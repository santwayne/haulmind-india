import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

// ── Branch ────────────────────────────────────────────────────────────────
const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // LDH, TPR …
    type: { type: String, enum: ['hub', 'branch'], default: 'branch' },
    state: { type: String, trim: true },
    city: { type: String, trim: true },
    address: String,
    phone: String,
    managerName: String,
    gstin: String,
    parentHub: { type: ObjectId, ref: 'Branch' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const Branch = mongoose.model('Branch', branchSchema);

// ── Party (consignor / consignee / billing party) ─────────────────────────
const partySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, trim: true },
    altMobile: String,
    email: String,
    address: String,
    city: String,
    state: String,
    pincode: String,
    gstin: { type: String, uppercase: true, trim: true },
    homeBranch: { type: ObjectId, ref: 'Branch' },
    broker: { type: ObjectId, ref: 'Broker' },
    creditLimit: { type: Number, default: 0 }, // warning when outstanding + new LR crosses this
    creditDays: { type: Number, default: 30 }, // bill due date = bill date + creditDays
    openingBalance: { type: Number, default: 0 }, // + party owes us, − we owe party (taken over from Vouch)
    openingDate: Date,
    lastReminderAt: Date, // 15-day payment reminder
    whatsappOptIn: { type: Boolean, default: true },
    // Party-specific freight rates (overrides branch defaults)
    rates: [
      {
        toBranch: { type: ObjectId, ref: 'Branch' },
        perKg: Number,
        perNag: Number,
        minFreight: Number,
      },
    ],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
partySchema.index({ name: 'text', mobile: 'text' });
partySchema.index({ mobile: 1 });
export const Party = mongoose.model('Party', partySchema);

// ── Broker ────────────────────────────────────────────────────────────────
const brokerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: String,
    address: String,
    commissionType: { type: String, enum: ['percent', 'fixed_per_lr'], default: 'percent' },
    commissionValue: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const Broker = mongoose.model('Broker', brokerSchema);

// ── Vehicle / transporter ─────────────────────────────────────────────────
const vehicleSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ['own', 'hired', 'transporter'], default: 'hired' },
    ownerName: String,
    ownerMobile: String,
    driverName: String,
    driverMobile: String,
    capacityKg: Number,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const Vehicle = mongoose.model('Vehicle', vehicleSchema);

// ── Default route rates (branch → branch) ─────────────────────────────────
const rateSchema = new mongoose.Schema(
  {
    fromBranch: { type: ObjectId, ref: 'Branch', required: true },
    toBranch: { type: ObjectId, ref: 'Branch', required: true },
    perKg: { type: Number, default: 0 },
    perNag: { type: Number, default: 0 },
    minFreight: { type: Number, default: 0 },
    biltyCharge: { type: Number, default: 0 },
  },
  { timestamps: true }
);
rateSchema.index({ fromBranch: 1, toBranch: 1 }, { unique: true });
export const RouteRate = mongoose.model('RouteRate', rateSchema);

// ── Counter for running numbers (LR, challan, DC) ─────────────────────────
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = mongoose.model('Counter', counterSchema);
