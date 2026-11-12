import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { useAppSelector, HQ, type User } from './redux/store';
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
            <Route path="users" element={<Protected roles={HQ}><Users /></Protected>} />
            <Route path="audit" element={<Protected roles={HQ}><AuditLog /></Protected>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
