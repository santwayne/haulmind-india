import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Table } from 'antd';
import { type Dayjs } from 'dayjs';
import { api, errMsg } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector, can, ACCOUNTS } from '../redux/store';
import { inr, inr2 } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function BrokerCommission() {
  const nav = useNavigate();
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user)!;
  const current = useAppSelector((s) => s.auth.branch);
  const allB = useGet<{ items: any[] }>('/branches', { limit: 200 }).data?.items || [];
  const myBranches = user.allBranches ? allB : user.branches;
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const { data, loading, reload } = useGet<{ items: any[] }>('/reports/brokers', { from: range?.[0].format('YYYY-MM-DD'), to: range?.[1].format('YYYY-MM-DD') });
  const [pay, setPay] = useState<any>(null);
  const [form] = Form.useForm();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Broker commission</h1>
        <DatePicker.RangePicker format="DD MMM YY" value={range} onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} placeholder={['Earned from', 'to']} />
      </div>
      <div className="panel">
        <Table
          size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} pagination={false} scroll={{ x: 760 }}
          columns={[
            { title: 'Broker', dataIndex: 'name', render: (v, r: any) => <a onClick={() => nav(`/ledger?kind=broker&id=${r._id}`)}><b>{v}</b></a> },
            { title: 'Rate', render: (_, r: any) => (r.commissionType === 'percent' ? `${r.commissionValue}% of freight` : `${inr(r.commissionValue)} / LR`) },
            { title: 'LRs', dataIndex: 'lrs', align: 'right' },
            { title: 'Commission earned', dataIndex: 'commission', align: 'right', render: inr2 },
            { title: 'Paid', dataIndex: 'paid', align: 'right', render: inr2 },
            { title: 'Pending (all time)', dataIndex: 'pending', align: 'right', render: (v) => <b className={v > 0 ? 'text-amber-700' : ''}>{inr2(v)}</b> },
            {
              title: '', width: 90,
              render: (_, r: any) => can(user, ...ACCOUNTS) && r.pending > 0 ? (
                <Button size="small" type="primary" onClick={() => { form.setFieldsValue({ amount: r.pending, mode: 'cash', branch: current || myBranches[0]?._id }); setPay(r); }}>Pay</Button>
              ) : null,
            },
          ]}
        />
      </div>
      <Modal open={!!pay} title={`Pay ${pay?.name}`} okText="Save payment" onCancel={() => setPay(null)} destroyOnHidden
        onOk={async () => {
          const v = await form.validateFields();
          try { const r = await api.post(`/brokers/${pay._id}/payments`, v); message.success(r.data.message); setPay(null); reload(); }
          catch (e) { message.error(errMsg(e)); }
        }}>
        <Form form={form} layout="vertical">
          <Form.Item name="amount" label="Amount" rules={[{ required: true }]}><InputNumber min={1} prefix="₹" className="!w-full" /></Form.Item>
          <Form.Item name="mode" label="Mode"><Select options={['cash', 'upi', 'bank', 'cheque'].map((m) => ({ value: m, label: m.toUpperCase() }))} /></Form.Item>
          <Form.Item name="reference" label="UTR / cheque no."><Input /></Form.Item>
          <Form.Item name="branch" label="Paid from branch" rules={[{ required: true }]}><Select options={myBranches.map((b: any) => ({ value: b._id, label: b.name }))} /></Form.Item>
          <Form.Item name="narration" label="Note"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
