import { useEffect, useState } from 'react';
import { App, Button, Col, DatePicker, Input, InputNumber, Modal, Row, Segmented, Select, Table, Tag } from 'antd';
import { Ban, Save } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import { api, errMsg } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector, can, MANAGERS } from '../redux/store';
import { d, inr, inr2 } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Vouchers() {
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user)!;
  const current = useAppSelector((s) => s.auth.branch);
  const allB = useGet<{ items: any[] }>('/branches', { limit: 200 }).data?.items || [];
  const myBranches = user.allBranches ? allB : user.branches;
  const accounts = useGet<{ items: any[] }>('/money-accounts').data?.items || [];
  const [type, setType] = useState<'expense' | 'income' | 'contra'>('expense');
  const heads = useGet<{ items: any[] }>('/heads', { kind: type === 'income' ? 'income' : 'expense' }).data?.items || [];
  const [branch, setBranch] = useState<string | undefined>(current || undefined);
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [head, setHead] = useState<string | undefined>();
  const [amount, setAmount] = useState<number>(0);
  const [mode, setMode] = useState('cash');
  const [account, setAccount] = useState<string | undefined>();
  const [toAccount, setToAccount] = useState<string | undefined>();
  const [paidTo, setPaidTo] = useState('');
  const [narration, setNarration] = useState('');
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [filterType, setFilterType] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useGet<any>('/vouchers', { branch: current, type: filterType, page, v: version, from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') });
  const [cancel, setCancel] = useState<any>(null);
  const [reason, setReason] = useState('');

  useEffect(() => { if (!branch && myBranches[0]) setBranch(current || myBranches[0]._id); }, [myBranches, branch, current]);
  useEffect(() => setHead(undefined), [type]);
  const branchAccounts = accounts.filter((a) => !a.branch || a.branch._id === branch);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.post('/vouchers', {
        type, branch, date: date.format('YYYY-MM-DD'), head, amount, narration, paidTo,
        ...(type === 'contra' ? { account, toAccount } : mode === 'account' ? { account } : { mode }),
      });
      message.success(r.data.message);
      setAmount(0); setPaidTo(''); setNarration('');
      setVersion((x) => x + 1);
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <h1 className="page-title">Expenses, income & cash ↔ bank</h1>
      <div className="panel">
        <Segmented value={type} onChange={(v) => setType(v as typeof type)} className="!mb-3"
          options={[{ value: 'expense', label: 'Expense (kharcha)' }, { value: 'income', label: 'Other income' }, { value: 'contra', label: 'Cash ↔ bank' }]} />
        <Row gutter={[12, 10]}>
          <Col xs={12} md={5}><div className="text-xs text-slate-500">Branch</div><Select value={branch} onChange={setBranch} className="w-full" options={myBranches.map((b: any) => ({ value: b._id, label: b.name }))} /></Col>
          <Col xs={12} md={4}><div className="text-xs text-slate-500">Date</div><DatePicker value={date} onChange={(v) => v && setDate(v)} allowClear={false} format="DD MMM YYYY" className="w-full" /></Col>
          {type !== 'contra' ? (
            <>
              <Col xs={24} md={5}><div className="text-xs text-slate-500">Head</div><Select showSearch value={head} onChange={setHead} placeholder="e.g. Rent" className="w-full" options={heads.map((h) => ({ value: h.name, label: h.name }))} /></Col>
              <Col xs={12} md={4}><div className="text-xs text-slate-500">Amount</div><InputNumber min={0} prefix="₹" value={amount} onChange={(v) => setAmount(v || 0)} className="!w-full" /></Col>
              <Col xs={12} md={6}>
                <div className="text-xs text-slate-500">{type === 'expense' ? 'Paid from' : 'Received in'}</div>
                <Select value={mode === 'account' ? account : mode} className="w-full"
                  onChange={(v) => { if (v === 'cash') { setMode('cash'); setAccount(undefined); } else { setMode('account'); setAccount(v); } }}
                  options={[{ value: 'cash', label: 'Branch cash' }, ...branchAccounts.filter((a) => a.type === 'bank').map((a) => ({ value: a._id, label: a.name }))]} />
              </Col>
              <Col xs={24} md={9}><div className="text-xs text-slate-500">{type === 'expense' ? 'Paid to' : 'Received from'}</div><Input value={paidTo} onChange={(e) => setPaidTo(e.target.value)} /></Col>
            </>
          ) : (
            <>
              <Col xs={12} md={5}><div className="text-xs text-slate-500">From</div><Select value={account} onChange={setAccount} className="w-full" options={branchAccounts.map((a) => ({ value: a._id, label: a.name }))} /></Col>
              <Col xs={12} md={5}><div className="text-xs text-slate-500">To</div><Select value={toAccount} onChange={setToAccount} className="w-full" options={branchAccounts.filter((a) => a._id !== account).map((a) => ({ value: a._id, label: a.name }))} /></Col>
              <Col xs={12} md={5}><div className="text-xs text-slate-500">Amount</div><InputNumber min={0} prefix="₹" value={amount} onChange={(v) => setAmount(v || 0)} className="!w-full" /></Col>
            </>
          )}
          <Col xs={24} md={type === 'contra' ? 19 : 11}><div className="text-xs text-slate-500">Narration</div><Input value={narration} onChange={(e) => setNarration(e.target.value)} /></Col>
          <Col xs={24} md={4} className="flex items-end">
            <Button type="primary" block icon={<Save size={15} />} loading={saving} disabled={!amount || (type !== 'contra' ? !head : !account || !toAccount)} onClick={save}>Save voucher</Button>
          </Col>
        </Row>
      </div>
      <div className="panel">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select allowClear placeholder="All types" value={filterType} onChange={(v) => { setFilterType(v); setPage(1); }} className="min-w-[140px]"
            options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }, { value: 'contra', label: 'Cash ↔ bank' }]} />
          <DatePicker.RangePicker format="DD MMM YY" value={range} allowClear={false} onChange={(v) => v && setRange([v[0]!, v[1]!])} />
          <div className="ml-auto flex gap-4 text-sm">
            <span>Expenses <b className="text-red-600">{inr(data?.sums?.expense)}</b></span>
            <span>Income <b className="text-emerald-700">{inr(data?.sums?.income)}</b></span>
          </div>
        </div>
        <Table
          size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} scroll={{ x: 820 }}
          pagination={{ current: page, total: data?.total, pageSize: 25, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: 'Voucher', dataIndex: 'voucherNo', render: (v, r: any) => <b className={r.reversed ? 'text-slate-400 line-through' : ''}>{v}</b> },
            { title: 'Date', dataIndex: 'date', render: d },
            { title: 'Branch', dataIndex: 'branchCode' },
            { title: 'Type', dataIndex: 'category', render: (v) => <Tag color={v === 'expense' ? 'volcano' : v === 'income' ? 'green' : 'blue'}>{v === 'contra' ? 'cash ↔ bank' : v}</Tag> },
            { title: 'Particulars', dataIndex: 'narration', ellipsis: true },
            { title: 'Account', render: (_, r: any) => r.accountNames.join(' → ') },
            { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr2 },
            {
              title: '', width: 50,
              render: (_, r: any) => !r.reversed && can(user, ...MANAGERS, 'accountant') ? <Button size="small" danger icon={<Ban size={14} />} onClick={() => { setReason(''); setCancel(r); }} /> : r.reversed ? <Tag>cancelled</Tag> : null,
            },
          ]}
        />
      </div>
      <Modal open={!!cancel} title={`Cancel voucher ${cancel?.voucherNo}?`} okText="Cancel voucher" okButtonProps={{ danger: true, disabled: !reason.trim() }} onCancel={() => setCancel(null)}
        onOk={async () => { try { await api.post(`/vouchers/${cancel._id}/cancel`, { reason }); message.success('Cancelled'); setCancel(null); reload(); } catch (e) { message.error(errMsg(e)); } }}>
        <p className="text-sm text-slate-600">An opposite entry is written in the cash/bank book; nothing is deleted.</p>
        <Input.TextArea placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}
