export class AppError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Wrap async controllers so thrown errors reach the error handler
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const ok = (res, data, message = 'ok', status = 200) =>
  res.status(status).json({ success: true, message, data });

export const paginate = (q) => {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 25));
  return { page, limit, skip: (page - 1) * limit };
};

export const dayRange = (from, to) => {
  const start = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
  const end = to ? new Date(to) : new Date(start);
  if (!to) end.setHours(23, 59, 59, 999);
  else end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

export const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
