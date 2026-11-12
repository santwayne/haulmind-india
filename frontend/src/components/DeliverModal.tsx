import { useEffect, useState } from 'react';
import { App, Checkbox, Col, Form, Input, InputNumber, Modal, Row, Select, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { Camera } from 'lucide-react';
import { api, errMsg, openPdf } from '../api/client';
import { inr2 } from '../utils/format';
import SignaturePad from './SignaturePad';

type LRLite = {
  _id: string; lrNo: string; paymentType: string; totalNag: number;
  freight: { total: number }; consignee: { name: string; mobile?: string };
  received?: { nag?: number; shortNag?: number; damagedNag?: number };
};

export default function DeliverModal({ lr, onClose, onDone }: { lr: LRLite | null; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [signature, setSignature] = useState('');
  const [saving, setSaving] = useState(false);
  const toPay = lr?.paymentType === 'to_pay';

  useEffect(() => {
    if (!lr) return;
    form.setFieldsValue({
      receiverName: lr.consignee.name,
      receiverMobile: lr.consignee.mobile,
      deliveredNag: lr.received?.nag ?? lr.totalNag,
      collectedAmount: toPay ? lr.freight.total : 0,
      collectionMode: toPay ? 'cash' : 'none',
      allowCredit: false,
    });
    setFiles([]);
    setSignature('');
  }, [lr, form, toPay]);

  const submit = async () => {
    const v = await form.validateFields();
    const fd = new FormData();
    Object.entries(v).forEach(([k, val]) => val != null && fd.append(k, String(val)));
    if (signature) fd.append('signature', signature);
    files.forEach((f) => f.originFileObj && fd.append('pod', f.originFileObj));
    setSaving(true);
    try {
      const r = await api.post(`/lrs/${lr!._id}/deliver`, fd);
      message.success(r.data.message);
      onClose();
      onDone();
      openPdf(`/lrs/${lr!._id}/dc-pdf`, `${r.data.data.delivery.dcNo}.pdf`);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!lr} title={`Deliver LR ${lr?.lrNo}`} onCancel={onClose} onOk={submit} okText="Confirm delivery" confirmLoading={saving} destroyOnHidden width={560}>
      {lr?.received?.shortNag || lr?.received?.damagedNag ? (
        <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          At unloading: {lr.received.shortNag || 0} short, {lr.received.damagedNag || 0} damaged.
        </div>
      ) : null}
      <Form form={form} layout="vertical">
        <Row gutter={10}>
          <Col xs={24} sm={14}>
            <Form.Item name="receiverName" label="Received by" rules={[{ required: true }]} className="!mb-3"><Input /></Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="receiverMobile" label="Mobile" className="!mb-3"><Input inputMode="numeric" maxLength={10} /></Form.Item>
          </Col>
          <Col xs={8}>
            <Form.Item name="deliveredNag" label="Nag delivered" className="!mb-3"><InputNumber min={0} max={lr?.totalNag} className="!w-full" /></Form.Item>
          </Col>
          <Col xs={8}>
            <Form.Item name="collectedAmount" label={toPay ? `Collect (${inr2(lr?.freight.total)})` : 'Collected'} className="!mb-3"><InputNumber min={0} prefix="₹" className="!w-full" /></Form.Item>
          </Col>
          <Col xs={8}>
            <Form.Item name="collectionMode" label="Mode" className="!mb-3">
              <Select options={['cash', 'upi', 'bank', 'cheque', 'none'].map((x) => ({ value: x, label: x.toUpperCase() }))} />
            </Form.Item>
          </Col>
        </Row>
        {toPay && (
          <Form.Item name="allowCredit" valuePropName="checked" className="!mb-3">
            <Checkbox>Deliver without collecting (party will pay later)</Checkbox>
          </Form.Item>
        )}
        <Form.Item name="remark" label="Remark" className="!mb-3"><Input /></Form.Item>
      </Form>
      <div className="mb-1 text-sm font-semibold">POD photo / PDF</div>
      <Upload
        listType="picture-card"
        accept="image/*,application/pdf"
        capture="environment"
        fileList={files}
        beforeUpload={() => false}
        onChange={({ fileList }) => setFiles(fileList.slice(0, 5))}
      >
        {files.length < 5 && (
          <div className="flex flex-col items-center text-xs text-slate-500">
            <Camera size={18} />
            Add
          </div>
        )}
      </Upload>
      <div className="mb-1 mt-3 text-sm font-semibold">Receiver signature</div>
      <SignaturePad onChange={setSignature} />
    </Modal>
  );
}
