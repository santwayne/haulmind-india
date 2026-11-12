import axios from 'axios';
import { config } from '../config/config.js';
import { Notification } from '../models/systemModels.js';

/**
 * WhatsApp / SMS alerts (point 4, 6, 9)
 *
 * NOTIFY_PROVIDER=log       → only stored in DB + console (default, for testing)
 * NOTIFY_PROVIDER=whatsapp  → Meta WhatsApp Cloud API template messages
 * NOTIFY_PROVIDER=msg91     → SMS through MSG91 flow API (DLT template ids needed)
 *
 * Each event maps to one approved template. Body parameters are passed in order.
 * Template names below must be created + approved in Meta Business Manager.
 */
export const TEMPLATES = {
  lr_booked: {
    wa: 'hm_lr_booked',
    text: (p) => `${config.COMPANY_NAME}: Aapka maal book ho gaya hai. LR ${p.lrNo}, ${p.nag} nag, ${p.from} se ${p.to}. Track: ${p.trackUrl}`,
  },
  lr_unloaded: {
    wa: 'hm_lr_arrived',
    text: (p) => `${config.COMPANY_NAME}: LR ${p.lrNo} ka maal ${p.branch} branch mein pahunch gaya hai (${p.nag} nag). Kripya delivery le lein.`,
  },
  lr_delivered: {
    wa: 'hm_lr_delivered',
    text: (p) => `${config.COMPANY_NAME}: LR ${p.lrNo} deliver ho gaya hai. Receiver: ${p.receiver}. DC ${p.dcNo}. Dhanyavaad.`,
  },
  payment_reminder: {
    wa: 'hm_payment_reminder',
    text: (p) => `${config.COMPANY_NAME}: Aapka ₹${p.amount} bakaya hai (${p.days} din se). Kripya bhugtan karein.`,
  },
};

const clean = (m) => {
  const d = String(m || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  return null;
};

const sendWhatsApp = async (to, event, params) => {
  const tpl = TEMPLATES[event];
  const r = await axios.post(
    `https://graph.facebook.com/v21.0/${config.WA_PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: tpl.wa,
        language: { code: config.WA_LANG },
        components: [{ type: 'body', parameters: Object.values(params).map((v) => ({ type: 'text', text: String(v) })) }],
      },
    },
    { headers: { Authorization: `Bearer ${config.WA_TOKEN}` }, timeout: 15000 }
  );
  return r.data?.messages?.[0]?.id;
};

const sendSms = async (to, event, params) => {
  // MSG91 Flow API – template_id per event comes from env: MSG91_TPL_LR_BOOKED etc.
  const template_id = process.env[`MSG91_TPL_${event.toUpperCase()}`];
  if (!template_id) throw new Error(`No MSG91 template for ${event}`);
  const r = await axios.post(
    'https://control.msg91.com/api/v5/flow',
    { template_id, sender: config.MSG91_SENDER, short_url: 0, recipients: [{ mobiles: to, ...params }] },
    { headers: { authkey: config.MSG91_AUTH_KEY }, timeout: 15000 }
  );
  return r.data?.request_id;
};

/** Fire-and-forget. Never throws – a failed message must not block booking. */
export const notify = async ({ event, mobile, params, lr, party }) => {
  const to = clean(mobile);
  const tpl = TEMPLATES[event];
  const message = tpl ? tpl.text(params) : JSON.stringify(params);
  const rec = await Notification.create({
    channel: config.NOTIFY_PROVIDER === 'msg91' ? 'sms' : config.NOTIFY_PROVIDER === 'whatsapp' ? 'whatsapp' : 'log',
    event, to: to || mobile, lr, party, message,
    status: to ? 'queued' : 'skipped',
    error: to ? undefined : 'invalid mobile',
  }).catch(() => null);
  if (!to || !rec) return rec;

  try {
    let id;
    if (config.NOTIFY_PROVIDER === 'whatsapp') id = await sendWhatsApp(to, event, params);
    else if (config.NOTIFY_PROVIDER === 'msg91') id = await sendSms(to, event, params);
    else console.log(`📨 [${event}] → ${to}: ${message}`);
    rec.status = 'sent';
    rec.providerId = id;
  } catch (e) {
    rec.status = 'failed';
    rec.error = (e.response?.data ? JSON.stringify(e.response.data) : e.message).slice(0, 500);
  }
  await rec.save().catch(() => {});
  return rec;
};
