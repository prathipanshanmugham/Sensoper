/* The quotation / sale arithmetic, the same as the server (sales._price_lines and _sale_totals), so a screen shows
 * the total that will be saved: line discount, then a discount on the whole order spread over the lines by value
 * (biggest line takes the odd paisa), GST on the discounted value, CGST + SGST split or IGST, rounded to the rupee. */
export const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
export const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

export function priceIt(lines, billDiscount, interState, autoRound = true) {
  const base = lines.map((l) => {
    const gross = num(l.quantity) * num(l.unit_price);
    return Math.max(gross - gross * num(l.discount_pct) / 100, 0);
  });
  const total = base.reduce((a, b) => a + b, 0);
  const hd = Math.min(Math.max(num(billDiscount), 0), total);
  let shares = base.map((b) => (total > 0 ? r2(hd * b / total) : 0));
  if (hd > 0 && total > 0) {
    const big = base.indexOf(Math.max(...base));
    shares[big] = r2(shares[big] + r2(hd - shares.reduce((a, b) => a + b, 0)));
  } else shares = base.map(() => 0);
  let subtotal = 0, disc = 0, taxable = 0, gst = 0;
  const rows = lines.map((l, i) => {
    const gross = num(l.quantity) * num(l.unit_price);
    const d = gross * num(l.discount_pct) / 100;
    const t = gross - d - shares[i];
    const g = t * num(l.gst_percentage, 18) / 100;
    subtotal += gross; disc += d + shares[i]; taxable += t; gst += r2(g);
    return { taxable: t, gst: g, total: t + g };
  });
  const gstTotal = r2(gst);
  const cgst = interState ? 0 : r2(gstTotal / 2);
  const before = r2(r2(taxable) + gstTotal);
  const roundOff = autoRound ? r2(Math.round(before) - before) : 0;
  return { rows, subtotal: r2(subtotal), discount: r2(disc), taxable: r2(taxable), gst: gstTotal, cgst, sgst: interState ? 0 : r2(gstTotal - cgst), igst: interState ? gstTotal : 0, roundOff, grand: r2(before + roundOff) };
}

