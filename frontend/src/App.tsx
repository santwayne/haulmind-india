import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { useAppSelector, HQ, ACCOUNTS, type User } from './redux/store';
import AppLayout from './layout/AppLayout';
import Login from './pages/Login';
import PublicTrack from './pages/PublicTrack';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const LRList = lazy(() => import('./pages/LRList'));
const LRForm = lazy(() => import('./pages/LRForm'));
const LRDetail = lazy(() => import('./pages/LRDetail'));
const Dispatch = lazy(() => import('./pages/Dispatch'));
const Challans = lazy(() => import('./pages/Challans'));
const Unloading = lazy(() => import('./pages/Unloading'));
const Delivery = lazy(() => import('./pages/Delivery'));
const Reports = lazy(() => import('./pages/Reports'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Masters = lazy(() => import('./pages/masters/Masters'));
const Billing = lazy(() => import('./pages/Billing'));
const Receipts = lazy(() => import('./pages/Receipts'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Outstanding = lazy(() => import('./pages/Outstanding'));
const BrokerCommission = lazy(() => import('./pages/BrokerCommission'));
const CashBook = lazy(() => import('./pages/CashBook'));
const Vouchers = lazy(() => import('./pages/Vouchers'));
const LorryHire = lazy(() => import('./pages/LorryHire'));
const ProfitLoss = lazy(() => import('./pages/ProfitLoss'));
const Payables = lazy(() => import('./pages/Payables'));
const ImportData = lazy(() => import('./pages/ImportData'));
const Users = lazy(() => import('./pages/masters/Users'));

const Protected = ({ children, roles }: { children: ReactNode; roles?: User['role'][] }) => {
  const user = useAppSelector((s) => s.auth.user);
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const Loading = () => (
  <div className="flex h-64 items-center justify-center">
    <Spin />
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/track" element={<PublicTrack />} />
          <Route
            element={
              <Protected>
                <AppLayout />
              </Protected>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="lrs" element={<LRList />} />
            <Route path="lrs/new" element={<LRForm />} />
            <Route path="lrs/:id" element={<LRDetail />} />
            <Route path="lrs/:id/edit" element={<LRForm />} />
            <Route path="dispatch" element={<Dispatch />} />
            <Route path="challans" element={<Challans />} />
            <Route path="unloading" element={<Unloading />} />
            <Route path="unloading/:id" element={<Unloading />} />
            <Route path="delivery" element={<Delivery />} />
            <Route path="reports" element={<Reports />} />
            <Route path="masters/:kind" element={<Masters />} />
            <Route path="billing" element={<Protected roles={[...ACCOUNTS, 'viewer']}><Billing /></Protected>} />
            <Route path="receipts" element={<Protected roles={[...ACCOUNTS, 'viewer']}><Receipts /></Protected>} />
            <Route path="ledger" element={<Protected roles={[...ACCOUNTS, 'viewer']}><Ledger /></Protected>} />
            <Route path="outstanding" element={<Protected roles={[...ACCOUNTS, 'viewer']}><Outstanding /></Protected>} />
            <Route path="brokers" element={<Protected roles={[...ACCOUNTS, 'viewer']}><BrokerCommission /></Protected>} />
            <Route path="cashbook" element={<Protected roles={[...ACCOUNTS, 'viewer']}><CashBook /></Protected>} />
            <Route path="vouchers" element={<Protected roles={[...ACCOUNTS, 'viewer']}><Vouchers /></Protected>} />
            <Route path="lorry-hire" element={<Protected roles={[...ACCOUNTS, 'viewer']}><LorryHire /></Protected>} />
            <Route path="profit-loss" element={<Protected roles={[...ACCOUNTS, 'viewer']}><ProfitLoss /></Protected>} />
            <Route path="payables" element={<Protected roles={[...ACCOUNTS, 'viewer']}><Payables /></Protected>} />
            <Route path="import" element={<Protected roles={HQ}><ImportData /></Protected>} />
            <Route path="users" element={<Protected roles={HQ}><Users /></Protected>} />
            <Route path="audit" element={<Protected roles={HQ}><AuditLog /></Protected>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
