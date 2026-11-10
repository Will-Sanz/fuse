import type { VisualSpec } from '../../shared/visual';

const node = (
  x: number,
  y: number,
  text: string,
  detail: string,
  tone: VisualSpec['elements'][number]['tone'],
): VisualSpec['elements'][number] => ({
  type: 'panel',
  x,
  y,
  width: 400,
  height: 160,
  text,
  detail,
  tone,
});
const arrow = (
  x: number,
  y: number,
  width: number,
  height: number,
): VisualSpec['elements'][number] => ({
  type: 'arrow',
  x,
  y,
  width,
  height,
  text: '',
  detail: '',
  tone: 'neutral',
});
export const technicalVisual: VisualSpec = {
  title: 'Coupon changes a value consumed by shipping',
  summary: 'Should shipping eligibility use the original subtotal?',
  metaphor: 'Changed functions, data dependency, and proposed correction',
  elements: [
    node(40, 40, 'A: merchandiseTotal', '12000 - 3000\n= 9000 cents', 'a'),
    node(550, 40, 'B: shippingFee', '9000 < 10000\nshipping = 1000', 'b'),
    node(550, 300, 'Proposed correction', 'cart.subtotalCents\n>= 10000', 'success'),
    node(40, 300, 'Expected orderTotal', '9000 + 0\n= 9000 cents', 'neutral'),
    arrow(440, 120, 110, 0),
    arrow(750, 200, 0, 100),
    arrow(550, 380, -110, 0),
  ],
  options: [
    { action: 'a', label: 'Original subtotal', description: 'Use original subtotal.' },
    { action: 'b', label: 'Discounted subtotal', description: 'Use discounted subtotal.' },
  ],
};
