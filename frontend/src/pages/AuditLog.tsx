import { useState } from 'react';
import { App, Button, Input, Select, Table, Tabs, Tag } from 'antd';
import { useGet } from '../api/hooks';
import { api, errMsg } from '../api/client';
import { useAppSelector } from '../redux/store';
import { dt } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const showVal = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v));

function Audit() {
  const [entity, setEntity] = useState<string | undefined>();
  const [ref, setRef] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading } = useGet<{ items: any[]; total: number }>('/audit', { entity, ref, page, limit: 50 });
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select allowClear placeholder="All records" value={entity} onChange={(v) => { setEntity(v); setPage(1); }} className="min-w-[150px]"
          options={['LR', 'Challan', 'Party', 'Branch', 'User', 'Vehicle', 'Broker', 'RouteRate'].map((x) => ({ value: x, label: x }))} />
        <Input.Search allowClear placeholder="Exact LR / challan no." className="max-w-[240px]" onSearch={(v) => { setRef(v.trim().toUpperCase()); setPage(1); }} />
      </div>
      <Table
        size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} scroll={{ x: 900 }}
        pagination={{ current: page, total: data?.total, pageSize: 50, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: 'When', dataIndex: 'createdAt', render: dt, width: 150 },
          { title: 'Who', dataIndex: 'userName', width: 130 },
          { title: 'Action', dataIndex: 'action', width: 90, render: (v) => <Tag color={{ delete: 'red', cancel: 'red', update: 'gold', create: 'green', login: 'default' }[v as string] || 'blue'}>{v}</Tag> },
          { title: 'Record', render: (_, r: any) => <><b>{r.entity}</b> {r.ref}</>, width: 200 },
          {
            title: 'Changes',
            render: (_, r: any) => r.changes ? (
              <div className="space-y-0.5 text-xs">
                {Object.entries(r.changes).slice(0, 6).map(([k, v]: [string, any]) => (
                  <div key={k}><b>{k}</b>: {v && typeof v === 'object' && 'from' in v ? <><span className="text-red-600 line-through">{showVal(v.from)}</span> → <span className="text-green-700">{showVal(v.to)}</span></> : showVal(v)}</div>
                ))}
              </div>
            ) : null,
          },
        ]}
      />
    </>
  );
}

function Messages() {
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const { data, loading } = useGet<{ items: any[]; total: number }>('/notifications', { status, page, limit: 50 });
  return (
    <>
      <Select allowClear placeholder="All" value={status} onChange={setStatus} className="mb-3 min-w-[140px]"
        options={['sent', 'failed', 'skipped', 'queued'].map((x) => ({ value: x, label: x }))} />
      <Table
        size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} scroll={{ x: 800 }}
        pagination={{ current: page, total: data?.total, pageSize: 50, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: 'When', dataIndex: 'createdAt', render: dt, width: 150 },
          { title: 'Event', dataIndex: 'event', width: 140 },
          { title: 'To', dataIndex: 'to', width: 130 },
          { title: 'Via', dataIndex: 'channel', width: 90 },
          { title: 'Message', dataIndex: 'message' },
          { title: 'Status', dataIndex: 'status', width: 90, render: (v, r: any) => <Tag color={v === 'sent' ? 'green' : v === 'failed' ? 'red' : 'default'} title={r.error}>{v}</Tag> },
        ]}
      />
    </>
  );
}

export default function AuditLog() {
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Audit log & messages</h1>
        {user?.role === 'owner' && (
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post('/backup/run');
              message.success(`Backup done: ${r.data.data.documents} records`);
            } catch (e) {
              message.error(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}>Run backup now</Button>
        )}
      </div>
      <div className="panel">
        <Tabs items={[{ key: 'a', label: 'Who changed what', children: <Audit /> }, { key: 'm', label: 'WhatsApp / SMS sent', children: <Messages /> }]} />
      </div>
    </div>
  );
}
