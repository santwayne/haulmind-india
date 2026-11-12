import cron from 'node-cron';
import { config } from '../config/config.js';
import { Party } from '../models/masterModels.js';
import { Bill, LedgerEntry } from '../models/accountsModels.js';
import { notify } from '../services/notificationService.js';

/**
 * Payment reminder every 15 days (requirement point 9).
 * Runs daily (REMINDER_CRON, default 10:30 AM IST). A party gets a reminder when
 *   - it owes money (opening + bills − receipts > 0)
 *   - it has an unpaid bill
 *   - it has not been reminded in the last REMINDER_EVERY_DAYS (default 15) days
 *   - WhatsApp opt-in is on and it has a mobile number
 */
export const runReminders = async ({ dryRun = false } = {}) => {
  const every = config.REMINDER_EVERY_DAYS;
  const cutoff = new Date(Date.now() - every * 86400000);
  const unpaid = await Bill.aggregate([
    { $match: { status: { $in: ['unpaid', 'partial'] } } },
    { $group: { _id: '$party', oldest: { $min: '$billDate' } } },
  ]);
  if (!unpaid.length) return { checked: 0, sent: 0 };
  const ids = unpaid.map((u) => u._id);
  const [parties, bal] = await Promise.all([
    Party.find({
      _id: { $in: ids },
      whatsappOptIn: { $ne: false },
      mobile: { $exists: true, $ne: '' },
      $or: [{ lastReminderAt: null }, { lastReminderAt: { $lte: cutoff } }],
    }).lean(),
    LedgerEntry.aggregate([
      { $match: { account: 'party', party: { $in: ids } } },
      { $group: { _id: '$party', bal: { $sum: { $subtract: ['$debit', '$credit'] } } } },
    ]),
  ]);
  const balMap = Object.fromEntries(bal.map((b) => [String(b._id), b.bal]));
  const oldest = Object.fromEntries(unpaid.map((u) => [String(u._id), u.oldest]));
  let sent = 0;
  for (const p of parties) {
    const amount = Math.round((p.openingBalance || 0) + (balMap[String(p._id)] || 0));
    if (amount <= 0) continue;
    const days = Math.floor((Date.now() - new Date(oldest[String(p._id)])) / 86400000);
    if (dryRun) { sent++; continue; }
    const r = await notify({ event: 'payment_reminder', mobile: p.mobile, party: p._id, params: { amount, days } });
    if (r && r.status !== 'skipped') {
      await Party.updateOne({ _id: p._id }, { lastReminderAt: new Date() });
      sent++;
    }
  }
  console.log(`🔔 Payment reminders: ${sent} sent (${parties.length} due)`);
  return { checked: parties.length, sent };
};

export const scheduleReminders = () =>
  cron.schedule(config.REMINDER_CRON, () => runReminders().catch((e) => console.error('Reminder job failed', e)), {
    timezone: config.TIMEZONE,
  });
