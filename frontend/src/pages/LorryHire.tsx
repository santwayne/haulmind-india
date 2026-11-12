import { useState } from 'react';
import { App, Form, Input, InputNumber, Modal, Segmented, Select, Table, Tag, Button } from 'antd';
import { api, errMsg } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector, can, ACCOUNTS } from '../redux/store';
import { dt, inr, inr2 } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function LorryHire() {
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user)!;
  const branch = useAppSelector((s) => s.auth.branch);
  const [status, setStatus] = useState('pending');
  const { data, loading, reload } = useGet<{ items: any[]; totalPending: number }>('/lorry-hire', { branch, status: status === 'all' ? 'all' : '' });
  const accounts = useGet<{ items: any[] }>('/money-accounts').data?.items || [];
  const allB = useGet<{ items: any[] }>('/branches', { limit: 200 }).data?.items || [];
  const myBranches = user.allBranches ? allB : user.branches;
  const [pay, setPay] = useState<any>(null);
  const [form] = Form.useForm();
  const payBranch = Form.useWatch('branch', form);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Lorry hire (gaadi bhaada)</h1>
        <Segmented value={status} onChange={(v) => setStatus(v as string)} options={[{ value: 'pending', label: 'Balance pending' }, { value: 'all', label: 'All' }]} />
      </div>
      <div className="kpi max-w-xs"><div className="label">Balance to pay truck owners</div><div className="value text-red-600">{inr(data?.totalPending)}</div></div>
      <div className="panel">
        <Table
          size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} scroll={{ x: 900 }} pagination={{ pageSize: 50, showSizeChanger: false }}
          columns={[
            { title: 'Challan', dataIndex: 'challanNo', render: (v, r: any) => <><b>{v}</b>{r.type === 'transfer' && <Tag color="purple" className="!ml-1">Transfer</Tag>}</> },
            { title: 'Dispatched', dataIndex: 'dispatchedAt', render: dt },
            { title: 'Route', render: (_, r: any) => `${r.fromBranch?.code} → ${r.toBranch?.code}` },
            { title: 'Vehicle / owner', render: (_, r: any) => <>{r.vehicleNo}<div className="text-xs text-slate-500">{r.transporter || r.driverName}</div></> },
            { title: 'Hire', dataIndex: 'lorryHire', align: 'right', render: inr2 },
            { title: 'Paid', dataIndex: 'hirePaid', align: 'right', render: inr2 },
            { title: 'Balance', dataIndex: 'pending', align: 'right', render: (v) => <b className={v > 0 ? 'text-red-600' : 'text-emerald-700'}>{inr2(v)}</b> },
            {
              title: '', width: 80,
              render: (_, r: any) => r.pending > 0 && can(user, ...ACCOUNTS) ? (
                <Button size="small" type="primary" onClick={() => { form.resetFields(); form.setFieldsValue({ amount: r.pending, branch: myBranches.find((b: any) => b._id === r.toBranch?._id)?._id || myBranches[0]?._id, pay: 'cash' }); setPay(r); }}>Pay</Button>
              ) : null,
            },
          ]}
        />
      </div>
      <Modal open={!!pay} title={`Pay balance – ${pay?.vehicleNo || ''} ${pay?.challanNo || ''}`} okText="Save payment" onCancel={() => setPay(null)} destroyOnHidden
        onOk={async () => {
          const v = await form.validateFields();
          try {
            const r = await api.post(`/challans/${pay._id}/hire-payment`, { amount: v.amount, branch: v.branch, narration: v.narration, ...(v.pay === 'cash' ? { mode: 'cash' } : { account: v.pay }) });
            message.success(r.data.message); setPay(null); reload();
          } catch (e) { message.error(errMsg(e)); }
        }}>
        <Form form={form} layout="vertical">
          <Form.Item name="amount" label={`Amount (balance ${inr2(pay?.pending)})`} rules={[{ required: true }]}><InputNumber min={1} max={pay?.pending} prefix="₹" className="!w-full" /></Form.Item>
          <Form.Item name="branch" label="Paid at branch" rules={[{ required: true }]}><Select options={myBranches.map((b: any) => ({ value: b._id, label: b.name }))} /></Form.Item>
          <Form.Item name="pay" label="Paid from">
            <Select options={[{ value: 'cash', label: 'Branch cash' }, ...accounts.filter((a) => a.type === 'bank' && (!a.branch || a.branch._id === payBranch)).map((a) => ({ value: a._id, label: a.name }))]} />
          </Form.Item>
          <Form.Item name="narration" label="Note"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
