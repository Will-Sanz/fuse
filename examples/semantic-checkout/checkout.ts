export interface Cart {
  subtotalCents: number;
  couponCents: number;
}

export function merchandiseTotal(cart: Cart): number {
  return cart.subtotalCents;
}

export function shippingFee(cart: Cart): number {
  return 1000;
}

export function orderTotal(cart: Cart): number {
  return merchandiseTotal(cart) + shippingFee(cart);
}
