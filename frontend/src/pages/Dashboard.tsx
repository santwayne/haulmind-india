import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DatePicker, Table, Tag, Alert, Skeleton } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGet } from '../api/hooks';
import { useAppSelector } from '../redux/store';
import { inr, num } from '../utils/format';

type Row = {
  branch: { _id: string; name: string; code: string; type: string };
  booked: { lrs: number; nag: number; weight: number; freight: number };
  dispatched: { lrs: number; challans: number; nag: number };
  unloaded: { lrs: number; nag: number; short: number; damaged: number };
  delivered: { lrs: number; collected: number };
  pending: { toDispatch: number; incoming: number; toDeliver: number };
};
type Dash = {
  totals: Record<string, number>;
  rows: Row[];
  trend: { _id: string; lrs: number; freight: number }[];
};

const Kpi = ({ label, value, sub, to }: { label: string; value: string; sub?: string; to?: string }) => {
  const body = (
    <div className="kpi h-full transition hover:border-brand">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
};

export default function Dashboard() {
  const branch = useAppSelector((s) => s.auth.branch);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()]);
  const { data, loading, error } = useGet<Dash>('/dashboard', {
    branch,
    from: range[0].format('YYYY-MM-DD'),
    to: range[1].format('YYYY-MM-DD'),
  });
  const t = data?.totals || {};
  const isToday = range[0].isSame(dayjs(), 'day') && range[1].isSame(dayjs(), 'day');
  const when = isToday ? 'today' : 'in period';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">{isToday ? "Today's position" : 'Position'}</h1>
        <DatePicker.RangePicker format="DD MMM YY"
          value={range}
          allowClear={false}
          onChange={(v) => v && setRange([v[0]!, v[1]!])}
          presets={[
            { label: 'Today', value: [dayjs(), dayjs()] },
            { label: 'Yesterday', value: [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')] },
            { label: 'This month', value: [dayjs().startOf('month'), dayjs()] },
          ]}
        />
      </div>
      {error && <Alert type="error" message={error} />}
      {loading && !data ? (
        <Skeleton active />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label={`Bookings ${when}`} value={num(t.bookings)} sub={`${num(t.bookedNag)} nag`} to="/lrs" />
            <Kpi label="Freight booked" value={inr(t.freight)} />
            <Kpi label="Dispatched" value={num(t.dispatchedLrs)} sub={`${num(t.challans)} vehicles`} to="/challans" />
            <Kpi label="Unloaded" value={num(t.unloadedLrs)} sub={t.shortNag || t.damagedNag ? `${t.shortNag} short · ${t.damagedNag} damaged` : 'no shortage'} />
            <Kpi label="Delivered" value={num(t.deliveredLrs)} sub={`${inr(t.collected)} collected`} />
            <Kpi label="To deliver now" value={num(t.toDeliver)} sub={`${num(t.inTransit)} in transit · ${num(t.toDispatch)} to dispatch`} to="/reports" />
          </div>

          <div className="panel">
            <div className="mb-3 font-bold text-slate-800">Branch-wise</div>
            <Table<Row>
              size="small"
              rowKey={(r) => r.branch._id}
              dataSource={data?.rows || []}
              pagination={false}
              scroll={{ x: 900 }}
              columns={[
                {
                  title: 'Branch', fixed: 'left', width: 170,
                  render: (_, r) => (
                    <span className="font-semibold">
                      {r.branch.name} {r.branch.type === 'hub' && <Tag color="gold" className="!ml-1">HUB</Tag>}
                    </span>
                  ),
                },
                { title: 'Booked LR', align: 'right', render: (_, r) => num(r.booked.lrs) },
                { title: 'Nag', align: 'right', render: (_, r) => num(r.booked.nag) },
                { title: 'Freight', align: 'right', render: (_, r) => inr(r.booked.freight) },
                { title: 'Dispatched', align: 'right', render: (_, r) => `${num(r.dispatched.lrs)} LR / ${r.dispatched.challans} veh` },
                { title: 'Unloaded', align: 'right', render: (_, r) => <>{num(r.unloaded.lrs)}{(r.unloaded.short || r.unloaded.damaged) ? <Tag color="red" className="!ml-1">{r.unloaded.short + r.unloaded.damaged}</Tag> : null}</> },
                { title: 'Delivered', align: 'right', render: (_, r) => num(r.delivered.lrs) },
                { title: 'Collected', align: 'right', render: (_, r) => inr(r.delivered.collected) },
                { title: 'Pending dispatch', align: 'right', render: (_, r) => <b className={r.pending.toDispatch ? 'text-amber-600' : ''}>{r.pending.toDispatch}</b> },
                { title: 'Incoming', align: 'right', render: (_, r) => r.pending.incoming },
                { title: 'To deliver', align: 'right', render: (_, r) => <b className={r.pending.toDeliver ? 'text-cyan-700' : ''}>{r.pending.toDeliver}</b> },
              ]}
            />
          </div>

          <div className="panel">
            <div className="mb-3 font-bold text-slate-800">Bookings – last 7 days</div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={(data?.trend || []).map((d) => ({ ...d, day: dayjs(d._id).format('DD MMM') }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={32} />
                  <Tooltip />
                  <Bar dataKey="lrs" name="LRs" fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
