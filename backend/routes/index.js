import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { authorizeRoles, OPS_ROLES, MANAGER_ROLES, HQ_ROLES, ACCOUNTS_ROLES } from '../middleware/authRoles.js';
import { podUpload, importUpload } from '../middleware/upload.js';
import { login, me, changePassword } from '../controllers/authController.js';
import { branchCtl, partyCtl, brokerCtl, vehicleCtl, rateCtl, userCtl } from '../controllers/masterController.js';
import * as lr from '../controllers/lrController.js';
import * as ch from '../controllers/challanController.js';
import * as dl from '../controllers/deliveryController.js';
import * as rp from '../controllers/reportController.js';
import * as ac from '../controllers/accountsController.js';
import * as fin from '../controllers/financeController.js';
import * as imp from '../controllers/importController.js';
import { runBackup } from '../jobs/backupJob.js';
import { runReminders } from '../jobs/reminderJob.js';
import { ah, ok } from '../utils/http.js';

export const router = Router();

// ── public ──
router.post('/auth/login', login);
router.get('/public/track/:lrNo', lr.publicTrack);

// ── everything below needs login ──
router.use(authMiddleware);
router.get('/auth/me', me);
router.post('/auth/change-password', changePassword);

const ALL = ['owner', 'admin', 'branch_manager', 'booking_clerk', 'accountant', 'viewer'];
const masters = (path, ctl, writeRoles) => {
  router.get(`/${path}`, ctl.list);
  if (ctl.get) router.get(`/${path}/:id`, ctl.get);
  router.post(`/${path}`, authorizeRoles(...writeRoles), ctl.create);
  router.put(`/${path}/:id`, authorizeRoles(...writeRoles), ctl.update);
  if (ctl.remove) router.delete(`/${path}/:id`, authorizeRoles(...writeRoles), ctl.remove);
};
masters('branches', branchCtl, HQ_ROLES);
// money fields on a party can only be set by accounts staff
const guardPartyMoney = (req, res, next) => {
  if (!ACCOUNTS_ROLES.includes(req.user.role)) for (const k of ['openingBalance', 'openingDate', 'creditLimit', 'creditDays']) delete req.body?.[k];
  next();
};
router.post('/parties', guardPartyMoney);
router.put('/parties/:id', guardPartyMoney);
masters('parties', partyCtl, [...OPS_ROLES, 'accountant']);
masters('brokers', brokerCtl, [...MANAGER_ROLES, 'accountant']);
masters('vehicles', vehicleCtl, OPS_ROLES);
masters('rates', rateCtl, HQ_ROLES);
router.get('/users', authorizeRoles(...HQ_ROLES), userCtl.list);
router.post('/users', authorizeRoles(...HQ_ROLES), userCtl.create);
router.put('/users/:id', authorizeRoles(...HQ_ROLES), userCtl.update);

// ── LR booking ──
router.get('/lrs', authorizeRoles(...ALL), lr.listLRs);
router.get('/lrs/rate', lr.rateLookup);
router.get('/lrs/by-no/:lrNo', lr.findByNo);
router.get('/lrs/:id', lr.getLR);
router.get('/lrs/:id/pdf', lr.lrPdfCtl);
router.post('/lrs', authorizeRoles(...OPS_ROLES), lr.createLR);
router.put('/lrs/:id', authorizeRoles(...OPS_ROLES), lr.updateLR);
router.post('/lrs/:id/cancel', authorizeRoles(...MANAGER_ROLES), lr.cancelLR);

// ── dispatch / transfer / unloading ──
router.get('/challans/loadable', ch.loadable);
router.get('/challans', ch.listChallans);
router.get('/challans/:id', ch.getChallan);
router.get('/challans/:id/pdf', ch.challanPdfCtl);
router.post('/challans', authorizeRoles(...OPS_ROLES), ch.createChallan);
router.post('/challans/:id/unload', authorizeRoles(...OPS_ROLES), ch.unloadChallan);
router.post('/challans/:id/cancel', authorizeRoles(...MANAGER_ROLES), ch.cancelChallan);

// ── delivery ──
router.post('/lrs/:id/deliver', authorizeRoles(...OPS_ROLES), podUpload.array('pod', 5), dl.deliverLR);
router.post('/lrs/:id/pod', authorizeRoles(...OPS_ROLES), podUpload.array('pod', 5), dl.addPod);
router.get('/lrs/:id/dc-pdf', dl.dcPdfCtl);

// ── dashboard & reports ──
router.get('/dashboard', rp.dashboard);
router.get('/reports/pending', rp.pendingReport);
router.get('/reports/movement', rp.branchMovement);
router.get('/claims', rp.claims);
router.put('/claims/:id', authorizeRoles(...MANAGER_ROLES), rp.updateClaim);
router.get('/alerts', rp.branchAlerts);
router.post('/alerts/read', rp.markAlertsRead);
router.get('/audit', authorizeRoles(...HQ_ROLES), rp.auditLog);
router.get('/notifications', authorizeRoles(...HQ_ROLES), rp.notifications);
router.post('/backup/run', authorizeRoles('owner'), ah(async (req, res) => ok(res, await runBackup(), 'Backup done')));

// ── Phase 2: billing, receipts, ledgers, brokers, outstanding ──
const ACC = ACCOUNTS_ROLES;
router.get('/billing/parties', authorizeRoles(...ACC), ac.partiesToBill);
router.get('/billing/unbilled', authorizeRoles(...ACC), ac.unbilledLRs);
router.get('/bills', authorizeRoles(...ACC, 'viewer'), ac.listBills);
router.get('/bills/:id', authorizeRoles(...ACC, 'viewer'), ac.getBill);
router.get('/bills/:id/pdf', authorizeRoles(...ACC, 'viewer'), ac.billPdfCtl);
router.post('/bills', authorizeRoles(...ACC), ac.createBill);
router.post('/bills/:id/cancel', authorizeRoles(...MANAGER_ROLES, 'accountant'), ac.cancelBill);

router.get('/receipts/open-bills', authorizeRoles(...ACC), ac.openBills);
router.get('/receipts', authorizeRoles(...ACC, 'viewer'), ac.listReceipts);
router.get('/receipts/:id', authorizeRoles(...ACC, 'viewer'), ac.getReceipt);
router.get('/receipts/:id/pdf', authorizeRoles(...ACC, 'viewer'), ac.receiptPdfCtl);
router.post('/receipts', authorizeRoles(...ACC), ac.createReceipt);
router.post('/receipts/:id/adjust', authorizeRoles(...ACC), ac.adjustOnAccount);
router.post('/receipts/:id/cancel', authorizeRoles(...MANAGER_ROLES, 'accountant'), ac.cancelReceipt);

router.get('/ledger/party/:id', authorizeRoles(...ACC, 'viewer'), ac.partyLedger);
router.get('/ledger/broker/:id', authorizeRoles(...ACC, 'viewer'), ac.brokerLedger);
router.get('/reports/outstanding', authorizeRoles(...ACC, 'viewer'), ac.outstanding);
router.get('/reports/brokers', authorizeRoles(...ACC, 'viewer'), ac.brokerSummary);
router.post('/brokers/:id/payments', authorizeRoles(...ACC), ac.payBroker);
router.post('/parties/:id/remind', authorizeRoles(...ACC), ac.sendReminder);
router.post('/reminders/run', authorizeRoles(...HQ_ROLES), ah(async (req, res) => ok(res, await runReminders(), 'Reminders processed')));

// ── Phase 3: cash / bank, vouchers, lorry hire, P&L, payables, Vouch import ──
router.get('/money-accounts', authorizeRoles(...ACC, 'viewer'), fin.listMoneyAccounts);
router.post('/money-accounts', authorizeRoles(...HQ_ROLES), fin.saveMoneyAccount);
router.put('/money-accounts/:id', authorizeRoles(...HQ_ROLES), fin.saveMoneyAccount);
router.get('/heads', fin.listHeads);
router.post('/heads', authorizeRoles(...ACC), fin.createHead);
router.get('/vouchers', authorizeRoles(...ACC, 'viewer'), fin.listVouchers);
router.post('/vouchers', authorizeRoles(...ACC), fin.createVoucher);
router.post('/vouchers/:id/cancel', authorizeRoles(...MANAGER_ROLES, 'accountant'), fin.cancelVoucher);
router.get('/cashbook', authorizeRoles(...ACC, 'viewer'), fin.cashBook);
router.get('/lorry-hire', authorizeRoles(...ACC, 'viewer'), fin.lorryHire);
router.post('/challans/:id/hire-payment', authorizeRoles(...ACC), fin.payLorryHire);
router.get('/reports/pnl', authorizeRoles(...ACC, 'viewer'), fin.pnl);
router.get('/reports/payables', authorizeRoles(...ACC, 'viewer'), fin.payables);

router.get('/import/kinds', authorizeRoles(...HQ_ROLES), imp.importKinds);
router.get('/import/template/:kind', authorizeRoles(...HQ_ROLES), imp.template);
router.post('/import/pod', authorizeRoles(...HQ_ROLES), importUpload.single('file'), imp.importPods);
router.post('/import/:kind', authorizeRoles(...HQ_ROLES), importUpload.single('file'), imp.runImport);
