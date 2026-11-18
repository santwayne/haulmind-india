import crypto from 'crypto';
import { config } from '../config/config.js';
import { Notification } from '../models/systemModels.js';
import { Party } from '../models/masterModels.js';
import { escapeRegex } from '../utils/http.js';

/**
 * Meta WhatsApp Cloud API webhook
 *
 * Callback URL (Meta app → WhatsApp → Configuration):
 *   https://haulmindin.wayneesolutions.com/api/v1/webhooks/whatsapp
 * Verify token: the value of WA_VERIFY_TOKEN in backend/.env
 * Subscribe to the "messages" field.
 *
 * GET  → Meta's one-time verification (hub.challenge echo)
 * POST → delivery status of messages we sent (sent / delivered / read / failed)
 *        + messages customers send back to the business number (saved as "received")
 */

// Status only moves forward: a late "delivered" must not overwrite "read".
const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };

export const verifyWhatsApp = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && config.WA_VERIFY_TOKEN && token === config.WA_VERIFY_TOKEN) {
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }
  return res.sendStatus(403);
};

// X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret)
const signatureOk = (req) => {
  if (!config.WA_APP_SECRET) return true; // not configured yet → accept (startup prints a warning)
  const sig = String(req.get('x-hub-signature-256') || '');
  if (!sig.startsWith('sha256=') || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', config.WA_APP_SECRET).update(req.rawBody).digest('hex');
  const a = Buffer.from(sig.slice(7), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const applyStatus = async (s) => {
  if (!s?.id || !s.status) return;
  const rec = await Notification.findOne({ providerId: s.id });
  if (!rec) return; // not one of ours (or sent before this install)
  const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
  if (s.status === 'failed') {
    rec.status = 'failed';
    const e = s.errors?.[0];
    rec.error = (e ? `${e.code || ''} ${e.title || ''} ${e.error_data?.details || e.message || ''}` : 'failed (WhatsApp)').trim().slice(0, 500);
  } else if (s.status in RANK) {
    if ((RANK[s.status] ?? 0) > (RANK[rec.status] ?? -1)) rec.status = s.status;
    if (s.status === 'delivered' && !rec.deliveredAt) rec.deliveredAt = at;
    if (s.status === 'read') {
      rec.readAt = rec.readAt || at;
      rec.deliveredAt = rec.deliveredAt || at;
    }
  } else {
    return;
  }
  await rec.save();
};

const textOf = (m) => {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || m.button?.payload || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '[interactive]';
    case 'image': case 'video': case 'document': case 'audio': case 'sticker':
      return `[${m.type}]${m[m.type]?.caption ? ` ${m[m.type].caption}` : ''}`;
    case 'location': return `[location] ${m.location?.latitude},${m.location?.longitude}`;
    default: return `[${m.type || 'message'}]`;
  }
};

const saveIncoming = async (m, contacts) => {
  if (!m?.id) return;
  if (await Notification.exists({ providerId: m.id })) return; // Meta retries → no duplicates
  const from = String(m.from || '');
  const last10 = from.replace(/\D/g, '').slice(-10);
  const party = last10.length === 10
    ? await Party.findOne({ $or: [{ mobile: new RegExp(`${escapeRegex(last10)}$`) }, { altMobile: new RegExp(`${escapeRegex(last10)}$`) }] }).select('_id').lean()
    : null;
  const name = contacts?.find((c) => c.wa_id === from)?.profile?.name;
  await Notification.create({
    channel: 'whatsapp',
    direction: 'in',
    event: 'incoming',
    to: from, // for incoming rows this is the sender's number
    senderName: name,
    party: party?._id,
    message: textOf(m).slice(0, 2000),
    status: 'received',
    providerId: m.id,
  });
};

export const receiveWhatsApp = async (req, res) => {
  if (!signatureOk(req)) return res.sendStatus(401);
  // Answer Meta at once; it retries anything that is slow or not 200.
  res.sendStatus(200);
  try {
    for (const entry of req.body?.entry || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        if (config.WA_PHONE_ID && v.metadata?.phone_number_id && v.metadata.phone_number_id !== config.WA_PHONE_ID) continue;
        for (const s of v.statuses || []) await applyStatus(s).catch((e) => console.error('WA status', e.message));
        for (const m of v.messages || []) await saveIncoming(m, v.contacts).catch((e) => console.error('WA incoming', e.message));
      }
    }
  } catch (e) {
    console.error('WhatsApp webhook', e);
  }
};
