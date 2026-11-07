# Checkout requirements

All amounts are integer cents. The cart already includes a coupon amount.
Feature A applies the coupon to merchandise. Feature B gives free shipping when
original merchandise subtotal is at least 10000 cents; otherwise shipping is
1000 cents. Shipping eligibility always uses the ORIGINAL merchandise subtotal,
regardless of coupon. Both features must survive integration.

For example, an original subtotal of 12000 with a coupon of 3000 totals 9000.
Coupons are nonnegative and do not exceed subtotal in the supported domain.
