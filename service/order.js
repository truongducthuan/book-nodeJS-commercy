const Item = require("../model/item");
const Order = require("../model/order");
const User = require("../model/user");
const Voucher = require("../model/voucher");
const FlashSale = require("../model/flashsale");

exports.createOrder = (value, req) => {
  return new Promise(async (resolve, reject) => {
    try {
      const user = await User.findById(req.user._id);
      if (user && user.role === "F2") {
        // add items for order
        const arrCart = user.cart.items;
        if (arrCart.length) {
          const handleArr = (arr, id) => {
            return arr.find((v) => v.toString() === id.toString());
          };
          const newArrOrder = arrCart.filter((v) =>
            handleArr(value.arrCartId, v._id)
          );
          const updateItem = arrCart.filter(
            (v) => !handleArr(value.arrCartId, v._id)
          );
          user.cart.items = updateItem;
          await user.save();

          // update quantity for order
          const newQuantity = newArrOrder.reduce((a, b) => {
            return a + b.quantity;
          }, 0);

          // Update mount
          let amount = 0;

          // Update count
          const arrId = newArrOrder.map((item) => item.itemId.toString());
          const items = await Item.find().where("_id", arrId);
          // let flashSale;
          const updateCount = async (arr, id, quantity) => {
            const item = arr.find((v) => v._id.toString() === id.toString());
            if (item.flashSaleId) {
              const flashSale = await FlashSale?.findById(item.flashSaleId);
              // update flashsale
              const quantitySale = flashSale.items.find((v) => {
                if (v.itemId.toString() === item._id.toString()) {
                  return v.quantity;
                }
              });
              if (item.flashSaleId) {
                if (
                  flashSale &&
                  flashSale.isActive &&
                  flashSale.end_date < Date.now() &&
                  flashSale.start_date > Date.now()
                ) {
                  item.pricePay = item.priceInput;
                  item.flashSaleId = null;
                  flashSale.isActive = false;
                } else if (quantitySale < 1) {
                  item.pricePay = item.priceInput;
                }
              }
              amount += item.pricePay;

              const updateFlashSale = flashSale?.items.find(
                (v) => v.itemId.toString() === item._id.toString()
              );
              const newQuantityFlashSale = +quantitySale.quantity - quantity;
              updateFlashSale.quantity = newQuantityFlashSale;
              await flashSale.save();
            }
            const newQuantity = item.count - quantity;
            item.count = newQuantity;
            await item.save();
          };
          for (let i = 0; i < newArrOrder.length; i++) {
            await updateCount(
              items,
              newArrOrder[i].itemId,
              +newArrOrder[i].quantity
            );
          }

          // Apply voucher
          if (value.voucherCode) {
            const voucher = await Voucher.findOne({ code: value.voucherCode });
            if (
              new Date().getTime() < voucher.expirationDate &&
              voucher.quantity > 0 &&
              voucher.isActive === true
            ) {
              amount = (amount - (amount * +voucher.discount) / 100).toFixed(2);
              voucher.quantity = voucher.quantity - 1;
              await voucher.save();
            } else {
              voucher.isActive = false;
              await voucher.save();
            }
          }

          const order = new Order({
            userId: user._id,
            amount: amount,
            quantity: newQuantity,
            items: newArrOrder,
          });
          if (order) {
            const updateOrder = await order.save();
            resolve({
              status: 200,
              message: "ok",
              data: updateOrder,
            });
          }
        } else {
          resolve({
            status: 404,
            message: "Not found item in the cart",
          });
        }
      } else {
        resolve({
          status: 403,
          message: "User invalid",
        });
      }
    } catch (err) {
      reject(err);
    }
  });
};
