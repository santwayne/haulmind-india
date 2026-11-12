import { useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
import { api } from '../api/client';

type P = { _id: string; name: string; mobile?: string; city?: string };

/** Searchable party picker (server search). value = party _id */
export default function PartySelect({
  value, onChange, placeholder = 'Search party by name or mobile', style, className, endpoint = '/parties',
}: {
  value?: string; onChange?: (v: string | undefined, p?: P) => void; placeholder?: string;
  style?: React.CSSProperties; className?: string; endpoint?: string;
}) {
  const [opts, setOpts] = useState<P[]>([]);
  const [loading, setLoading] = useState(false);
  const t = useRef<number>(0);

  const search = (q: string) => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get(endpoint, { params: { q, limit: 15 } });
        setOpts(r.data.data.items);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  // make sure a pre-selected party shows its name
  useEffect(() => {
    if (value && !opts.some((o) => o._id === value)) {
      api.get(`${endpoint}/${value}`).then((r) => setOpts((o) => [r.data.data, ...o])).catch(() => {});
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => search(''), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Select
      showSearch
      allowClear
      value={value}
      placeholder={placeholder}
      style={style}
      className={className}
      filterOption={false}
      loading={loading}
      onSearch={search}
      onChange={(v) => onChange?.(v, opts.find((o) => o._id === v))}
      options={opts.map((o) => ({ value: o._id, label: `${o.name}${o.mobile ? ' · ' + o.mobile : ''}${o.city ? ' · ' + o.city : ''}` }))}
      notFoundContent={loading ? 'Searching…' : 'No party found'}
    />
  );
}
