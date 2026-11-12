import { useNavigate } from 'react-router-dom';
import { App, Button, Table, Tag } from 'antd';
import { BellRing } from 'lucide-react';
import dayjs from 'dayjs';
import { api, errMsg } from '../api/client';
import { useGet } from '../api/hooks';
import { useAppSelector, can, ACCOUNTS } from '../redux/store';
import { inr } from '../utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Outstanding() {
  const nav = useNavigate();
  const { message } = App.useApp();
  const user = useAppSelector((s) => s.auth.user);
  const branch = useAppSelector((s) => s.auth.branch);
  const { data, loading } = useGet<{ rows: any[]; totals: any }>('/reports/outstanding', { branch });
  const t = data?.totals || {};
  const remind = async (id: string) => {
    try { const r = await api.post(`/parties/${id}/remind`); message.success(r.data.message); }
    catch (e) { message.error(errMsg(e)); }
  };
  const csv = () => {
    const head = ['Party', 'Opening', '0-30', '31-60', '61-90', '90+', 'Overdue', 'On account', 'Net outstanding', 'Not billed', 'Oldest bill days'];
    const rows = (data?.rows || []).map((r) => [r.name, r.opening, r.b0_30, r.b31_60, r.b61_90, r.b90p, r.overdue, r.onAccount, r.net, r.unbilled, r.oldestDays]);
    const body = [head, ...rows].map((r) => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' }));
    a.download = `outstanding-${dayjs().format('YYYY-MM-DD')}.csv`;
    a.click();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Party outstanding</h1>
        <Button onClick={csv}>Download CSV</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="kpi"><div className="label">Net to receive</div><div className="value text-red-600">{inr(t.net)}</div></div>
        <div className="kpi"><div className="label">Overdue (past credit days)</div><div className="value">{inr(t.overdue)}</div></div>
        <div className="kpi"><div className="label">Over 90 days</div><div className="value">{inr(t.b90p)}</div></div>
        <div className="kpi"><div className="label">Advance on account</div><div className="value">{inr(t.onAccount)}</div></div>
        <div className="kpi"><div className="label">Not yet billed</div><div className="value">{inr(t.unbilled)}</div><div className="sub">TBB + credit to-pay LRs</div></div>
      </div>
      <div className="panel">
        <Table
          size="small" rowKey="party" loading={loading} dataSource={data?.rows || []} scroll={{ x: 1100 }}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          onRow={(r) => ({ onClick: () => nav(`/ledger?kind=party&id=${r.party}`), className: 'cursor-pointer' })}
          columns={[
            { title: 'Party', dataIndex: 'name', fixed: 'left', render: (v) => <b>{v}</b> },
            { title: 'Opening', dataIndex: 'opening', align: 'right', render: (v) => (v ? inr(v) : '') },
            { title: '0–30 d', dataIndex: 'b0_30', align: 'right', render: (v) => (v ? inr(v) : '') },
            { title: '31–60 d', dataIndex: 'b31_60', align: 'right', render: (v) => (v ? <span className="text-amber-700">{inr(v)}</span> : '') },
            { title: '61–90 d', dataIndex: 'b61_90', align: 'right', render: (v) => (v ? <span className="text-orange-600">{inr(v)}</span> : '') },
            { title: '90+ d', dataIndex: 'b90p', align: 'right', render: (v) => (v ? <b className="text-red-600">{inr(v)}</b> : '') },
            { title: 'On account', dataIndex: 'onAccount', align: 'right', render: (v) => (v ? `− ${inr(v)}` : '') },
            { title: 'Net', dataIndex: 'net', align: 'right', sorter: (a: any, b: any) => a.net - b.net, render: (v) => <b>{inr(v)}</b> },
            { title: 'Not billed', dataIndex: 'unbilled', align: 'right', render: (v) => (v ? <Tag>{inr(v)}</Tag> : '') },
            { title: 'Oldest', dataIndex: 'oldestDays', align: 'right', sorter: (a: any, b: any) => a.oldestDays - b.oldestDays, render: (v) => (v ? `${v} d` : '') },
            {
              title: '', width: 60,
              render: (_, r: any) => r.net > 0 && can(user, ...ACCOUNTS) ? (
                <Button size="small" title="Send WhatsApp/SMS payment reminder" icon={<BellRing size={14} />} onClick={(e) => { e.stopPropagation(); remind(r.party); }} />
              ) : null,
            },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><b>Total</b></Table.Summary.Cell>
              {['opening', 'b0_30', 'b31_60', 'b61_90', 'b90p', 'onAccount', 'net', 'unbilled'].map((k, i) => (
                <Table.Summary.Cell key={k} index={i + 1} align="right"><b>{inr(t[k])}</b></Table.Summary.Cell>
              ))}
              <Table.Summary.Cell index={9} colSpan={2} />
            </Table.Summary.Row>
          )}
        />
        <p className="mb-0 mt-2 text-xs text-slate-500">
          Ageing is counted from the bill date. Parties are reminded automatically every 15 days while money is pending.
        </p>
      </div>
    </div>
  );
}
