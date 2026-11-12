import mongoose from 'mongoose';
import { AppError } from '../utils/http.js';

const oid = (x) => new mongoose.Types.ObjectId(String(x));

/**
 * Roles
 *  owner          – full access to every branch (transport company owner)
 *  admin          – head-office admin, every branch
 *  branch_manager – everything inside own branch(es)
 *  booking_clerk  – LR booking, dispatch, unloading, delivery inside own branch(es)
 *  accountant     – billing, receipts, ledgers, broker payments + masters
 *  viewer         – read only
 */
export const ROLES = ['owner', 'admin', 'branch_manager', 'booking_clerk', 'accountant', 'viewer'];

export const OPS_ROLES = ['owner', 'admin', 'branch_manager', 'booking_clerk'];
export const MANAGER_ROLES = ['owner', 'admin', 'branch_manager'];
export const HQ_ROLES = ['owner', 'admin'];
export const ACCOUNTS_ROLES = ['owner', 'admin', 'branch_manager', 'accountant'];

export const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
  if (roles.includes(req.user.role)) return next();
  return res.status(403).json({
    success: false,
    message: `Access denied. Your role (${req.user.role}) cannot do this.`,
  });
};

// Branch scoping: owner/admin see all, others only their branches
export const canUseBranch = (req, branchId) =>
  req.allBranches || req.branchIds.includes(String(branchId));

export const assertBranch = (req, branchId) => {
  if (!canUseBranch(req, branchId)) throw new AppError(403, 'You do not have access to this branch');
};

// Mongo filter limiting a query to the branches the user may see.
// Uses ObjectIds so the same filter works in find() and aggregate().
export const branchFilter = (req, fields = ['bookingBranch']) => {
  const wanted = req.query.branch;
  if (wanted) {
    assertBranch(req, wanted);
    return { $or: fields.map((f) => ({ [f]: oid(wanted) })) };
  }
  if (req.allBranches) return {};
  const ids = req.branchIds.map(oid);
  return { $or: fields.map((f) => ({ [f]: { $in: ids } })) };
};
