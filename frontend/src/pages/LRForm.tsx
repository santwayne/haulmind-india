import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Col, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Spin, Tag } from 'antd';
import { Plus, Trash2, Printer } from 'lucide-react';
import { api, errMsg, openPdf } from '../api/client';
import { useBranches } from '../api/hooks';
import { useAppSelector } from '../redux/store';
import { inr2 } from '../utils/format';
import PartyFields from '../components/PartyFields';

type Item = { description?: string; packing?: string; nag?: number; actualWeight?: number; chargedWeight?: number };

// Same formula as backend services/freightService.js
const calc = (f: Record<string, number | string | undefined>, items: Item[]) => {
  const nag = items.reduce((s, i) => s + (Number(i?.nag) || 0), 0);
  const weight = items.reduce((s, i) => s + (Number(i?.chargedWeight) || Number(i?.actualWeight) || 0), 0);
  let basic = Number(f.basicFreight) || 0;
  const rate = Number(f.rate) || 0;
  if (f.basis === 'weight' && rate) basic = weight * rate;
  if (f.basis === 'nag' && rate) basic = nag * rate;
  if (f.minFreight && basic < Number(f.minFreight)) basic = Number(f.minFreight);
  const sub = basic + ['biltyCharge', 'hamali', 'doorDelivery', 'otherCharges'].reduce((s, k) => s + (Number(f[k]) || 0), 0);
  const gst = (sub * (Number(f.gstPercent) || 0)) / 100;
  return { nag, weight, basic, gst, total: sub + gst };
};

export default function LRForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user)!;
  const current = useAppSelector((s) => s.auth.branch);
  const branches = useBranches();
  const myBranches = user.allBranches ? branches : user.branches;
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [rateInfo, setRateInfo] = useState<string>('');
  const [brokers, setBrokers] = useState<{ _id: string; name: string }[]>([]);
  const [done, setDone] = useState<{ _id: string; lrNo: string; warning?: string } | null>(null);

  const items = Form.useWatch('items', form) || [];
  const freight = Form.useWatch('freight', form) || {};
  const bookingBranch = Form.useWatch('bookingBranch', form);
  const deliveryBranch = Form.useWatch('deliveryBranch', form);
  const consignorParty = Form.useWatch(['consignor', 'party'], form);
  const paymentType = Form.useWatch('paymentType', form);
  const totals = useMemo(() => calc(freight, items), [freight, items]);

  useEffect(() => {
    api.get('/brokers', { params: { limit: 200 } }).then((r) => setBrokers(r.data.data.items));
  }, []);

  useEffect(() => {
    if (!editing) return;
    api.get(`/lrs/${id}`).then((r) => {
      const lr = r.data.data;
      form.setFieldsValue({
        ...lr,
        bookingBranch: lr.bookingBranch._id,
        deliveryBranch: lr.deliveryBranch._id,
        broker: lr.broker?._id,
      });
      setLoading(false);
    });
  }, [editing, id, form]);

  // default booking branch = selected branch or user's first
  useEffect(() => {
    if (editing || form.getFieldValue('bookingBranch')) return;
    const def = current || myBranches[0]?._id;
    if (def) form.setFieldValue('bookingBranch', def);
  }, [current, myBranches, editing, form]);

  // auto rate when route / party changes
  useEffect(() => {
    if (!bookingBranch || !deliveryBranch || editing) return;
    api.get('/lrs/rate', { params: { fromBranch: bookingBranch, toBranch: deliveryBranch, party: consignorParty } }).then((r) => {
      const rt = r.data.data;
      if (rt.source === 'none') {
        setRateInfo('No saved rate for this route – enter manually');
        return;
      }
      const basis = rt.perKg ? 'weight' : rt.perNag ? 'nag' : 'fixed';
      form.setFieldsValue({
        freight: {
          ...form.getFieldValue('freight'),
          basis,
          rate: rt.perKg || rt.perNag || 0,
          minFreight: rt.minFreight,
          ...(rt.biltyCharge ? { biltyCharge: rt.biltyCharge } : {}),
        },
      });
      setRateInfo(`${rt.source === 'party' ? 'Party rate' : 'Route rate'}: ${rt.perKg ? `₹${rt.perKg}/kg` : `₹${rt.perNag}/nag`}${rt.minFreight ? `, min ₹${rt.minFreight}` : ''}`);
    });
  }, [bookingBranch, deliveryBranch, consignorParty, editing, form]);

  const submit = async (v: Record<string, unknown>) => {
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/lrs/${id}`, v);
        message.success('LR updated');
        nav(`/lrs/${id}`);
      } else {
        const r = await api.post('/lrs', v);
        setDone({ ...r.data.data.lr, warning: r.data.data.warning });
      }
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    const keep = form.getFieldValue('bookingBranch');
    form.resetFields();
    form.setFieldValue('bookingBranch', keep);
    setDone(null);
    window.scrollTo(0, 0);
  };

  if (loading) return <Spin />;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="page-title">{editing ? `Edit LR ${form.getFieldValue('lrNo') || ''}` : 'New LR booking'}</h1>
      </div>
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{
          paymentType: 'to_pay',
          paidMode: 'cash',
          deliveryType: 'godown',
          items: [{ nag: 1 }],
          freight: { basis: 'weight', rate: 0, biltyCharge: 0, hamali: 0, doorDelivery: 0, otherCharges: 0, gstPercent: 0 },
        }}
        scrollToFirstError
      >
        <div className="panel mb-3">
          <Row gutter={12}>
            <Col xs={12} md={6}>
              <Form.Item name="bookingBranch" label="Booking branch" rules={[{ required: true }]} className="!mb-2">
                <Select disabled={editing} options={myBranches.map((b) => ({ value: b._id, label: b.name }))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="deliveryBranch" label="Delivery branch" rules={[{ required: true, message: 'Select destination' }]} className="!mb-2">
                <Select showSearch optionFilterProp="label" options={branches.filter((b) => b._id !== bookingBranch).map((b) => ({ value: b._id, label: `${b.name} (${b.code})` }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item name="paymentType" label="Payment" className="!mb-2">
                <Radio.Group optionType="button" buttonStyle="solid" options={[{ value: 'paid', label: 'Paid' }, { value: 'to_pay', label: 'To Pay' }, { value: 'tbb', label: 'TBB' }]} />
              </Form.Item>
            </Col>
            {paymentType === 'paid' && (
              <Col xs={12} md={4}>
                <Form.Item name="paidMode" label="Paid by" className="!mb-2">
                  <Select options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank' }, { value: 'cheque', label: 'Cheque' }]} />
                </Form.Item>
              </Col>
            )}
            <Col xs={24} md={5}>
              <Form.Item name="deliveryType" label="Delivery" className="!mb-2">
                <Radio.Group optionType="button" options={[{ value: 'godown', label: 'Godown' }, { value: 'door', label: 'Door' }]} />
              </Form.Item>
            </Col>
          </Row>
        </div>

        <Row gutter={12}>
          <Col xs={24} md={12} className="mb-3">
            <PartyFields prefix="consignor" title="Consignor (sender)" />
          </Col>
          <Col xs={24} md={12} className="mb-3">
            <PartyFields prefix="consignee" title="Consignee (receiver)" />
          </Col>
        </Row>

        <div className="panel mb-3">
          <div className="mb-2 font-bold text-slate-800">Goods</div>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f, i) => (
                  <Row gutter={8} key={f.key} align="bottom" className={i ? 'border-t border-slate-100 pt-2' : ''}>
                    <Col xs={24} md={8}>
                      <Form.Item name={[f.name, 'description']} label={i ? undefined : 'Description of goods'} rules={[{ required: true, message: 'Required' }]} className="!mb-2">
                        <Input placeholder="e.g. Cotton hosiery" />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={4}>
                      <Form.Item name={[f.name, 'packing']} label={i ? undefined : 'Packing'} className="!mb-2">
                        <Select allowClear options={['Bale', 'Carton', 'Bag', 'Box', 'Roll', 'Loose'].map((x) => ({ value: x, label: x }))} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={3}>
                      <Form.Item name={[f.name, 'nag']} label={i ? undefined : 'Nag'} rules={[{ required: true }]} className="!mb-2">
                        <InputNumber min={0} className="!w-full" />
                      </Form.Item>
                    </Col>
                    <Col xs={10} md={4}>
                      <Form.Item name={[f.name, 'actualWeight']} label={i ? undefined : 'Actual wt (kg)'} className="!mb-2">
                        <InputNumber min={0} className="!w-full" />
                      </Form.Item>
                    </Col>
                    <Col xs={10} md={4}>
                      <Form.Item name={[f.name, 'chargedWeight']} label={i ? undefined : 'Charged wt (kg)'} className="!mb-2">
                        <InputNumber min={0} className="!w-full" placeholder="= actual" />
                      </Form.Item>
                    </Col>
                    <Col xs={4} md={1}>
                      <Button type="text" danger disabled={fields.length === 1} icon={<Trash2 size={16} />} onClick={() => remove(f.name)} className="!mb-2" />
                    </Col>
                  </Row>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button icon={<Plus size={15} />} onClick={() => add({ nag: 1 })}>
                    Add item
                  </Button>
                  <span className="font-semibold text-slate-700">
                    Total: {totals.nag} nag · {totals.weight} kg
                  </span>
                </div>
              </>
            )}
          </Form.List>
        </div>

        <Row gutter={12}>
          <Col xs={24} md={10} className="mb-3">
            <div className="panel h-full">
              <div className="mb-2 font-bold text-slate-800">Invoice & other</div>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item name="invoiceNo" label="Invoice no." className="!mb-2"><Input /></Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="invoiceValue" label="Invoice value" className="!mb-2"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="ewayBillNo" label="E-way bill no." className="!mb-2"><Input /></Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="broker" label="Broker" className="!mb-2">
                    <Select allowClear showSearch optionFilterProp="label" options={brokers.map((b) => ({ value: b._id, label: b.name }))} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="remarks" label="Remarks" className="!mb-0"><Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} /></Form.Item>
            </div>
          </Col>
          <Col xs={24} md={14} className="mb-3">
            <div className="panel h-full">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-800">Freight</span>
                {rateInfo && <Tag color="blue">{rateInfo}</Tag>}
              </div>
              <Row gutter={8}>
                <Col xs={12} sm={8}>
                  <Form.Item name={['freight', 'basis']} label="Basis" className="!mb-2">
                    <Select options={[{ value: 'weight', label: 'Per kg' }, { value: 'nag', label: 'Per nag' }, { value: 'fixed', label: 'Fixed amount' }]} />
                  </Form.Item>
                </Col>
                {freight.basis === 'fixed' ? (
                  <Col xs={12} sm={8}>
                    <Form.Item name={['freight', 'basicFreight']} label="Basic freight" className="!mb-2"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
                  </Col>
                ) : (
                  <Col xs={12} sm={8}>
                    <Form.Item name={['freight', 'rate']} label={freight.basis === 'nag' ? 'Rate / nag' : 'Rate / kg'} className="!mb-2"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
                  </Col>
                )}
                <Form.Item name={['freight', 'minFreight']} hidden><InputNumber /></Form.Item>
                <Col xs={12} sm={8}>
                  <Form.Item name={['freight', 'biltyCharge']} label="Bilty charge" className="!mb-2"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name={['freight', 'hamali']} label="Hamali" className="!mb-2"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name={['freight', 'doorDelivery']} label="Door delivery" className="!mb-2"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name={['freight', 'otherCharges']} label="Other" className="!mb-2"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name={['freight', 'gstPercent']} label="GST %" className="!mb-2">
                    <Select options={[0, 5, 12, 18].map((x) => ({ value: x, label: `${x}%` }))} />
                  </Form.Item>
                </Col>
              </Row>
              <div className="mt-1 flex items-end justify-between rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">
                  Basic {inr2(totals.basic)}{totals.gst ? ` + GST ${inr2(totals.gst)}` : ''}
                </div>
                <div className="text-xl font-extrabold text-brand">{inr2(totals.total)}</div>
              </div>
            </div>
          </Col>
        </Row>

        <div className="sticky bottom-0 z-10 -mx-3 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <Space className="w-full justify-end">
            <Button onClick={() => nav(-1)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={saving} size="large">
              {editing ? 'Save changes' : 'Book LR'}
            </Button>
          </Space>
        </div>
      </Form>

      <Modal
        open={!!done}
        closable={false}
        maskClosable={false}
        title={`LR ${done?.lrNo} booked`}
        footer={[
          <Button key="v" onClick={() => nav(`/lrs/${done?._id}`)}>View LR</Button>,
          <Button key="p" icon={<Printer size={15} />} onClick={() => done && openPdf(`/lrs/${done._id}/pdf`, `LR-${done.lrNo}.pdf`)}>Print bilty</Button>,
          <Button key="n" type="primary" onClick={reset}>Book next LR</Button>,
        ]}
      >
        {done?.warning && <p className="font-semibold text-red-600">⚠ {done.warning}</p>}
        <p>The consignor gets a WhatsApp/SMS with the tracking link (if mobile was entered).</p>
      </Modal>
    </div>
  );
}
