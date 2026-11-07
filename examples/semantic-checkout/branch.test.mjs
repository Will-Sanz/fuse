import assert from 'node:assert/strict';
import { merchandiseTotal, shippingFee } from './checkout.ts';
const cart = { subtotalCents: 12000, couponCents: 3000 };
if (process.argv[2] === 'coupon') assert.equal(merchandiseTotal(cart), 9000);
else {
  assert.equal(shippingFee(cart), 0);
  assert.equal(shippingFee({ subtotalCents: 9999, couponCents: 0 }), 1000);
  assert.equal(shippingFee({ subtotalCents: 10000, couponCents: 0 }), 0);
}
console.log('PASS: independent feature');
