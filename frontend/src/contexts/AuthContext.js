import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = not authenticated
  const [loading, setLoading] = useState(true);
  const [perms, setPerms] = useState(null); // this role's switches from Settings → Permissions (null = loading)

  const loadPerms = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/permissions/me`, { withCredentials: true });
      setPerms(data.permissions || {});
    } catch (error) {
      setPerms({});
    }
  }, []);

  useEffect(() => {
    if (user) loadPerms();
    else setPerms(null);
  }, [user, loadPerms]);

  // An admin may change permissions while someone has the app open — pick that up when they come back to it.
  useEffect(() => {
    if (!user || user.role === 'admin') return undefined;
    let last = Date.now();
    const onFocus = () => { if (Date.now() - last > 30000) { last = Date.now(); loadPerms(); } };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, loadPerms]);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/auth/me`, {
        withCredentials: true
      });
      setUser(data);
    } catch (error) {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (email, password) => {
    const { data } = await axios.post(`${API_URL}/api/auth/login`, 
      { email, password },
      { withCredentials: true }
    );
    if (data.requires_2fa) return data;          // Iter 53: second step pending — no session yet
    setUser(data);
    return data;
  }, []);

  const completeTwoFactor = useCallback(async (code) => {
    const { data } = await axios.post(`${API_URL}/api/auth/login/2fa`, { code }, { withCredentials: true });
    setUser(data);
    return data;
  }, []);

  const register = useCallback(async (userData) => {
    const { data } = await axios.post(`${API_URL}/api/auth/register`,
      userData,
      { withCredentials: true }
    );
    setUser(data);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await axios.post(`${API_URL}/api/auth/logout`, {}, { withCredentials: true });
    } catch (error) {
      console.error('Logout error:', error);
    }
    setUser(false);
  }, []);

  const refreshToken = useCallback(async () => {
    try {
      await axios.post(`${API_URL}/api/auth/refresh`, {}, { withCredentials: true });
      await checkAuth();
    } catch (error) {
      setUser(false);
    }
  }, [checkAuth]);

  /** can('module_inventory') → may open the page; can('module_inventory', 'export'); can('can_approve_quotation') → an option. */
  const can = useCallback((key, action = 'view') => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!perms || !key) return false;
    const v = perms[key];
    if (v && typeof v === 'object') return !!v[action];
    return v === true;
  }, [user, perms]);

  const contextValue = useMemo(() => ({
    user, 
    loading, 
    perms, can, reloadPerms: loadPerms,
    login, completeTwoFactor, 
    register, 
    logout, 
    refreshToken,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isManager: user?.role === 'manager',
    isStaff: user?.role === 'staff'
  }), [user, loading, perms, can, loadPerms, login, completeTwoFactor, register, logout, refreshToken]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default AuthContext;
