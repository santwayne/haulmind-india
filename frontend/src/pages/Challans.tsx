import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Input, Segmented, Table, Tag } from 'antd';
import { Printer, Ban } from 'lucide-react';
import { useGet } from '../api/hooks';
import { api, errMsg, openPdf } from '../api/client';
import { useAppSelector, can, MANAGERS } from '../redux/store';
import { dt, num, STATUS } from '../utils/format';

type Ch = {
  _id: string; challanNo: string; type: string; status: string; vehicleNo?: string; driverName?: string;
  fromBranch: { name: string; code: string }; toBranch: { name: string; code: string };
  dispatchedAt: string; arrivedAt?: string; lines: unknown[]; totalNag: number; totalWeight: number;
};

export default function Challans() {
  const nav = useNavigate();
  const { message, modal } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const branch = useAppSelector((s) => s.auth.branch);
  const [direction, setDirection] = useState('outgoing');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useGet<{ items: Ch[]; total: number }>('/challans', { branch, direction, q, page, limit: 25 });

  const cancel = (c: Ch) =>
    modal.confirm({
      title: `Cancel ${c.challanNo}?`,
      content: 'All LRs go back to the sending branch. Only possible before unloading.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.post(`/challans/${c._id}/cancel`, { reason: 'Cancelled from challan list' });
          message.success('Challan cancelled');
          reload();
        } catch (e) {
          message.error(errMsg(e));
        }
      },
    });

  return (
    <div className="space-y-3">
      <h1 className="page-title">Challans</h1>
      <div className="panel flex flex-wrap gap-2">
        <Segmented value={direction} onChange={(v) => { setDirection(v as string); setPage(1); }} options={[{ value: 'outgoing', label: 'Sent' }, { value: 'incoming', label: 'Received / coming' }]} />
        <Input.Search allowClear placeholder="Challan, vehicle or LR no." className="max-w-[260px]" onSearch={(v) => { setQ(v); setPage(1); }} />
      </div>
      <div className="panel">
        <Table<Ch>
          size="small"
          rowKey="_id"
          loading={loading}
          dataSource={data?.items || []}
          scroll={{ x: 900 }}
          pagination={{ current: page, total: data?.total, pageSize: 25, onChange: setPage, showSizeChanger: false }}
          columns={[
            { title: 'Challan', dataIndex: 'challanNo', render: (v, r) => <><b>{v}</b> {r.type === 'transfer' && <Tag color="purple">Transfer</Tag>}</> },
            { title: 'Dispatched', dataIndex: 'dispatchedAt', render: dt },
            { title: 'Route', render: (_, r) => `${r.fromBranch.code} → ${r.toBranch.code}` },
            { title: 'Vehicle', render: (_, r) => <>{r.vehicleNo}<div className="text-xs text-slate-500">{r.driverName}</div></> },
            { title: 'LR', align: 'right', render: (_, r) => r.lines.length },
            { title: 'Nag', align: 'right', render: (_, r) => num(r.totalNag) },
            { title: 'Kg', align: 'right', render: (_, r) => num(r.totalWeight) },
            { title: 'Status', dataIndex: 'status', render: (v, r) => <><Tag color={STATUS[v]?.color || (v === 'cancelled' ? 'default' : 'orange')}>{STATUS[v]?.label || v}</Tag>{r.arrivedAt && <div className="text-xs text-slate-500">{dt(r.arrivedAt)}</div>}</> },
            {
              title: '', width: 160,
              render: (_, r) => (
                <div className="flex gap-1">
                  <Button size="small" icon={<Printer size={14} />} onClick={() => openPdf(`/challans/${r._id}/pdf`, `${r.challanNo}.pdf`)} />
                  {direction === 'incoming' && ['in_transit', 'partially_received'].includes(r.status) && (
                    <Button size="small" type="primary" onClick={() => nav(`/unloading/${r._id}`)}>Unload</Button>
                  )}
                  {direction === 'outgoing' && r.status === 'in_transit' && can(user, ...MANAGERS) && (
                    <Button size="small" danger icon={<Ban size={14} />} onClick={() => cancel(r)} />
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
