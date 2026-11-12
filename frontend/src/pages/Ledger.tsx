import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Button, DatePicker, Empty, Segmented, Select, Table } from 'antd';
import { Printer, BellRing } from 'lucide-react';
import { type Dayjs } from 'dayjs';
import { api, errMsg, openPdf } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector, can, ACCOUNTS } from '../redux/store';
import { d, dt, inr2 } from '../utils/format';
import PartySelect from '../components/PartySelect';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Ledger() {
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const [sp, setSp] = useSearchParams();
  const kind = (sp.get('kind') as 'party' | 'broker') || 'party';
  const id = sp.get('id') || undefined;
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const brokers = useGet<{ items: any[] }>('/brokers', { limit: 200 }).data?.items || [];
  const params = { from: range?.[0].format('YYYY-MM-DD'), to: range?.[1].format('YYYY-MM-DD') };
  const { data, loading } = useGet<any>(id ? `/ledger/${kind}/${id}` : null, params);
  const set = (k: string, v?: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k === 'kind') n.delete('id'); setSp(n); };
  const side = (v: number) => (kind === 'party' ? (v >= 0 ? 'Dr' : 'Cr') : v >= 0 ? 'Cr' : 'Dr');
  const name = kind === 'party' ? data?.party?.name : data?.broker?.name;
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-3">
      <h1 className="page-title">Ledger</h1>
      <div className="panel flex flex-wrap items-center gap-2">
        <Segmented value={kind} onChange={(v) => set('kind', v as string)} options={[{ value: 'party', label: 'Party' }, { value: 'broker', label: 'Broker' }]} />
        {kind === 'party' ? (
          <PartySelect value={id} onChange={(v) => set('id', v)} className="min-w-[280px] flex-1" />
        ) : (
          <Select showSearch optionFilterProp="label" allowClear placeholder="Select broker" value={id} onChange={(v) => set('id', v)} className="min-w-[240px]"
            options={brokers.map((b) => ({ value: b._id, label: b.name }))} />
        )}
        <DatePicker.RangePicker format="DD MMM YY" value={range} onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} placeholder={['From (start)', 'To (today)']} />
        {id && <Button icon={<Printer size={15} />} onClick={() => openPdf(`/ledger/${kind}/${id}?pdf=1${qs ? '&' + qs : ''}`, `Ledger-${name}.pdf`)}>PDF</Button>}
        {id && kind === 'party' && can(user, ...ACCOUNTS) && (
          <Button icon={<BellRing size={15} />} onClick={async () => {
            try { const r = await api.post(`/parties/${id}/remind`); message.success(`${r.data.message}: ${inr2(r.data.data.amount)}`); }
            catch (e) { message.error(errMsg(e)); }
          }}>Send payment reminder</Button>
        )}
      </div>
      {!id ? (
        <Empty description={`Choose a ${kind} to see its account`} />
      ) : (
        <div className="panel">
          {data && (
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="kpi"><div className="label">Opening</div><div className="value !text-lg">{inr2(Math.abs(data.opening))} {side(data.opening)}</div></div>
              <div className="kpi"><div className="label">{kind === 'party' ? 'Billed (Dr)' : 'Paid (Dr)'}</div><div className="value !text-lg">{inr2(data.totalDebit)}</div></div>
              <div className="kpi"><div className="label">{kind === 'party' ? 'Received (Cr)' : 'Commission (Cr)'}</div><div className="value !text-lg">{inr2(data.totalCredit)}</div></div>
              <div className="kpi !border-emerald-600">
                <div className="label">Closing</div>
                <div className={`value !text-lg ${data.closing > 0 ? (kind === 'party' ? 'text-red-600' : 'text-amber-700') : ''}`}>{inr2(Math.abs(data.closing))} {side(data.closing)}</div>
                {kind === 'party' && data.unbilled > 0 && <div className="sub">+ {inr2(data.unbilled)} not yet billed</div>}
                {kind === 'party' && data.party?.lastReminderAt && <div className="sub">Last reminder {dt(data.party.lastReminderAt)}</div>}
              </div>
            </div>
          )}
          <Table
            size="small" rowKey="_id" loading={loading} pagination={false} scroll={{ x: 760 }}
            dataSource={data ? [{ _id: 'open', narration: 'Opening balance', balance: data.opening }, ...data.entries] : []}
            columns={[
              { title: 'Date', dataIndex: 'date', render: (v) => (v ? d(v) : '') },
              { title: 'Particulars', dataIndex: 'narration', render: (v, r: any) => <span className={r._id === 'open' ? 'font-semibold' : ''}>{v}</span> },
              { title: 'Ref', dataIndex: 'ref' },
              { title: 'Branch', render: (_, r: any) => r.branch?.code },
              { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => (v ? inr2(v) : '') },
              { title: 'Credit', dataIndex: 'credit', align: 'right', render: (v) => (v ? inr2(v) : '') },
              { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v) => <b>{inr2(Math.abs(v))} {side(v)}</b> },
            ]}
          />
        </div>
      )}
    </div>
  );
}
