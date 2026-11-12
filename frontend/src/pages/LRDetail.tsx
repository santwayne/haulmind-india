import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Descriptions, Dropdown, Input, Modal, Skeleton, Table, Tag, Timeline } from 'antd';
import { Printer, Pencil, Ban, PackageCheck, FileDown } from 'lucide-react';
import { useGet } from '../api/hooks';
import { api, errMsg, openPdf, FILE_BASE } from '../api/client';
import { useAppSelector, can, OPS, MANAGERS } from '../redux/store';
import { d, dt, inr2, PAY, STATUS } from '../utils/format';
import DeliverModal from '../components/DeliverModal';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function LRDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const { data: lr, loading, reload } = useGet<any>(`/lrs/${id}`);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [deliverOpen, setDeliverOpen] = useState(false);

  if (loading && !lr) return <Skeleton active />;
  if (!lr) return null;
  const f = lr.freight;

  const pdf = (copy?: string) => openPdf(`/lrs/${lr._id}/pdf${copy ? `?copy=${copy}` : ''}`, `LR-${lr.lrNo}.pdf`);

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">LR {lr.lrNo}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            <Tag color={STATUS[lr.status]?.color}>{STATUS[lr.status]?.label}</Tag>
            {d(lr.lrDate)} · {lr.bookingBranch.name} → {lr.deliveryBranch.name}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dropdown.Button
            icon={<Printer size={15} />}
            onClick={() => pdf()}
            menu={{
              items: [
                { key: 'consignor', label: 'Consignor copy only' },
                { key: 'consignee', label: 'Consignee copy only' },
                { key: 'office', label: 'Office copy only' },
              ],
              onClick: (e) => pdf(e.key),
            }}
          >
            Print bilty
          </Dropdown.Button>
          {lr.status === 'delivered' && (
            <Button icon={<FileDown size={15} />} onClick={() => openPdf(`/lrs/${lr._id}/dc-pdf`, `${lr.delivery.dcNo}.pdf`)}>
              Delivery challan
            </Button>
          )}
          {lr.status === 'booked' && can(user, ...OPS) && (
            <Button icon={<Pencil size={15} />} onClick={() => nav(`/lrs/${lr._id}/edit`)}>Edit</Button>
          )}
          {lr.status === 'booked' && can(user, ...MANAGERS) && (
            <Button danger icon={<Ban size={15} />} onClick={() => setCancelOpen(true)}>Cancel</Button>
          )}
          {lr.status === 'arrived' && can(user, ...OPS) && (
            <Button type="primary" icon={<PackageCheck size={15} />} onClick={() => setDeliverOpen(true)}>Deliver</Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="panel">
          <div className="mb-1 text-xs font-bold uppercase text-slate-500">Consignor</div>
          <div className="font-bold">{lr.consignor.name}</div>
          <div className="text-sm text-slate-600">{lr.consignor.address}</div>
          <div className="text-sm text-slate-600">{lr.consignor.mobile} {lr.consignor.gstin && `· ${lr.consignor.gstin}`}</div>
        </div>
        <div className="panel">
          <div className="mb-1 text-xs font-bold uppercase text-slate-500">Consignee</div>
          <div className="font-bold">{lr.consignee.name}</div>
          <div className="text-sm text-slate-600">{lr.consignee.address}</div>
          <div className="text-sm text-slate-600">{lr.consignee.mobile} {lr.consignee.gstin && `· ${lr.consignee.gstin}`}</div>
        </div>
      </div>

      <div className="panel">
        <Table
          size="small"
          pagination={false}
          rowKey={(_, i) => String(i)}
          dataSource={lr.items}
          scroll={{ x: 520 }}
          columns={[
            { title: 'Goods', dataIndex: 'description' },
            { title: 'Packing', dataIndex: 'packing' },
            { title: 'Nag', dataIndex: 'nag', align: 'right' },
            { title: 'Actual kg', dataIndex: 'actualWeight', align: 'right' },
            { title: 'Charged kg', align: 'right', render: (_: unknown, r: any) => r.chargedWeight || r.actualWeight },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}><b>Total</b></Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right"><b>{lr.totalNag}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={3} colSpan={2} align="right"><b>{lr.totalWeight} kg</b></Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="panel">
          <Descriptions size="small" column={1} title="Freight">
            <Descriptions.Item label="Payment">{PAY[lr.paymentType]}</Descriptions.Item>
            <Descriptions.Item label="Basic">{inr2(f.basicFreight)} {f.rate ? `(₹${f.rate}/${f.basis === 'nag' ? 'nag' : 'kg'})` : ''}</Descriptions.Item>
            {f.biltyCharge > 0 && <Descriptions.Item label="Bilty">{inr2(f.biltyCharge)}</Descriptions.Item>}
            {f.hamali > 0 && <Descriptions.Item label="Hamali">{inr2(f.hamali)}</Descriptions.Item>}
            {f.doorDelivery > 0 && <Descriptions.Item label="Door delivery">{inr2(f.doorDelivery)}</Descriptions.Item>}
            {f.otherCharges > 0 && <Descriptions.Item label="Other">{inr2(f.otherCharges)}</Descriptions.Item>}
            {f.gstAmount > 0 && <Descriptions.Item label={`GST ${f.gstPercent}%`}>{inr2(f.gstAmount)}</Descriptions.Item>}
            <Descriptions.Item label="Total"><b className="text-brand">{inr2(f.total)}</b></Descriptions.Item>
          </Descriptions>
          <Descriptions size="small" column={1} className="mt-2">
            {lr.invoiceNo && <Descriptions.Item label="Invoice">{lr.invoiceNo} {lr.invoiceValue ? `· ${inr2(lr.invoiceValue)}` : ''}</Descriptions.Item>}
            {lr.ewayBillNo && <Descriptions.Item label="E-way bill">{lr.ewayBillNo}</Descriptions.Item>}
            {lr.broker && <Descriptions.Item label="Broker">{lr.broker.name}</Descriptions.Item>}
            {lr.remarks && <Descriptions.Item label="Remarks">{lr.remarks}</Descriptions.Item>}
            {lr.cancelReason && <Descriptions.Item label="Cancelled">{lr.cancelReason}</Descriptions.Item>}
          </Descriptions>
        </div>
        <div className="panel">
          <div className="mb-3 font-bold text-slate-800">Journey</div>
          <Timeline
            items={[...lr.history].reverse().map((h: any) => ({
              color: h.status === 'delivered' ? 'green' : h.status === 'cancelled' ? 'gray' : 'blue',
              children: (
                <div>
                  <div className="font-semibold">{STATUS[h.status]?.label || h.status} {h.branch && <span className="text-slate-500">· {h.branch.name}</span>}</div>
                  <div className="text-sm text-slate-600">{h.note} {h.ref && <Tag className="!ml-1">{h.ref}</Tag>}</div>
                  <div className="text-xs text-slate-400">{dt(h.at)} {h.by && `· ${h.by.name}`}</div>
                </div>
              ),
            }))}
          />
        </div>
      </div>

      {lr.status === 'delivered' && (
        <div className="panel">
          <Descriptions size="small" title={`Delivered · ${lr.delivery.dcNo}`} column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Receiver">{lr.delivery.receiverName} {lr.delivery.receiverMobile}</Descriptions.Item>
            <Descriptions.Item label="When">{dt(lr.delivery.at)}</Descriptions.Item>
            <Descriptions.Item label="Nag delivered">{lr.delivery.deliveredNag} / {lr.totalNag}</Descriptions.Item>
            <Descriptions.Item label="Collected">{inr2(lr.delivery.collectedAmount)} {lr.delivery.collectionMode !== 'none' && `(${lr.delivery.collectionMode})`}</Descriptions.Item>
          </Descriptions>
          <div className="mt-2 flex flex-wrap gap-2">
            {lr.delivery.podFiles?.map((p: string, i: number) => (
              <a key={p} href={FILE_BASE + p} target="_blank" rel="noreferrer">
                {/\.pdf$/i.test(p) ? <Tag color="blue">POD {i + 1} (PDF)</Tag> : <img src={FILE_BASE + p} alt="POD" className="h-24 rounded border object-cover" />}
              </a>
            ))}
            {lr.delivery.signature && <img src={lr.delivery.signature} alt="signature" className="h-24 rounded border bg-white" />}
          </div>
        </div>
      )}

      <Modal
        title={`Cancel LR ${lr.lrNo}?`}
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        okText="Cancel LR"
        onOk={async () => {
          try {
            await api.post(`/lrs/${lr._id}/cancel`, { reason });
            message.success('LR cancelled');
            setCancelOpen(false);
            reload();
          } catch (e) {
            message.error(errMsg(e));
          }
        }}
      >
        <Input.TextArea placeholder="Reason (saved in audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
      <DeliverModal lr={deliverOpen ? lr : null} onClose={() => setDeliverOpen(false)} onDone={reload} />
    </div>
  );
}
