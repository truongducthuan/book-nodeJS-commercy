'use strict'

const _Order = require("../model/order.model.js");
const { acquireLock, releaseLock } = require('./redis.service.js')
const { BadRequestError, NotFoundError } = require('../core/error.response.js')
const { orderReview } = require('../model/repositories/checkout.repo.js')
const { addStockToInventory } = require('./inventory.service.js')
const { ORDER_STATUS } = require('../common/constant.js')

class OrderService  {
  static async orderByUser({shop_order_ids, cartId, user_address = {}, user_payment = {}, user}) {
    const { 
      shop_order_ids_new,
      checkout_order 
    } = await orderReview({cartId, shop_order_ids, userId: user.userId})

    const products = shop_order_ids_new.flatMap(order => order.item_products)
    const acquireProduct = []
    for(let i = 0; i < products.length; i++) {
      const { quantity, productId } = products[i]
      const keyLock = await acquireLock(productId, quantity, cartId)

      acquireProduct.push(keyLock ? true : false)
      if(keyLock) await releaseLock(keyLock)
    }
    if(acquireProduct.includes(false)) {
      throw new BadRequestError('Some product is added please  come back')
    }
    const newOrder = await _Order.create({
      order_userId: user.userId,
      order_checkout: checkout_order,
      order_shipping: user_address,
      order_payment: user_payment,
      order_products: shop_order_ids
    })

    // update inventory
    for(let i = 0; i < products.length; i++) {
      const { productId, quantity } = products[i]
      await addStockToInventory({productId, shopId: user.shopId, quantity: -quantity})
    }

    return newOrder
  }

  static async cancelOrder({orderId, shop_order_ids}) {
    const products = shop_order_ids.flatMap(order => order.item_products)
    for(let i = 0; i < products.length; i++) {
      const { productId, quantity, shopId } = products[i]
      await addStockToInventory({productId, shopId, quantity: quantity})
    }

    // update order
    const foundOrder = await _Order.findByIdAndUpdate(orderId, {order_status: ORDER_STATUS.cancelled})
    if(!foundOrder) throw new NotFoundError('Not found order')

    return foundOrder
  }

  static async changeOrderStatus({orderId, status}) {
    const foundOrder = await _Order.findByIdAndUpdate(orderId, {order_status: status})
    if(!foundOrder) throw new NotFoundError('Not found order')

    return foundOrder ? 1 : 0
  }

  static async getOrderByProduct({productId, page, limit}) {
    const foundOrder = await _Order.findOne({order_products: { $elemMatch: { productId }}}).paginate(page, limit).lean()
    if(!foundOrder) throw new NotFoundError('Not found order')

    return foundOrder
  }

  static async getOrderByUser(userId, page, limit) {
    const foundOrder = await _Order.findOne({order_userId: userId}).paginate(page, limit).lean()
    if(!foundOrder) throw new NotFoundError('Not found order')

    return foundOrder
  }

  static async getOrderByShop(shopId, page, limit) {
    const query = {
      "order_checkout": {
        $elemMatch: {
          shopId: shopId
        }
      }
    }
    const foundOrder = await _Order.find(query).paginate(page, limit).lean()
    if(!foundOrder) throw new NotFoundError('Not found order')

    return foundOrder
  }

  static async getOrderByAdmin(user, page, limit) {
    if(!user.permit.permit_admin) {
      throw new ForbiddenError('Not permission')
    }
    const foundOrder = await _Order.find().sort({createdAt: -1}).paginate(page, limit).lean()
    if(!foundOrder) throw new NotFoundError('Not found order')

    return foundOrder
  }
}

module.exports = OrderService

// exports.createOrder = (value, req) => {
//   return new Promise(async (resolve, reject) => {
//     try {
//       const user = await _User.findById(req.user._id)
//         .populate("cart.itemId")
//         .select("-password");
//       if (user && user.role !== "F1") {
//         // add items for order
//         const arrCart = user.cart;
//         if (arrCart.length) {
//           const handleArr = (arr, id) => {
//             return arr.find((v) => v.toString() === id.toString());
//           };
//           const newArrOrder = arrCart.filter((v) =>
//             handleArr(value.arrCartId, v._id)
//           );
//           const updateItem = arrCart.filter(
//             (v) => !handleArr(value.arrCartId, v._id)
//           );
//           user.cart = updateItem;
//           const updateUser = await user.save();

//           // update quantity for order
//           const newQuantity = newArrOrder.reduce((a, b) => {
//             return a + b.quantity;
//           }, 0);

//           // Update mount
//           let amount = 0;

//           // Update count
//           const arrId = newArrOrder.map((item) => item.itemId._id.toString());
//           const items = await _Item.find().where("_id", arrId);
//           // let flashSale;
//           const updateCount = async (arr, id, quantity) => {
//             const item = arr.find((v) => v._id.toString() === id.toString());
//             if (item.flashSaleId) {
//               const flashSale = await _FlashSale.findById(item.flashSaleId);
//               // update flashsale
//               if (flashSale) {
//                 const quantitySale = flashSale.items.find((v) => {
//                   if (v.itemId.toString() === item._id.toString()) {
//                     return v;
//                   }
//                 });
//                 if (
//                   flashSale &&
//                   flashSale.end_date < Date.now() &&
//                   flashSale.start_date > Date.now() &&
//                   quantitySale.quantity < 1
//                 ) {
//                   item.pricePay = item.priceInput;
//                   item.flashSaleId = null;
//                 }
//                 amount += item.pricePay * +quantity;

//                 const updateFlashSaleItem = flashSale.items.find(
//                   (v) => v.itemId.toString() === item._id.toString()
//                 );

//                 const newQuantityFlashSale = +quantitySale.quantity - +quantity;
//                 updateFlashSaleItem.quantity = newQuantityFlashSale;
//                 await flashSale.save();
//               }
//               // }
//             } else {
//               amount += item.pricePay * +quantity;
//             }
//             // update Item
//             const newQuantity = item.count - quantity;
//             const newPaid = item.paid + quantity;
//             item.count = newQuantity;
//             item.paid = newPaid;;
//             await item.save();
//           };
//           for (let i = 0; i < newArrOrder.length; i++) {
//             await updateCount(
//               items,
//               newArrOrder[i].itemId._id,
//               +newArrOrder[i].quantity
//             );
//           }
//           // Apply voucher
//           let voucherId;
//           if (value.voucherCode) {
//             const voucher = await _Voucher.findOne({ code: value.voucherCode });
//             if (
//               voucher &&
//               Date.now() < voucher.expirationDate &&
//               voucher.quantity > 0
//             ) {
//               amount = Math.floor(amount - (amount * +voucher.discount) / 100);
//               voucher.quantity = voucher.quantity - 1;
//               voucherId = voucher._id;
//               await voucher.save();
//             }
//           }

//           const order = new _Order({
//             userId: user._id,
//             amount: amount,
//             quantity: newQuantity,
//             items: newArrOrder,
//             voucherId: voucherId ?? null,
//             methodPay: value.methodPay,
//           });
//           if (order) {
//             const updateOrder = await order.save();
//             const arrItemId = updateOrder.items.map((i) => i.itemId);
//             sendMail(
//               user.email,
//               user.username,
//               arrItemId,
//               updateOrder.createdAt,
//               newQuantity,
//               amount
//             );
//             resolve({
//               status: 200,
//               message: "ok",
//               data: {
//                 updateOrder,
//                 updateUser,
//               },
//             });
//           }
//         } else {
//           resolve({
//             status: 404,
//             message: "Not found item in the cart",
//           });
//         }
//       } else {
//         resolve({
//           status: 403,
//           message: "User invalid",
//         });
//       }
//     } catch (err) {
//       reject(err);
//     }
//   });
// };

// exports.getOrder = (page, limit, type, column, req) => {
//   return new Promise(async (resolve, reject) => {
//     try {
//       const user = await _User.findById(req.user._id);
//       if (user && user.role === "F2") {
//         const orders = await _Order.find({ userId: req.user._id })
//           .populate("userId", '-password')
//           .populate("items.itemId")
//           .sort({ createdAt: -1 });

//         if (orders.length) {
//           const data = pageSection(page, limit, orders);

//           resolve({
//             status: 200,
//             message: "ok",
//             data: {
//               orders: data.result,
//               totalPage: data.totalPage,
//               totalOrder: orders.length,
//               currPage: page,
//               nextPage: +page * +limit < orders.length,
//               prevPage: +page > 1,
//             },
//           });
//         }
//       } else if (user && user.role === "F3") {
//         const orders = await Order.find()
//           .populate("userId", "-password")
//           .populate("items.itemId")
//           .sort([[column, type]]);
//         if (orders.length) {
//           const data = pageSection(page, limit, orders);

//           resolve({
//             status: 200,
//             message: "ok",
//             data: {
//               orders: data.result,
//               totalPage: data.totalPage,
//               totalOrder: orders.length,
//               currPage: page,
//               nextPage: +page * +limit < orders.length,
//               prevPage: +page > 1,
//             },
//           });
//         }
//       } else {
//         resolve({
//           status: 403,
//           message: "Unauthorized!",
//         });
//       }
//     } catch (err) {
//       reject(err);
//     }
//   });
// };

// exports.getRevenue = async(type, year) => {
//   try{
//     const orders = await _Order.find();
//     const newArray = [];
//     const result = {};
//     const totalMount = orders.reduce((a,b) => a + b.amount , 0);
//     if(type === 'month') {
//       for(const value of orders) {
//         let object = {};
//         if(+year != getFormatYear(value.createdAt)) continue;
//         const key = getFormatMonth(value.createdAt)
//         object[key] = value.amount;
//         newArray.push(object)
//       }
//       let sum = 0;
//       for (const value of newArray) {
//         const key = Object.keys(value);
//         const values = Object.values(value);
//         sum += +values;
//         result[key] = sum;
//       }
//     }else {
//       for (const value of orders) {
//         let object = {};
//         const key = getFormatYear(value.createdAt);
//         object[key] = value.amount;
//         newArray.push(object);
//       }
//       let sum = 0;
//       for(const value of newArray) {
//         const key = Object.keys(value);
//         const values = Object.values(value);
//         sum += +values
//         result[key] = sum;
//       }
//     }
//     if (result) {
//       return {
//         status: 201,
//         message: "ok",
//         data: {
//           totalMount,
//           result
//         },
//       };
//     }
//   }catch(err) {
//     return {
//       status: 500,
//       message: 'Error from server'
//     }
//   }
// }
