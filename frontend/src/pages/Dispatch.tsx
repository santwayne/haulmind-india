import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Col, Form, Input, InputNumber, Row, Select, Table, Tag } from 'antd';
import { Truck } from 'lucide-react';
import { api, errMsg, openPdf } from '../api/client';
import { useBranches, useGet } from '../api/hooks';
import { useAppSelector } from '../redux/store';
import { d, num, STATUS } from '../utils/format';

type Loadable = {
  _id: string; lrNo: string; lrDate: string; status: string; paymentType: string;
  consignor: { name: string }; consignee: { name: string };
  deliveryBranch: { _id: string; name: string; code: string };
  totalNag: number; totalWeight: number;
};

/** Dispatch + branch transfer on one screen: pick LRs lying here, choose next branch, load the truck. */
export default function Dispatch() {
  const nav = useNavigate();
  const { message, modal } = App.useApp();
  const user = useAppSelector((s) => s.auth.user)!;
  const current = useAppSelector((s) => s.auth.branch);
  const branches = useBranches();
  const mine = user.allBranches ? branches : user.branches;
  const [from, setFrom] = useState<string>(current || mine[0]?._id || '');
  const [filterTo, setFilterTo] = useState<string | undefined>();
  const [selected, setSelected] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { data, loading, reload } = useGet<{ items: Loadable[] }>(from ? '/challans/loadable' : null, { branch: from, toBranch: filterTo });

  useEffect(() => {
    if (!from && (current || mine[0]?._id)) setFrom(current || mine[0]._id);
  }, [current, mine, from]);
  useEffect(() => setSelected([]), [from, filterTo]);

  const rows = data?.items || [];
  const sel = useMemo(() => rows.filter((r) => selected.includes(r._id)), [rows, selected]);
  const toBranch = Form.useWatch('toBranch', form);
  const transfer = sel.some((r) => r.deliveryBranch._id !== toBranch);

  const submit = async (v: Record<string, unknown>) => {
    if (!sel.length) return message.warning('Select LRs to load');
    setSaving(true);
    try {
      const r = await api.post('/challans', { ...v, fromBranch: from, lrIds: selected });
      const ch = r.data.data;
      modal.success({
        title: `${ch.challanNo} created`,
        content: `${ch.lines.length} LR, ${ch.totalNag} nag loaded on ${ch.vehicleNo || 'vehicle'}. ${ch.toBranch.name} branch has been alerted.`,
        okText: 'Print challan',
        onOk: () => openPdf(`/challans/${ch._id}/pdf`, `${ch.challanNo}.pdf`),
      });
      form.resetFields();
      setSelected([]);
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
        <h1 className="page-title">Dispatch / branch transfer</h1>
        <Button onClick={() => nav('/challans')}>All challans</Button>
      </div>
      <div className="panel flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Loading at</span>
        <Select value={from} onChange={setFrom} className="min-w-[200px]" options={mine.map((b) => ({ value: b._id, label: b.name }))} />
        <span className="text-sm font-semibold">Show LRs for</span>
        <Select allowClear placeholder="All destinations" value={filterTo} onChange={setFilterTo} className="min-w-[180px]"
          options={branches.filter((b) => b._id !== from).map((b) => ({ value: b._id, label: b.name }))} />
      </div>

      <div className="panel">
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
          <span><b>{rows.length}</b> LR waiting at this branch</span>
          <span>Selected: <b>{sel.length}</b> LR · <b>{num(sel.reduce((s, r) => s + r.totalNag, 0))}</b> nag · <b>{num(sel.reduce((s, r) => s + r.totalWeight, 0))}</b> kg</span>
        </div>
        <Table<Loadable>
          size="small"
          rowKey="_id"
          loading={loading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 760, y: 420 }}
          rowSelection={{ selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]) }}
          columns={[
            { title: 'LR No.', dataIndex: 'lrNo', render: (v) => <b>{v}</b> },
            { title: 'Date', dataIndex: 'lrDate', render: d },
            { title: 'Final destination', render: (_, r) => r.deliveryBranch.name },
            { title: 'Consignee', render: (_, r) => r.consignee.name, ellipsis: true },
            { title: 'Nag', dataIndex: 'totalNag', align: 'right' },
            { title: 'Kg', dataIndex: 'totalWeight', align: 'right' },
            { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={STATUS[v].color}>{v === 'at_branch' ? 'Transit stock' : 'Fresh booking'}</Tag> },
          ]}
        />
      </div>

      <Form form={form} layout="vertical" onFinish={submit} className="panel">
        <div className="mb-2 font-bold text-slate-800">Truck details</div>
        <Row gutter={10}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="toBranch" label="Send to branch" rules={[{ required: true }]} className="!mb-3">
              <Select showSearch optionFilterProp="label" options={branches.filter((b) => b._id !== from).map((b) => ({ value: b._id, label: `${b.name} (${b.code})` }))} />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="vehicleNo" label="Vehicle no." rules={[{ required: true }]} className="!mb-3"><Input style={{ textTransform: 'uppercase' }} placeholder="PB10AB1234" /></Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="driverName" label="Driver" className="!mb-3"><Input /></Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="driverMobile" label="Driver mobile" className="!mb-3"><Input inputMode="numeric" maxLength={10} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="transporter" label="Transporter / owner" className="!mb-3"><Input /></Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="lorryHire" label="Lorry hire" className="!mb-3"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="advancePaid" label="Advance paid" className="!mb-3"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="remarks" label="Remarks" className="!mb-3"><Input /></Form.Item>
          </Col>
        </Row>
        {toBranch && sel.length > 0 && transfer && (
          <Alert type="info" showIcon className="!mb-3" message="Some selected LRs go further than this branch – this will be a branch transfer challan. They will wait there for the next truck." />
        )}
        <div className="flex justify-end">
          <Button type="primary" size="large" htmlType="submit" loading={saving} icon={<Truck size={17} />} disabled={!sel.length}>
            Create challan ({sel.length} LR)
          </Button>
        </div>
      </Form>
    </div>
  );
}
