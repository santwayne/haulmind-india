import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { User } from '../models/userModel.js';
import { ah, ok, AppError } from '../utils/http.js';
import { audit } from '../services/auditService.js';

const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  username: u.username,
  mobile: u.mobile,
  role: u.role,
  branches: u.branches,
  allBranches: ['owner', 'admin'].includes(u.role),
});

export const login = ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) throw new AppError(400, 'Username and password are required');
  const user = await User.findOne({ username: String(username).toLowerCase().trim() })
    .select('+password')
    .populate('branches', 'name code type');
  if (!user || !(await user.checkPassword(password))) throw new AppError(401, 'Wrong username or password');
  if (user.status !== 'active') throw new AppError(403, 'Your account is not active. Contact the owner.');
  user.lastLoginAt = new Date();
  await user.save();
  const token = jwt.sign({ id: user._id, role: user.role }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES });
  req.user = user;
  await audit(req, { action: 'login', entity: 'User', entityId: user._id, ref: user.username });
  ok(res, { token, user: publicUser(user) }, 'Login successful');
});

export const me = ah(async (req, res) => ok(res, publicUser(req.user)));

export const changePassword = ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) throw new AppError(400, 'New password must be at least 6 characters');
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.checkPassword(currentPassword || ''))) throw new AppError(400, 'Current password is wrong');
  user.password = newPassword;
  await user.save();
  ok(res, null, 'Password changed');
});
