import { useEffect, useMemo, useState } from 'react';
import { App, Button, Col, DatePicker, Input, InputNumber, Modal, Row, Segmented, Select, Table, Tabs, Tag } from 'antd';
import { Printer, Ban, IndianRupee, Link2 } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import { api, errMsg, openPdf } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector, can, MANAGERS } from '../redux/store';
import { d, inr, inr2 } from '../utils/format';
import PartySelect from '../components/PartySelect';

/* eslint-disable @typescript-eslint/no-explicit-any */
const r2 = (n: number) => Math.round(n * 100) / 100;

function NewReceipt({ onSaved }: { onSaved: () => void }) {
  const { message, modal } = App.useApp();
  const user = useAppSelector((s) => s.auth.user)!;
  const current = useAppSelector((s) => s.auth.branch);
  const allB = useGet<{ items: any[] }>('/branches', { limit: 200 }).data?.items || [];
  const myBranches = user.allBranches ? allB : user.branches;
  const [branch, setBranch] = useState<string | undefined>(current || undefined);
  const [party, setParty] = useState<string | undefined>();
  const [amount, setAmount] = useState<number>(0);
  const [tds, setTds] = useState<number>(0);
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [intoAccount, setIntoAccount] = useState<string | undefined>();
  const bankAccounts = (useGet<{ items: any[] }>('/money-accounts').data?.items || []).filter((a) => a.type === 'bank' && (!a.branch || a.branch._id === branch));
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [narration, setNarration] = useState('');
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const { data, reload } = useGet<{ items: any[]; balance: number; unbilled: number }>(party ? '/receipts/open-bills' : null, { party });

  useEffect(() => { if (!branch && myBranches[0]) setBranch(current || myBranches[0]._id); }, [myBranches, branch, current]);

  // auto-adjust oldest bills first whenever amount changes
  useEffect(() => {
    let pool = r2((amount || 0) + (tds || 0));
    const a: Record<string, number> = {};
    for (const b of data?.items || []) {
      const x = r2(Math.min(pool, b.balance));
      a[b._id] = x > 0 ? x : 0;
      pool = r2(pool - a[b._id]);
    }
    setAlloc(a);
  }, [amount, tds, data]);

  const used = useMemo(() => r2(Object.values(alloc).reduce((s, v) => s + (v || 0), 0)), [alloc]);
  const left = r2((amount || 0) + (tds || 0) - used);

  const save = async () => {
    if (!party || !branch || !amount) return message.warning('Party, branch and amount are required');
    if (left < -0.009) return message.error('Adjusted more than the money received');
    setSaving(true);
    try {
      const allocations = Object.entries(alloc).filter(([, v]) => v > 0).map(([bill, v]) => ({ bill, amount: v }));
      const r = await api.post('/receipts', {
        party, branch, amount, tds, mode, reference, bankName, date: date.format('YYYY-MM-DD'), narration,
        ...(mode !== 'cash' && intoAccount ? { account: intoAccount } : {}),
        allocations, autoAllocate: false,
      });
      const rc = r.data.data;
      modal.success({ title: r.data.message, okText: 'Print receipt', onOk: () => openPdf(`/receipts/${rc._id}/pdf`, `${rc.receiptNo}.pdf`) });
      setAmount(0); setTds(0); setReference(''); setNarration('');
      reload(); onSaved();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel">
      <Row gutter={[12, 10]}>
        <Col xs={24} md={12}>
          <div className="text-xs text-slate-500">Party</div>
          <PartySelect value={party} onChange={(v) => setParty(v)} className="w-full" />
        </Col>
        <Col xs={12} md={6}>
          <div className="text-xs text-slate-500">Received at</div>
          <Select value={branch} onChange={setBranch} className="w-full" options={myBranches.map((b: any) => ({ value: b._id, label: b.name }))} />
        </Col>
        <Col xs={12} md={6}>
          <div className="text-xs text-slate-500">Date</div>
          <DatePicker value={date} onChange={(v) => v && setDate(v)} allowClear={false} format="DD MMM YYYY" className="w-full" />
        </Col>
      </Row>
      {party && data && (
        <div className="mt-3 flex flex-wrap gap-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span>Ledger balance: <b className={data.balance > 0 ? 'text-red-600' : 'text-emerald-700'}>{inr2(Math.abs(data.balance))} {data.balance >= 0 ? 'Dr' : 'Cr'}</b></span>
          <span>Open bills: <b>{data.items.length}</b></span>
          {data.unbilled > 0 && <span>Not yet billed: <b>{inr2(data.unbilled)}</b></span>}
        </div>
      )}
      <Row gutter={[12, 10]} className="mt-3">
        <Col xs={12} md={5}>
          <div className="text-xs text-slate-500">Amount received</div>
          <InputNumber min={0} prefix="₹" value={amount} onChange={(v) => setAmount(v || 0)} className="!w-full" size="large" />
        </Col>
        <Col xs={12} md={4}>
          <div className="text-xs text-slate-500">TDS deducted</div>
          <InputNumber min={0} prefix="₹" value={tds} onChange={(v) => setTds(v || 0)} className="!w-full" size="large" />
        </Col>
        <Col xs={24} md={7}>
          <div className="text-xs text-slate-500">Mode</div>
          <Segmented value={mode} onChange={(v) => setMode(v as string)} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank' }, { value: 'cheque', label: 'Cheque' }]} />
        </Col>
        {mode !== 'cash' && (
          <>
            <Col xs={12} md={4}>
              <div className="text-xs text-slate-500">{mode === 'cheque' ? 'Cheque no.' : 'UTR / Ref no.'}</div>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Col>
            <Col xs={12} md={4}>
              <div className="text-xs text-slate-500">Party's bank</div>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </Col>
            <Col xs={24} md={6}>
              <div className="text-xs text-slate-500">Received in our account</div>
              <Select allowClear placeholder="Default bank" value={intoAccount} onChange={setIntoAccount} className="w-full" options={bankAccounts.map((a) => ({ value: a._id, label: a.name }))} />
            </Col>
          </>
        )}
      </Row>
      {party && (
        <Table
          className="mt-3" size="small" rowKey="_id" dataSource={data?.items || []} pagination={false} scroll={{ x: 640 }}
          locale={{ emptyText: 'No open bill – money will be kept on account (advance)' }}
          columns={[
            { title: 'Bill', dataIndex: 'billNo', render: (v) => <b>{v}</b> },
            { title: 'Date', dataIndex: 'billDate', render: d },
            { title: 'Due', dataIndex: 'dueDate', render: (v) => <span className={dayjs(v).isBefore(dayjs(), 'day') ? 'text-red-600' : ''}>{d(v)}</span> },
            { title: 'Total', dataIndex: 'total', align: 'right', render: inr2 },
            { title: 'Pending', dataIndex: 'balance', align: 'right', render: inr2 },
            {
              title: 'Adjust now', width: 150,
              render: (_, b: any) => (
                <InputNumber size="small" min={0} max={b.balance} value={alloc[b._id]} prefix="₹" className="!w-full"
                  onChange={(v) => setAlloc((a) => ({ ...a, [b._id]: v || 0 }))} />
              ),
            },
          ]}
        />
      )}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <Input placeholder="Narration (optional)" value={narration} onChange={(e) => setNarration(e.target.value)} className="max-w-md" />
        <div className="text-right">
          <div className="text-sm text-slate-600">
            Adjusted {inr2(used)}{left > 0 ? <> · <b className="text-amber-700">{inr2(left)} on account</b></> : null}
            {left < -0.009 && <b className="text-red-600"> · over by {inr2(-left)}</b>}
          </div>
          <Button type="primary" size="large" icon={<IndianRupee size={16} />} loading={saving} disabled={!party || !amount} onClick={save} className="mt-1">
            Save receipt
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReceiptList({ version }: { version: number }) {
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const branch = useAppSelector((s) => s.auth.branch);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().startOf('month'), dayjs()]);
  const [mode, setMode] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [cancel, setCancel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const { data, loading, reload } = useGet<{ items: any[]; total: number; byMode: Record<string, number> }>('/receipts', {
    branch, mode, q, page, v: version, from: range?.[0].format('YYYY-MM-DD'), to: range?.[1].format('YYYY-MM-DD'),
  });
  const total = Object.values(data?.byMode || {}).reduce((s, v) => s + v, 0);

  return (
    <div className="panel">
      <div className="mb-3 flex flex-wrap gap-2">
        <Input.Search allowClear placeholder="Receipt, party, UTR" className="max-w-[240px]" onSearch={(v) => { setQ(v); setPage(1); }} />
        <Select allowClear placeholder="Mode" value={mode} onChange={setMode} className="min-w-[110px]" options={['cash', 'upi', 'bank', 'cheque'].map((m) => ({ value: m, label: m.toUpperCase() }))} />
        <DatePicker.RangePicker format="DD MMM YY" value={range} onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} />
      </div>
      <div className="mb-2 flex flex-wrap gap-4 text-sm text-slate-600">
        <span>Total <b>{inr(total)}</b></span>
        {Object.entries(data?.byMode || {}).map(([k, v]) => <span key={k}>{k.toUpperCase()} <b>{inr(v)}</b></span>)}
      </div>
      <Table
        size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} scroll={{ x: 860 }}
        pagination={{ current: page, total: data?.total, pageSize: 25, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: 'Receipt', dataIndex: 'receiptNo', render: (v) => <b>{v}</b> },
          { title: 'Date', dataIndex: 'date', render: d },
          { title: 'Party', dataIndex: 'partyName', ellipsis: true },
          { title: 'Mode', render: (_, r: any) => <>{r.mode.toUpperCase()}<div className="text-xs text-slate-500">{r.reference}</div></> },
          { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v, r: any) => <>{inr2(v)}{r.tds ? <div className="text-xs text-slate-500">+ TDS {inr2(r.tds)}</div> : null}</> },
          { title: 'Against', render: (_, r: any) => <>{r.allocations.map((a: any) => <Tag key={a.billNo}>{a.billNo}</Tag>)}{r.onAccount > 0 && <Tag color="gold">On account {inr(r.onAccount)}</Tag>}</> },
          { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag> },
          {
            title: '', width: 110,
            render: (_, r: any) => (
              <div className="flex gap-1">
                <Button size="small" icon={<Printer size={14} />} onClick={() => openPdf(`/receipts/${r._id}/pdf`, `${r.receiptNo}.pdf`)} />
                {r.status === 'active' && r.onAccount > 0 && (
                  <Button size="small" title="Adjust on-account money against open bills" icon={<Link2 size={14} />}
                    onClick={async () => { try { const x = await api.post(`/receipts/${r._id}/adjust`); message.success(x.data.message); reload(); } catch (e) { message.error(errMsg(e)); } }} />
                )}
                {r.status === 'active' && can(user, ...MANAGERS, 'accountant') && <Button size="small" danger icon={<Ban size={14} />} onClick={() => { setReason(''); setCancel(r); }} />}
              </div>
            ),
          },
        ]}
      />
      <Modal open={!!cancel} title={`Cancel receipt ${cancel?.receiptNo}?`} okText="Cancel receipt" okButtonProps={{ danger: true, disabled: !reason.trim() }} onCancel={() => setCancel(null)}
        onOk={async () => {
          try { const r = await api.post(`/receipts/${cancel._id}/cancel`, { reason }); message.success(r.data.message); setCancel(null); reload(); }
          catch (e) { message.error(errMsg(e)); }
        }}>
        <p className="text-sm text-slate-600">The bills it paid become open again and the party's balance goes back up.</p>
        <Input.TextArea placeholder="Reason, e.g. cheque bounced" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}

export default function Receipts() {
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-3">
      <h1 className="page-title">Payments received</h1>
      <Tabs items={[
        { key: 'new', label: 'New receipt', children: <NewReceipt onSaved={() => setVersion((v) => v + 1)} /> },
        { key: 'list', label: 'Receipts', children: <ReceiptList version={version} /> },
      ]} />
    </div>
  );
}
