import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

/**
 * Phase 2 – billing & payments (requirement points 7, 8, 9)
 *
 * Money moves are written once, as LedgerEntry rows. Balances, party ledger,
 * broker ledger and outstanding all come from these rows, so the numbers on
 * every screen always agree.
 *
 *   Party ledger  : debit = party owes us (bill)        credit = party paid (receipt)
 *   Broker ledger : credit = we owe broker (commission) debit  = we paid broker
 */

// ── Bill (party bill built from many LRs) ─────────────────────────────────
const billLineSchema = new mongoose.Schema(
  {
    lr: { type: ObjectId, ref: 'LR', required: true },
    lrNo: String,
    lrDate: Date,
    route: String, // "TPR → LDH"
    consignor: String,
    consignee: String,
    nag: Number,
    weight: Number,
    paymentType: String,
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    billNo: { type: String, required: true, unique: true },
    billDate: { type: Date, default: Date.now },
    dueDate: Date,
    branch: { type: ObjectId, ref: 'Branch', required: true }, // branch raising the bill
    party: { type: ObjectId, ref: 'Party', required: true },
    partyName: String,
    lines: { type: [billLineSchema], validate: (v) => v.length > 0 },
    subTotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    received: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    status: { type: String, enum: ['unpaid', 'partial', 'paid', 'cancelled'], default: 'unpaid', index: true },
    remarks: String,
    cancelReason: String,
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
billSchema.index({ party: 1, status: 1, billDate: 1 });
billSchema.index({ branch: 1, billDate: -1 });
export const Bill = mongoose.model('Bill', billSchema);

// ── Receipt (money received from party) ───────────────────────────────────
const allocationSchema = new mongoose.Schema(
  { bill: { type: ObjectId, ref: 'Bill', required: true }, billNo: String, amount: { type: Number, required: true } },
  { _id: false }
);

const receiptSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now },
    branch: { type: ObjectId, ref: 'Branch', required: true },
    party: { type: ObjectId, ref: 'Party', required: true },
    partyName: String,
    amount: { type: Number, required: true, min: 0.01 },
    mode: { type: String, enum: ['cash', 'bank', 'upi', 'cheque'], default: 'cash' },
    account: { type: ObjectId, ref: 'MoneyAccount' }, // cash box / bank the money went into
    bankName: String,
    reference: String, // UTR / cheque no.
    allocations: [allocationSchema],
    onAccount: { type: Number, default: 0 }, // advance / not yet matched to a bill
    tds: { type: Number, default: 0 }, // TDS deducted by party (counts as settled)
    narration: String,
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelReason: String,
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
receiptSchema.index({ party: 1, date: -1 });
receiptSchema.index({ branch: 1, date: -1 });
export const Receipt = mongoose.model('Receipt', receiptSchema);

// ── Ledger entry (party + broker) ─────────────────────────────────────────
const ledgerSchema = new mongoose.Schema(
  {
    account: { type: String, enum: ['party', 'broker'], required: true },
    party: { type: ObjectId, ref: 'Party' },
    broker: { type: ObjectId, ref: 'Broker' },
    date: { type: Date, default: Date.now },
    type: {
      type: String,
      enum: ['bill', 'bill_cancel', 'receipt', 'receipt_cancel', 'commission', 'commission_reversal', 'broker_payment', 'adjustment'],
      required: true,
    },
    ref: String, // bill / receipt / LR number
    refId: ObjectId,
    branch: { type: ObjectId, ref: 'Branch' },
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    mode: String, // cash / bank … for money entries
    narration: String,
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
ledgerSchema.index({ account: 1, party: 1, date: 1 });
ledgerSchema.index({ account: 1, broker: 1, date: 1 });
ledgerSchema.index({ refId: 1, type: 1 });
export const LedgerEntry = mongoose.model('LedgerEntry', ledgerSchema);
