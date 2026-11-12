import { useNavigate } from 'react-router-dom';
import { Table } from 'antd';
import { useGet } from '../api/hooks';
import { useAppSelector } from '../redux/store';
import { inr, inr2 } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Payables() {
  const nav = useNavigate();
  const branch = useAppSelector((s) => s.auth.branch);
  const { data, loading } = useGet<any>('/reports/payables', { branch });
  const t = data?.totals || {};
  return (
    <div className="space-y-3">
      <h1 className="page-title">To pay (payables)</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="kpi"><div className="label">Total to pay</div><div className="value text-red-600">{inr(t.all)}</div></div>
        <div className="kpi"><div className="label">Lorry hire balance</div><div className="value">{inr(t.lorryHire)}</div></div>
        <div className="kpi"><div className="label">Broker commission</div><div className="value">{inr(t.brokers)}</div></div>
        <div className="kpi"><div className="label">Party advances held</div><div className="value">{inr(t.partyAdvances)}</div></div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel">
          <div className="mb-2 font-bold">Truck owners / transporters</div>
          <Table size="small" rowKey="name" loading={loading} pagination={false} dataSource={data?.lorryHire || []} onRow={() => ({ onClick: () => nav('/lorry-hire'), className: 'cursor-pointer' })}
            columns={[{ title: 'Owner / vehicle', render: (_, r: any) => <>{r.name}<div className="text-xs text-slate-500">{r.challans} challan · {r.vehicles.join(', ')}</div></> }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr2 }]} />
        </div>
        <div className="panel">
          <div className="mb-2 font-bold">Brokers</div>
          <Table size="small" rowKey="_id" loading={loading} pagination={false} dataSource={data?.brokers || []} onRow={(r: any) => ({ onClick: () => nav(`/ledger?kind=broker&id=${r._id}`), className: 'cursor-pointer' })}
            columns={[{ title: 'Broker', dataIndex: 'name' }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr2 }]} />
        </div>
        <div className="panel">
          <div className="mb-2 font-bold">Parties (advance taken)</div>
          <Table size="small" rowKey="_id" loading={loading} pagination={false} dataSource={data?.partyAdvances || []} onRow={(r: any) => ({ onClick: () => nav(`/ledger?kind=party&id=${r._id}`), className: 'cursor-pointer' })}
            columns={[{ title: 'Party', dataIndex: 'name' }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr2 }]} />
        </div>
      </div>
    </div>
  );
}
