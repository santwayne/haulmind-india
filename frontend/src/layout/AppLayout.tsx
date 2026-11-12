import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Drawer, Dropdown, Grid, Input, Layout, Menu, Popover, Select, List, message } from 'antd';
import {
  LayoutDashboard, FilePlus2, FileText, Truck, PackageOpen, PackageCheck, BarChart3, Building2,
  Users as UsersIcon, Contact, Car, IndianRupee, History, Bell, LogOut, Menu as MenuIcon, Search, KeyRound, Handshake,
  Receipt, BookOpen, Wallet, ReceiptText, Clock, Landmark, NotebookPen, Truck as TruckIcon, TrendingUp, HandCoins, FileUp,
} from 'lucide-react';
import { api, errMsg } from '../api/client';
import { useBranches } from '../api/hooks';
import { loggedOut, setBranch, useAppDispatch, useAppSelector, OPS, HQ, ACCOUNTS, can } from '../redux/store';
import { dt, ROLE_LABEL } from '../utils/format';
import ChangePassword from '../components/ChangePassword';
import { COMPANY, LOGO } from '../brand';

const { Sider, Header, Content } = Layout;

type Alert = { _id: string; title: string; body: string; link: string; read: boolean; createdAt: string; branch?: { code: string } };

export default function AppLayout() {
  const user = useAppSelector((s) => s.auth.user)!;
  const branch = useAppSelector((s) => s.auth.branch);
  const dispatch = useAppDispatch();
  const nav = useNavigate();
  const loc = useLocation();
  const screens = Grid.useBreakpoint();
  const mobile = !screens.lg;
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [alerts, setAlerts] = useState<{ items: Alert[]; unread: number }>({ items: [], unread: 0 });
  const allBranches = useBranches();
  const branchOptions = user.allBranches ? allBranches : user.branches;

  useEffect(() => {
    const load = () => api.get('/alerts', { params: branch ? { branch } : {} }).then((r) => setAlerts(r.data.data)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [branch]);

  const ops = can(user, ...OPS);
  const items = [
    { key: '/', icon: <LayoutDashboard size={17} />, label: 'Dashboard' },
    ops && { key: '/lrs/new', icon: <FilePlus2 size={17} />, label: 'New LR booking' },
    { key: '/lrs', icon: <FileText size={17} />, label: 'LR register' },
    ops && { key: '/dispatch', icon: <Truck size={17} />, label: 'Dispatch / transfer' },
    { key: '/challans', icon: <FileText size={17} />, label: 'Challans' },
    ops && { key: '/unloading', icon: <PackageOpen size={17} />, label: 'Unloading' },
    ops && { key: '/delivery', icon: <PackageCheck size={17} />, label: 'Delivery' },
    { key: '/reports', icon: <BarChart3 size={17} />, label: 'Reports' },
    can(user, ...ACCOUNTS, 'viewer') && {
      key: 'accounts', icon: <Wallet size={17} />, label: 'Accounts',
      children: [
        { key: '/billing', icon: <ReceiptText size={15} />, label: 'Billing' },
        { key: '/receipts', icon: <Receipt size={15} />, label: 'Payments received' },
        { key: '/outstanding', icon: <Clock size={15} />, label: 'Outstanding' },
        { key: '/ledger', icon: <BookOpen size={15} />, label: 'Ledger' },
        { key: '/brokers', icon: <Handshake size={15} />, label: 'Broker commission' },
        { key: '/cashbook', icon: <Landmark size={15} />, label: 'Cash & bank book' },
        { key: '/vouchers', icon: <NotebookPen size={15} />, label: 'Expenses & income' },
        { key: '/lorry-hire', icon: <TruckIcon size={15} />, label: 'Lorry hire' },
        { key: '/payables', icon: <HandCoins size={15} />, label: 'To pay' },
        { key: '/profit-loss', icon: <TrendingUp size={15} />, label: 'Profit & loss' },
      ],
    },
    {
      key: 'masters', icon: <Building2 size={17} />, label: 'Masters',
      children: [
        { key: '/masters/parties', icon: <Contact size={15} />, label: 'Parties' },
        { key: '/masters/brokers', icon: <Handshake size={15} />, label: 'Brokers' },
        { key: '/masters/vehicles', icon: <Car size={15} />, label: 'Vehicles' },
        { key: '/masters/branches', icon: <Building2 size={15} />, label: 'Branches' },
        { key: '/masters/rates', icon: <IndianRupee size={15} />, label: 'Route rates' },
      ],
    },
    can(user, ...HQ) && { key: '/users', icon: <UsersIcon size={17} />, label: 'Staff & logins' },
    can(user, ...HQ) && { key: '/import', icon: <FileUp size={17} />, label: 'Import from Vouch' },
    can(user, ...HQ) && { key: '/audit', icon: <History size={17} />, label: 'Audit & messages' },
  ].filter(Boolean) as never[];

  const selected = items
    .flatMap((i: { key: string; children?: { key: string }[] }) => [i, ...(i.children || [])])
    .map((i) => i.key)
    .filter((k) => k === '/' ? loc.pathname === '/' : loc.pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];

  const menu = (
    <Menu
      theme="light"
      mode="inline"
      style={{ borderInlineEnd: 0 }}
      selectedKeys={[selected || '/']}
      defaultOpenKeys={loc.pathname.startsWith('/masters') ? ['masters'] : ['/billing', '/receipts', '/outstanding', '/ledger', '/brokers', '/cashbook', '/vouchers', '/lorry-hire', '/payables', '/profit-loss'].some((k) => loc.pathname.startsWith(k)) ? ['accounts'] : []}
      items={items}
      onClick={(e) => {
        nav(e.key);
        setOpen(false);
      }}
    />
  );

  const brand = (
    <Link to="/" className="block border-b border-[#e2ece6] px-4 pb-3 pt-4 no-underline">
      <img src={LOGO} alt="HaulMind" className="mx-auto h-14 w-auto" />
      <div className="mt-2 truncate text-center text-[13px] font-semibold text-[#0f1f17]">{COMPANY}</div>
    </Link>
  );

  const searchLR = async (v: string) => {
    if (!v.trim()) return;
    try {
      const r = await api.get(`/lrs/by-no/${encodeURIComponent(v.trim())}`);
      nav(`/lrs/${r.data.data._id}`);
    } catch (e) {
      message.warning(errMsg(e));
    }
  };

  return (
    <Layout className="min-h-screen">
      {mobile ? (
        <Drawer open={open} onClose={() => setOpen(false)} placement="left" width={250} styles={{ body: { padding: 0, background: '#fff' }, header: { display: 'none' } }}>
          {brand}
          {menu}
        </Drawer>
      ) : (
        <Sider width={228} className="!fixed left-0 top-0 h-screen overflow-auto border-r border-[#e2ece6]">
          {brand}
          {menu}
        </Sider>
      )}
      <Layout style={{ marginLeft: mobile ? 0 : 228 }}>
        <Header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 !px-3 sm:!px-5" style={{ height: 56, lineHeight: '56px' }}>
          {mobile && <Button type="text" icon={<MenuIcon size={20} />} onClick={() => setOpen(true)} />}
          <Select
            value={branch}
            onChange={(v) => dispatch(setBranch(v))}
            className="min-w-[150px] sm:min-w-[200px]"
            options={[
              ...(user.allBranches ? [{ value: '', label: 'All branches' }] : []),
              ...branchOptions.map((b) => ({ value: b._id, label: `${b.name} (${b.code})` })),
            ]}
          />
          <Input
            allowClear
            prefix={<Search size={15} className="text-slate-400" />}
            placeholder="LR number…"
            className="!hidden max-w-[220px] sm:!flex"
            onPressEnter={(e) => searchLR((e.target as HTMLInputElement).value)}
          />
          <div className="flex-1" />
          <Popover
            trigger="click"
            placement="bottomRight"
            title={
              <div className="flex items-center justify-between">
                <span>Branch alerts</span>
                <Button size="small" type="link" onClick={() => api.post('/alerts/read', null, { params: branch ? { branch } : {} }).then(() => setAlerts((a) => ({ ...a, unread: 0 })))}>
                  Mark all read
                </Button>
              </div>
            }
            content={
              <List
                className="max-h-80 w-[300px] overflow-auto"
                dataSource={alerts.items}
                locale={{ emptyText: 'No alerts' }}
                renderItem={(a) => (
                  <List.Item className={a.read ? '' : 'bg-amber-50'} style={{ paddingInline: 8 }}>
                    <Link to={a.link}>
                      <div className="text-[13px] font-semibold text-slate-800">{a.title}</div>
                      <div className="text-xs text-slate-500">{a.body}</div>
                      <div className="text-[11px] text-slate-400">{a.branch?.code} · {dt(a.createdAt)}</div>
                    </Link>
                  </List.Item>
                )}
              />
            }
          >
            <Badge count={alerts.unread} size="small">
              <Button type="text" icon={<Bell size={19} />} />
            </Badge>
          </Popover>
          <Dropdown
            menu={{
              items: [
                { key: 'role', label: <span className="text-xs text-slate-500">{ROLE_LABEL[user.role]}</span>, disabled: true },
                { key: 'pw', icon: <KeyRound size={14} />, label: 'Change password', onClick: () => setPwOpen(true) },
                { key: 'out', icon: <LogOut size={14} />, label: 'Log out', onClick: () => { dispatch(loggedOut()); nav('/login'); } },
              ],
            }}
          >
            <Button type="text" className="!font-semibold">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs text-white">{user.name.slice(0, 1)}</span>
              <span className="hidden sm:inline">{user.name}</span>
            </Button>
          </Dropdown>
        </Header>
        <Content className="p-3 sm:p-5">
          <Outlet />
        </Content>
      </Layout>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </Layout>
  );
}
