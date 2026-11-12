import { useRef, useState } from 'react';
import { AutoComplete, Col, Form, Input, Row } from 'antd';
import { api } from '../api/client';

type Party = { _id: string; name: string; mobile?: string; address?: string; city?: string; gstin?: string };

/** Consignor / consignee block. Type a name or mobile → pick saved party, or keep typing a new one. */
export default function PartyFields({ prefix, title }: { prefix: 'consignor' | 'consignee'; title: string }) {
  const form = Form.useFormInstance();
  const [opts, setOpts] = useState<Party[]>([]);
  const timer = useRef<number>(0);

  const search = (q: string) => {
    window.clearTimeout(timer.current);
    if (q.length < 2) return setOpts([]);
    timer.current = window.setTimeout(async () => {
      const r = await api.get('/parties', { params: { q, limit: 8 } });
      setOpts(r.data.data.items);
    }, 250);
  };

  const pick = (id: string) => {
    const p = opts.find((o) => o._id === id);
    if (!p) return;
    form.setFieldsValue({
      [prefix]: { party: p._id, name: p.name, mobile: p.mobile, address: [p.address, p.city].filter(Boolean).join(', '), gstin: p.gstin },
    });
    form.validateFields([[prefix, 'name']]).catch(() => {});
  };

  return (
    <div className="panel">
      <div className="mb-2 font-bold text-slate-800">{title}</div>
      <Form.Item name={[prefix, 'party']} hidden>
        <Input />
      </Form.Item>
      <Form.Item name={[prefix, 'name']} label="Name" rules={[{ required: true, message: 'Enter name' }]} className="!mb-3">
        <AutoComplete
          options={opts.map((o) => ({ value: o._id, label: <div><b>{o.name}</b> <span className="text-slate-500">{o.mobile} {o.city}</span></div> }))}
          onSearch={search}
          onSelect={pick}
          onChange={(v) => {
            // typing a new name clears the link to a saved party
            if (!opts.some((o) => o._id === v)) form.setFieldValue([prefix, 'party'], undefined);
          }}
          placeholder="Search saved party or type new name"
        />
      </Form.Item>
      <Row gutter={10}>
        <Col xs={24} sm={12}>
          <Form.Item name={[prefix, 'mobile']} label="Mobile (for WhatsApp)" rules={[{ pattern: /^[6-9]\d{9}$/, message: '10 digit mobile' }]} className="!mb-3">
            <Input inputMode="numeric" maxLength={10} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name={[prefix, 'gstin']} label="GSTIN" className="!mb-3">
            <Input maxLength={15} style={{ textTransform: 'uppercase' }} />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name={[prefix, 'address']} label="Address" className="!mb-0">
        <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} />
      </Form.Item>
    </div>
  );
}
