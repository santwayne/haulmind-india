import { useState } from 'react';
import { App, Button, Col, Form, Input, Modal, Row, Select, Table, Tag } from 'antd';
import { Plus, Pencil } from 'lucide-react';
import { useBranches, useGet } from '../../api/hooks';
import { api, errMsg } from '../../api/client';
import { useAppSelector } from '../../redux/store';
import { dt, ROLE_LABEL } from '../../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Users() {
  const { message } = App.useApp();
  const me = useAppSelector((s) => s.auth.user)!;
  const branches = useBranches();
  const { data, loading, reload } = useGet<{ items: any[] }>('/users');
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const role = Form.useWatch('role', form);

  const save = async () => {
    const v = await form.validateFields();
    if (!v.password) delete v.password;
    try {
      if (editing._id) await api.put(`/users/${editing._id}`, v);
      else await api.post('/users', v);
      message.success('Saved');
      setEditing(null);
      reload();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const roles = Object.entries(ROLE_LABEL).filter(([k]) => k !== 'owner' || me.role === 'owner');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Staff & logins</h1>
        <Button type="primary" icon={<Plus size={16} />} onClick={() => { form.resetFields(); form.setFieldsValue({ role: 'booking_clerk', status: 'active' }); setEditing({}); }}>
          Add staff
        </Button>
      </div>
      <div className="panel">
        <Table
          size="small" rowKey="_id" loading={loading} dataSource={data?.items || []} scroll={{ x: 760 }} pagination={false}
          columns={[
            { title: 'Name', dataIndex: 'name', render: (v) => <b>{v}</b> },
            { title: 'User ID', dataIndex: 'username' },
            { title: 'Role', dataIndex: 'role', render: (v) => ROLE_LABEL[v] },
            { title: 'Branches', render: (_, r: any) => (['owner', 'admin'].includes(r.role) ? <Tag color="gold">All</Tag> : r.branches.map((b: any) => <Tag key={b._id}>{b.code}</Tag>)) },
            { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v}</Tag> },
            { title: 'Last login', dataIndex: 'lastLoginAt', render: dt },
            {
              title: '', width: 50,
              render: (_, r: any) => (
                <Button size="small" type="text" icon={<Pencil size={14} />} disabled={r.role === 'owner' && me.role !== 'owner'}
                  onClick={() => { form.resetFields(); form.setFieldsValue({ ...r, branches: r.branches.map((b: any) => b._id), password: '' }); setEditing(r); }} />
              ),
            },
          ]}
        />
      </div>
      <Modal open={!!editing} title={editing?._id ? `Edit ${editing.name}` : 'Add staff'} onCancel={() => setEditing(null)} onOk={save} okText="Save" destroyOnHidden>
        <Form form={form} layout="vertical">
          <Row gutter={10}>
            <Col xs={24} sm={12}><Form.Item name="name" label="Name" rules={[{ required: true }]} className="!mb-3"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="mobile" label="Mobile" className="!mb-3"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="username" label="User ID" rules={[{ required: true, pattern: /^[a-z0-9._-]{3,}$/i, message: 'Letters/numbers, min 3' }]} className="!mb-3"><Input disabled={!!editing?._id} autoCapitalize="none" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="password" label={editing?._id ? 'New password (leave blank to keep)' : 'Password'} rules={editing?._id ? [{ min: 6 }] : [{ required: true, min: 6 }]} className="!mb-3"><Input.Password autoComplete="new-password" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="role" label="Role" className="!mb-3"><Select options={roles.map(([k, v]) => ({ value: k, label: v }))} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="status" label="Status" className="!mb-3"><Select options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Blocked' }]} /></Form.Item></Col>
            {!['owner', 'admin'].includes(role) && (
              <Col span={24}>
                <Form.Item name="branches" label="Branches this person works in" rules={[{ required: true, message: 'Pick at least one branch' }]} className="!mb-0">
                  <Select mode="multiple" optionFilterProp="label" options={branches.map((b) => ({ value: b._id, label: `${b.name} (${b.code})` }))} />
                </Form.Item>
              </Col>
            )}
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
