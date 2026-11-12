import { Party, RouteRate } from '../models/masterModels.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Freight calculation (point 14: फ्रेट कैलकुलेशन)
 * Rate priority: party-specific rate for this destination → route rate → manual.
 * basic = max(weight × perKg  or  nag × perNag, minFreight)
 */
export const findRate = async ({ fromBranch, toBranch, partyId }) => {
  if (partyId) {
    const party = await Party.findById(partyId).lean();
    const pr = party?.rates?.find((r) => String(r.toBranch) === String(toBranch));
    if (pr) return { source: 'party', perKg: pr.perKg || 0, perNag: pr.perNag || 0, minFreight: pr.minFreight || 0 };
  }
  const rr = await RouteRate.findOne({ fromBranch, toBranch }).lean();
  if (rr) return { source: 'route', perKg: rr.perKg, perNag: rr.perNag, minFreight: rr.minFreight, biltyCharge: rr.biltyCharge };
  return { source: 'none', perKg: 0, perNag: 0, minFreight: 0 };
};

export const computeFreight = (input = {}, totals = {}) => {
  const f = { ...input };
  const basis = f.basis || 'weight';
  const rate = Number(f.rate) || 0;
  let basic = Number(f.basicFreight) || 0;
  if (basis === 'weight' && rate) basic = totals.weight * rate;
  if (basis === 'nag' && rate) basic = totals.nag * rate;
  if (f.minFreight && basic < f.minFreight) basic = Number(f.minFreight);
  const sub =
    basic + (Number(f.biltyCharge) || 0) + (Number(f.hamali) || 0) +
    (Number(f.doorDelivery) || 0) + (Number(f.otherCharges) || 0);
  const gstPercent = Number(f.gstPercent) || 0;
  const gstAmount = (sub * gstPercent) / 100;
  return {
    basis,
    rate,
    basicFreight: r2(basic),
    biltyCharge: r2(f.biltyCharge),
    hamali: r2(f.hamali),
    doorDelivery: r2(f.doorDelivery),
    otherCharges: r2(f.otherCharges),
    gstPercent,
    gstAmount: r2(gstAmount),
    total: r2(sub + gstAmount),
  };
};

export const itemTotals = (items = []) => ({
  nag: items.reduce((s, i) => s + (Number(i.nag) || 0), 0),
  weight: items.reduce((s, i) => s + (Number(i.chargedWeight) || Number(i.actualWeight) || 0), 0),
});
