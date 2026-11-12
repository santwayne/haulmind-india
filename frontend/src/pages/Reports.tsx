import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, DatePicker, InputNumber, Select, Table, Tabs, Tag } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useGet } from '../api/hooks';
import { api, errMsg } from '../api/client';
import { useAppSelector, can, MANAGERS } from '../redux/store';
import { d, dt, inr, num, PAY, STATUS } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const csv = (name: string, rows: (string | number)[][]) => {
  const body = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' }));
  a.download = `${name}-${dayjs().format('YYYY-MM-DD')}.csv`;
  a.click();
};

function Pending({ type }: { type: 'dispatch' | 'unloading' | 'delivery' }) {
  const branch = useAppSelector((s) => s.auth.branch);
  const { data, loading } = useGet<{ items: any[] }>('/reports/pending', { type, branch });
  const items = data?.items || [];
  return (
    <>
      <div className="mb-2 flex justify-between text-sm">
        <span><b>{items.length}</b> LR · <b>{num(items.reduce((s, i) => s + i.totalNag, 0))}</b> nag</span>
        <a onClick={() => csv(`pending-${type}`, [['LR', 'Date', 'From', 'To', 'Lying at', 'Consignor', 'Consignee', 'Nag', 'Kg', 'Status', 'Days'], ...items.map((i) => [i.lrNo, d(i.lrDate), i.bookingBranch?.code, i.deliveryBranch?.code, i.currentBranch?.code, i.consignor.name, i.consignee.name, i.totalNag, i.totalWeight, i.status, i.ageDays])])}>Download CSV</a>
      </div>
      <Table
        size="small"
        rowKey="_id"
        loading={loading}
        dataSource={items}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        columns={[
          { title: 'LR', dataIndex: 'lrNo', render: (v, r: any) => <Link to={`/lrs/${r._id}`} className="font-semibold">{v}</Link> },
          { title: 'Date', dataIndex: 'lrDate', render: d },
          { title: 'Route', render: (_, r: any) => `${r.bookingBranch?.code} → ${r.deliveryBranch?.code}` },
          { title: type === 'unloading' ? 'Vehicle' : 'Lying at', render: (_, r: any) => (type === 'unloading' ? <>{r.currentChallan?.vehicleNo}<div className="text-xs text-slate-500">{r.currentChallan?.challanNo} · {dt(r.currentChallan?.dispatchedAt)}</div></> : r.currentBranch?.name) },
          { title: 'Consignee', render: (_, r: any) => r.consignee.name, ellipsis: true },
          { title: 'Nag', dataIndex: 'totalNag', align: 'right' },
          { title: 'Pay', dataIndex: 'paymentType', render: (v) => PAY[v] },
          { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={STATUS[v]?.color}>{STATUS[v]?.label}</Tag> },
          { title: 'Age', dataIndex: 'ageDays', sorter: (a: any, b: any) => a.ageDays - b.ageDays, defaultSortOrder: 'descend', render: (v) => <Tag color={v > 7 ? 'red' : v > 3 ? 'orange' : 'default'}>{v}d</Tag> },
        ]}
      />
    </>
  );
}

function Movement() {
  const branch = useAppSelector((s) => s.auth.branch);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const { data, loading } = useGet<{ outward: any[]; inward: any[] }>('/reports/movement', { branch, from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') });
  const cols = [
    { title: 'From', render: (_: unknown, r: any) => r.from?.name },
    { title: 'To', render: (_: unknown, r: any) => r.to?.name },
    { title: 'Vehicles', dataIndex: 'challans', align: 'right' as const },
    { title: 'Nag', dataIndex: 'nag', align: 'right' as const, render: num },
    { title: 'Kg', dataIndex: 'weight', align: 'right' as const, render: num },
  ];
  return (
    <>
      <DatePicker.RangePicker format="DD MMM YY" value={range} allowClear={false} onChange={(v) => v && setRange([v[0]!, v[1]!])} className="mb-3" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1 font-bold">Goods sent (outward)</div>
          <Table size="small" loading={loading} rowKey={(r: any) => JSON.stringify(r._id)} dataSource={data?.outward || []} pagination={false}
            columns={[...cols, { title: 'Lorry hire', dataIndex: 'hire', align: 'right' as const, render: inr }]} />
        </div>
        <div>
          <div className="mb-1 font-bold">Goods received (inward)</div>
          <Table size="small" loading={loading} rowKey={(r: any) => JSON.stringify(r._id)} dataSource={data?.inward || []} pagination={false} columns={cols} />
        </div>
      </div>
    </>
  );
}

function Claims() {
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const branch = useAppSelector((s) => s.auth.branch);
  const [status, setStatus] = useState<string | undefined>('open');
  const { data, loading, reload } = useGet<{ items: any[] }>('/claims', { branch, status });
  const upd = async (id: string, body: Record<string, unknown>) => {
    try {
      await api.put(`/claims/${id}`, body);
      reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };
  const edit = can(user, ...MANAGERS);
  return (
    <>
      <Select allowClear value={status} onChange={setStatus} placeholder="All" className="mb-3 min-w-[140px]" options={[{ value: 'open', label: 'Open' }, { value: 'settled', label: 'Settled' }, { value: 'rejected', label: 'Rejected' }]} />
      <Table
        size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} scroll={{ x: 800 }}
        columns={[
          { title: 'Date', dataIndex: 'createdAt', render: d },
          { title: 'LR', dataIndex: 'lrNo', render: (v, r: any) => <Link to={`/lrs/${r.lr}`}>{v}</Link> },
          { title: 'Branch', render: (_, r: any) => r.branch?.code },
          { title: 'Vehicle', render: (_, r: any) => r.challan?.vehicleNo },
          { title: 'Type', dataIndex: 'type', render: (v) => <Tag color={v === 'damage' ? 'volcano' : 'red'}>{v}</Tag> },
          { title: 'Nag', dataIndex: 'nag', align: 'right' },
          { title: 'Remark', dataIndex: 'remark' },
          { title: 'Claim ₹', dataIndex: 'claimAmount', render: (v, r: any) => edit ? <InputNumber size="small" min={0} defaultValue={v} onBlur={(e) => upd(r._id, { claimAmount: Number(e.target.value.replace(/[^\d.]/g, '')) })} /> : inr(v) },
          { title: 'Status', dataIndex: 'status', render: (v, r: any) => edit ? <Select size="small" value={v} onChange={(s) => upd(r._id, { status: s })} options={['open', 'settled', 'rejected'].map((x) => ({ value: x, label: x }))} /> : v },
        ]}
      />
    </>
  );
}

export default function Reports() {
  return (
    <div className="space-y-3">
      <h1 className="page-title">Reports</h1>
      <div className="panel">
        <Tabs
          items={[
            { key: 'd', label: 'Pending dispatch', children: <Pending type="dispatch" /> },
            { key: 'u', label: 'Not yet unloaded', children: <Pending type="unloading" /> },
            { key: 'v', label: 'Not yet delivered', children: <Pending type="delivery" /> },
            { key: 'm', label: 'Branch in / out', children: <Movement /> },
            { key: 'c', label: 'Damage & shortage', children: <Claims /> },
          ]}
        />
      </div>
    </div>
  );
}
