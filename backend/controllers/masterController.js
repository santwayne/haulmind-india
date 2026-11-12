import { Branch, Party, Broker, Vehicle, RouteRate } from '../models/masterModels.js';
import { User } from '../models/userModel.js';
import { ah, ok, AppError, paginate, escapeRegex } from '../utils/http.js';
import { audit } from '../services/auditService.js';

/**
 * Generic CRUD for master data. Deletes are soft (active=false) so old LRs keep their links.
 * searchFields → used by ?q=
 */
const crud = (Model, { name, searchFields = ['name'], populate = '', soft = true, sort = { name: 1 } }) => ({
  list: ah(async (req, res) => {
    const { page, limit, skip } = paginate(req.query);
    const filter = {};
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(req.query.q), 'i');
      filter.$or = searchFields.map((f) => ({ [f]: rx }));
    }
    if (soft && req.query.all !== '1') filter.active = { $ne: false };
    const [items, total] = await Promise.all([
      Model.find(filter).populate(populate).sort(sort).skip(skip).limit(limit).lean(),
      Model.countDocuments(filter),
    ]);
    ok(res, { items, total, page, limit });
  }),
  get: ah(async (req, res) => {
    const doc = await Model.findById(req.params.id).populate(populate).lean();
    if (!doc) throw new AppError(404, `${name} not found`);
    ok(res, doc);
  }),
  create: ah(async (req, res) => {
    const doc = await Model.create(req.body);
    await audit(req, { action: 'create', entity: name, entityId: doc._id, ref: doc.name || doc.number || doc.code, after: doc.toObject() });
    ok(res, doc, `${name} created`, 201);
  }),
  update: ah(async (req, res) => {
    const before = await Model.findById(req.params.id).lean();
    if (!before) throw new AppError(404, `${name} not found`);
    const doc = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    await audit(req, { action: 'update', entity: name, entityId: doc._id, ref: doc.name || doc.number || doc.code, before, after: doc.toObject() });
    ok(res, doc, `${name} updated`);
  }),
  remove: ah(async (req, res) => {
    const doc = soft
      ? await Model.findByIdAndUpdate(req.params.id, { active: false }, { new: true })
      : await Model.findByIdAndDelete(req.params.id);
    if (!doc) throw new AppError(404, `${name} not found`);
    await audit(req, { action: 'delete', entity: name, entityId: doc._id, ref: doc.name || doc.number || doc.code });
    ok(res, null, `${name} removed`);
  }),
});

export const branchCtl = crud(Branch, { name: 'Branch', searchFields: ['name', 'code', 'city', 'state'], populate: 'parentHub', sort: { type: 1, name: 1 } });
export const partyCtl = crud(Party, { name: 'Party', searchFields: ['name', 'mobile', 'gstin', 'city'], populate: 'homeBranch broker' });
export const brokerCtl = crud(Broker, { name: 'Broker', searchFields: ['name', 'mobile'] });
export const vehicleCtl = crud(Vehicle, { name: 'Vehicle', searchFields: ['number', 'ownerName', 'driverName'], sort: { number: 1 } });
export const rateCtl = crud(RouteRate, { name: 'RouteRate', searchFields: [], populate: 'fromBranch toBranch', soft: false, sort: { createdAt: -1 } });

// Users need password handling, so they are separate
export const userCtl = {
  list: ah(async (req, res) => {
    const items = await User.find().populate('branches', 'name code').sort({ name: 1 }).lean();
    ok(res, { items, total: items.length });
  }),
  create: ah(async (req, res) => {
    const { name, username, mobile, password, role, branches, status } = req.body;
    if (!password || password.length < 6) throw new AppError(400, 'Password must be at least 6 characters');
    if (role === 'owner' && req.user.role !== 'owner') throw new AppError(403, 'Only the owner can create another owner');
    const u = await User.create({ name, username, mobile, password, role, branches, status });
    await audit(req, { action: 'create', entity: 'User', entityId: u._id, ref: u.username, changes: { role, branches } });
    ok(res, { ...u.toObject(), password: undefined }, 'User created', 201);
  }),
  update: ah(async (req, res) => {
    const u = await User.findById(req.params.id).select('+password');
    if (!u) throw new AppError(404, 'User not found');
    if ((u.role === 'owner' || req.body.role === 'owner') && req.user.role !== 'owner') throw new AppError(403, 'Only the owner can change an owner');
    const before = { role: u.role, branches: u.branches.map(String), status: u.status, name: u.name, mobile: u.mobile };
    for (const k of ['name', 'mobile', 'role', 'branches', 'status']) if (k in req.body) u[k] = req.body[k];
    if (req.body.password) u.password = req.body.password;
    await u.save();
    await audit(req, {
      action: 'update', entity: 'User', entityId: u._id, ref: u.username, before,
      after: { role: u.role, branches: u.branches.map(String), status: u.status, name: u.name, mobile: u.mobile, ...(req.body.password ? { passwordReset: true } : {}) },
    });
    ok(res, { ...u.toObject(), password: undefined }, 'User updated');
  }),
};
