import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

/**
 * Phase 3 – full accounting (requirement points 10, 11, 14 "ब्रांच खर्च")
 *
 * MoneyAccount = a cash box (one per branch) or a bank account.
 * CashEntry    = every rupee that actually comes in or goes out of a MoneyAccount.
 *   Posted automatically from: PAID LR booking, TO PAY collection at delivery, party receipts,
 *   broker payments, lorry hire advance/balance. Posted by hand from: expense, income and
 *   contra (cash ↔ bank) vouchers.
 * Cancelling anything never deletes a row – an opposite entry is written, so the book always balances.
 */

const moneyAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['cash', 'bank'], required: true },
    branch: { type: ObjectId, ref: 'Branch' }, // empty = company-level (head office) bank account
    bankName: String,
    accountLabel: String, // e.g. "HDFC CA ••4417" – keep only the last digits
    openingBalance: { type: Number, default: 0 },
    openingDate: Date,
    isDefault: { type: Boolean, default: false }, // default bank for that branch / company
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
moneyAccountSchema.index({ branch: 1, type: 1 });
export const MoneyAccount = mongoose.model('MoneyAccount', moneyAccountSchema);

export const CASH_CATEGORIES = [
  'opening', 'lr_paid', 'topay_collection', 'party_receipt', 'broker_payment', 'lorry_hire',
  'expense', 'income', 'contra', 'reversal', 'migrated',
];

const cashEntrySchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: 'MoneyAccount', required: true },
    branch: { type: ObjectId, ref: 'Branch' },
    date: { type: Date, default: Date.now },
    direction: { type: String, enum: ['in', 'out'], required: true },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, enum: CASH_CATEGORIES, required: true },
    head: String, // expense / income head (Rent, Salary …)
    party: { type: ObjectId, ref: 'Party' },
    broker: { type: ObjectId, ref: 'Broker' },
    refType: String, // LR, Receipt, Challan, Voucher, BrokerPayment
    refId: ObjectId,
    ref: String, // human number
    voucherNo: String,
    narration: String,
    reversed: { type: Boolean, default: false },
    reversalOf: { type: ObjectId, ref: 'CashEntry' },
    reversalCategory: String, // original category of a reversal row (for P&L)
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
cashEntrySchema.index({ account: 1, date: 1 });
cashEntrySchema.index({ branch: 1, date: 1, category: 1 });
cashEntrySchema.index({ refType: 1, refId: 1 });
export const CashEntry = mongoose.model('CashEntry', cashEntrySchema);

const headSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['expense', 'income'], default: 'expense' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
headSchema.index({ name: 1, kind: 1 }, { unique: true });
export const AccountHead = mongoose.model('AccountHead', headSchema);

export const DEFAULT_HEADS = {
  expense: ['Rent', 'Salary', 'Electricity', 'Diesel / fuel', 'Hamali / labour', 'Telephone & internet', 'Office expenses', 'Vehicle repair', 'Godown maintenance', 'Tea & refreshment', 'Bank charges', 'Other expenses'],
  income: ['Godown rent received', 'Commission received', 'Scrap sale', 'Other income'],
};
