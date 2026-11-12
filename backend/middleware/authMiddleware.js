import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { User } from '../models/userModel.js';

// Same pattern as Logistiq: Bearer token → load user → block inactive accounts
export const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findById(decoded.id).populate('branches', 'name code').lean();
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });
    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your account is not active. Contact the owner.' });
    }
    req.user = user;
    req.allBranches = ['owner', 'admin'].includes(user.role);
    req.branchIds = user.branches.map((b) => String(b._id));
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Session expired, please log in again' });
  }
};
