import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { authorizeRoles, OPS_ROLES, MANAGER_ROLES, HQ_ROLES } from '../middleware/authRoles.js';
import { podUpload } from '../middleware/upload.js';
import { login, me, changePassword } from '../controllers/authController.js';
import { branchCtl, partyCtl, brokerCtl, vehicleCtl, rateCtl, userCtl } from '../controllers/masterController.js';
import * as lr from '../controllers/lrController.js';
import * as ch from '../controllers/challanController.js';
import * as dl from '../controllers/deliveryController.js';
import * as rp from '../controllers/reportController.js';
import { runBackup } from '../jobs/backupJob.js';
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
