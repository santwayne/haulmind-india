import { useEffect, useState } from 'react';
import { App, Button, Checkbox, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Table, Tag } from 'antd';
import { Printer, Plus, Pencil, Landmark, Wallet } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import { api, errMsg, openPdf } from '../api/client';
import { useGet, useBranches } from '../api/hooks';
import { useAppSelector, can, HQ } from '../redux/store';
import { d, inr, inr2 } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT: Record<string, string> = {
  opening: 'Opening', lr_paid: 'Paid LR', topay_collection: 'To-pay collected', party_receipt: 'Party payment', broker_payment: 'Broker paid',
  lorry_hire: 'Lorry hire', expense: 'Expense', income: 'Income', contra: 'Cash ↔ bank', reversal: 'Reversal', migrated: 'Imported',
};

export default function CashBook() {
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const branch = useAppSelector((s) => s.auth.branch);
  const branches = useBranches();
  const accs = useGet<{ items: any[] }>('/money-accounts');
  const list = (accs.data?.items || []).filter((a) => !branch || !a.branch || a.branch._id === branch);
  const [account, setAccount] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()]);
  const [edit, setEdit] = useState<any>(null);
  const [form] = Form.useForm();
  const params = { account, from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') };
  const { data, loading } = useGet<any>(account ? '/cashbook' : null, params);

  useEffect(() => {
    if (!account && list.length) setAccount((list.find((a) => a.type === 'cash') || list[0])._id);
  }, [list, account]);

  const save = async () => {
    const v = await form.validateFields();
    try {
      if (edit._id) await api.put(`/money-accounts/${edit._id}`, v);
      else await api.post('/money-accounts', v);
      message.success('Saved');
      setEdit(null);
      accs.reload();
    } catch (e) { message.error(errMsg(e)); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Cash & bank book</h1>
        {can(user, ...HQ) && <Button icon={<Plus size={15} />} onClick={() => { form.resetFields(); form.setFieldsValue({ type: 'bank' }); setEdit({}); }}>Add bank / cash account</Button>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {list.map((a) => (
          <button key={a._id} onClick={() => setAccount(a._id)}
            className={`kpi cursor-pointer text-left ${account === a._id ? '!border-emerald-600 ring-1 ring-emerald-600' : ''}`}>
            <div className="label flex items-center gap-1">{a.type === 'cash' ? <Wallet size={13} /> : <Landmark size={13} />} {a.type === 'cash' ? 'Cash' : 'Bank'}{a.accountLabel ? ` ${a.accountLabel}` : ''}</div>
            <div className={`value !text-xl ${a.balance < 0 ? 'text-red-600' : ''}`}>{inr(a.balance)}</div>
            <div className="sub flex items-center justify-between gap-1">
              <span className="truncate">{a.name}</span>
              {can(user, ...HQ) && <Pencil size={13} className="shrink-0 text-slate-400 hover:text-emerald-700" onClick={(e) => { e.stopPropagation(); form.resetFields(); form.setFieldsValue({ ...a, branch: a.branch?._id, openingDate: undefined }); setEdit(a); }} />}
            </div>
          </button>
        ))}
      </div>
      <div className="panel">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={account} onChange={setAccount} className="min-w-[260px]" options={list.map((a) => ({ value: a._id, label: a.name }))} />
          <DatePicker.RangePicker format="DD MMM YY" value={range} allowClear={false} onChange={(v) => v && setRange([v[0]!, v[1]!])}
            presets={[{ label: 'Today', value: [dayjs(), dayjs()] }, { label: 'This month', value: [dayjs().startOf('month'), dayjs()] }, { label: 'This FY', value: [dayjs().month() >= 3 ? dayjs().month(3).startOf('month') : dayjs().subtract(1, 'year').month(3).startOf('month'), dayjs()] }]} />
          {account && <Button icon={<Printer size={15} />} onClick={() => openPdf(`/cashbook?account=${account}&from=${params.from}&to=${params.to}&pdf=1`, 'cash-book.pdf')}>PDF</Button>}
          {data && (
            <div className="ml-auto flex flex-wrap gap-4 text-sm">
              <span>Opening <b>{inr2(data.opening)}</b></span>
              <span className="text-emerald-700">In <b>{inr2(data.totalIn)}</b></span>
              <span className="text-red-600">Out <b>{inr2(data.totalOut)}</b></span>
              <span>Closing <b>{inr2(data.closing)}</b></span>
            </div>
          )}
        </div>
        <Table
          size="small" rowKey="_id" loading={loading} pagination={false} scroll={{ x: 860, y: 520 }}
          dataSource={data?.entries || []}
          locale={{ emptyText: 'No money in or out in this period' }}
          columns={[
            { title: 'Date', dataIndex: 'date', width: 100, render: d },
            { title: 'Type', dataIndex: 'category', width: 130, render: (v, r: any) => <Tag color={v === 'reversal' ? 'default' : r.direction === 'in' ? 'green' : 'volcano'}>{CAT[v] || v}</Tag> },
            { title: 'Particulars', dataIndex: 'narration', render: (v, r: any) => <span className={r.reversed ? 'text-slate-400 line-through' : ''}>{v}</span> },
            { title: 'Ref', render: (_, r: any) => r.voucherNo || r.ref, width: 160 },
            { title: 'In', align: 'right', width: 110, render: (_, r: any) => (r.direction === 'in' ? <span className="text-emerald-700">{inr2(r.amount)}</span> : '') },
            { title: 'Out', align: 'right', width: 110, render: (_, r: any) => (r.direction === 'out' ? <span className="text-red-600">{inr2(r.amount)}</span> : '') },
            { title: 'Balance', dataIndex: 'balance', align: 'right', width: 120, render: (v) => <b>{inr2(v)}</b> },
          ]}
        />
      </div>
      <Modal open={!!edit} title={edit?._id ? `Edit ${edit.name}` : 'Add cash / bank account'} okText="Save" onCancel={() => setEdit(null)} onOk={save} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Row gutter={10}>
            <Col span={16}><Form.Item name="name" label="Name" rules={[{ required: true }]} className="!mb-3"><Input placeholder="e.g. HDFC Current – Ludhiana" /></Form.Item></Col>
            <Col span={8}><Form.Item name="type" label="Type" className="!mb-3"><Select options={[{ value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="branch" label="Branch (blank = head office)" className="!mb-3"><Select allowClear options={branches.map((b) => ({ value: b._id, label: b.name }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="bankName" label="Bank name" className="!mb-3"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="accountLabel" label="Account no. (only last 4 kept)" className="!mb-3"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="openingBalance" label="Opening balance" className="!mb-3"><InputNumber prefix="₹" className="!w-full" /></Form.Item></Col>
            <Col span={24}><Form.Item name="isDefault" valuePropName="checked" className="!mb-0"><Checkbox>Default {form.getFieldValue('type') === 'cash' ? 'cash box' : 'bank'} for this branch (UPI / bank receipts go here)</Checkbox></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
