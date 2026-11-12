import { useState } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { Button, Form, Input, Alert } from 'antd';
import { api, errMsg } from '../api/client';
import { loggedIn, useAppDispatch, useAppSelector } from '../redux/store';
import { COMPANY, LOGO, PRODUCT } from '../brand';

export default function Login() {
  const user = useAppSelector((s) => s.auth.user);
  const dispatch = useAppDispatch();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (v: { username: string; password: string }) => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.post('/auth/login', v);
      dispatch(loggedIn(r.data.data));
      nav('/');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 flex-col justify-between bg-gradient-to-br from-[#065f46] to-[#0f1f17] p-10 text-white lg:flex">
        <div className="text-sm font-semibold uppercase tracking-widest text-emerald-200">{PRODUCT}</div>
        <div>
          <div className="mb-4 inline-block rounded-md bg-amber-500/90 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[#0f1f17]">{COMPANY}</div>
          <h1 className="text-4xl font-extrabold leading-tight">
            Every branch.
            <br />
            Every LR.
            <br />
            One screen.
          </h1>
          <p className="mt-3 max-w-md text-emerald-100/80">
            Booking, dispatch, unloading and delivery across all your branches — live from head office.
          </p>
        </div>
        <div className="text-xs text-emerald-200/70">HaulMind · Built by Wayne E Solutions</div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <img src={LOGO} alt="HaulMind" className="mb-6 h-20 w-auto" />
          <h2 className="text-2xl font-extrabold text-[#0f1f17]">Sign in to {COMPANY}</h2>
          <p className="mb-6 text-slate-500">Use the ID given by your head office.</p>
          {err && <Alert type="error" message={err} className="!mb-4" showIcon />}
          <Form layout="vertical" onFinish={submit} requiredMark={false} size="large">
            <Form.Item name="username" label="User ID" rules={[{ required: true }]}>
              <Input autoComplete="username" autoCapitalize="none" />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Sign in
            </Button>
          </Form>
          <div className="mt-6 text-center text-sm">
            <Link to="/track">Track a consignment →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
