import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Readable } from 'stream';
import { LR } from '../models/lrModel.js';
import { Branch, Party, Broker } from '../models/masterModels.js';
import { LedgerEntry } from '../models/accountsModels.js';
import { MoneyAccount } from '../models/financeModels.js';
import { ah, ok, AppError, escapeRegex } from '../utils/http.js';
import { audit } from '../services/auditService.js';

/**
 * Vouch → HaulMind migration (requirement point 12).
 *
 * Flow for every kind: download template → fill / paste Vouch export → upload with commit=0
 * (preview: row-by-row errors, nothing saved) → upload again with commit=1 to save.
 * Column names are matched loosely, so Vouch's own headers ("Bilty No", "GR No", "Party Name" …) also work.
 */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const KINDS = {
  parties: {
    title: 'Parties',
    cols: [
      ['name', 'Name*', ['partyname', 'party', 'accountname', 'ledgername']],
      ['mobile', 'Mobile', ['mobileno', 'phone', 'contact', 'contactno']],
      ['address', 'Address', []],
      ['city', 'City', ['station']],
      ['state', 'State', []],
      ['gstin', 'GSTIN', ['gst', 'gstno']],
      ['openingBalance', 'Opening Balance (+ party owes us, - we owe party)', ['opening', 'openingbalance', 'balance', 'closingbalance']],
      ['creditLimit', 'Credit Limit', []],
      ['creditDays', 'Credit Days', []],
      ['branchCode', 'Home Branch Code', ['branch', 'branchcode']],
    ],
  },
  brokers: {
    title: 'Brokers',
    cols: [
      ['name', 'Name*', ['brokername', 'broker']],
      ['mobile', 'Mobile', ['mobileno', 'phone']],
      ['commissionType', 'Commission Type (percent / fixed)', ['type']],
      ['commissionValue', 'Commission Value', ['commission', 'rate']],
      ['openingBalance', 'Opening Balance (commission we still owe)', ['opening', 'balance']],
    ],
  },
  lrs: {
    title: 'LRs (last year from Vouch)',
    cols: [
      ['lrNo', 'LR No*', ['lr', 'lrnumber', 'biltyno', 'bilty', 'grno', 'gr', 'cnno', 'cn', 'docketno']],
      ['lrDate', 'LR Date* (DD-MM-YYYY)', ['date', 'biltydate', 'grdate', 'bookingdate']],
      ['from', 'From Branch Code*', ['frombranch', 'bookingbranch', 'fromstation', 'from']],
      ['to', 'To Branch Code*', ['tobranch', 'deliverybranch', 'tostation', 'to', 'destination']],
      ['consignor', 'Consignor*', ['consignorname', 'sender', 'sendername']],
      ['consignorMobile', 'Consignor Mobile', ['consignorphone', 'sendermobile']],
      ['consignee', 'Consignee*', ['consigneename', 'receiver', 'receivername']],
      ['consigneeMobile', 'Consignee Mobile', ['consigneephone', 'receivermobile']],
      ['goods', 'Goods', ['description', 'item', 'itemname', 'material']],
      ['nag', 'Nag', ['packages', 'pkgs', 'qty', 'quantity', 'articles']],
      ['weight', 'Weight (kg)', ['weight', 'wt', 'actualweight', 'chargedweight']],
      ['paymentType', 'Payment Type (paid / to_pay / tbb)', ['paytype', 'paymentmode', 'type']],
      ['freight', 'Freight Total*', ['freight', 'amount', 'total', 'totalfreight', 'grandtotal']],
      ['status', 'Status (booked / in_transit / arrived / delivered)', []],
      ['deliveredOn', 'Delivered On (DD-MM-YYYY)', ['deliverydate', 'delivereddate']],
      ['receivedBy', 'Received By', ['receiver', 'receivedby']],
      ['invoiceNo', 'Invoice No', ['invoice', 'billno']],
      ['billed', 'Already Billed (Y/N)', ['billed']],
    ],
  },
  money: {
    title: 'Cash & bank opening balances',
    cols: [
      ['name', 'Account Name*', ['account', 'accountname', 'ledger']],
      ['type', 'Type* (cash / bank)', []],
      ['branchCode', 'Branch Code', ['branch']],
      ['bankName', 'Bank Name', ['bank']],
      ['accountLabel', 'Account (last 4 digits only)', ['accountno', 'acno']],
      ['openingBalance', 'Opening Balance', ['opening', 'balance', 'closingbalance']],
      ['openingDate', 'Opening Date (DD-MM-YYYY)', ['date', 'asondate']],
    ],
  },
};

const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[₹,\s]/g, '');
  const neg = /cr$/i.test(s) || /^\(.*\)$/.test(s);
  const n = Number(s.replace(/(dr|cr)$/i, '').replace(/[()]/g, ''));
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : NaN;
};
const date = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)); // Excel serial
  const m = String(v).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(y, Number(m[2]) - 1, Number(m[1]));
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('text' in v) return v.text;
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
  }
  return v;
};

const readRows = async (file, kind) => {
  const wb = new ExcelJS.Workbook();
  const name = (file.originalname || '').toLowerCase();
  let ws;
  if (name.endsWith('.csv')) ws = await wb.csv.read(Readable.from(file.buffer.toString('utf8')));
  else if (name.endsWith('.xlsx')) { await wb.xlsx.load(file.buffer); ws = wb.worksheets[0]; }
  else throw new AppError(400, 'Upload an .xlsx or .csv file');
  if (!ws) throw new AppError(400, 'The file has no sheet');
  // find header row = first row with at least 2 known columns
  const cols = KINDS[kind].cols;
  let headerRow = 0;
  let map = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
    const m = {};
    ws.getRow(r).eachCell((cell, c) => {
      const h = norm(cellText(cell.value));
      const col = cols.find(([key, label, alias]) => norm(label) === h || norm(label.replace(/\(.*\)|\*/g, '')) === h || norm(key) === h || alias.includes(h));
      if (col && !Object.values(m).includes(col[0])) m[c] = col[0];
    });
    if (Object.keys(m).length >= 2) { headerRow = r; map = m; }
  }
  if (!headerRow) throw new AppError(400, `Could not find the column headings. Use the ${KINDS[kind].title} template.`);
  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const o = {};
    let any = false;
    for (const [c, key] of Object.entries(map)) {
      const v = cellText(row.getCell(Number(c)).value);
      if (v !== '' && v != null) any = true;
      o[key] = typeof v === 'string' ? v.trim() : v;
    }
    if (any) rows.push({ rowNo: r, ...o });
  }
  return { rows, mapped: Object.values(map), missing: cols.filter(([k, l]) => l.includes('*') && !Object.values(map).includes(k)).map(([, l]) => l) };
};

export const template = ah(async (req, res) => {
  const k = KINDS[req.params.kind];
  if (!k) throw new AppError(404, 'Unknown import type');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(k.title.slice(0, 30));
  ws.addRow(k.cols.map(([, l]) => l));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
  ws.columns.forEach((c) => { c.width = 22; });
  const examples = {
    parties: ['Sri Murugan Knits', '9876543210', '12 Kumaran Rd', 'Tiruppur', 'Tamil Nadu', '33ABCDE1234F1Z5', 15000, 50000, 30, 'TPR'],
    brokers: ['Rakesh Broker', '9800000000', 'percent', 5, 1200],
    lrs: ['TPR-0001', '05-04-2025', 'TPR', 'LDH', 'Sri Murugan Knits', '9876543210', 'Gill Hosiery', '9812345678', 'Hosiery', 10, 500, 'tbb', 3050, 'delivered', '09-04-2025', 'Harpreet', 'INV-552', 'Y'],
    money: ['Cash – Ludhiana Hub', 'cash', 'LDH', '', '', 25000, '31-03-2026'],
  };
  ws.addRow(examples[req.params.kind]);
  ws.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="haulmind-import-${req.params.kind}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

const branchMap = async () => Object.fromEntries((await Branch.find().select('code').lean()).map((b) => [b.code.toUpperCase(), b._id]));

// ── validators: return { errors:[], doc } per row ──
const VALIDATE = {
  parties: async (r, ctx) => {
    const e = [];
    if (!r.name) e.push('Name missing');
    const ob = num(r.openingBalance);
    if (Number.isNaN(ob)) e.push('Opening balance is not a number');
    if (r.mobile && !/^[6-9]\d{9}$/.test(String(r.mobile).replace(/\D/g, '').slice(-10))) e.push('Mobile is not a 10 digit number');
    const bc = r.branchCode ? ctx.branches[String(r.branchCode).toUpperCase()] : undefined;
    if (r.branchCode && !bc) e.push(`Branch code ${r.branchCode} not found`);
    const exists = r.name && (await Party.exists({ name: new RegExp(`^${escapeRegex(r.name)}$`, 'i'), ...(r.mobile && { mobile: String(r.mobile).replace(/\D/g, '').slice(-10) }) }));
    return {
      errors: e, skip: !!exists && 'already exists',
      doc: {
        name: r.name, mobile: r.mobile ? String(r.mobile).replace(/\D/g, '').slice(-10) : undefined, address: r.address, city: r.city, state: r.state,
        gstin: r.gstin ? String(r.gstin).toUpperCase() : undefined, openingBalance: ob || 0, openingDate: new Date(),
        creditLimit: num(r.creditLimit) || 0, creditDays: num(r.creditDays) || 30, homeBranch: bc,
      },
    };
  },
  brokers: async (r) => {
    const e = [];
    if (!r.name) e.push('Name missing');
    const t = String(r.commissionType || 'percent').toLowerCase().startsWith('f') ? 'fixed_per_lr' : 'percent';
    const exists = r.name && (await Broker.exists({ name: new RegExp(`^${escapeRegex(r.name)}$`, 'i') }));
    return { errors: e, skip: !!exists && 'already exists', doc: { name: r.name, mobile: r.mobile, commissionType: t, commissionValue: num(r.commissionValue) || 0, opening: num(r.openingBalance) || 0 } };
  },
  lrs: async (r, ctx) => {
    const e = [];
    const lrNo = String(r.lrNo || '').trim().toUpperCase();
    if (!lrNo) e.push('LR No missing');
    const d = date(r.lrDate);
    if (!d) e.push('LR date missing or wrong (use DD-MM-YYYY)');
    const from = ctx.branches[String(r.from || '').toUpperCase()];
    const to = ctx.branches[String(r.to || '').toUpperCase()];
    if (!from) e.push(`From branch "${r.from || ''}" not found – use the branch code`);
    if (!to) e.push(`To branch "${r.to || ''}" not found – use the branch code`);
    if (!r.consignor) e.push('Consignor missing');
    if (!r.consignee) e.push('Consignee missing');
    const freight = num(r.freight);
    if (Number.isNaN(freight)) e.push('Freight is not a number');
    const pt = String(r.paymentType || 'to_pay').toLowerCase().replace(/[\s-]/g, '_');
    const paymentType = pt.startsWith('paid') ? 'paid' : pt.startsWith('tbb') || pt.includes('billed') ? 'tbb' : 'to_pay';
    const st = String(r.status || 'delivered').toLowerCase().replace(/[\s-]/g, '_');
    const status = ['booked', 'in_transit', 'arrived', 'delivered', 'cancelled'].includes(st) ? st : 'delivered';
    if (lrNo && ctx.seen.has(lrNo)) e.push('Same LR No appears twice in the file');
    ctx.seen.add(lrNo);
    const exists = lrNo && (await LR.exists({ lrNo }));
    const nag = num(r.nag) || 0;
    const wt = num(r.weight) || 0;
    return {
      errors: e, skip: !!exists && 'LR No already in HaulMind',
      doc: {
        lrNo, lrDate: d, bookingBranch: from, deliveryBranch: to,
        currentBranch: ['arrived', 'delivered'].includes(status) ? to : from,
        consignor: { name: r.consignor, mobile: r.consignorMobile ? String(r.consignorMobile) : undefined },
        consignee: { name: r.consignee, mobile: r.consigneeMobile ? String(r.consigneeMobile) : undefined },
        items: [{ description: r.goods || 'Goods', nag, actualWeight: wt, chargedWeight: wt }],
        totalNag: nag, totalWeight: wt, paymentType, invoiceNo: r.invoiceNo,
        freight: { basis: 'fixed', basicFreight: freight || 0, total: freight || 0 },
        status,
        billed: String(r.billed ?? 'Y').trim().toUpperCase() !== 'N',
        migratedFrom: 'vouch',
        ...(status === 'delivered' && { delivery: { at: date(r.deliveredOn) || d, receiverName: r.receivedBy || '', deliveredNag: nag, podFiles: [] } }),
        history: [{ at: d, status, note: 'Imported from Vouch' }],
      },
    };
  },
  money: async (r, ctx) => {
    const e = [];
    if (!r.name) e.push('Account name missing');
    const type = String(r.type || '').toLowerCase().startsWith('b') ? 'bank' : String(r.type || '').toLowerCase().startsWith('c') ? 'cash' : null;
    if (!type) e.push('Type must be cash or bank');
    const bc = r.branchCode ? ctx.branches[String(r.branchCode).toUpperCase()] : null;
    if (r.branchCode && !bc) e.push(`Branch code ${r.branchCode} not found`);
    const ob = num(r.openingBalance);
    if (Number.isNaN(ob)) e.push('Opening balance is not a number');
    const label = r.accountLabel ? String(r.accountLabel).replace(/\s/g, '').slice(-4) : undefined;
    const exists = r.name && (await MoneyAccount.exists({ name: r.name }));
    return { errors: e, skip: !!exists && 'already exists', doc: { name: r.name, type, branch: bc, bankName: r.bankName, accountLabel: label && `••${label}`, openingBalance: ob || 0, openingDate: date(r.openingDate) || new Date() } };
  },
};

const partyFor = async (snap, branchId, cache) => {
  const key = `${norm(snap.name)}|${snap.mobile || ''}`;
  if (cache.has(key)) return cache.get(key);
  let p = await Party.findOne({ name: new RegExp(`^${escapeRegex(snap.name)}$`, 'i') });
  if (!p) p = await Party.create({ name: snap.name, mobile: snap.mobile, homeBranch: branchId });
  cache.set(key, p._id);
  return p._id;
};

export const runImport = ah(async (req, res) => {
  const kind = req.params.kind;
  if (!KINDS[kind]) throw new AppError(404, 'Unknown import type');
  if (!req.file) throw new AppError(400, 'Attach the Excel / CSV file');
  const commit = req.query.commit === '1';
  const { rows, mapped, missing } = await readRows(req.file, kind);
  if (missing.length) throw new AppError(400, `Required columns not found: ${missing.join(', ')}`);
  const ctx = { branches: await branchMap(), seen: new Set() };
  const checked = [];
  for (const r of rows) checked.push({ rowNo: r.rowNo, ...(await VALIDATE[kind](r, ctx)) });
  const bad = checked.filter((c) => c.errors.length);
  const skipped = checked.filter((c) => !c.errors.length && c.skip);
  const good = checked.filter((c) => !c.errors.length && !c.skip);
  const summary = {
    kind, totalRows: rows.length, ready: good.length, skipped: skipped.length, withErrors: bad.length, columnsFound: mapped,
    errors: bad.slice(0, 200).map((c) => ({ row: c.rowNo, errors: c.errors })),
    skippedRows: skipped.slice(0, 50).map((c) => ({ row: c.rowNo, reason: c.skip })),
    sample: good.slice(0, 5).map((c) => c.doc),
  };
  if (!commit) return ok(res, summary, 'Preview only – nothing saved yet');
  if (bad.length && req.query.skipErrors !== '1') throw new AppError(400, `${bad.length} rows have errors. Fix them or import with "skip rows with errors".`, { summary });

  let saved = 0;
  const cache = new Map();
  for (const { doc } of good) {
    if (kind === 'parties') await Party.create(doc);
    if (kind === 'brokers') {
      const { opening, ...b } = doc;
      const br = await Broker.create(b);
      if (opening) await LedgerEntry.create({ account: 'broker', broker: br._id, type: 'adjustment', ref: 'OPENING', ...(opening > 0 ? { credit: opening } : { debit: -opening }), narration: 'Opening balance (Vouch)', createdBy: req.user._id });
    }
    if (kind === 'money') await MoneyAccount.create(doc);
    if (kind === 'lrs') {
      doc.consignor.party = await partyFor(doc.consignor, doc.bookingBranch, cache);
      doc.consignee.party = await partyFor(doc.consignee, doc.deliveryBranch, cache);
      doc.billingParty = doc.paymentType === 'to_pay' ? doc.consignee.party : doc.consignor.party;
      doc.createdBy = req.user._id;
      await LR.create(doc);
    }
    saved++;
  }
  await audit(req, { action: 'create', entity: 'Import', ref: kind, changes: { saved, skipped: skipped.length, errors: bad.length, file: req.file.originalname } });
  ok(res, { ...summary, saved }, `${saved} ${KINDS[kind].title.toLowerCase()} imported`);
});

/** POD / DC PDFs from Vouch: a .zip whose file names contain the LR number */
export const importPods = ah(async (req, res) => {
  if (!req.file) throw new AppError(400, 'Attach a .zip file');
  let zip;
  try { zip = new AdmZip(req.file.buffer); } catch { throw new AppError(400, 'Not a valid .zip file'); }
  const dir = path.resolve('uploads/pod');
  fs.mkdirSync(dir, { recursive: true });
  const matched = [];
  const unmatched = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const base = path.basename(entry.entryName);
    const ext = path.extname(base).toLowerCase();
    if (!['.pdf', '.jpg', '.jpeg', '.png', '.webp'].includes(ext) || base.startsWith('.')) continue;
    const stem = base.slice(0, -ext.length).toUpperCase().trim();
    // try the whole name, then name without suffixes like "_POD", " (1)", "-DC"
    const tries = [stem, stem.replace(/[\s_-]*(POD|DC|DELIVERY|BILTY|COPY|\(\d+\))$/g, ''), stem.split(/[\s_]/)[0]];
    let lr = null;
    for (const t of [...new Set(tries)].filter(Boolean)) {
      lr = await LR.findOne({ lrNo: t }).select('_id lrNo');
      if (lr) break;
    }
    if (!lr) { unmatched.push(base); continue; }
    const fname = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(dir, fname), entry.getData());
    await LR.updateOne({ _id: lr._id }, { $push: { 'delivery.podFiles': `/uploads/pod/${fname}` } });
    matched.push({ file: base, lrNo: lr.lrNo });
  }
  await audit(req, { action: 'create', entity: 'Import', ref: 'pod', changes: { matched: matched.length, unmatched: unmatched.length } });
  ok(res, { matched, unmatched }, `${matched.length} files attached, ${unmatched.length} not matched`);
});

export const importKinds = ah(async (req, res) =>
  ok(res, Object.entries(KINDS).map(([k, v]) => ({ kind: k, title: v.title, columns: v.cols.map(([, l]) => l) })))
);
