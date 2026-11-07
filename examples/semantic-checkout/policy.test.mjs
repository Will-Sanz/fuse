import assert from 'node:assert/strict';
import { test } from 'node:test';
test('original-subtotal policy and preserved coupon feature', async () => {
  const { merchandiseTotal, shippingFee, orderTotal } = await import('./checkout.ts');
  // Independent business-policy oracle, not the candidate implementation.
  for (const [subtotalCents, couponCents, merchandise, shipping, total] of [
    [12000, 3000, 9000, 0, 9000],
    [10000, 1, 9999, 0, 9999],
    [9999, 500, 9499, 1000, 10499],
    [12000, 0, 12000, 0, 12000],
    [10000, 0, 10000, 0, 10000],
    [8000, 0, 8000, 1000, 9000],
  ]) {
    const cart = { subtotalCents, couponCents };
    assert.equal(merchandiseTotal(cart), merchandise, 'coupon preserved');
    assert.equal(
      shippingFee(cart),
      shipping,
      `original-subtotal eligibility: ${subtotalCents}/${couponCents}`,
    );
    assert.equal(orderTotal(cart), total, 'combined total');
  }
  console.log('PASS: coupon, original-subtotal eligibility, exact/below threshold and zero coupon');
});
