import { Counter } from '../models/masterModels.js';

// Indian financial year tag, e.g. Nov 2026 → "2627"
export const fyTag = (d = new Date()) => {
  const y = d.getFullYear() % 100;
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).padStart(2, '0')}${String(start + 1).padStart(2, '0')}`;
};

/**
 * Atomic running number per branch, per financial year, per document type.
 *   LR      → LDH-2627-00001
 *   Challan → LDH-CH-2627-0001
 *   DC      → LDH-DC-2627-0001
 */
export const nextNumber = async (kind, branchCode, date = new Date()) => {
  const fy = fyTag(date);
  const key = `${kind}:${branchCode}:${fy}`;
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  if (kind === 'LR') return `${branchCode}-${fy}-${String(c.seq).padStart(5, '0')}`;
  return `${branchCode}-${kind}-${fy}-${String(c.seq).padStart(4, '0')}`;
};
