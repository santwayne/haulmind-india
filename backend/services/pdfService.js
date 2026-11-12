import PDFDocument from 'pdfkit';
import { config } from '../config/config.js';

// HaulMind green by default; set PDF_ACCENT in .env to use the customer's own colour
const INK = '#0f1f17';
const ACCENT = process.env.PDF_ACCENT || '#047857';
const MUTED = '#6b7280';

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const dtt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');

const header = (doc, title, no, date, branch, noLabel = 'No. ') => {
  const w = doc.page.width - 80;
  doc.rect(40, 40, w, 56).fill(ACCENT);
  doc.fill('#fff').font('Helvetica-Bold').fontSize(18).text(config.COMPANY_NAME.toUpperCase(), 52, 50);
  doc.font('Helvetica').fontSize(8.5).text(
    branch ? `${branch.name} (${branch.code})${branch.address ? ' · ' + branch.address : ''}${branch.phone ? ' · Ph ' + branch.phone : ''}` : '',
    52, 74, { width: w - 200 }
  );
  doc.font('Helvetica-Bold').fontSize(13).text(title, 40, 50, { width: w - 12, align: 'right' });
  doc.font('Helvetica').fontSize(9).text(`${noLabel}${no}`, 40, 68, { width: w - 12, align: 'right' });
  doc.text(`Date: ${dt(date)}`, 40, 80, { width: w - 12, align: 'right' });
  doc.fill(INK);
  return 108;
};

const box = (doc, x, y, w, h, label, lines) => {
  doc.rect(x, y, w, h).lineWidth(0.6).stroke('#cbd5e1');
  doc.fill(MUTED).font('Helvetica-Bold').fontSize(7.5).text(label.toUpperCase(), x + 6, y + 5);
  doc.fill(INK).font('Helvetica').fontSize(9);
  let yy = y + 17;
  for (const [i, l] of lines.filter(Boolean).entries()) {
    doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').text(l, x + 6, yy, { width: w - 12 });
    yy = doc.y + 1;
  }
};

const table = (doc, y, cols, rows) => {
  const x0 = 40;
  const w = doc.page.width - 80;
  doc.rect(x0, y, w, 18).fill('#eef2f7');
  doc.fill(INK).font('Helvetica-Bold').fontSize(8.5);
  let x = x0;
  for (const c of cols) {
    doc.text(c.label, x + 4, y + 5, { width: c.w - 8, align: c.align || 'left' });
    x += c.w;
  }
  y += 18;
  doc.font('Helvetica').fontSize(8.5);
  for (const r of rows) {
    if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
    x = x0;
    let rowH = 16;
    for (const [i, c] of cols.entries()) {
      const h = doc.heightOfString(String(r[i] ?? ''), { width: c.w - 8 });
      rowH = Math.max(rowH, h + 8);
    }
    for (const [i, c] of cols.entries()) {
      doc.text(String(r[i] ?? ''), x + 4, y + 4, { width: c.w - 8, align: c.align || 'left' });
      x += c.w;
    }
    doc.moveTo(x0, y + rowH).lineTo(x0 + w, y + rowH).lineWidth(0.4).stroke('#e5e7eb');
    y += rowH;
  }
  return y;
};

const footerSign = (doc, y, left, right) => {
  y = Math.max(y + 30, doc.page.height - 110);
  const w = doc.page.width - 80;
  doc.font('Helvetica').fontSize(8.5).fill(MUTED);
  doc.moveTo(52, y + 30).lineTo(220, y + 30).stroke('#9ca3af');
  doc.moveTo(40 + w - 180, y + 30).lineTo(40 + w - 12, y + 30).stroke('#9ca3af');
  doc.text(left, 52, y + 34);
  doc.text(right, 40 + w - 180, y + 34, { width: 168, align: 'right' });
  doc.fontSize(7).text(`Computer generated document · Powered by ${config.PRODUCT_NAME}`, 40, doc.page.height - 50, { width: w, align: 'center' });
  doc.fill(INK);
};

const toBuffer = (build) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const bufs = [];
    doc.on('data', (b) => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });

// ── LR / Bilty ────────────────────────────────────────────────────────────
export const lrPdf = (lr, copies = ['CONSIGNOR COPY', 'CONSIGNEE COPY', 'OFFICE COPY']) =>
  toBuffer((doc) => {
    copies.forEach((copy, idx) => {
      if (idx) doc.addPage();
      let y = header(doc, 'LORRY RECEIPT (BILTY)', lr.lrNo, lr.lrDate, lr.bookingBranch);
      const w = doc.page.width - 80;
      doc.font('Helvetica-Bold').fontSize(8).fill(ACCENT).text(copy, 40, y, { width: w, align: 'right' });
      doc.fill(INK);
      y += 14;
      box(doc, 40, y, w / 2 - 4, 78, 'Consignor (Sender)', [lr.consignor.name, lr.consignor.address, lr.consignor.mobile && `Mob: ${lr.consignor.mobile}`, lr.consignor.gstin && `GSTIN: ${lr.consignor.gstin}`]);
      box(doc, 40 + w / 2 + 4, y, w / 2 - 4, 78, 'Consignee (Receiver)', [lr.consignee.name, lr.consignee.address, lr.consignee.mobile && `Mob: ${lr.consignee.mobile}`, lr.consignee.gstin && `GSTIN: ${lr.consignee.gstin}`]);
      y += 86;
      const q = w / 4;
      box(doc, 40, y, q - 4, 40, 'From', [`${lr.bookingBranch?.name || ''}`]);
      box(doc, 40 + q, y, q - 4, 40, 'To', [`${lr.deliveryBranch?.name || ''}`]);
      box(doc, 40 + 2 * q, y, q - 4, 40, 'Payment', [{ paid: 'PAID', to_pay: 'TO PAY', tbb: 'TO BE BILLED' }[lr.paymentType]]);
      box(doc, 40 + 3 * q, y, q, 40, 'Delivery', [lr.deliveryType === 'door' ? 'DOOR DELIVERY' : 'GODOWN']);
      y += 50;
      y = table(
        doc, y,
        [
          { label: '#', w: 26 },
          { label: 'Description of goods', w: 210 },
          { label: 'Packing', w: 70 },
          { label: 'Nag', w: 50, align: 'right' },
          { label: 'Actual Wt (kg)', w: 80, align: 'right' },
          { label: 'Charged Wt (kg)', w: w - 436, align: 'right' },
        ],
        lr.items.map((it, i) => [i + 1, it.description, it.packing || '', it.nag, it.actualWeight, it.chargedWeight || it.actualWeight])
      );
      doc.font('Helvetica-Bold').fontSize(9).text(`Total: ${lr.totalNag} nag · ${lr.totalWeight} kg`, 40, y + 6, { width: w, align: 'right' });
      y += 26;
      // Freight block (hidden on consignee copy when TBB, like most transporters do)
      const showFreight = !(copy.includes('CONSIGNEE') && lr.paymentType === 'tbb');
      const left = [
        lr.invoiceNo && `Invoice: ${lr.invoiceNo}${lr.invoiceValue ? ' · ' + money(lr.invoiceValue) : ''}`,
        lr.ewayBillNo && `E-way bill: ${lr.ewayBillNo}`,
        lr.remarks && `Remarks: ${lr.remarks}`,
      ].filter(Boolean);
      box(doc, 40, y, w / 2 - 4, 96, 'Details', left.length ? left : ['-']);
      const f = lr.freight;
      const fl = showFreight
        ? [
            `Basic freight: ${money(f.basicFreight)}`,
            f.biltyCharge ? `Bilty charge: ${money(f.biltyCharge)}` : null,
            f.hamali ? `Hamali: ${money(f.hamali)}` : null,
            f.doorDelivery ? `Door delivery: ${money(f.doorDelivery)}` : null,
            f.otherCharges ? `Other: ${money(f.otherCharges)}` : null,
            f.gstAmount ? `GST ${f.gstPercent}%: ${money(f.gstAmount)}` : null,
          ].filter(Boolean)
        : ['Freight will be billed to party'];
      box(doc, 40 + w / 2 + 4, y, w / 2 - 4, 96, 'Freight', [' ', ...fl]);
      if (showFreight) {
        doc.font('Helvetica-Bold').fontSize(11).fill(ACCENT).text(`TOTAL ${money(f.total)}`, 40 + w / 2 + 10, y + 74, { width: w / 2 - 20, align: 'right' });
        doc.fill(INK);
      }
      y += 106;
      doc.font('Helvetica').fontSize(7.5).fill(MUTED).text(
        'Goods are carried at owner\'s risk. Company is not responsible for leakage, breakage or damage due to improper packing. Subject to local jurisdiction. Track your consignment with this LR number.',
        40, y, { width: w }
      );
      doc.fill(INK);
      footerSign(doc, doc.y, 'Consignor signature', `For ${config.COMPANY_NAME}`);
    });
  });

// ── Dispatch / Transfer challan ───────────────────────────────────────────
export const challanPdf = (ch) =>
  toBuffer((doc) => {
    const title = ch.type === 'transfer' ? 'BRANCH TRANSFER CHALLAN' : 'DISPATCH CHALLAN';
    let y = header(doc, title, ch.challanNo, ch.dispatchedAt, ch.fromBranch);
    const w = doc.page.width - 80;
    const t = w / 3;
    box(doc, 40, y, t - 4, 52, 'Route', [`${ch.fromBranch?.name} to ${ch.toBranch?.name}`, `Dispatched: ${dtt(ch.dispatchedAt)}`]);
    box(doc, 40 + t, y, t - 4, 52, 'Vehicle', [ch.vehicleNo || '-', ch.transporter]);
    box(doc, 40 + 2 * t, y, t, 52, 'Driver', [ch.driverName || '-', ch.driverMobile && `Mob: ${ch.driverMobile}`]);
    y += 62;
    y = table(
      doc, y,
      [
        { label: '#', w: 26 },
        { label: 'LR No.', w: 110 },
        { label: 'Consignor', w: 120 },
        { label: 'Consignee', w: 120 },
        { label: 'Nag', w: 45, align: 'right' },
        { label: 'Weight', w: w - 421, align: 'right' },
      ],
      ch.lines.map((l, i) => [i + 1, l.lrNo, l.lr?.consignor?.name || '', l.lr?.consignee?.name || '', l.nag, l.weight])
    );
    doc.font('Helvetica-Bold').fontSize(9.5).text(`${ch.lines.length} LR · ${ch.totalNag} nag · ${ch.totalWeight} kg`, 40, y + 8, { width: w, align: 'right' });
    if (ch.lorryHire) doc.font('Helvetica').fontSize(9).text(`Lorry hire: ${money(ch.lorryHire)}   Advance: ${money(ch.advancePaid)}   Balance: ${money(ch.lorryHire - ch.advancePaid)}`, 40, y + 24, { width: w, align: 'right' });
    footerSign(doc, doc.y, 'Driver signature', 'Loading in-charge');
  });

// ── Delivery challan (DC) ─────────────────────────────────────────────────
export const dcPdf = (lr) =>
  toBuffer((doc) => {
    const d = lr.delivery || {};
    let y = header(doc, 'DELIVERY CHALLAN', d.dcNo, d.at, lr.deliveryBranch);
    const w = doc.page.width - 80;
    box(doc, 40, y, w / 2 - 4, 70, 'LR', [lr.lrNo, `Booked: ${dt(lr.lrDate)} at ${lr.bookingBranch?.name}`, `From: ${lr.consignor.name}`]);
    box(doc, 40 + w / 2 + 4, y, w / 2 - 4, 70, 'Delivered to', [d.receiverName, d.receiverMobile && `Mob: ${d.receiverMobile}`, `On: ${dtt(d.at)}`]);
    y += 80;
    y = table(
      doc, y,
      [
        { label: 'Description', w: 230 },
        { label: 'Booked nag', w: 90, align: 'right' },
        { label: 'Delivered nag', w: 90, align: 'right' },
        { label: 'Weight', w: w - 410, align: 'right' },
      ],
      lr.items.map((it) => [it.description, it.nag, '', it.chargedWeight || it.actualWeight])
    );
    doc.font('Helvetica-Bold').fontSize(9.5).text(`Delivered: ${d.deliveredNag ?? lr.totalNag} of ${lr.totalNag} nag`, 40, y + 8, { width: w, align: 'right' });
    if (d.collectedAmount) doc.font('Helvetica').text(`Freight collected: ${money(d.collectedAmount)} (${d.collectionMode})`, 40, y + 24, { width: w, align: 'right' });
    if (d.remark) doc.text(`Remark: ${d.remark}`, 40, y + 40, { width: w });
    if (d.signature?.startsWith('data:image/png;base64,')) {
      try {
        doc.image(Buffer.from(d.signature.split(',')[1], 'base64'), 52, doc.page.height - 170, { fit: [160, 60] });
      } catch { /* ignore bad signature */ }
    }
    footerSign(doc, doc.y, 'Receiver signature', `For ${config.COMPANY_NAME}`);
  });

// ═══════════════ Phase 2: bill, receipt, ledger ═══════════════════════════

// Indian number to words for amounts on bill / receipt
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`);
const three = (n) => `${Math.floor(n / 100) ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : ''}${n % 100 ? two(n % 100) : ''}`;
export const inWords = (amount) => {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  const paise = Math.round((Math.abs(Number(amount) || 0) - n) * 100);
  if (!n && !paise) return 'Rupees Zero Only';
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `Rupees ${parts.join(' ')}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
};

const partyLines = (p, fallback) => [p?.name || fallback, p?.address, [p?.city, p?.state].filter(Boolean).join(', '), p?.mobile && `Mob: ${p.mobile}`, p?.gstin && `GSTIN: ${p.gstin}`];

export const billPdf = (b) =>
  toBuffer((doc) => {
    let y = header(doc, b.status === 'cancelled' ? 'FREIGHT BILL (CANCELLED)' : 'FREIGHT BILL', b.billNo, b.billDate, b.branch);
    const w = doc.page.width - 80;
    box(doc, 40, y, w * 0.62 - 4, 80, 'Bill to', partyLines(b.party, b.partyName));
    box(doc, 40 + w * 0.62 + 4, y, w * 0.38 - 4, 80, 'Terms', [`Due date: ${dt(b.dueDate)}`, `${b.lines.length} LR`, b.branch?.gstin && `Our GSTIN: ${b.branch.gstin}`]);
    y += 90;
    y = table(
      doc, y,
      [
        { label: '#', w: 22 },
        { label: 'LR No. / Date', w: 112 },
        { label: 'Route', w: 62 },
        { label: 'Consignor / Consignee', w: 150 },
        { label: 'Nag', w: 36, align: 'right' },
        { label: 'Kg', w: 48, align: 'right' },
        { label: 'Amount', w: w - 430, align: 'right' },
      ],
      b.lines.map((l, i) => [i + 1, `${l.lrNo}\n${dt(l.lrDate)}`, (l.route || '').replace('→', '-'), `${l.consignor} / ${l.consignee}`, l.nag, l.weight, money(l.amount)])
    );
    const rows = [
      ['Sub total', money(b.subTotal)],
      b.discount ? ['Less: discount', `- ${money(b.discount)}`] : null,
      b.otherCharges ? ['Add: other charges', money(b.otherCharges)] : null,
    ].filter(Boolean);
    y += 8;
    if (y > doc.page.height - 200) { doc.addPage(); y = 50; }
    doc.font('Helvetica').fontSize(9.5);
    for (const [k, v] of rows) {
      doc.text(k, 40 + w - 260, y, { width: 140 });
      doc.text(v, 40 + w - 120, y, { width: 114, align: 'right' });
      y += 15;
    }
    doc.rect(40 + w - 265, y, 265, 22).fill(ACCENT);
    doc.fill('#fff').font('Helvetica-Bold').fontSize(11).text('BILL TOTAL', 40 + w - 258, y + 6);
    doc.text(money(b.total), 40 + w - 120, y + 6, { width: 114, align: 'right' });
    doc.fill(INK);
    y += 30;
    doc.font('Helvetica-Oblique').fontSize(8.5).text(inWords(b.total), 40, y, { width: w });
    if (b.received) {
      doc.font('Helvetica').fontSize(9).text(`Received: ${money(b.received)}   Balance: ${money(b.balance)}`, 40, doc.y + 4, { width: w, align: 'right' });
    }
    if (b.remarks) doc.font('Helvetica').fontSize(8.5).text(`Remarks: ${b.remarks}`, 40, doc.y + 6, { width: w });
    footerSign(doc, doc.y, 'Receiver signature', `For ${config.COMPANY_NAME}`);
  });

export const receiptPdf = (r) =>
  toBuffer((doc) => {
    let y = header(doc, r.status === 'cancelled' ? 'PAYMENT RECEIPT (CANCELLED)' : 'PAYMENT RECEIPT', r.receiptNo, r.date, r.branch);
    const w = doc.page.width - 80;
    box(doc, 40, y, w / 2 - 4, 76, 'Received from', partyLines(r.party, r.partyName));
    box(doc, 40 + w / 2 + 4, y, w / 2 - 4, 76, 'Payment', [
      `${r.mode.toUpperCase()}${r.bankName ? ' · ' + r.bankName : ''}`,
      r.reference && `Ref / UTR / Cheque: ${r.reference}`,
      r.tds ? `TDS deducted: ${money(r.tds)}` : null,
    ]);
    y += 86;
    doc.rect(40, y, w, 30).fill('#ecfdf5');
    doc.fill(ACCENT).font('Helvetica-Bold').fontSize(15).text(money(r.amount), 52, y + 8);
    doc.fill(INK).font('Helvetica-Oblique').fontSize(8.5).text(inWords(r.amount), 200, y + 11, { width: w - 170, align: 'right' });
    y += 42;
    if (r.allocations?.length) {
      y = table(doc, y, [{ label: 'Adjusted against bill', w: w - 140 }, { label: 'Amount', w: 140, align: 'right' }], r.allocations.map((a) => [a.billNo, money(a.amount)]));
    }
    if (r.onAccount) doc.font('Helvetica').fontSize(9).text(`Kept on account (advance): ${money(r.onAccount)}`, 40, y + 8, { width: w, align: 'right' });
    if (r.narration) doc.fontSize(8.5).text(`Narration: ${r.narration}`, 40, doc.y + 6, { width: w });
    footerSign(doc, doc.y, 'Party signature', `For ${config.COMPANY_NAME}`);
  });

export const ledgerPdf = (L) =>
  toBuffer((doc) => {
    const period = `${L.from ? dt(L.from) : 'Beginning'} to ${dt(L.to)}`;
    let y = header(doc, L.title, L.name, L.to, null, '');
    const w = doc.page.width - 80;
    doc.font('Helvetica').fontSize(9).fill(MUTED).text(`${L.sub || ''}${L.sub ? ' · ' : ''}Period: ${period}`, 40, y, { width: w });
    doc.fill(INK);
    y += 18;
    const fmtBal = (v) => `${money(Math.abs(v))} ${L.kind === 'party' ? (v >= 0 ? 'Dr' : 'Cr') : v >= 0 ? 'Cr' : 'Dr'}`;
    y = table(
      doc, y,
      [
        { label: 'Date', w: 62 },
        { label: 'Particulars', w: 150 },
        { label: 'Ref', w: 86 },
        { label: 'Debit', w: 64, align: 'right' },
        { label: 'Credit', w: 64, align: 'right' },
        { label: 'Balance', w: w - 426, align: 'right' },
      ],
      [
        ['', 'Opening balance', '', '', '', fmtBal(L.opening)],
        ...L.entries.map((e) => [dt(e.date), e.narration || e.type, e.ref || '', e.debit ? money(e.debit) : '', e.credit ? money(e.credit) : '', fmtBal(e.balance)]),
        ['', 'Total', '', money(L.totalDebit), money(L.totalCredit), ''],
      ]
    );
    doc.rect(40, y + 6, w, 22).fill(ACCENT);
    doc.fill('#fff').font('Helvetica-Bold').fontSize(10.5).text('CLOSING BALANCE', 52, y + 12);
    doc.text(fmtBal(L.closing), 40, y + 12, { width: w - 12, align: 'right' });
    doc.fill(INK);
    doc.font('Helvetica').fontSize(7).fill(MUTED).text(`Computer generated statement · ${config.COMPANY_NAME} · Powered by ${config.PRODUCT_NAME}`, 40, doc.page.height - 50, { width: w, align: 'center' });
  });
