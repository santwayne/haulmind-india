import axios from 'axios';

// Same idea as Logistiq's src/axios/apiClient.ts: one axios instance, token from storage,
// auto-logout on 401.
export const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';
export const FILE_BASE = import.meta.env.VITE_FILE_BASE || '';

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('tcl_token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  if (cfg.data instanceof FormData) delete cfg.headers['Content-Type'];
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.startsWith('/login') && !location.pathname.startsWith('/track')) {
      localStorage.removeItem('tcl_token');
      localStorage.removeItem('tcl_user');
      location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e: unknown) =>
  (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ||
  (e as Error)?.message ||
  'Something went wrong';

// Open a PDF endpoint (needs auth header, so fetch as blob)
export const openPdf = async (path: string, filename = 'document.pdf', download = false) => {
  const r = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } else {
    window.open(url, '_blank');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
