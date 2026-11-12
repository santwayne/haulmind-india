import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { App, Button, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Table, Tag } from 'antd';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useBranches, useGet, clearBranchCache } from '../../api/hooks';
import { api, errMsg } from '../../api/client';
import { useAppSelector, can, HQ, OPS, MANAGERS, type User } from '../../redux/store';
import { inr } from '../../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Field = { name: string | string[]; label: string; required?: boolean; span?: number; input: (ctx: Ctx) => ReactNode };
type Ctx = { branches: { _id: string; name: string; code: string }[]; brokers: { _id: string; name: string }[] };
type Def = {
  title: string; path: string; writeRoles: User['role'][]; fields: Field[];
  columns: (ctx: Ctx) => any[]; toForm?: (r: any) => any;
};

const txt = () => <Input />;
const money = () => <InputNumber min={0} prefix="₹" className="!w-full" />;
const n = () => <InputNumber min={0} className="!w-full" />;
const branchSel = (c: Ctx) => <Select allowClear showSearch optionFilterProp="label" options={c.branches.map((b) => ({ value: b._id, label: `${b.name} (${b.code})` }))} />;

const DEFS: Record<string, Def> = {
  parties: {
    title: 'Parties', path: '/parties', writeRoles: [...OPS, 'accountant'],
    fields: [
      { name: 'name', label: 'Party name', required: true, span: 12, input: txt },
      { name: 'mobile', label: 'Mobile', span: 6, input: txt },
      { name: 'altMobile', label: 'Alt. mobile', span: 6, input: txt },
      { name: 'gstin', label: 'GSTIN', span: 8, input: txt },
      { name: 'city', label: 'City', span: 8, input: txt },
      { name: 'state', label: 'State', span: 8, input: txt },
      { name: 'address', label: 'Address', span: 24, input: () => <Input.TextArea autoSize /> },
      { name: 'homeBranch', label: 'Home branch', span: 8, input: branchSel },
      { name: 'broker', label: 'Broker', span: 8, input: (c) => <Select allowClear options={c.brokers.map((b) => ({ value: b._id, label: b.name }))} /> },
      { name: 'creditLimit', label: 'Credit limit (TBB)', span: 4, input: money },
      { name: 'creditDays', label: 'Credit days', span: 4, input: n },
    ],
    toForm: (r) => ({ ...r, homeBranch: r.homeBranch?._id, broker: r.broker?._id }),
    columns: () => [
      { title: 'Name', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
      { title: 'Mobile', dataIndex: 'mobile' },
      { title: 'City', dataIndex: 'city' },
      { title: 'GSTIN', dataIndex: 'gstin' },
      { title: 'Branch', render: (_: unknown, r: any) => r.homeBranch?.code },
      { title: 'Credit', render: (_: unknown, r: any) => (r.creditLimit ? `${inr(r.creditLimit)} / ${r.creditDays}d` : '—') },
    ],
  },
  brokers: {
    title: 'Brokers', path: '/brokers', writeRoles: [...MANAGERS, 'accountant'],
    fields: [
      { name: 'name', label: 'Name', required: true, span: 12, input: txt },
      { name: 'mobile', label: 'Mobile', span: 12, input: txt },
      { name: 'commissionType', label: 'Commission type', span: 12, input: () => <Select options={[{ value: 'percent', label: '% of freight' }, { value: 'fixed_per_lr', label: 'Fixed per LR' }]} /> },
      { name: 'commissionValue', label: 'Commission value', span: 12, input: n },
      { name: 'address', label: 'Address', span: 24, input: txt },
    ],
    columns: () => [
      { title: 'Name', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
      { title: 'Mobile', dataIndex: 'mobile' },
      { title: 'Commission', render: (_: unknown, r: any) => (r.commissionType === 'percent' ? `${r.commissionValue}%` : `${inr(r.commissionValue)}/LR`) },
    ],
  },
  vehicles: {
    title: 'Vehicles', path: '/vehicles', writeRoles: OPS,
    fields: [
      { name: 'number', label: 'Vehicle no.', required: true, span: 8, input: () => <Input style={{ textTransform: 'uppercase' }} /> },
      { name: 'type', label: 'Type', span: 8, input: () => <Select options={['own', 'hired', 'transporter'].map((x) => ({ value: x, label: x }))} /> },
      { name: 'capacityKg', label: 'Capacity (kg)', span: 8, input: n },
      { name: 'ownerName', label: 'Owner', span: 12, input: txt },
      { name: 'ownerMobile', label: 'Owner mobile', span: 12, input: txt },
      { name: 'driverName', label: 'Driver', span: 12, input: txt },
      { name: 'driverMobile', label: 'Driver mobile', span: 12, input: txt },
    ],
    columns: () => [
      { title: 'Number', dataIndex: 'number', render: (v: string) => <b>{v}</b> },
      { title: 'Type', dataIndex: 'type', render: (v: string) => <Tag>{v}</Tag> },
      { title: 'Owner', dataIndex: 'ownerName' },
      { title: 'Driver', render: (_: unknown, r: any) => [r.driverName, r.driverMobile].filter(Boolean).join(' · ') },
    ],
  },
  branches: {
    title: 'Branches', path: '/branches', writeRoles: HQ,
    fields: [
      { name: 'name', label: 'Branch name', required: true, span: 12, input: txt },
      { name: 'code', label: 'Code (3–4 letters, used in LR no.)', required: true, span: 12, input: () => <Input maxLength={4} style={{ textTransform: 'uppercase' }} /> },
      { name: 'type', label: 'Type', span: 8, input: () => <Select options={[{ value: 'hub', label: 'Hub' }, { value: 'branch', label: 'Branch' }]} /> },
      { name: 'parentHub', label: 'Under hub', span: 8, input: branchSel },
      { name: 'state', label: 'State', span: 8, input: () => <Select options={['Punjab', 'Tamil Nadu', 'Kerala', 'Haryana', 'Himachal Pradesh', 'Delhi', 'Karnataka'].map((x) => ({ value: x, label: x }))} /> },
      { name: 'city', label: 'City', span: 8, input: txt },
      { name: 'phone', label: 'Phone', span: 8, input: txt },
      { name: 'managerName', label: 'Manager', span: 8, input: txt },
      { name: 'gstin', label: 'GSTIN', span: 12, input: txt },
      { name: 'address', label: 'Address (printed on LR)', span: 24, input: txt },
    ],
    toForm: (r) => ({ ...r, parentHub: r.parentHub?._id }),
    columns: () => [
      { title: 'Branch', render: (_: unknown, r: any) => <b>{r.name} <Tag className="!ml-1">{r.code}</Tag>{r.type === 'hub' && <Tag color="gold">HUB</Tag>}</b> },
      { title: 'State', dataIndex: 'state' },
      { title: 'Under hub', render: (_: unknown, r: any) => r.parentHub?.name },
      { title: 'Phone', dataIndex: 'phone' },
      { title: 'Manager', dataIndex: 'managerName' },
    ],
  },
  rates: {
    title: 'Route rates', path: '/rates', writeRoles: HQ,
    fields: [
      { name: 'fromBranch', label: 'From', required: true, span: 12, input: branchSel },
      { name: 'toBranch', label: 'To', required: true, span: 12, input: branchSel },
      { name: 'perKg', label: '₹ per kg', span: 6, input: n },
      { name: 'perNag', label: '₹ per nag', span: 6, input: n },
      { name: 'minFreight', label: 'Minimum freight', span: 6, input: money },
      { name: 'biltyCharge', label: 'Bilty charge', span: 6, input: money },
    ],
    toForm: (r) => ({ ...r, fromBranch: r.fromBranch?._id, toBranch: r.toBranch?._id }),
    columns: () => [
      { title: 'Route', render: (_: unknown, r: any) => <b>{r.fromBranch?.name} → {r.toBranch?.name}</b> },
      { title: 'Per kg', dataIndex: 'perKg', render: (v: number) => (v ? `₹${v}` : '—') },
      { title: 'Per nag', dataIndex: 'perNag', render: (v: number) => (v ? `₹${v}` : '—') },
      { title: 'Minimum', dataIndex: 'minFreight', render: inr },
      { title: 'Bilty', dataIndex: 'biltyCharge', render: inr },
    ],
  },
};

export default function Masters() {
  const { kind = 'parties' } = useParams();
  const def = DEFS[kind] || DEFS.parties;
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const branches = useBranches();
  const brokers = useGet<{ items: { _id: string; name: string }[] }>(kind === 'parties' ? '/brokers' : null, { limit: 200 }).data?.items || [];
  const ctx: Ctx = { branches, brokers };
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useGet<{ items: any[]; total: number }>(def.path, { q, page, limit: 25 });
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const canWrite = can(user, ...def.writeRoles);

  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing._id) await api.put(`${def.path}/${editing._id}`, v);
      else await api.post(def.path, v);
      message.success('Saved');
      if (kind === 'branches') clearBranchCache();
      setEditing(null);
      reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">{def.title}</h1>
        {canWrite && (
          <Button type="primary" icon={<Plus size={16} />} onClick={() => { form.resetFields(); setEditing({}); }}>
            Add
          </Button>
        )}
      </div>
      <div className="panel">
        {kind !== 'rates' && <Input.Search allowClear placeholder="Search" className="mb-3 max-w-xs" onSearch={(v) => { setQ(v); setPage(1); }} />}
        <Table
          size="small"
          rowKey="_id"
          loading={loading}
          dataSource={data?.items || []}
          scroll={{ x: 700 }}
          pagination={{ current: page, total: data?.total, pageSize: 25, onChange: setPage, showSizeChanger: false }}
          columns={[
            ...def.columns(ctx),
            ...(canWrite
              ? [{
                  title: '', width: 90,
                  render: (_: unknown, r: any) => (
                    <div className="flex gap-1">
                      <Button size="small" type="text" icon={<Pencil size={14} />} onClick={() => { form.resetFields(); form.setFieldsValue(def.toForm ? def.toForm(r) : r); setEditing(r); }} />
                      <Popconfirm title="Remove?" onConfirm={async () => { try { await api.delete(`${def.path}/${r._id}`); reload(); } catch (e) { message.error(errMsg(e)); } }}>
                        <Button size="small" type="text" danger icon={<Trash2 size={14} />} />
                      </Popconfirm>
                    </div>
                  ),
                }]
              : []),
          ]}
        />
      </div>
      <Modal open={!!editing} title={`${editing?._id ? 'Edit' : 'Add'} ${def.title.replace(/s$/, '').toLowerCase()}`} onCancel={() => setEditing(null)} onOk={save} okText="Save" width={720} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={kind === 'branches' ? { type: 'branch' } : kind === 'brokers' ? { commissionType: 'percent' } : kind === 'vehicles' ? { type: 'hired' } : { creditDays: 30 }}>
          <Row gutter={10}>
            {def.fields.map((f) => (
              <Col key={String(f.name)} xs={24} sm={f.span || 12}>
                <Form.Item name={f.name} label={f.label} rules={f.required ? [{ required: true }] : []} className="!mb-3">
                  {f.input(ctx)}
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
