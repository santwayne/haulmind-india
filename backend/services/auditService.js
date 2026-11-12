import { AuditLog } from '../models/systemModels.js';

const SKIP = new Set(['updatedAt', 'createdAt', '__v', 'history', 'password']);

// Field-level diff of two plain objects (only top level + one nested level)
export const diff = (before = {}, after = {}) => {
  const out = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const a = JSON.stringify(before?.[k] ?? null);
    const b = JSON.stringify(after?.[k] ?? null);
    if (a !== b) out[k] = { from: before?.[k] ?? null, to: after?.[k] ?? null };
  }
  return out;
};

export const audit = async (req, { action, entity, entityId, ref, branch, before, after, changes }) => {
  try {
    await AuditLog.create({
      user: req.user?._id,
      userName: req.user?.name,
      action,
      entity,
      entityId: entityId && String(entityId),
      ref,
      branch,
      changes: changes || (before || after ? diff(before, after) : undefined),
      ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim(),
    });
  } catch (e) {
    console.error('audit log failed', e.message); // never block the main action
  }
};
