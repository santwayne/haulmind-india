import { useState } from 'react';
import { Button, DatePicker, Skeleton, Table, Tag } from 'antd';
import { Printer } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { openPdf } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector } from '../redux/store';
import { inr } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fyStart = () => (dayjs().month() >= 3 ? dayjs().month(3).startOf('month') : dayjs().subtract(1, 'year').month(3).startOf('month'));

export default function ProfitLoss() {
  const branch = useAppSelector((s) => s.auth.branch);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([fyStart(), dayjs()]);
  const params = { branch, from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') };
  const { data, loading } = useGet<any>('/reports/pnl', params);
  const T = data?.total;
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

  const lines = T ? [
    { k: 'Freight earned (excl. GST)', v: T.freight, kind: 'in' },
    { k: 'Other income', v: T.otherIncome, kind: 'in' },
    { k: 'Lorry hire', v: T.lorryHire, kind: 'out' },
    { k: 'Broker commission', v: T.brokerCommission, kind: 'out' },
    { k: 'Discount allowed on bills', v: T.discount, kind: 'out' },
    { k: 'Damage / shortage claims paid', v: T.claims, kind: 'out' },
    ...Object.entries(T.heads as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v, kind: 'out' })),
  ] : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Profit & loss</h1>
        <div className="flex flex-wrap gap-2">
          <DatePicker.RangePicker format="DD MMM YY" value={range} allowClear={false} onChange={(v) => v && setRange([v[0]!, v[1]!])}
            presets={[{ label: 'This month', value: [dayjs().startOf('month'), dayjs()] }, { label: 'Last month', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] }, { label: 'This FY', value: [fyStart(), dayjs()] }]} />
          <Button icon={<Printer size={15} />} onClick={() => openPdf(`/reports/pnl?${qs}&pdf=1`, 'profit-and-loss.pdf')}>PDF</Button>
        </div>
      </div>
      {loading && !data ? <Skeleton active /> : T && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="kpi"><div className="label">Income</div><div className="value">{inr(T.income)}</div><div className="sub">{T.lrs} LR booked</div></div>
            <div className="kpi"><div className="label">Expenses</div><div className="value">{inr(T.totalExpense)}</div></div>
            <div className={`kpi ${T.profit >= 0 ? '!border-emerald-600' : '!border-red-500'}`}>
              <div className="label">{T.profit >= 0 ? 'Profit' : 'Loss'}</div>
              <div className={`value ${T.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{inr(Math.abs(T.profit))}</div>
              <div className="sub">{T.margin}% of income</div>
            </div>
            <div className="kpi"><div className="label">Lorry hire share</div><div className="value">{T.income ? Math.round((T.lorryHire / T.income) * 100) : 0}%</div><div className="sub">of income goes to trucks</div></div>
          </div>
          <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
            <div className="panel">
              <div className="mb-2 font-bold">Branch-wise</div>
              <Table
                size="small" rowKey={(r: any) => r.branch._id} pagination={false} scroll={{ x: 820 }} dataSource={data.rows}
                columns={[
                  { title: 'Branch', render: (_, r: any) => <b>{r.branch.name} {r.branch.type === 'hub' && <Tag color="gold">HUB</Tag>}</b> },
                  { title: 'Freight', dataIndex: 'freight', align: 'right', render: inr },
                  { title: 'Other inc.', dataIndex: 'otherIncome', align: 'right', render: inr },
                  { title: 'Lorry hire', dataIndex: 'lorryHire', align: 'right', render: inr },
                  { title: 'Commission', dataIndex: 'brokerCommission', align: 'right', render: inr },
                  { title: 'Expenses', align: 'right', render: (_, r: any) => inr(r.expenses + r.discount + r.claims) },
                  { title: 'Profit', dataIndex: 'profit', align: 'right', sorter: (a: any, b: any) => a.profit - b.profit, render: (v) => <b className={v >= 0 ? 'text-emerald-700' : 'text-red-600'}>{inr(v)}</b> },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}><b>All branches</b></Table.Summary.Cell>
                    {[T.freight, T.otherIncome, T.lorryHire, T.brokerCommission, T.expenses + T.discount + T.claims].map((v, i) => <Table.Summary.Cell key={i} index={i + 1} align="right"><b>{inr(v)}</b></Table.Summary.Cell>)}
                    <Table.Summary.Cell index={6} align="right"><b className={T.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{inr(T.profit)}</b></Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </div>
            <div className="panel">
              <div className="mb-2 font-bold">Statement</div>
              {lines.filter((l) => l.v).map((l) => (
                <div key={l.k} className="flex justify-between border-b border-slate-100 py-1 text-sm">
                  <span className="text-slate-600">{l.kind === 'in' ? '+ ' : '− '}{l.k}</span>
                  <span className={l.kind === 'in' ? 'font-semibold text-emerald-700' : 'text-slate-800'}>{inr(l.v)}</span>
                </div>
              ))}
              <div className={`mt-2 flex justify-between rounded-lg px-3 py-2 font-bold text-white ${T.profit >= 0 ? 'bg-emerald-700' : 'bg-red-600'}`}>
                <span>{T.profit >= 0 ? 'Net profit' : 'Net loss'}</span><span>{inr(Math.abs(T.profit))}</span>
              </div>
            </div>
          </div>
          {data.months.length > 0 && (
            <div className="panel">
              <div className="mb-2 font-bold">Month by month</div>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={data.months.map((m: any) => ({ ...m, label: dayjs(m.month + '-01').format('MMM YY') }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} width={60} tickFormatter={(v) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(1)}L` : `${Math.round(v / 1000)}k`)} />
                    <Tooltip formatter={(v) => inr(Number(v))} />
                    <Legend />
                    <Bar dataKey="income" name="Income" fill="#059669" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="totalExpense" name="Expenses" fill="#d97706" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="profit" name="Profit" fill="#0f1f17" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <p className="m-0 text-xs text-slate-500">
            Income is counted when an LR is booked (freight without GST). Lorry hire is counted when the truck is dispatched, broker commission when the LR is booked, expenses on the voucher date.
          </p>
        </>
      )}
    </div>
  );
}
