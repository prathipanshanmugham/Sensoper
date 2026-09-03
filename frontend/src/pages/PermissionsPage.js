import { useState, useEffect, useCallback } from 'react';
import { permissionsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { Loader2, Shield, Save, Crown, Briefcase, HardHat, ChevronDown, ChevronUp, LayoutDashboard, TrendingUp, Wallet, Activity, Package, Truck, CreditCard, Undo2, ClipboardList, BarChart3, AlertTriangle, ClipboardCheck, Users, Settings, FolderInput, ShoppingBag } from 'lucide-react';

const PERMISSION_GROUPS = [
  { label: 'Projects', permissions: [
    { key: 'can_create_project', label: 'Create Projects' },
    { key: 'can_edit_project', label: 'Edit Projects' },
    { key: 'can_delete_project', label: 'Delete Projects Directly' },
    { key: 'can_request_delete', label: 'Request Deletion' },
    { key: 'can_approve_deletion', label: 'Approve Deletions' },
    { key: 'can_approve_quotation', label: 'Approve Quotations' }
  ]},
  { label: 'Margins', permissions: [
    { key: 'can_set_margin', label: 'Set Margins' },
    { key: 'can_approve_margin', label: 'Approve Margin Changes' }
  ]},
  { label: 'Inventory', permissions: [
    { key: 'can_edit_inventory', label: 'Edit Inventory' },
    { key: 'can_approve_inventory', label: 'Approve Inventory Edits' }
  ]},
  { label: 'Administration', permissions: [
    { key: 'can_manage_users', label: 'Manage Users' },
    { key: 'can_change_user_access', label: 'Change User Access' },
    { key: 'can_view_reports', label: 'View Reports' },
    { key: 'can_view_audit_logs', label: 'View Audit Logs' },
    { key: 'can_manage_company', label: 'Manage Company Profile' },
    { key: 'can_manage_terms', label: 'Manage Terms & Conditions' }
  ]}
];

// Module-level permissions: view / create / edit / delete / export
const MODULES = [
  { key: 'module_dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'module_ceo_dashboard', label: 'CEO Dashboard', icon: TrendingUp },
  { key: 'module_accounts', label: 'Accounts', icon: Wallet },
  { key: 'module_readings', label: 'Readings', icon: Activity },
  { key: 'module_inventory', label: 'Inventory', icon: Package },
  { key: 'module_purchase_inbound', label: 'Purchase Inbound', icon: FolderInput },
  { key: 'module_delivery_outbound', label: 'Delivery Outbound', icon: Truck },
  { key: 'module_credits', label: 'Customer Credits', icon: CreditCard },
  { key: 'module_returns', label: 'Brand Returns', icon: Undo2 },
  { key: 'module_audits', label: 'Weekly Audits', icon: ClipboardList },
  { key: 'module_reports', label: 'Reports', icon: BarChart3 },
  { key: 'module_alerts', label: 'Profit Alerts', icon: AlertTriangle },
  { key: 'module_approvals', label: 'Approvals', icon: ClipboardCheck },
  { key: 'module_users', label: 'User Management', icon: Users },
  { key: 'module_permissions', label: 'Permissions', icon: Shield },
  { key: 'module_settings', label: 'Settings', icon: Settings },
  { key: 'module_partners', label: 'Partners', icon: HardHat },
  { key: 'module_ecommerce', label: 'Ecommerce', icon: ShoppingBag }
];
const MODULE_ACTIONS = ['view', 'create', 'edit', 'delete', 'export'];

const ROLE_CONFIG = {
  admin: { label: 'Admin', icon: Crown, color: 'text-amber-600 bg-amber-50 border-amber-200', desc: 'Full system control — locked' },
  manager: { label: 'Manager', icon: Briefcase, color: 'text-blue-600 bg-blue-50 border-blue-200', desc: 'Controlled by admin' },
  staff: { label: 'Staff', icon: HardHat, color: 'text-slate-600 bg-slate-50 border-slate-200', desc: 'Limited access' }
};

export default function PermissionsPage() {
  const [allPerms, setAllPerms] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [dirty, setDirty] = useState({});
  const [openRole, setOpenRole] = useState({ admin: true, manager: true, staff: true });

  const fetchPermissions = useCallback(async () => {
    try {
      const res = await permissionsAPI.getAll();
      setAllPerms(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPermissions(); }, [fetchPermissions]);

  const isLocked = (role) => role === 'admin';

  const togglePermission = (role, key) => {
    if (isLocked(role)) return;
    setAllPerms(prev => ({ ...prev, [role]: { ...prev[role], [key]: !prev[role]?.[key] } }));
    setDirty(prev => ({ ...prev, [role]: true }));
  };

  const toggleModuleAction = (role, moduleKey, action) => {
    if (isLocked(role)) return;
    setAllPerms(prev => {
      const current = prev[role]?.[moduleKey] || {};
      return { ...prev, [role]: { ...prev[role], [moduleKey]: { ...current, [action]: !current[action] } } };
    });
    setDirty(prev => ({ ...prev, [role]: true }));
  };

  const saveRole = async (role) => {
    setSaving(role);
    try {
      await permissionsAPI.updateRole(role, allPerms[role]);
      setDirty(prev => ({ ...prev, [role]: false }));
    } catch (err) { alert(err.response?.data?.detail || 'Failed to save'); }
    finally { setSaving(null); }
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-bold font-['Outfit'] text-slate-900 mb-1 flex items-center gap-3" data-testid="permissions-title">
            <Shield className="h-7 w-7 text-emerald-600" />Roles &amp; Permissions
          </h1>
          <p className="text-sm text-slate-500">Configure module access (view/create/edit/delete/export) and functional permissions per role. Admin always retains full access.</p>
        </div>

        <div className="space-y-5">
          {['admin', 'manager', 'staff'].map(role => {
            const rc = ROLE_CONFIG[role];
            const RoleIcon = rc.icon;
            const perms = allPerms[role] || {};
            const locked = isLocked(role);
            const isOpen = openRole[role];
            return (
              <Card key={role} className={`border ${dirty[role] ? 'ring-2 ring-emerald-400' : ''}`} data-testid={`role-card-${role}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <button onClick={() => setOpenRole(p => ({ ...p, [role]: !p[role] }))} className="flex items-center gap-2 text-left flex-1 min-w-0" data-testid={`role-toggle-${role}`}>
                      <div className={`p-2 rounded-lg border ${rc.color} shrink-0`}><RoleIcon className="h-5 w-5" /></div>
                      <div className="min-w-0">
                        <CardTitle className="text-lg font-['Outfit'] truncate">{rc.label}{locked && <span className="ml-2 text-xs font-normal text-amber-600">(locked)</span>}</CardTitle>
                        <CardDescription className="text-xs truncate">{rc.desc}</CardDescription>
                      </div>
                      <span className="ml-auto text-slate-400 shrink-0">{isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                    </button>
                    {dirty[role] && !locked && (
                      <Button size="sm" onClick={() => saveRole(role)} disabled={saving === role} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 gap-1" data-testid={`save-${role}`}>
                        {saving === role ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {isOpen && (
                <CardContent className="space-y-6">
                  {/* Module access matrix */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Module Access</p>
                    {/* Desktop matrix */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-slate-200">
                          <th className="text-left py-2 px-2 text-xs font-semibold text-slate-500">Module</th>
                          {MODULE_ACTIONS.map(a => <th key={a} className="text-center py-2 px-2 text-xs font-semibold text-slate-500 capitalize">{a}</th>)}
                        </tr></thead>
                        <tbody>
                          {MODULES.map(m => {
                            const Icon = m.icon;
                            const modPerms = perms[m.key] || {};
                            return (
                              <tr key={m.key} className="border-b border-slate-100 hover:bg-slate-50/60">
                                <td className="py-2.5 px-2 text-slate-700"><span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-slate-400" />{m.label}</span></td>
                                {MODULE_ACTIONS.map(action => (
                                  <td key={action} className="py-2.5 px-2 text-center">
                                    <Switch checked={!!modPerms[action] || locked} disabled={locked} onCheckedChange={() => toggleModuleAction(role, m.key, action)} data-testid={`mod-${role}-${m.key}-${action}`} />
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                      {MODULES.map(m => {
                        const Icon = m.icon;
                        const modPerms = perms[m.key] || {};
                        return (
                          <div key={m.key} className="border border-slate-200 rounded-lg p-3 bg-white" data-testid={`mod-mobile-${role}-${m.key}`}>
                            <div className="flex items-center gap-2 mb-2">
                              <Icon className="h-4 w-4 text-slate-500" />
                              <span className="text-sm font-medium text-slate-800">{m.label}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                              {MODULE_ACTIONS.map(action => (
                                <div key={action} className="flex items-center justify-between">
                                  <Label className="text-xs capitalize text-slate-600">{action}</Label>
                                  <Switch checked={!!modPerms[action] || locked} disabled={locked} onCheckedChange={() => toggleModuleAction(role, m.key, action)} data-testid={`mod-m-${role}-${m.key}-${action}`} />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Functional permissions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {PERMISSION_GROUPS.map(group => (
                      <div key={group.label}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{group.label}</p>
                        <div className="space-y-2">
                          {group.permissions.map(perm => (
                            <div key={perm.key} className="flex items-center justify-between py-1">
                              <Label className="text-sm text-slate-700 cursor-pointer pr-3" htmlFor={`${role}-${perm.key}`}>{perm.label}</Label>
                              <Switch id={`${role}-${perm.key}`} checked={!!perms[perm.key] || locked} disabled={locked} onCheckedChange={() => togglePermission(role, perm.key)} data-testid={`perm-${role}-${perm.key}`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
