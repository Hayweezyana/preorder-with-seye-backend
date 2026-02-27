import type { CartDocument } from "../models/cart.js";

export function calculateCartTotals(cart: Pick<CartDocument, "lines">) {
  const subtotalNgn = cart.lines.reduce((acc, item) => acc + item.quantity * item.unitPriceNgn, 0);
  const shippingNgn = subtotalNgn > 0 ? 2500 : 0;
  const totalNgn = subtotalNgn + shippingNgn;

  return { subtotalNgn, shippingNgn, totalNgn };
}
