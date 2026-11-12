import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Card, Empty, Input, InputNumber, Skeleton, Table, Tag } from 'antd';
import { PackageOpen } from 'lucide-react';
import { api, errMsg } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector } from '../redux/store';
import { dt, num } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Line = {
  lr: { _id: string; lrNo: string; consignee: { name: string }; deliveryBranch: string };
  lrNo: string; nag: number; weight: number; unloaded: boolean;
  receivedNag?: number; shortNag?: number; damagedNag?: number; damageRemark?: string;
};

function IncomingList() {
  const nav = useNavigate();
  const branch = useAppSelector((s) => s.auth.branch);
  const { data, loading } = useGet<{ items: any[] }>('/challans', { branch, direction: 'incoming', status: 'in_transit,partially_received', limit: 100 });
  return (
    <div className="space-y-3">
      <h1 className="page-title">Unloading – vehicles coming in</h1>
      {loading && <Skeleton active />}
      {!loading && !data?.items.length && <Empty description="No vehicle pending for unloading" />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data?.items.map((c) => (
          <Card key={c._id} size="small" hoverable onClick={() => nav(`/unloading/${c._id}`)}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-extrabold">{c.vehicleNo || 'Vehicle'}</div>
                <div className="text-sm text-slate-500">{c.challanNo}</div>
              </div>
              <Tag color={c.status === 'in_transit' ? 'orange' : 'gold'}>{c.status === 'in_transit' ? 'On the way' : 'Partly unloaded'}</Tag>
            </div>
            <div className="mt-2 text-sm">
              From <b>{c.fromBranch.name}</b> → {c.toBranch.name}
            </div>
            <div className="text-sm text-slate-600">{c.lines.length} LR · {num(c.totalNag)} nag · {num(c.totalWeight)} kg</div>
            <div className="text-xs text-slate-400">Left {dt(c.dispatchedAt)}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UnloadChallan({ id }: { id: string }) {
  const nav = useNavigate();
  const { message } = App.useApp();
  const { data: ch, loading, reload } = useGet<any>(`/challans/${id}`);
  const [rows, setRows] = useState<Record<string, { receivedNag: number; damagedNag: number; damageRemark: string; pick: boolean }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ch) return;
    const r: typeof rows = {};
    ch.lines.filter((l: Line) => !l.unloaded).forEach((l: Line) => {
      r[l.lr._id] = { receivedNag: l.nag, damagedNag: 0, damageRemark: '', pick: true };
    });
    setRows(r);
  }, [ch]);

  if (loading && !ch) return <Skeleton active />;
  if (!ch) return null;
  const pending = ch.lines.filter((l: Line) => !l.unloaded);
  const set = (lrId: string, k: string, v: unknown) => setRows((p) => ({ ...p, [lrId]: { ...p[lrId], [k]: v } }));

  const submit = async () => {
    const lines = Object.entries(rows).filter(([, v]) => v.pick).map(([lr, v]) => ({ lr, receivedNag: v.receivedNag, damagedNag: v.damagedNag, damageRemark: v.damageRemark }));
    if (!lines.length) return message.warning('Tick the LRs that were unloaded');
    setSaving(true);
    try {
      const r = await api.post(`/challans/${id}/unload`, { lines });
      message.success(r.data.message + ' – parties informed on WhatsApp/SMS');
      reload();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">Unload {ch.vehicleNo} · {ch.challanNo}</h1>
          <div className="text-sm text-slate-500">{ch.fromBranch.name} → {ch.toBranch.name} · left {dt(ch.dispatchedAt)}</div>
        </div>
        <Button onClick={() => nav('/unloading')}>Back</Button>
      </div>
      <div className="panel">
        <Table<Line>
          size="small"
          rowKey={(l) => l.lr._id}
          dataSource={ch.lines}
          pagination={false}
          scroll={{ x: 820 }}
          rowSelection={{
            selectedRowKeys: Object.entries(rows).filter(([, v]) => v.pick).map(([k]) => k),
            getCheckboxProps: (l) => ({ disabled: l.unloaded }),
            onChange: (keys) => setRows((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, pick: keys.includes(k) }]))),
          }}
          columns={[
            { title: 'LR', render: (_, l) => <b>{l.lrNo}</b> },
            { title: 'Consignee', render: (_, l) => l.lr.consignee?.name, ellipsis: true },
            { title: 'Sent nag', dataIndex: 'nag', align: 'right' },
            {
              title: 'Received nag', width: 120,
              render: (_, l) => l.unloaded ? <span>{l.receivedNag}{l.shortNag ? <Tag color="red" className="!ml-1">{l.shortNag} short</Tag> : null}</span>
                : <InputNumber size="small" min={0} max={l.nag} value={rows[l.lr._id]?.receivedNag} onChange={(v) => set(l.lr._id, 'receivedNag', v ?? 0)} />,
            },
            {
              title: 'Damaged', width: 100,
              render: (_, l) => l.unloaded ? (l.damagedNag ? <Tag color="red">{l.damagedNag}</Tag> : '—')
                : <InputNumber size="small" min={0} value={rows[l.lr._id]?.damagedNag} onChange={(v) => set(l.lr._id, 'damagedNag', v ?? 0)} />,
            },
            {
              title: 'Remark',
              render: (_, l) => l.unloaded ? l.damageRemark : <Input size="small" placeholder="e.g. 1 bale torn" value={rows[l.lr._id]?.damageRemark} onChange={(e) => set(l.lr._id, 'damageRemark', e.target.value)} />,
            },
            { title: '', render: (_, l) => (l.unloaded ? <Tag color="green">Unloaded</Tag> : <Tag color="orange">Pending</Tag>) },
          ]}
        />
        {pending.length > 0 ? (
          <div className="mt-3 flex justify-end">
            <Button type="primary" size="large" icon={<PackageOpen size={17} />} loading={saving} onClick={submit}>
              Save unloading
            </Button>
          </div>
        ) : (
          <div className="mt-3 text-right font-semibold text-green-700">Fully unloaded</div>
        )}
      </div>
    </div>
  );
}

export default function Unloading() {
  const { id } = useParams();
  return id ? <UnloadChallan id={id} /> : <IncomingList />;
}
