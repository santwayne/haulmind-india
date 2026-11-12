/**
 * End-to-end test of the whole goods journey against a THROWAWAY database.
 *   MONGO_URI=mongodb://127.0.0.1:27017/tcl_test npm test
 * Flow: login → book 3 LRs at Tiruppur → dispatch 2 to Ludhiana hub →
 *       unload (1 short) → transfer 1 to Jalandhar → unload → deliver with POD →
 *       double-delivery blocked → dashboard + reports + PDFs + tracking.
 */
import assert from 'assert/strict';
import mongoose from 'mongoose';
import http from 'http';

process.env.NODE_ENV = 'test';
const uri = process.env.MONGO_URI;
if (!uri || !/test/i.test(uri)) {
  console.error('Set MONGO_URI to a database whose name contains "test" – this script wipes it.');
  process.exit(1);
}
const { connectDB } = await import('../config/mongoConnection.js');
const { app } = await import('../app.js');
const { seed } = await import('./seed.js');

await connectDB(uri);
await mongoose.connection.db.dropDatabase();
const { byCode, ownerPassword } = await seed({ ownerPassword: 'test-owner-123', quiet: true });
const server = http.createServer(app).listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/v1`;

let token;
const api = async (method, path, body, { raw, form } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(form ? {} : { 'Content-Type': 'application/json' }) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  if (raw) return r;
  const j = await r.json();
  return { status: r.status, ...j };
};
const step = (m) => console.log(`✔ ${m}`);

try {
  // login
  let r = await api('POST', '/auth/login', { username: 'owner', password: ownerPassword });
  assert.equal(r.status, 200, r.message);
  token = r.data.token;
  step('owner login');

  // branch clerk at Tiruppur
  r = await api('POST', '/users', { name: 'TPR Clerk', username: 'tprclerk', password: 'clerk123', role: 'booking_clerk', branches: [byCode.TPR._id] });
  assert.equal(r.status, 201, r.message);

  // rate lookup
  r = await api('GET', `/lrs/rate?fromBranch=${byCode.TPR._id}&toBranch=${byCode.LDH._id}`);
  assert.equal(r.data.perKg, 6);
  step('route rate lookup');

  const book = (to, nag, kg, extra = {}) =>
    api('POST', '/lrs', {
      bookingBranch: byCode.TPR._id,
      deliveryBranch: byCode[to]._id,
      consignor: { name: 'Sri Murugan Knits', mobile: '9876543210', address: 'Tiruppur' },
      consignee: { name: 'Gill Hosiery', mobile: '9812345678', address: to },
      items: [{ description: 'Cotton hosiery', packing: 'Bale', nag, actualWeight: kg, chargedWeight: kg }],
      paymentType: 'to_pay',
      freight: { basis: 'weight', rate: 6, biltyCharge: 50, hamali: 20 },
      ...extra,
    });
  const a = await book('LDH', 10, 500);
  const b = await book('JAL', 4, 200);
  const c = await book('LDH', 2, 60);
  assert.equal(a.status, 201, a.message);
  assert.match(a.data.lr.lrNo, /^TPR-\d{4}-00001$/);
  assert.equal(a.data.lr.freight.total, 500 * 6 + 50 + 20);
  step(`booked ${a.data.lr.lrNo}, ${b.data.lr.lrNo}, ${c.data.lr.lrNo} (freight ₹${a.data.lr.freight.total})`);

  // PDF
  let pdf = await api('GET', `/lrs/${a.data.lr._id}/pdf`, null, { raw: true });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok((await pdf.arrayBuffer()).byteLength > 2000);
  step('LR bilty PDF');

  // dispatch a + b to Ludhiana hub (b is a transfer through the hub)
  r = await api('POST', '/challans', { fromBranch: byCode.TPR._id, toBranch: byCode.LDH._id, lrIds: [a.data.lr._id, b.data.lr._id], vehicleNo: 'TN 39 AB 1234', driverName: 'Ravi', lorryHire: 45000, advancePaid: 20000 });
  assert.equal(r.status, 201, r.message);
  const ch1 = r.data;
  assert.equal(ch1.type, 'transfer');
  step(`challan ${ch1.challanNo} with 2 LR`);

  // same LR on another challan must fail
  r = await api('POST', '/challans', { fromBranch: byCode.TPR._id, toBranch: byCode.LDH._id, lrIds: [a.data.lr._id] });
  assert.equal(r.status, 409);
  step('duplicate dispatch blocked');

  // pending reports
  r = await api('GET', '/reports/pending?type=dispatch');
  assert.ok(r.data.items.some((i) => i.lrNo === c.data.lr.lrNo));
  r = await api('GET', '/reports/pending?type=unloading');
  assert.equal(r.data.total, 2);
  step('pending dispatch / unloading reports');

  // unload at Ludhiana: a short by 1, b fine
  r = await api('POST', `/challans/${ch1._id}/unload`, { lines: [{ lr: a.data.lr._id, receivedNag: 9, damagedNag: 1, damageRemark: '1 bale torn' }, { lr: b.data.lr._id }] });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.status, 'received');
  let la = await api('GET', `/lrs/${a.data.lr._id}`);
  let lb = await api('GET', `/lrs/${b.data.lr._id}`);
  assert.equal(la.data.status, 'arrived');
  assert.equal(lb.data.status, 'at_branch');
  r = await api('GET', '/claims');
  assert.equal(r.data.total, 2); // short + damage
  step('unloaded at LDH: A arrived (1 short, 1 damaged → claims), B waiting at hub');

  // unloading twice does nothing
  r = await api('POST', `/challans/${ch1._id}/unload`, { lines: [{ lr: a.data.lr._id }] });
  assert.equal(r.status, 400);
  step('second unloading blocked');

  // transfer B from Ludhiana to Jalandhar
  r = await api('POST', '/challans', { fromBranch: byCode.LDH._id, toBranch: byCode.JAL._id, lrIds: [b.data.lr._id], vehicleNo: 'PB10XY9999' });
  assert.equal(r.status, 201, r.message);
  r = await api('POST', `/challans/${r.data._id}/unload`, { lines: [{ lr: b.data.lr._id }] });
  lb = await api('GET', `/lrs/${b.data.lr._id}`);
  assert.equal(lb.data.status, 'arrived');
  assert.equal(String(lb.data.currentBranch._id), String(byCode.JAL._id));
  step('branch transfer LDH → JAL');

  // deliver A with POD + collected to-pay freight
  const fd = new FormData();
  fd.append('receiverName', 'Harpreet (Gill Hosiery)');
  fd.append('receiverMobile', '9812345678');
  fd.append('collectedAmount', String(la.data.freight.total));
  fd.append('collectionMode', 'cash');
  fd.append('pod', new Blob([Buffer.from('%PDF-1.4 test pod')], { type: 'application/pdf' }), 'pod.pdf');
  r = await api('POST', `/lrs/${a.data.lr._id}/deliver`, null, { form: fd });
  assert.equal(r.status, 200, r.message);
  assert.match(r.data.delivery.dcNo, /^LDH-DC-/);
  assert.equal(r.data.delivery.podFiles.length, 1);
  step(`delivered A, ${r.data.delivery.dcNo}, POD saved`);

  const fd2 = new FormData();
  fd2.append('receiverName', 'x');
  fd2.append('collectedAmount', '1');
  r = await api('POST', `/lrs/${a.data.lr._id}/deliver`, null, { form: fd2 });
  assert.equal(r.status, 409);
  step('double delivery blocked');

  pdf = await api('GET', `/lrs/${a.data.lr._id}/dc-pdf`, null, { raw: true });
  assert.equal(pdf.status, 200);
  pdf = await api('GET', `/challans/${ch1._id}/pdf`, null, { raw: true });
  assert.equal(pdf.status, 200);
  step('DC + challan PDFs');

  // clerk scoping: TPR clerk cannot see LDH-only data or deliver at JAL
  r = await api('POST', '/auth/login', { username: 'tprclerk', password: 'clerk123' });
  const ownerToken = token;
  token = r.data.token;
  r = await api('POST', '/lrs', { bookingBranch: byCode.LDH._id, deliveryBranch: byCode.TPR._id, consignor: { name: 'x' }, consignee: { name: 'y' }, items: [{ description: 'z', nag: 1 }] });
  assert.equal(r.status, 403);
  r = await api('GET', '/audit');
  assert.equal(r.status, 403);
  token = ownerToken;
  step('branch + role restrictions');

  // edit after dispatch not allowed, cancel C works
  r = await api('PUT', `/lrs/${a.data.lr._id}`, { remarks: 'x' });
  assert.equal(r.status, 400);
  r = await api('POST', `/lrs/${c.data.lr._id}/cancel`, { reason: 'Party cancelled' });
  assert.equal(r.status, 200);
  step('edit lock after dispatch, cancel before dispatch');

  // ═══ Phase 2: billing, receipts, ledger, broker ═══
  r = await api('POST', '/brokers', { name: 'Rakesh Broker', commissionType: 'percent', commissionValue: 5 });
  const broker = r.data;
  r = await api('POST', '/parties', { name: 'Sri Murugan Knits TBB', mobile: '9876500001', creditLimit: 4000, creditDays: 30, openingBalance: 1000 });
  const tbbParty = r.data;
  const tbb = (kg) => api('POST', '/lrs', {
    bookingBranch: byCode.TPR._id, deliveryBranch: byCode.LDH._id,
    consignor: { party: tbbParty._id, name: tbbParty.name, mobile: tbbParty.mobile },
    consignee: { name: 'Gill Hosiery', mobile: '9812345678' },
    items: [{ description: 'Yarn', nag: 5, actualWeight: kg }], paymentType: 'tbb', broker: broker._id,
    freight: { basis: 'weight', rate: 6 },
  });
  const t1 = await tbb(300); // 1800
  const t2 = await tbb(200); // 1200
  assert.equal(t1.status, 201, t1.message);
  const t3 = await tbb(300); // exposure 1000 + 3000 + 1800 > 4000 → warning
  assert.ok(t3.data.warning?.includes('Credit limit'), 'credit warning expected');
  step(`TBB LRs booked, credit warning: "${t3.data.warning.slice(0, 40)}…"`);

  r = await api('GET', '/reports/brokers');
  let br = r.data.items.find((x) => x._id === broker._id);
  assert.equal(br.commission, (1800 + 1200 + 1800) * 0.05);
  step(`broker commission ₹${br.commission}`);

  r = await api('GET', '/billing/parties');
  assert.ok(r.data.items.some((x) => x.party === tbbParty._id && x.lrs === 3));
  r = await api('GET', `/billing/unbilled?party=${tbbParty._id}`);
  assert.equal(r.data.amount, 4800);
  r = await api('POST', '/bills', { party: tbbParty._id, branch: byCode.TPR._id, lrIds: [t1.data.lr._id, t2.data.lr._id], discount: 100 });
  assert.equal(r.status, 201, r.message);
  const bill = r.data;
  assert.equal(bill.total, 2900);
  r = await api('POST', '/bills', { party: tbbParty._id, branch: byCode.TPR._id, lrIds: [t1.data.lr._id] });
  assert.equal(r.status, 409);
  r = await api('PUT', `/lrs/${t1.data.lr._id}`, { remarks: 'x' });
  assert.equal(r.status, 400);
  step(`bill ${bill.billNo} ₹${bill.total}; double billing + edit of billed LR blocked`);

  pdf = await api('GET', `/bills/${bill._id}/pdf`, null, { raw: true });
  assert.equal(pdf.status, 200);

  // part payment, then the rest with TDS
  r = await api('POST', '/receipts', { party: tbbParty._id, branch: byCode.TPR._id, amount: 1000, mode: 'cash' });
  assert.equal(r.status, 201, r.message);
  const rc1 = r.data;
  let b2 = (await api('GET', `/bills/${bill._id}`)).data;
  assert.equal(b2.status, 'partial');
  assert.equal(b2.balance, 1900);
  r = await api('POST', '/receipts', { party: tbbParty._id, branch: byCode.TPR._id, amount: 2350, tds: 50, mode: 'bank', reference: 'UTR123' });
  assert.equal(r.status, 201, r.message);
  b2 = (await api('GET', `/bills/${bill._id}`)).data;
  assert.equal(b2.status, 'paid');
  assert.equal(r.data.onAccount, 500); // 2400 settles 1900, 500 kept on account
  step(`part payment → partial, second payment (incl. TDS) → paid, ₹${r.data.onAccount} on account`);

  r = await api('POST', `/bills/${bill._id}/cancel`, { reason: 'test' });
  assert.equal(r.status, 400);
  step('paid bill cannot be cancelled');

  // ledger: opening 1000 + bill 2900 − 1000 − 2400 = 500
  r = await api('GET', `/ledger/party/${tbbParty._id}`);
  assert.equal(r.data.closing, 500);
  assert.equal(r.data.unbilled, 1800);
  pdf = await api('GET', `/ledger/party/${tbbParty._id}?pdf=1`, null, { raw: true });
  assert.equal(pdf.status, 200);
  step(`party ledger closing ₹${r.data.closing} Dr, unbilled ₹${r.data.unbilled}`);

  // cancel first receipt → bill partly open again
  r = await api('POST', `/receipts/${rc1._id}/cancel`, { reason: 'cheque bounced' });
  assert.equal(r.status, 200, r.message);
  b2 = (await api('GET', `/bills/${bill._id}`)).data;
  assert.equal(b2.status, 'partial');
  assert.equal(b2.balance, 1000);
  r = await api('GET', `/ledger/party/${tbbParty._id}`);
  assert.equal(r.data.closing, 1500);
  step('receipt cancel reopens bill and restores balance');

  r = await api('GET', '/reports/outstanding');
  const row = r.data.rows.find((x) => x.party === tbbParty._id);
  assert.equal(row.net, 1500); // opening 1000 + bill balance 1000 − on account 500
  assert.equal(row.b0_30, 1000);
  step(`outstanding ageing: net ₹${row.net}, 0-30 days ₹${row.b0_30}`);

  r = await api('POST', `/brokers/${broker._id}/payments`, { branch: byCode.TPR._id, amount: 100, mode: 'cash' });
  assert.equal(r.status, 201, r.message);
  r = await api('GET', `/ledger/broker/${broker._id}`);
  assert.equal(r.data.closing, 240 - 100);
  step(`broker paid ₹100, pending ₹${r.data.closing}`);

  r = await api('POST', `/parties/${tbbParty._id}/remind`);
  assert.equal(r.status, 200, r.message);
  r = await api('POST', '/reminders/run');
  assert.equal(r.data.sent, 0); // just reminded → not again for 15 days
  step('payment reminder sent, 15-day gap respected');

  // ═══ Phase 3: cash / bank, vouchers, lorry hire, P&L, payables, import ═══
  r = await api('GET', '/money-accounts');
  const accounts = r.data.items;
  const cashOf = (code) => accounts.find((a) => a.type === 'cash' && a.branch?.code === code);
  assert.ok(cashOf('TPR') && cashOf('LDH'), 'every branch has a cash box');
  // TPR cash so far: − lorry hire advance 20000 (ch1) − broker paid 100 in cash
  assert.equal(cashOf('TPR').balance, -20100);
  // LDH cash: + TO PAY collected at delivery (3070)
  assert.equal(cashOf('LDH').balance, 3070);
  // bank receipt (2350, UTR123) went to the auto-created main bank account
  const bank = accounts.find((a) => a.type === 'bank');
  assert.equal(bank.balance, 2350);
  step('cash boxes auto-created; delivery collection, hire advance and bank receipt posted');

  r = await api('PUT', `/money-accounts/${cashOf('LDH')._id}`, { ...cashOf('LDH'), branch: byCode.LDH._id, openingBalance: 10000 });
  assert.equal(r.status, 200, r.message);

  // PAID LR → cash in at booking branch; cancel → reversed
  const paid = await api('POST', '/lrs', {
    bookingBranch: byCode.TPR._id, deliveryBranch: byCode.LDH._id,
    consignor: { name: 'Walk-in Customer', mobile: '9876500002' }, consignee: { name: 'Gill Hosiery', mobile: '9812345678' },
    items: [{ description: 'Cartons', nag: 2, actualWeight: 100 }], paymentType: 'paid', paidMode: 'cash',
    freight: { basis: 'weight', rate: 6 },
  });
  assert.equal(paid.status, 201, paid.message);
  r = await api('GET', `/cashbook?account=${cashOf('TPR')._id}&from=2000-01-01`);
  assert.equal(r.data.closing, -20100 + 600);
  await api('POST', `/lrs/${paid.data.lr._id}/cancel`, { reason: 'test' });
  r = await api('GET', `/cashbook?account=${cashOf('TPR')._id}&from=2000-01-01`);
  assert.equal(r.data.closing, -20100);
  step('PAID LR posts ₹600 to TPR cash, cancel reverses it');

  // vouchers at LDH
  r = await api('GET', '/heads?kind=expense');
  assert.ok(r.data.items.some((h) => h.name === 'Rent'));
  r = await api('POST', '/vouchers', { type: 'expense', branch: byCode.LDH._id, head: 'Rent', amount: 5000, mode: 'cash', paidTo: 'Landlord' });
  assert.equal(r.status, 201, r.message);
  r = await api('POST', '/vouchers', { type: 'income', branch: byCode.LDH._id, head: 'Godown rent received', amount: 1000, mode: 'cash' });
  assert.equal(r.status, 201, r.message);
  r = await api('POST', '/vouchers', { type: 'contra', branch: byCode.LDH._id, amount: 2000, account: cashOf('LDH')._id, toAccount: bank._id, narration: 'Cash deposited' });
  assert.equal(r.status, 201, r.message);
  const wrong = await api('POST', '/vouchers', { type: 'expense', branch: byCode.LDH._id, head: 'Electricity', amount: 999, mode: 'cash' });
  r = await api('POST', `/vouchers/${wrong.data.refId}/cancel`, { reason: 'entered twice' });
  assert.equal(r.status, 200, r.message);
  r = await api('POST', `/vouchers/${wrong.data.refId}/cancel`, { reason: 'again' });
  assert.equal(r.status, 400);
  r = await api('GET', `/cashbook?account=${cashOf('LDH')._id}&from=2000-01-01`);
  // 10000 opening + 3070 − 5000 + 1000 − 2000 (+999 −999) = 7070
  assert.equal(r.data.closing, 7070);
  pdf = await api('GET', `/cashbook?account=${cashOf('LDH')._id}&from=2000-01-01&pdf=1`, null, { raw: true });
  assert.equal(pdf.status, 200);
  r = await api('GET', '/vouchers?from=2000-01-01');
  assert.equal(r.data.sums.expense, 5000);
  step(`LDH cash book closing ₹7070 after rent, income, deposit to bank and a cancelled voucher`);

  // lorry hire balance paid at Ludhiana from bank
  r = await api('GET', '/lorry-hire');
  assert.equal(r.data.totalPending, 25000);
  r = await api('POST', `/challans/${ch1._id}/hire-payment`, { amount: 30000, mode: 'bank' });
  assert.equal(r.status, 400);
  r = await api('POST', `/challans/${ch1._id}/hire-payment`, { amount: 25000, mode: 'bank' });
  assert.equal(r.status, 200, r.message);
  r = await api('GET', '/lorry-hire');
  assert.equal(r.data.totalPending, 0);
  step('lorry hire balance ₹25000 paid, overpayment blocked');

  // P&L
  r = await api('GET', '/reports/pnl?from=2000-01-01');
  const T = r.data.total;
  assert.equal(T.lorryHire, 45000);
  assert.equal(T.brokerCommission, 240);
  assert.equal(T.discount, 100);
  assert.equal(T.otherIncome, 1000);
  assert.equal(T.expenses, 5000);
  assert.equal(T.heads.Rent, 5000);
  assert.equal(T.profit, Math.round((T.income - T.totalExpense) * 100) / 100);
  const ldhRow = r.data.rows.find((x) => x.branch.code === 'LDH');
  assert.equal(ldhRow.expenses, 5000);
  pdf = await api('GET', '/reports/pnl?from=2000-01-01&pdf=1', null, { raw: true });
  assert.equal(pdf.status, 200);
  step(`P&L: income ₹${T.income}, expenses ₹${T.totalExpense}, ${T.profit >= 0 ? 'profit' : 'loss'} ₹${Math.abs(T.profit)}`);

  r = await api('GET', '/reports/payables');
  assert.equal(r.data.totals.brokers, 140);
  assert.equal(r.data.totals.lorryHire, 0);
  step(`payables: brokers ₹${r.data.totals.brokers}, lorry hire ₹${r.data.totals.lorryHire}, party advances ₹${r.data.totals.partyAdvances}`);

  // ── Vouch import ──
  const ExcelJS = (await import('exceljs')).default;
  const sheet = async (rows) => { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('x'); rows.forEach((x) => ws.addRow(x)); return Buffer.from(await wb.xlsx.writeBuffer()); };
  const upload = async (path, buf, name) => { const fd = new FormData(); fd.append('file', new Blob([buf]), name); return api('POST', path, null, { form: fd }); };
  let tpl = await api('GET', '/import/template/lrs', null, { raw: true });
  assert.equal(tpl.status, 200);
  const partyXlsx = await sheet([
    ['Party Name', 'Mobile', 'City', 'Opening Balance', 'Branch'],
    ['Old Party One', '9811111111', 'Ludhiana', '12,500 Dr', 'LDH'],
    ['Old Party Two', '12345', 'Kochi', 800, 'COK'],
  ]);
  r = await upload('/import/parties?commit=0', partyXlsx, 'parties.xlsx');
  assert.equal(r.data.ready, 1);
  assert.equal(r.data.withErrors, 1);
  r = await upload('/import/parties?commit=1', partyXlsx, 'parties.xlsx');
  assert.equal(r.status, 400);
  r = await upload('/import/parties?commit=1&skipErrors=1', partyXlsx, 'parties.xlsx');
  assert.equal(r.data.saved, 1);
  r = await api('GET', '/parties?q=Old Party One');
  assert.equal(r.data.items[0].openingBalance, 12500);
  const lrCsv = Buffer.from('Bilty No,Date,From,To,Consignor,Consignee,Nag,Weight,Freight,Payment Type,Status\nVCH-1001,05-04-2025,TPR,LDH,Old Party One,Gill Hosiery,10,500,3050,tbb,delivered\nVCH-1002,06/04/2025,TPR,XXX,A,B,1,1,10,paid,delivered\n');
  r = await upload('/import/lrs?commit=1&skipErrors=1', lrCsv, 'lrs.csv');
  assert.equal(r.status, 200, r.message);
  assert.equal(r.data.saved, 1);
  assert.equal(r.data.withErrors, 1);
  r = await api('GET', '/lrs/by-no/VCH-1001');
  assert.equal(r.data.migratedFrom, 'vouch');
  assert.equal(r.data.billed, true);
  r = await upload('/import/lrs?commit=1', lrCsv.toString().split('\n').slice(0, 2).join('\n') + '\n' === '' ? lrCsv : Buffer.from('LR No,LR Date,From Branch Code,To Branch Code,Consignor,Consignee,Freight Total\nVCH-1001,05-04-2025,TPR,LDH,X,Y,1\n'), 'again.csv');
  assert.equal(r.data.saved, 0); // already imported → skipped
  const AdmZip = (await import('adm-zip')).default;
  const z = new AdmZip();
  z.addFile('VCH-1001_POD.pdf', Buffer.from('%PDF-1.4 pod'));
  z.addFile('UNKNOWN-9.pdf', Buffer.from('%PDF-1.4 x'));
  r = await upload('/import/pod', z.toBuffer(), 'pods.zip');
  assert.equal(r.data.matched.length, 1);
  assert.equal(r.data.unmatched.length, 1);
  r = await upload('/import/money?commit=1', await sheet([['Account Name', 'Type', 'Branch Code', 'Opening Balance'], ['HDFC Current', 'bank', '', 150000]]), 'money.xlsx');
  assert.equal(r.data.saved, 1);
  step('Vouch import: parties (with error preview), LRs from CSV, duplicate skip, POD zip matched, bank opening');

  // dashboard
  r = await api('GET', '/dashboard');
  assert.equal(r.data.totals.bookings, 5); // C + paid LR cancelled, 3 TBB added
  assert.equal(r.data.totals.billed, 2900);
  assert.equal(r.data.totals.outstanding, 1000);
  assert.equal(r.data.totals.deliveredLrs, 1);
  assert.equal(r.data.totals.toDeliver, 1); // B at Jalandhar
  step(`dashboard: ${JSON.stringify(r.data.totals)}`);

  // totals must work when a branch is picked (aggregate needs ObjectIds)
  r = await api('GET', `/lrs?branch=${byCode.TPR._id}&from=2000-01-01`);
  assert.ok(r.data.sums.nag > 0, 'LR register totals for a branch');
  r = await api('GET', `/bills?branch=${byCode.TPR._id}`);
  assert.equal(r.data.sums.total, 2900);
  step('branch-filtered totals');

  // public tracking
  token = null;
  r = await api('GET', `/public/track/${b.data.lr.lrNo}`);
  assert.equal(r.data.status, 'arrived');
  assert.equal(r.data.freight, undefined);
  step('public tracking hides amounts');
  token = ownerToken;

  r = await api('GET', '/audit?entity=LR');
  assert.ok(r.data.total >= 4);
  r = await api('GET', '/notifications');
  assert.ok(r.data.items.some((n) => n.event === 'lr_unloaded') && r.data.items.some((n) => n.event === 'lr_delivered'));
  step(`audit log (${r.data.total} notifications logged)`);

  r = await api('POST', '/backup/run');
  assert.equal(r.status, 200, r.message);
  step(`backup: ${r.data.collections} collections`);

  console.log('\n✅ ALL FLOW TESTS PASSED');
} catch (e) {
  console.error('\n❌ TEST FAILED:', e.message);
  process.exitCode = 1;
} finally {
  server.close();
  await mongoose.disconnect();
}
