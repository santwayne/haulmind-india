import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../middleware/authRoles.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    mobile: { type: String, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'booking_clerk' },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.checkPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export const User = mongoose.model('User', userSchema);
