import dayjs from 'dayjs';

export const inr = (n?: number) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const inr2 = (n?: number) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n?: number) => Number(n || 0).toLocaleString('en-IN');
export const d = (v?: string | Date) => (v ? dayjs(v).format('DD MMM YYYY') : '—');
export const dt = (v?: string | Date) => (v ? dayjs(v).format('DD MMM, hh:mm A') : '—');

export const STATUS: Record<string, { label: string; color: string }> = {
  booked: { label: 'Booked', color: 'blue' },
  in_transit: { label: 'In transit', color: 'orange' },
  at_branch: { label: 'At hub / branch', color: 'gold' },
  arrived: { label: 'Arrived – to deliver', color: 'cyan' },
  delivered: { label: 'Delivered', color: 'green' },
  cancelled: { label: 'Cancelled', color: 'default' },
  partially_received: { label: 'Partly unloaded', color: 'gold' },
  received: { label: 'Unloaded', color: 'green' },
};

export const PAY: Record<string, string> = { paid: 'Paid', to_pay: 'To Pay', tbb: 'TBB' };
export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Head office admin',
  branch_manager: 'Branch manager',
  booking_clerk: 'Booking clerk',
  accountant: 'Accountant',
  viewer: 'Viewer',
};
