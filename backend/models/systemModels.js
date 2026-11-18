import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

// Who changed or deleted what (point 14: ऑडिट लॉग)
const auditSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User' },
    userName: String,
    action: { type: String, enum: ['create', 'update', 'delete', 'cancel', 'status', 'login'], required: true },
    entity: { type: String, required: true }, // LR, Challan, Party …
    entityId: String,
    ref: String, // human readable no. (LR no. etc.)
    branch: { type: ObjectId, ref: 'Branch' },
    changes: mongoose.Schema.Types.Mixed, // { field: { from, to } }
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditSchema.index({ entity: 1, entityId: 1 });
auditSchema.index({ createdAt: -1 });
export const AuditLog = mongoose.model('AuditLog', auditSchema);

// Every WhatsApp / SMS sent (or failed) – useful for proving "party was informed"
const notificationSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['whatsapp', 'sms', 'log'], default: 'log' },
    // out = we sent it; in = customer messaged the business number (WhatsApp webhook)
    direction: { type: String, enum: ['out', 'in'], default: 'out' },
    event: String, // lr_booked, lr_unloaded, lr_delivered, dispatch_alert, payment_reminder, incoming
    to: String, // for direction "in" this is the sender's number
    senderName: String, // WhatsApp profile name of an incoming sender
    party: { type: ObjectId, ref: 'Party' },
    lr: { type: ObjectId, ref: 'LR' },
    message: String,
    // logged = provider is "log": saved here only, NOT delivered to the customer
    // delivered / read come from the WhatsApp webhook; received = incoming message
    status: { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'logged', 'failed', 'skipped', 'received'], default: 'queued' },
    error: String,
    providerId: String,
    deliveredAt: Date,
    readAt: Date,
  },
  { timestamps: true }
);
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ providerId: 1 }, { sparse: true });
export const Notification = mongoose.model('Notification', notificationSchema);

// In-app alert for a branch (e.g. "truck PB10 dispatched to you with 14 LRs")
const branchAlertSchema = new mongoose.Schema(
  {
    branch: { type: ObjectId, ref: 'Branch', required: true },
    title: String,
    body: String,
    link: String,
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);
branchAlertSchema.index({ branch: 1, read: 1, createdAt: -1 });
export const BranchAlert = mongoose.model('BranchAlert', branchAlertSchema);

// Damage / shortage claim (point 14: डैमेज क्लेम)
const claimSchema = new mongoose.Schema(
  {
    lr: { type: ObjectId, ref: 'LR', required: true },
    lrNo: String,
    challan: { type: ObjectId, ref: 'Challan' },
    branch: { type: ObjectId, ref: 'Branch' },
    type: { type: String, enum: ['short', 'damage', 'lost'], required: true },
    nag: Number,
    remark: String,
    claimAmount: { type: Number, default: 0 },
    settledAmount: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'settled', 'rejected'], default: 'open' },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
export const Claim = mongoose.model('Claim', claimSchema);
