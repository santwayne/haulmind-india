import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';

export type Branch = { _id: string; name: string; code: string; type?: 'hub' | 'branch' };
export type User = {
  _id: string;
  name: string;
  username: string;
  role: 'owner' | 'admin' | 'branch_manager' | 'booking_clerk' | 'accountant' | 'viewer';
  branches: Branch[];
  allBranches: boolean;
};

const read = <T,>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};

type AuthState = { user: User | null; token: string | null; branch: string };

const auth = createSlice({
  name: 'auth',
  initialState: {
    user: read<User>('tcl_user'),
    token: localStorage.getItem('tcl_token'),
    branch: localStorage.getItem('tcl_branch') || '',
  } as AuthState,
  reducers: {
    loggedIn(s, a: PayloadAction<{ user: User; token: string }>) {
      s.user = a.payload.user;
      s.token = a.payload.token;
      localStorage.setItem('tcl_user', JSON.stringify(a.payload.user));
      localStorage.setItem('tcl_token', a.payload.token);
      // single-branch staff: lock to their branch
      s.branch = a.payload.user.allBranches ? '' : a.payload.user.branches[0]?._id || '';
      localStorage.setItem('tcl_branch', s.branch);
    },
    loggedOut(s) {
      s.user = null;
      s.token = null;
      s.branch = '';
      ['tcl_user', 'tcl_token', 'tcl_branch'].forEach((k) => localStorage.removeItem(k));
    },
    setBranch(s, a: PayloadAction<string>) {
      s.branch = a.payload;
      localStorage.setItem('tcl_branch', a.payload);
    },
  },
});

export const { loggedIn, loggedOut, setBranch } = auth.actions;

export const store = configureStore({ reducer: { auth: auth.reducer } });
export type RootState = ReturnType<typeof store.getState>;
export const useAppDispatch = () => useDispatch<typeof store.dispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export const can = (u: User | null, ...roles: User['role'][]) => !!u && roles.includes(u.role);
export const OPS: User['role'][] = ['owner', 'admin', 'branch_manager', 'booking_clerk'];
export const MANAGERS: User['role'][] = ['owner', 'admin', 'branch_manager'];
export const HQ: User['role'][] = ['owner', 'admin'];
