# HaulMind India – Transport Management Software

HaulMind India is the Indian parcel-transport edition of HaulMind (Wayne E Solutions' trucking software):
multi-branch LR / bilty booking, dispatch, branch transfer, unloading, delivery with POD, owner dashboard.
One codebase, one install per transport company. **First customer: TCL Logistics** (Ludhiana + Tiruppur hubs,
branches in Punjab, Tamil Nadu, Kerala) – their requirement list is what Phase 1 follows.

The customer's name comes from settings (`COMPANY_NAME` in backend `.env`, `VITE_COMPANY_NAME` in frontend env)
and is printed on LR, challan, DC and WhatsApp/SMS. The app itself carries the HaulMind logo and colours.

Built on the same stack as the Logistiq portal
(Express 5 + MongoDB/Mongoose backend, React 19 + TypeScript + Vite + Ant Design + Tailwind + Redux frontend).

```
haulmind-india/
├── backend/    Node API  (config · middleware · models · controllers · routes · services · jobs · scripts)
└── frontend/   React web app (works on phone and computer)
```

## Phase 1 – done in this code

| Requirement (TCL list) | Where |
|---|---|
| 1. Branch management – LDH + TPR hubs, all branches linked, owner sees all, staff see own branch | `models/masterModels.js` (Branch), `middleware/authRoles.js` (branch scoping), header branch switcher |
| 2. LR booking – auto LR no. per branch per FY (`LDH-2627-00001`), consignor/consignee, goods, nag, weight, stations, freight, bilty PDF (3 copies), reprint, status by LR no. | `controllers/lrController.js`, `services/pdfService.js`, `pages/LRForm.tsx`, `LRDetail.tsx` |
| 3. Dispatch – many LRs on one challan, vehicle/driver, auto challan, date-time, destination branch alerted | `controllers/challanController.js`, `pages/Dispatch.tsx` |
| 4. Unloading – arrival entry, received vs short, damage record, WhatsApp/SMS to party, not-unloaded report | `unloadChallan`, `pages/Unloading.tsx`, Reports → Not yet unloaded |
| 5. Branch transfer – hub-to-branch transfer challan, in-transit / arrived status, no duplicate entry | same challan flow (`type: transfer`), conditional DB updates |
| 6. Delivery – DC no., receiver name/mobile, signature pad, POD photo/PDF upload, no double delivery, pending-delivery report | `controllers/deliveryController.js`, `components/DeliverModal.tsx` |
| 9. Notifications – booked / arrived / delivered messages (WhatsApp Cloud API or MSG91 SMS), every message logged | `services/notificationService.js` |
| 11. Dashboard – today's bookings, dispatch, unloading, delivery, freight, collection, per branch | `reportController.dashboard`, `pages/Dashboard.tsx` |
| 13. Security – login per employee, 6 roles, branch-limited access, daily 5 AM backup, mobile + desktop | `authMiddleware`, `authRoles`, `jobs/backupJob.js` |
| 14. Extras – freight calculation (party/route rates), damage claims, audit log, LR tracking (public page), credit-limit warning on TBB | `freightService`, `Claim`, `AuditLog`, `/track` |

## Phase 2 / 3 – next

- Billing: party bills from many LRs, bill PDF, outstanding + ageing (7)
- Payments: cash/bank receipts against bills, part payment, broker commission, receipts (8)
- 15-day payment reminders + 30-day credit tracking (9) – template `payment_reminder` already exists
- Accounting: ledgers, cash/bank book, branch expenses, P&L per branch/month/year (10, 11)
- Vouch data import: LR Excel, party/broker ledgers, cash/bank, POD/DC PDFs (12) – LR model already has `migratedFrom`, and the API accepts the old LR no. for migrated records

## Run locally

Needs Node 20+ and MongoDB (local or Atlas).

```bash
# backend
cd backend
cp .env.example .env          # set MONGO_URI and JWT_SECRET
npm install
npm run seed                  # creates hubs, sample branches, owner login (printed once)
npm run dev                   # http://localhost:5000

# frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173  (proxies /api to :5000)
```

Frontend env (`frontend/.env`): `VITE_COMPANY_NAME=TCL Logistics`

Full journey test (book → dispatch → unload → transfer → deliver → reports). **Wipes the DB you point it at:**

```bash
cd backend
MONGO_URI=mongodb://127.0.0.1:27017/haulmind_test npm test
```

## Deploy

- Backend → Render web service (`npm start`), env from `.env.example`. Mount a disk for `uploads/` and `backups/` (or swap `middleware/upload.js` for Logistiq's S3 upload).
- Frontend → Vercel (`npm run build`, output `dist`), env `VITE_API_BASE=https://<api-host>/api/v1`, `VITE_FILE_BASE=https://<api-host>`.
- Or single server: build the frontend, the backend serves `../frontend/dist` automatically.

## Before go-live

- Replace sample branches in `scripts/seed.js` with TCL's real list and codes
- Real route rates (Masters → Route rates)
- TCL logo on LR/challan/DC PDFs (`services/pdfService.js`); their own colour via `PDF_ACCENT` in `.env`
- WhatsApp: approve 4 templates in Meta (`hm_lr_booked`, `hm_lr_arrived`, `hm_lr_delivered`, `hm_payment_reminder`), set `NOTIFY_PROVIDER=whatsapp`
- SMS: DLT templates in MSG91, set `NOTIFY_PROVIDER=msg91`
- Turn on MongoDB Atlas backups in addition to the 5 AM file backup
