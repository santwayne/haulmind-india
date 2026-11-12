import { useState } from 'react';
import { Alert, App, Button, Checkbox, Segmented, Steps, Table, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { Download, Upload as UploadIcon, Eye, Database, FileArchive } from 'lucide-react';
import { api, errMsg } from '../api/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
const KINDS = [
  { value: 'parties', label: 'Parties', note: 'Party list with opening balance from Vouch (closing balance of the last year). + = party owes you.' },
  { value: 'brokers', label: 'Brokers', note: 'Brokers with commission rate and commission still owed to them.' },
  { value: 'lrs', label: 'Old LRs', note: 'Last year\'s LR register. Imported LRs are marked "already billed" unless you put N, so they are not billed again. No WhatsApp messages are sent.' },
  { value: 'money', label: 'Cash & bank', note: 'Cash boxes and bank accounts with their opening balance on the go-live date.' },
];

export default function ImportData() {
  const { message } = App.useApp();
  const [kind, setKind] = useState('parties');
  const [file, setFile] = useState<UploadFile | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zip, setZip] = useState<UploadFile | null>(null);
  const [podResult, setPodResult] = useState<any>(null);
  const k = KINDS.find((x) => x.value === kind)!;

  const download = async () => {
    const r = await api.get(`/import/template/${kind}`, { responseType: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.data);
    a.download = `haulmind-import-${kind}.xlsx`;
    a.click();
  };
  const send = async (commit: boolean) => {
    if (!file?.originFileObj) return;
    const fd = new FormData();
    fd.append('file', file.originFileObj);
    setBusy(true);
    try {
      const r = await api.post(`/import/${kind}?commit=${commit ? 1 : 0}${skipErrors ? '&skipErrors=1' : ''}`, fd);
      if (commit) { setResult(r.data.data); message.success(r.data.message); } else { setPreview(r.data.data); setResult(null); }
    } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
  };
  const reset = (v: string) => { setKind(v); setFile(null); setPreview(null); setResult(null); setSkipErrors(false); };

  return (
    <div className="space-y-3">
      <h1 className="page-title">Import data from Vouch</h1>
      <Alert type="info" showIcon message="Recommended order: Cash & bank → Brokers → Parties → Old LRs → POD files. Every import is checked first; nothing is saved until you press Import." />
      <div className="panel">
        <Segmented value={kind} onChange={(v) => reset(v as string)} options={KINDS.map((x) => ({ value: x.value, label: x.label }))} className="!mb-3" />
        <p className="text-sm text-slate-600">{k.note}</p>
        <Steps size="small" className="!mb-4" current={result ? 3 : preview ? 2 : file ? 1 : 0}
          items={[{ title: 'Template' }, { title: 'Upload' }, { title: 'Check' }, { title: 'Import' }]} />
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<Download size={15} />} onClick={download}>Download {k.label.toLowerCase()} template</Button>
          <Upload accept=".xlsx,.csv" maxCount={1} beforeUpload={() => false} fileList={file ? [file] : []}
            onChange={({ fileList }) => { setFile(fileList[0] || null); setPreview(null); setResult(null); }} onRemove={() => setFile(null)}>
            <Button icon={<UploadIcon size={15} />}>Choose Excel / CSV</Button>
          </Upload>
          <Button icon={<Eye size={15} />} disabled={!file} loading={busy && !preview} onClick={() => send(false)}>Check file</Button>
        </div>
        {preview && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>Rows: <b>{preview.totalRows}</b></span>
              <span className="text-emerald-700">Ready: <b>{preview.ready}</b></span>
              <span className="text-slate-500">Already present (skipped): <b>{preview.skipped}</b></span>
              <span className="text-red-600">With errors: <b>{preview.withErrors}</b></span>
            </div>
            <div className="text-xs text-slate-500">Columns understood: {preview.columnsFound.join(', ')}</div>
            {preview.errors.length > 0 && (
              <Table size="small" rowKey="row" pagination={{ pageSize: 10 }} dataSource={preview.errors}
                columns={[{ title: 'Excel row', dataIndex: 'row', width: 90 }, { title: 'Problem', dataIndex: 'errors', render: (v: string[]) => v.join(' · ') }]} />
            )}
            <div className="flex flex-wrap items-center gap-3">
              {preview.withErrors > 0 && <Checkbox checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)}>Skip rows with errors and import the rest</Checkbox>}
              <Button type="primary" icon={<Database size={15} />} disabled={!preview.ready || (preview.withErrors > 0 && !skipErrors)} loading={busy} onClick={() => send(true)}>
                Import {preview.ready} {k.label.toLowerCase()}
              </Button>
            </div>
          </div>
        )}
        {result && <Alert className="!mt-3" type="success" showIcon message={`${result.saved} saved. ${result.skipped} skipped (already present), ${result.withErrors} rows with errors left out.`} />}
      </div>
      <div className="panel">
        <div className="mb-1 font-bold">POD / DC files</div>
        <p className="text-sm text-slate-600">Put all scanned POD / DC PDFs or photos in one .zip. Each file name must contain the LR number (e.g. <code>TPR-0001.pdf</code> or <code>TPR-0001_POD.jpg</code>). Import the old LRs first.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Upload accept=".zip" maxCount={1} beforeUpload={() => false} fileList={zip ? [zip] : []} onChange={({ fileList }) => { setZip(fileList[0] || null); setPodResult(null); }}>
            <Button icon={<FileArchive size={15} />}>Choose .zip</Button>
          </Upload>
          <Button type="primary" disabled={!zip} loading={busy} onClick={async () => {
            const fd = new FormData();
            fd.append('file', zip!.originFileObj!);
            setBusy(true);
            try { const r = await api.post('/import/pod', fd); setPodResult(r.data.data); message.success(r.data.message); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
          }}>Attach to LRs</Button>
        </div>
        {podResult && (
          <div className="mt-3 text-sm">
            <div className="text-emerald-700">{podResult.matched.length} files attached.</div>
            {podResult.unmatched.length > 0 && <div className="text-red-600">No LR found for: {podResult.unmatched.slice(0, 30).join(', ')}{podResult.unmatched.length > 30 ? ' …' : ''}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
