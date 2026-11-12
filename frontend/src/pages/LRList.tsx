import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, DatePicker, Input, Segmented, Select, Table, Tag } from 'antd';
import { Plus, Printer } from 'lucide-react';
import dayjs, { type Dayjs } from 'dayjs';
import { useGet } from '../api/hooks';
import { openPdf } from '../api/client';
import { useAppSelector, can, OPS } from '../redux/store';
import { d, inr, num, PAY, STATUS } from '../utils/format';

type LRRow = {
  _id: string; lrNo: string; lrDate: string; status: string; paymentType: string;
  consignor: { name: string }; consignee: { name: string };
  bookingBranch: { code: string }; deliveryBranch: { code: string }; currentBranch?: { code: string };
  totalNag: number; totalWeight: number; freight: { total: number };
};
type Res = { items: LRRow[]; total: number; sums: { nag: number; weight: number; freight: number } };

export default function LRList() {
  const nav = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const branch = useAppSelector((s) => s.auth.branch);
  const [scope, setScope] = useState('booking');
  const [status, setStatus] = useState<string | undefined>();
  const [pay, setPay] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().startOf('month'), dayjs()]);
  const [page, setPage] = useState(1);
  const { data, loading } = useGet<Res>('/lrs', {
    branch, scope, status, paymentType: pay, q, page, limit: 25,
    from: range?.[0].format('YYYY-MM-DD'), to: range?.[1].format('YYYY-MM-DD'),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">LR register</h1>
        {can(user, ...OPS) && (
          <Button type="primary" icon={<Plus size={16} />} onClick={() => nav('/lrs/new')}>
            New LR
          </Button>
        )}
      </div>
      <div className="panel flex flex-wrap gap-2">
        <Segmented
          value={scope}
          onChange={(v) => { setScope(v as string); setPage(1); }}
          options={[{ value: 'booking', label: 'Booked here' }, { value: 'delivery', label: 'For delivery here' }, { value: 'current', label: 'Lying here' }]}
        />
        <Input.Search allowClear placeholder="LR no, party, mobile, invoice" className="max-w-[260px]" onSearch={(v) => { setQ(v); setPage(1); }} />
        <Select allowClear placeholder="Status" className="min-w-[150px]" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
          options={Object.entries(STATUS).filter(([k]) => !['partially_received', 'received'].includes(k)).map(([k, v]) => ({ value: k, label: v.label }))} />
        <Select allowClear placeholder="Payment" className="min-w-[110px]" value={pay} onChange={(v) => { setPay(v); setPage(1); }}
          options={Object.entries(PAY).map(([k, v]) => ({ value: k, label: v }))} />
        <DatePicker.RangePicker format="DD MMM YY" value={range} onChange={(v) => { setRange(v as [Dayjs, Dayjs] | null); setPage(1); }} />
      </div>
      <div className="panel">
        <div className="mb-2 flex flex-wrap gap-4 text-sm text-slate-600">
          <span><b>{num(data?.total)}</b> LR</span>
          <span><b>{num(data?.sums.nag)}</b> nag</span>
          <span><b>{num(data?.sums.weight)}</b> kg</span>
          <span><b>{inr(data?.sums.freight)}</b> freight</span>
        </div>
        <Table<LRRow>
          size="small"
          rowKey="_id"
          loading={loading}
          dataSource={data?.items || []}
          scroll={{ x: 960 }}
          onRow={(r) => ({ onClick: () => nav(`/lrs/${r._id}`), className: 'cursor-pointer' })}
          pagination={{ current: page, pageSize: 25, total: data?.total, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: 'LR No.', dataIndex: 'lrNo', fixed: 'left', render: (v, r) => <Link to={`/lrs/${r._id}`} className="font-semibold">{v}</Link> },
            { title: 'Date', dataIndex: 'lrDate', render: d },
            { title: 'Route', render: (_, r) => `${r.bookingBranch?.code} → ${r.deliveryBranch?.code}` },
            { title: 'Consignor', render: (_, r) => r.consignor.name, ellipsis: true },
            { title: 'Consignee', render: (_, r) => r.consignee.name, ellipsis: true },
            { title: 'Nag', dataIndex: 'totalNag', align: 'right' },
            { title: 'Kg', dataIndex: 'totalWeight', align: 'right' },
            { title: 'Pay', dataIndex: 'paymentType', render: (v) => PAY[v] },
            { title: 'Freight', align: 'right', render: (_, r) => inr(r.freight?.total) },
            { title: 'Status', dataIndex: 'status', render: (v, r) => <Tag color={STATUS[v]?.color}>{STATUS[v]?.label}{v === 'at_branch' && r.currentBranch ? ` (${r.currentBranch.code})` : ''}</Tag> },
            {
              title: '', width: 50,
              render: (_, r) => (
                <Button size="small" type="text" icon={<Printer size={15} />} onClick={(e) => { e.stopPropagation(); openPdf(`/lrs/${r._id}/pdf`, `LR-${r.lrNo}.pdf`); }} />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
