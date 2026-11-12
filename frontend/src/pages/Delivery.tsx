import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Table, Tag } from 'antd';
import { PackageCheck } from 'lucide-react';
import { useGet } from '../api/hooks';
import { api } from '../api/client';
import { useAppSelector } from '../redux/store';
import { d, inr, PAY } from '../utils/format';
import DeliverModal from '../components/DeliverModal';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Delivery() {
  const branch = useAppSelector((s) => s.auth.branch);
  const [q, setQ] = useState('');
  const [lr, setLr] = useState<any>(null);
  const { data, loading, reload } = useGet<{ items: any[] }>('/reports/pending', { type: 'delivery', branch });
  const rows = (data?.items || []).filter((r) => !q || JSON.stringify([r.lrNo, r.consignee]).toLowerCase().includes(q.toLowerCase()));

  const openDeliver = async (r: any) => {
    // need received + freight details
    const full = await api.get(`/lrs/${r._id}`);
    setLr(full.data.data);
  };

  return (
    <div className="space-y-3">
      <h1 className="page-title">Delivery – goods waiting for party</h1>
      <div className="panel">
        <Input.Search allowClear placeholder="LR no. or consignee" className="mb-3 max-w-xs" onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
        <Table
          size="small"
          rowKey="_id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 820 }}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          columns={[
            { title: 'LR', dataIndex: 'lrNo', render: (v, r: any) => <Link to={`/lrs/${r._id}`} className="font-semibold">{v}</Link> },
            { title: 'Booked', dataIndex: 'lrDate', render: d },
            { title: 'Consignee', render: (_, r: any) => <>{r.consignee.name}<div className="text-xs text-slate-500">{r.consignee.mobile}</div></> },
            { title: 'At', render: (_, r: any) => r.deliveryBranch?.code },
            { title: 'Nag', dataIndex: 'totalNag', align: 'right' },
            { title: 'Pay', render: (_, r: any) => <>{PAY[r.paymentType]}{r.paymentType === 'to_pay' && <div className="text-xs font-semibold text-amber-700">collect {inr(r.freight?.total)}</div>}</> },
            { title: 'Waiting', dataIndex: 'ageDays', render: (v) => <Tag color={v > 5 ? 'red' : v > 2 ? 'orange' : 'default'}>{v} days since booking</Tag> },
            { title: '', render: (_, r: any) => <Button type="primary" size="small" icon={<PackageCheck size={14} />} onClick={() => openDeliver(r)}>Deliver</Button> },
          ]}
        />
      </div>
      <DeliverModal lr={lr} onClose={() => setLr(null)} onDone={reload} />
    </div>
  );
}
