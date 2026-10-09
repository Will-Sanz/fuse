import type { Input } from './types';
const base = `type Order = { email?: string; items?: string[] };
type Result = { ok: boolean; error?: string };

export function requestHandler(order: Order): Result {
  const result = validateBody(order);
  if (!result.ok) return result;
  return sendResponse(order);
}

function validateBody(order: Order): Result {
  return { ok: true };
}

function schemaCheck(order: Order): Result {
  if (typeof order.email !== "string" || !order.email.includes("@")) {
    return { ok: false, error: "email: enter a valid email address" };
  }
  if (!Array.isArray(order.items) || order.items.some(item => typeof item !== "string")) {
    return { ok: false, error: "items: expected a list of product names" };
  }
  return { ok: true };
}

function sendResponse(order: Order): Result {
  return { ok: true };
}
`;
export const checkoutExample: Input = {
  title: 'Checkout validation',
  fileName: 'checkout.ts',
  nameA: 'Request validation',
  nameB: 'Schema validation',
  base,
  agentA: base.replace(
    'function validateBody(order: Order): Result {',
    `function validateBody(order: Order): Result {
  if (!order.email || !order.items || order.items.length === 0) {
    return { ok: false, error: "Your order is incomplete" };
  }`,
  ),
  agentB: base.replace(
    'function validateBody(order: Order): Result {',
    `function validateBody(order: Order): Result {
  const schema = schemaCheck(order);
  if (!schema.ok) return schema;`,
  ),
};
const shippingBase = `export function shippingCost(subtotal: number, discount: number): number {
  return 10;
}

export function orderTotal(subtotal: number, discount: number): number {
  return subtotal - discount + shippingCost(subtotal, discount);
}
`;
export const shippingExample: Input = {
  title: 'Free shipping after discounts',
  fileName: 'shipping.ts',
  nameA: 'Discounted subtotal',
  nameB: 'Original subtotal',
  base: shippingBase,
  agentA: shippingBase.replace(
    '  return 10;',
    '  const eligibleTotal = subtotal - discount;\n  return eligibleTotal >= 100 ? 0 : 10;',
  ),
  agentB: shippingBase.replace('  return 10;', '  return subtotal >= 100 ? 0 : 10;'),
};
