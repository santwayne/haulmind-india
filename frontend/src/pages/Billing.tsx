import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, DatePicker, Descriptions, Drawer, Empty, Input, InputNumber, Modal, Select, Table, Tabs, Tag } from 'antd';
import { FileText, Printer, Ban } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import { api, errMsg, openPdf } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector, can, MANAGERS } from '../redux/store';
import { d, inr, inr2, num, PAY } from '../utils/format';
import PartySelect from '../components/PartySelect';

/* eslint-disable @typescript-eslint/no-explicit-any */
const BILL_STATUS: Record<string, string> = { unpaid: 'red', partial: 'gold', paid: 'green', cancelled: 'default' };

function MakeBill({ onMade }: { onMade: () => void }) {
  const { message, modal } = App.useApp();
  const user = useAppSelector((s) => s.auth.user)!;
  const current = useAppSelector((s) => s.auth.branch);
  const branches = user.allBranches ? null : user.branches;
  const allB = useGet<{ items: any[] }>('/branches', { limit: 200 }).data?.items || [];
  const myBranches = branches || allB;
  const [branch, setBranch] = useState<string | undefined>(current || undefined);
  const [party, setParty] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [discount, setDiscount] = useState(0);
  const [other, setOther] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const todo = useGet<{ items: any[] }>('/billing/parties');
  const { data, loading, reload } = useGet<{ items: any[]; amount: number }>(party ? '/billing/unbilled' : null, {
    party, from: range?.[0].format('YYYY-MM-DD'), to: range?.[1].format('YYYY-MM-DD'),
  });

  useEffect(() => { if (!branch && myBranches[0]) setBranch(current || myBranches[0]._id); }, [myBranches, branch, current]);
  useEffect(() => setSelected((data?.items || []).map((i) => i._id)), [data]);

  const sel = useMemo(() => (data?.items || []).filter((i) => selected.includes(i._id)), [data, selected]);
  const sub = sel.reduce((s, i) => s + i.amount, 0);
  const total = sub - (discount || 0) + (other || 0);

  const create = async () => {
    setSaving(true);
    try {
      const r = await api.post('/bills', { party, branch, lrIds: selected, discount, otherCharges: other, remarks });
      const bill = r.data.data;
      modal.success({ title: `Bill ${bill.billNo} – ${inr2(bill.total)}`, content: `Due on ${d(bill.dueDate)}.`, okText: 'Print bill', onOk: () => openPdf(`/bills/${bill._id}/pdf`, `${bill.billNo}.pdf`) });
      setDiscount(0); setOther(0); setRemarks('');
      reload(); todo.reload(); onMade();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[320px_1fr]">
      <div className="panel">
        <div className="mb-2 font-bold">Parties waiting for a bill</div>
        {!todo.data?.items.length && <Empty description="Nothing to bill" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        <div className="max-h-[520px] space-y-1 overflow-auto">
          {todo.data?.items.map((p) => (
            <button key={p.party} onClick={() => setParty(p.party)}
              className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left ${party === p.party ? 'border-emerald-600 bg-emerald-50' : 'border-transparent bg-transparent hover:bg-slate-50'}`}>
              <div className="flex justify-between gap-2"><b className="truncate">{p.name}</b><span className="font-semibold">{inr(p.amount)}</span></div>
              <div className="text-xs text-slate-500">{p.lrs} LR · oldest {d(p.oldest)}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="mb-3 flex flex-wrap gap-2">
          <PartySelect value={party} onChange={(v) => setParty(v)} className="min-w-[260px] flex-1" />
          <DatePicker.RangePicker format="DD MMM YY" value={range} onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} placeholder={['LR from', 'LR to']} />
          <Select value={branch} onChange={setBranch} className="min-w-[160px]" options={myBranches.map((b: any) => ({ value: b._id, label: `Bill from ${b.name}` }))} />
        </div>
        {!party ? (
          <Empty description="Pick a party on the left or search above" />
        ) : (
          <>
            <Table
              size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} pagination={false} scroll={{ x: 760, y: 380 }}
              rowSelection={{ selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) }}
              columns={[
                { title: 'LR', dataIndex: 'lrNo', render: (v, r: any) => <Link to={`/lrs/${r._id}`} className="font-semibold">{v}</Link> },
                { title: 'Date', dataIndex: 'lrDate', render: d },
                { title: 'Route', render: (_, r: any) => `${r.bookingBranch?.code} → ${r.deliveryBranch?.code}` },
                { title: 'Consignee', render: (_, r: any) => r.consignee.name, ellipsis: true },
                { title: 'Type', render: (_, r: any) => <Tag>{r.paymentType === 'to_pay' ? 'To Pay (credit)' : PAY[r.paymentType]}</Tag> },
                { title: 'Nag', dataIndex: 'totalNag', align: 'right' },
                { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr2 },
              ]}
            />
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-lg bg-slate-50 p-3">
              <div className="flex flex-wrap gap-2">
                <div><div className="text-xs text-slate-500">Discount</div><InputNumber min={0} prefix="₹" value={discount} onChange={(v) => setDiscount(v || 0)} /></div>
                <div><div className="text-xs text-slate-500">Other charges</div><InputNumber min={0} prefix="₹" value={other} onChange={(v) => setOther(v || 0)} /></div>
                <div className="min-w-[200px]"><div className="text-xs text-slate-500">Remarks</div><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">{sel.length} LR · {inr2(sub)}</div>
                <div className="text-2xl font-extrabold text-brand">{inr2(total)}</div>
                <Button type="primary" size="large" icon={<FileText size={16} />} disabled={!sel.length || total <= 0 || !branch} loading={saving} onClick={create}>
                  Make bill
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BillList({ version }: { version: number }) {
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const branch = useAppSelector((s) => s.auth.branch);
  const [status, setStatus] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [cancel, setCancel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const { data, loading, reload } = useGet<{ items: any[]; total: number; sums: any }>('/bills', {
    branch, status, q, page, overdue: overdue ? '1' : '', v: version,
    from: range?.[0].format('YYYY-MM-DD'), to: range?.[1].format('YYYY-MM-DD'),
  });
  const detail = useGet<any>(open ? `/bills/${open}` : null);

  return (
    <div className="panel">
      <div className="mb-3 flex flex-wrap gap-2">
        <Input.Search allowClear placeholder="Bill no, party, LR no" className="max-w-[240px]" onSearch={(v) => { setQ(v); setPage(1); }} />
        <Select allowClear placeholder="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} className="min-w-[130px]"
          options={Object.keys(BILL_STATUS).map((k) => ({ value: k, label: k }))} />
        <DatePicker.RangePicker format="DD MMM YY" value={range} onChange={(v) => { setRange(v as [Dayjs, Dayjs] | null); setPage(1); }} />
        <Button type={overdue ? 'primary' : 'default'} danger={overdue} onClick={() => setOverdue((x) => !x)}>Overdue only</Button>
      </div>
      <div className="mb-2 flex flex-wrap gap-4 text-sm text-slate-600">
        <span>Billed <b>{inr(data?.sums.total)}</b></span>
        <span>Received <b>{inr(data?.sums.received)}</b></span>
        <span>Pending <b className="text-red-600">{inr(data?.sums.balance)}</b></span>
      </div>
      <Table
        size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} scroll={{ x: 860 }}
        pagination={{ current: page, total: data?.total, pageSize: 25, onChange: setPage, showSizeChanger: false }}
        onRow={(r) => ({ onClick: () => setOpen(r._id), className: 'cursor-pointer' })}
        columns={[
          { title: 'Bill', dataIndex: 'billNo', render: (v) => <b>{v}</b> },
          { title: 'Date', dataIndex: 'billDate', render: d },
          { title: 'Party', dataIndex: 'partyName', ellipsis: true },
          { title: 'Total', dataIndex: 'total', align: 'right', render: inr2 },
          { title: 'Received', dataIndex: 'received', align: 'right', render: inr2 },
          { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v) => <b>{inr2(v)}</b> },
          {
            title: 'Due', dataIndex: 'dueDate',
            render: (v, r: any) => {
              const late = ['unpaid', 'partial'].includes(r.status) && dayjs(v).isBefore(dayjs(), 'day');
              return <span className={late ? 'font-semibold text-red-600' : ''}>{d(v)}{late ? ` (${dayjs().diff(v, 'day')}d late)` : ''}</span>;
            },
          },
          { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={BILL_STATUS[v]}>{v}</Tag> },
          {
            title: '', width: 80,
            render: (_, r: any) => (
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <Button size="small" icon={<Printer size={14} />} onClick={() => openPdf(`/bills/${r._id}/pdf`, `${r.billNo}.pdf`)} />
                {r.status === 'unpaid' && can(user, ...MANAGERS, 'accountant') && <Button size="small" danger icon={<Ban size={14} />} onClick={() => { setReason(''); setCancel(r); }} />}
              </div>
            ),
          },
        ]}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} width={Math.min(720, window.innerWidth)} title={detail.data?.billNo}
        extra={detail.data && <Button icon={<Printer size={14} />} onClick={() => openPdf(`/bills/${open}/pdf`, `${detail.data.billNo}.pdf`)}>Print</Button>}>
        {detail.data && (
          <>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Party" span={2}>{detail.data.party?.name}</Descriptions.Item>
              <Descriptions.Item label="Date">{d(detail.data.billDate)}</Descriptions.Item>
              <Descriptions.Item label="Due">{d(detail.data.dueDate)}</Descriptions.Item>
              <Descriptions.Item label="Total">{inr2(detail.data.total)}</Descriptions.Item>
              <Descriptions.Item label="Balance"><b>{inr2(detail.data.balance)}</b> <Tag color={BILL_STATUS[detail.data.status]}>{detail.data.status}</Tag></Descriptions.Item>
            </Descriptions>
            <Table className="mt-3" size="small" rowKey="lrNo" pagination={false} dataSource={detail.data.lines}
              columns={[
                { title: 'LR', dataIndex: 'lrNo', render: (v, r: any) => <Link to={`/lrs/${r.lr}`}>{v}</Link> },
                { title: 'Route', dataIndex: 'route' },
                { title: 'Nag', dataIndex: 'nag', align: 'right' },
                { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr2 },
              ]} />
            <div className="mb-1 mt-4 font-bold">Payments</div>
            {detail.data.payments.length ? detail.data.payments.map((p: any) => (
              <div key={p._id} className="flex justify-between border-b border-slate-100 py-1 text-sm">
                <span>{p.receiptNo} · {d(p.date)} · {p.mode}</span><b>{inr2(p.amount)}</b>
              </div>
            )) : <div className="text-sm text-slate-500">No payment yet</div>}
            {detail.data.cancelReason && <div className="mt-3 text-red-600">Cancelled: {detail.data.cancelReason}</div>}
          </>
        )}
      </Drawer>
      <Modal open={!!cancel} title={`Cancel bill ${cancel?.billNo}?`} okText="Cancel bill" okButtonProps={{ danger: true, disabled: !reason.trim() }} onCancel={() => setCancel(null)}
        onOk={async () => {
          try {
            const r = await api.post(`/bills/${cancel._id}/cancel`, { reason });
            message.success(r.data.message);
            setCancel(null);
            reload();
          } catch (e) { message.error(errMsg(e)); }
        }}>
        <p className="text-sm text-slate-600">Its {num(cancel?.lines?.length)} LRs become free to bill again.</p>
        <Input.TextArea placeholder="Reason (saved in audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}

export default function Billing() {
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-3">
      <h1 className="page-title">Billing</h1>
      <Tabs items={[
        { key: 'make', label: 'Make bill', children: <MakeBill onMade={() => setVersion((v) => v + 1)} /> },
        { key: 'list', label: 'Bills', children: <BillList version={version} /> },
      ]} />
    </div>
  );
}
