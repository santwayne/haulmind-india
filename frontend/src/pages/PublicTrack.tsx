import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Alert, Input, Spin, Steps, Timeline } from 'antd';
import { api, errMsg } from '../api/client';
import { d, dt, STATUS } from '../utils/format';
import { COMPANY, LOGO } from '../brand';

type Track = {
  lrNo: string; lrDate: string; status: string; from: string; to: string; currentBranch?: string;
  totalNag: number; consignor: string; consignee: string; deliveredAt?: string; receiverName?: string;
  history: { at: string; status: string; branch?: string; note?: string }[];
};

const STEP = ['booked', 'in_transit', 'arrived', 'delivered'];

export default function PublicTrack() {
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<Track | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const lr = sp.get('lr') || '';

  useEffect(() => {
    if (!lr) return;
    setLoading(true);
    setErr('');
    api.get(`/public/track/${encodeURIComponent(lr)}`)
      .then((r) => setData(r.data.data))
      .catch((e) => { setData(null); setErr(errMsg(e)); })
      .finally(() => setLoading(false));
  }, [lr]);

  const stepIdx = data ? Math.max(0, STEP.indexOf(data.status === 'at_branch' ? 'in_transit' : data.status)) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#065f46] to-[#0f1f17] px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-white p-1.5"><img src={LOGO} alt="HaulMind" className="h-10 w-auto" /></div>
          <div>
            <div className="text-lg font-bold text-white">{COMPANY}</div>
            <div className="text-sm text-emerald-200">Track your consignment</div>
          </div>
        </div>
        <Input.Search size="large" placeholder="Enter LR number e.g. TPR-2627-00012" defaultValue={lr} enterButton="Track"
          onSearch={(v) => v.trim() && setSp({ lr: v.trim().toUpperCase() })} />
        <div className="mt-4 rounded-xl bg-white p-5">
          {loading && <Spin />}
          {err && <Alert type="warning" message={err} />}
          {!lr && !loading && <p className="m-0 text-slate-500">Your LR number is printed on the bilty and in the WhatsApp message you received.</p>}
          {data && !loading && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xl font-extrabold">{data.lrNo}</div>
                <div className="font-semibold text-brand">{STATUS[data.status]?.label}</div>
              </div>
              <div className="mb-4 text-sm text-slate-500">
                {data.from} → {data.to} · {data.totalNag} nag · booked {d(data.lrDate)}
              </div>
              {data.status === 'cancelled' ? (
                <Alert type="error" message="This LR was cancelled" />
              ) : (
                <Steps size="small" current={stepIdx} responsive={false} labelPlacement="vertical" className="!mb-5"
                  items={[{ title: 'Booked' }, { title: 'On way' }, { title: 'Arrived' }, { title: 'Delivered' }]} />
              )}
              {data.status === 'delivered' && <Alert type="success" className="!mb-4" message={`Delivered to ${data.receiverName} on ${dt(data.deliveredAt)}`} />}
              <Timeline
                items={[...data.history].reverse().map((h) => ({
                  children: (
                    <div>
                      <div className="font-semibold">{STATUS[h.status]?.label || h.status}{h.branch ? ` · ${h.branch}` : ''}</div>
                      <div className="text-xs text-slate-500">{dt(h.at)}</div>
                    </div>
                  ),
                }))}
              />
            </>
          )}
        </div>
        <div className="mt-6 text-center text-sm">
          <Link to="/login" className="!text-emerald-200">Staff login</Link>
          <div className="mt-2 text-xs text-emerald-200/60">Powered by HaulMind India</div>
        </div>
      </div>
    </div>
  );
}
