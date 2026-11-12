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

## Phase 2 – billing & payments (done)

| Requirement | Where |
|---|---|
| 7. Billing – party account, bill from many LRs (TBB + to-pay delivered on credit), bill PDF, due date from party credit days, outstanding, days pending, full ledger any time | `controllers/accountsController.js` (bills, ledger), `pages/Billing.tsx`, `Ledger.tsx` |
| 8. Payments – cash / UPI / bank / cheque, bill-wise adjustment or auto oldest-first, part payment, TDS, money kept on account, receipt PDF, balance updates itself | receipts in `accountsController.js`, `pages/Receipts.tsx` |
| 8 + 14. Broker commission – % of freight or fixed per LR, posted automatically on booking, reversed on cancel/edit, broker payments, broker ledger | `services/accountService.js` (`syncCommission`), `pages/BrokerCommission.tsx` |
| 9. Payment reminder every 15 days, 30-day credit period, balance updates on payment | `jobs/reminderJob.js`, `Party.creditDays`, manual "Send reminder" button |
| 11. Who owes how much – outstanding with ageing (0-30 / 31-60 / 61-90 / 90+), overdue, unbilled; dashboard shows billed, received, outstanding per branch | `services/accountService.js` (`outstandingReport`), `pages/Outstanding.tsx`, `Dashboard.tsx` |
| 14. Credit control – warning when outstanding + unbilled + new LR crosses the party's credit limit | `creditCheck` in `accountService.js` |
| Opening balances (from Vouch) per party | Party master → "Opening balance" (accounts staff only) |

All money is written once as `LedgerEntry` rows (bill, receipt, cancel, commission, broker payment),
so every screen reads the same numbers. Billed LRs cannot be edited or cancelled until their bill is cancelled,
and a bill with payments cannot be cancelled until those receipts are cancelled.

## Phase 3 – accounting, P&L, Vouch import (done)

| Requirement | Where |
|---|---|
| 10. Full accounting – cash box per branch (auto), bank accounts, cash book / bank book with running balance + PDF | `models/financeModels.js`, `financeController.cashBook`, `pages/CashBook.tsx` |
| Money posts itself: PAID LR, TO PAY collected at delivery, party receipts (cash or chosen bank), broker payments, lorry hire advance / balance; cancelling writes an opposite entry | `services/financeService.js` (`postCash`, `reverseCash`) |
| 14. Branch expenses – rent, salary, electricity, diesel … (heads editable), other income, cash ↔ bank (contra) vouchers | `financeController.createVoucher`, `pages/Vouchers.tsx` |
| Lorry hire payable per challan, balance payment at unloading branch | `pages/LorryHire.tsx` |
| 11. Profit & loss per branch, per month, combined for all branches, PDF – freight (without GST) + other income − lorry hire − broker commission − bill discounts − claims − expenses | `financeController.pnl`, `pages/ProfitLoss.tsx` |
| 11. Who we have to pay – truck owners, brokers, party advances | `pages/Payables.tsx` |
| 12. Vouch import – parties with opening balance, brokers, last year's LRs, cash/bank opening; Excel or CSV, Vouch column names understood, preview with row errors before saving; POD/DC zip matched to LR numbers | `controllers/importController.js`, `pages/ImportData.tsx` |

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

## Deploy on AWS (EC2 + PM2 + Nginx)

One small server runs everything: the Node API also serves the built React app, so there is one domain and no CORS.

**Database:** MongoDB Atlas, region **Mumbai (ap-south-1)**, M10 or higher for daily snapshots. Allow only the EC2 instance's IP in Atlas Network Access. (A self-managed `mongod` on the same EC2 also works – then the 5 AM file backup is your only backup, so copy it to S3.)

**Server:** EC2 `t3.small` (2 GB) Ubuntu 24.04, security group open for 80/443 (and 22 from your IP only). Attach an Elastic IP and point the domain's A record to it.

```bash
ssh ubuntu@EC2-IP
git clone https://github.com/santwayne/haulmind-india.git && cd haulmind-india
bash deploy/setup-ec2.sh          # 1st run creates backend/.env with a random JWT secret, then stops
nano backend/.env                 # MONGO_URI, COMPANY_NAME, CORS_ORIGIN, PUBLIC_TRACK_URL, BACKUP_DIR
bash deploy/setup-ec2.sh          # 2nd run: installs, builds, seeds owner login (printed once), starts PM2 + Nginx
sudo nano /etc/nginx/sites-available/haulmind   # replace YOUR-DOMAIN
sudo certbot --nginx -d YOUR-DOMAIN             # HTTPS
```

Updates after merging to `main`: `bash deploy/update.sh` (pull → install → build → `pm2 reload`).

**Keep exactly one PM2 instance** (`deploy/ecosystem.config.cjs`): the 5 AM backup and the 15-day reminder job run inside the API, so more instances would duplicate them.

**Backups:** set `BACKUP_DIR=/home/ubuntu/haulmind-backups`, then add a cron line to push them to S3:
`15 5 * * * aws s3 sync /home/ubuntu/haulmind-backups s3://YOUR-BUCKET/haulmind-backups --delete`
Keep Atlas snapshots on as well. Restore a day's file backup with `cd backend && npm run restore -- 2026-11-12` (asks before replacing; try it first with `MONGO_URI` pointing at a spare database).

**Files:** POD photos are stored in `backend/uploads/pod` on the instance disk (EBS). Take EBS snapshots, or later switch `middleware/upload.js` to S3 (the Logistiq portal already has an S3 uploader).

**Logs:** `pm2 logs haulmind-india`, files in `/var/log/haulmind/`.

## Tests

- `backend/scripts/flowTest.js` – 37-step API journey across all three phases (book → dispatch → transfer → unload → deliver → bill → part payment → TDS → ledger → broker → cash book → vouchers → lorry hire → P&L → payables → Vouch import). Needs a database whose name contains "test" (it wipes it):
  `MONGO_URI=mongodb://127.0.0.1:27017/haulmind_test npm test`
- Checked in a real browser against the production build: login, LR booking form, dispatch, unloading, delivery with signature, bill, receipt, expense voucher, every page opened with no console errors and no server errors.

## Before go-live

- Replace sample branches in `scripts/seed.js` with TCL's real list and codes (before the first `npm run seed`)
- Run the Vouch import in this order: Cash & bank → Brokers → Parties → Old LRs → POD zip
- Real route rates (Masters → Route rates)
- TCL logo on LR/challan/DC PDFs (`services/pdfService.js`); their own colour via `PDF_ACCENT` in `.env`
- WhatsApp: approve 4 templates in Meta (`hm_lr_booked`, `hm_lr_arrived`, `hm_lr_delivered`, `hm_payment_reminder`), set `NOTIFY_PROVIDER=whatsapp`
- SMS: DLT templates in MSG91, set `NOTIFY_PROVIDER=msg91`
- Turn on MongoDB Atlas backups in addition to the 5 AM file backup
