import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

/**
 * Challan = one truck load. Used for both
 *   dispatch  – booking branch → destination branch
 *   transfer  – branch → branch (e.g. Tiruppur hub → Ludhiana hub → Jalandhar)
 * Status: in_transit → partially_received → received   (or cancelled)
 */
const lineSchema = new mongoose.Schema(
  {
    lr: { type: ObjectId, ref: 'LR', required: true },
    lrNo: String,
    nag: Number,
    weight: Number,
    // Filled at unloading
    unloaded: { type: Boolean, default: false },
    receivedNag: Number,
    shortNag: { type: Number, default: 0 },
    damagedNag: { type: Number, default: 0 },
    damageRemark: String,
    unloadedAt: Date,
  },
  { _id: false }
);

const challanSchema = new mongoose.Schema(
  {
    challanNo: { type: String, required: true, unique: true },
    type: { type: String, enum: ['dispatch', 'transfer'], default: 'dispatch' },
    fromBranch: { type: ObjectId, ref: 'Branch', required: true },
    toBranch: { type: ObjectId, ref: 'Branch', required: true },
    vehicle: { type: ObjectId, ref: 'Vehicle' },
    vehicleNo: String,
    driverName: String,
    driverMobile: String,
    transporter: String,
    lorryHire: { type: Number, default: 0 },
    advancePaid: { type: Number, default: 0 },
    dispatchedAt: { type: Date, default: Date.now },
    expectedAt: Date,
    lines: [lineSchema],
    totalNag: Number,
    totalWeight: Number,
    status: {
      type: String,
      enum: ['in_transit', 'partially_received', 'received', 'cancelled'],
      default: 'in_transit',
      index: true,
    },
    arrivedAt: Date,
    unloadedBy: { type: ObjectId, ref: 'User' },
    remarks: String,
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

challanSchema.index({ fromBranch: 1, dispatchedAt: -1 });
challanSchema.index({ toBranch: 1, status: 1 });
challanSchema.index({ 'lines.lr': 1 });

export const Challan = mongoose.model('Challan', challanSchema);
