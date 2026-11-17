import cron from 'node-cron';
import { config } from '../config/config.js';
import { Party } from '../models/masterModels.js';
import { Bill, LedgerEntry } from '../models/accountsModels.js';
import { notify } from '../services/notificationService.js';

const DAY = 86400000;
// Whole calendar days between two moments in local (IST) time: bill on 13 Nov, today 14 Nov → 1
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const calendarDays = (from, to = new Date()) => Math.max(0, Math.round((startOfDay(to) - startOfDay(from)) / DAY));

/** Due date of a bill: stored dueDate, else bill date + party credit days (default 30) */
export const billDueDate = (bill, creditDays) => (bill.dueDate ? new Date(bill.dueDate) : new Date(new Date(bill.billDate).getTime() + (creditDays ?? 30) * DAY));

/**
 * Payment reminder every 15 days (requirement point 9).
 * Runs daily (REMINDER_CRON, default 10:30 AM IST). A party gets a reminder when
 *   - it owes money (opening + bills − receipts > 0)
 *   - it has an unpaid bill that is PAST ITS DUE DATE (bill date + party credit days).
 *     Set REMINDER_ONLY_OVERDUE=false to remind on any unpaid bill (old behaviour).
 *   - it has not been reminded in the last REMINDER_EVERY_DAYS (default 15) days
 *   - WhatsApp opt-in is on and it has a mobile number
 * "X din se" in the message = calendar days since the oldest such bill was raised.
 */
export const runReminders = async ({ dryRun = false, now = new Date() } = {}) => {
  const every = config.REMINDER_EVERY_DAYS;
  const cutoff = new Date(now.getTime() - every * DAY);
  const bills = await Bill.find({ status: { $in: ['unpaid', 'partial'] } }).select('party billDate dueDate').lean();
  if (!bills.length) return { checked: 0, sent: 0 };
  const ids = [...new Set(bills.map((b) => String(b.party)))];
  const [parties, bal] = await Promise.all([
    Party.find({
      _id: { $in: ids },
      whatsappOptIn: { $ne: false },
      mobile: { $exists: true, $ne: '' },
      $or: [{ lastReminderAt: null }, { lastReminderAt: { $lte: cutoff } }],
    }).lean(),
    LedgerEntry.aggregate([
      { $match: { account: 'party', party: { $in: bills.map((b) => b.party) } } },
      { $group: { _id: '$party', bal: { $sum: { $subtract: ['$debit', '$credit'] } } } },
    ]),
  ]);
  const balMap = Object.fromEntries(bal.map((b) => [String(b._id), b.bal]));
  let sent = 0;
  let due = 0;
  for (const p of parties) {
    const mine = bills.filter((b) => String(b.party) === String(p._id));
    const eligible = config.REMINDER_ONLY_OVERDUE ? mine.filter((b) => billDueDate(b, p.creditDays) < now) : mine;
    if (!eligible.length) continue;
    const amount = Math.round((p.openingBalance || 0) + (balMap[String(p._id)] || 0));
    if (amount <= 0) continue;
    due++;
    const oldest = eligible.reduce((m, b) => (new Date(b.billDate) < m ? new Date(b.billDate) : m), new Date(eligible[0].billDate));
    const days = calendarDays(oldest, now);
    if (dryRun) { sent++; continue; }
    const r = await notify({ event: 'payment_reminder', mobile: p.mobile, party: p._id, params: { amount, days } });
    // a failed or skipped message must be tried again tomorrow, not after 15 days
    if (r && ['sent', 'logged'].includes(r.status)) {
      await Party.updateOne({ _id: p._id }, { lastReminderAt: now });
      sent++;
    }
  }
  console.log(`🔔 Payment reminders: ${sent} sent (${due} due)`);
  return { checked: due, sent };
};

export const scheduleReminders = () =>
  cron.schedule(config.REMINDER_CRON, () => runReminders().catch((e) => console.error('Reminder job failed', e)), {
    timezone: config.TIMEZONE,
  });
