import { useState, useEffect } from 'react';
import { permissionsAPI } from '../utils/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Loader2, Shield, Save, Crown, Briefcase, HardHat } from 'lucide-react';

const PERMISSION_GROUPS = [
  {
    label: 'Projects',
    permissions: [
      { key: 'can_create_project', label: 'Create Projects' },
      { key: 'can_edit_project', label: 'Edit Projects' },
      { key: 'can_delete_project', label: 'Delete Projects Directly' },
      { key: 'can_request_delete', label: 'Request Deletion' },
      { key: 'can_approve_deletion', label: 'Approve Deletions' },
      { key: 'can_approve_quotation', label: 'Approve Quotations' }
    ]
  },
  {
    label: 'Margins',
    permissions: [
      { key: 'can_set_margin', label: 'Set Margins' },
      { key: 'can_approve_margin', label: 'Approve Margin Changes' }
    ]
  },
  {
    label: 'Inventory',
    permissions: [
      { key: 'can_edit_inventory', label: 'Edit Inventory' },
      { key: 'can_approve_inventory', label: 'Approve Inventory Edits' }
    ]
  },
  {
    label: 'Administration',
    permissions: [
      { key: 'can_manage_users', label: 'Manage Users' },
      { key: 'can_change_user_access', label: 'Change User Access' },
      { key: 'can_view_reports', label: 'View Reports' },
      { key: 'can_view_audit_logs', label: 'View Audit Logs' },
      { key: 'can_manage_company', label: 'Manage Company Profile' },
      { key: 'can_manage_terms', label: 'Manage Terms & Conditions' }
    ]
  }
];

const ROLE_CONFIG = {
  admin: { label: 'Admin', icon: Crown, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  manager: { label: 'Manager', icon: Briefcase, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  staff: { label: 'Staff', icon: HardHat, color: 'text-slate-600 bg-slate-50 border-slate-200' }
};

export default function PermissionsPage() {
  const [allPerms, setAllPerms] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [dirty, setDirty] = useState({});

  useEffect(() => { fetchPermissions(); }, []);

  const fetchPermissions = async () => {
    try {
      const res = await permissionsAPI.getAll();
      setAllPerms(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const togglePermission = (role, key) => {
    setAllPerms(prev => ({
      ...prev,
      [role]: { ...prev[role], [key]: !prev[role]?.[key] }
    }));
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
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold font-['Outfit'] text-slate-900 mb-1 flex items-center gap-3" data-testid="permissions-title">
            <Shield className="h-7 w-7 text-emerald-600" />Permissions
          </h1>
          <p className="text-sm text-slate-500">Configure what each role can do in the system</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {['admin', 'manager', 'staff'].map(role => {
            const rc = ROLE_CONFIG[role];
            const RoleIcon = rc.icon;
            const perms = allPerms[role] || {};
            return (
              <Card key={role} className={`border ${dirty[role] ? 'ring-2 ring-emerald-400' : ''}`} data-testid={`role-card-${role}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg border ${rc.color}`}><RoleIcon className="h-5 w-5" /></div>
                      <div>
                        <CardTitle className="text-lg font-['Outfit']">{rc.label}</CardTitle>
                        <CardDescription className="text-xs">
                          {role === 'admin' && 'Full system control'}
                          {role === 'manager' && 'Controlled by admin'}
                          {role === 'staff' && 'Limited access'}
                        </CardDescription>
                      </div>
                    </div>
                    {dirty[role] && (
                      <Button size="sm" onClick={() => saveRole(role)} disabled={saving === role} className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 gap-1" data-testid={`save-${role}`}>
                        {saving === role ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {PERMISSION_GROUPS.map(group => (
                    <div key={group.label}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{group.label}</p>
                      <div className="space-y-2">
                        {group.permissions.map(perm => (
                          <div key={perm.key} className="flex items-center justify-between py-1">
                            <Label className="text-sm text-slate-700 cursor-pointer" htmlFor={`${role}-${perm.key}`}>{perm.label}</Label>
                            <Switch
                              id={`${role}-${perm.key}`}
                              checked={!!perms[perm.key]}
                              onCheckedChange={() => togglePermission(role, perm.key)}
                              data-testid={`perm-${role}-${perm.key}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
