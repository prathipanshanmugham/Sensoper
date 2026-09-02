import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { usersAPI, employeeScoresAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { 
  ArrowLeft,
  Users,
  Plus,
  Edit,
  Trash2,
  Loader2,
  Shield,
  User as UserIcon,
  Star
} from 'lucide-react';

const roleConfig = {
  admin: { label: 'Admin', color: 'bg-purple-100 text-purple-800' },
  manager: { label: 'Manager', color: 'bg-blue-100 text-blue-800' },
  staff: { label: 'Staff', color: 'bg-slate-100 text-slate-800' }
};

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'staff'
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [scoreUser, setScoreUser] = useState(null);
  const [scoreForm, setScoreForm] = useState({ period: new Date().toISOString().slice(0, 7), score: 4, notes: '' });
  const [scoreSaving, setScoreSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await usersAPI.getAll();
      setUsers(res.data);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openScoreDialog = (user) => {
    setScoreUser(user);
    setScoreForm({ period: new Date().toISOString().slice(0, 7), score: 4, notes: '' });
  };

  const handleLogScore = async () => {
    if (!scoreUser) return;
    setScoreSaving(true);
    try {
      await employeeScoresAPI.create({ user_id: scoreUser.id, period: scoreForm.period, score: parseInt(scoreForm.score, 10), notes: scoreForm.notes });
      setScoreUser(null);
    } catch (e) { alert(e.response?.data?.detail || 'Failed to log score'); }
    finally { setScoreSaving(false); }
  };

  const openCreateDialog = () => {
    setEditingUser(null);
    setFormData({ name: '', email: '', password: '', phone: '', role: 'staff' });
    setError('');
    setShowDialog(true);
  };

  const openEditDialog = (user) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: '',
      phone: user.phone || '',
      role: user.role
    });
    setError('');
    setShowDialog(true);
  };

  const handleSubmit = async () => {
    setActionLoading(true);
    setError('');

    try {
      if (editingUser) {
        await usersAPI.update(editingUser.id, {
          name: formData.name,
          phone: formData.phone,
          role: formData.role,
          password: formData.password || undefined
        });
      } else {
        if (!formData.password) {
          setError('Password is required');
          setActionLoading(false);
          return;
        }
        await usersAPI.create(formData);
      }
      setShowDialog(false);
      fetchUsers();
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || 'Operation failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      await usersAPI.delete(editingUser.id);
      setShowDeleteDialog(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">User Management</h1>
              <p className="text-slate-500">{users.length} users</p>
            </div>
          </div>
          <Button 
            onClick={openCreateDialog}
            className="bg-[#4ADE40] hover:bg-[#3dba35] text-black text-white"
            data-testid="add-user-btn"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>

        {/* Users List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#4ADE40]" />
          </div>
        ) : (
          <div className="space-y-4">
            {users.map((user) => {
              const config = roleConfig[user.role] || roleConfig.staff;

              return (
                <Card key={user.id} className="border-slate-200" data-testid={`user-card-${user.id}`}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                          {user.role === 'admin' ? (
                            <Shield className="h-6 w-6 text-[#4ADE40]" />
                          ) : (
                            <UserIcon className="h-6 w-6 text-[#4ADE40]" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-slate-900">{user.name}</h3>
                            <Badge className={config.color}>{config.label}</Badge>
                          </div>
                          <p className="text-sm text-slate-500">{user.email}</p>
                          {user.phone && <p className="text-sm text-slate-400">{user.phone}</p>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          onClick={() => openScoreDialog(user)}
                          data-testid={`log-performance-${user.id}`}
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => openEditDialog(user)}
                          data-testid={`edit-user-${user.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            setEditingUser(user);
                            setShowDeleteDialog(true);
                          }}
                          data-testid={`delete-user-${user.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter name"
                data-testid="user-name-input"
              />
            </div>
            {!editingUser && (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Enter email"
                  data-testid="user-email-input"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">
                {editingUser ? 'New Password (leave blank to keep current)' : 'Password'}
              </Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                placeholder={editingUser ? 'Enter new password' : 'Enter password'}
                data-testid="user-password-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="Enter phone number"
                data-testid="user-phone-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={formData.role} onValueChange={(v) => setFormData(prev => ({ ...prev, role: v }))}>
                <SelectTrigger data-testid="user-role-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={actionLoading || !formData.name}
              className="bg-[#4ADE40] hover:bg-[#3dba35] text-black"
              data-testid="save-user-btn"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingUser ? 'Save Changes' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>
          <p className="text-slate-600">
            Are you sure you want to delete <strong>{editingUser?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={actionLoading}
              data-testid="confirm-delete-user-btn"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Performance Dialog */}
      <Dialog open={!!scoreUser} onOpenChange={(v) => !v && setScoreUser(null)}>
        <DialogContent data-testid="log-performance-dialog">
          <DialogHeader><DialogTitle>Log Performance — {scoreUser?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="score-period">Period</Label>
              <Input id="score-period" type="month" value={scoreForm.period} onChange={(e) => setScoreForm(p => ({...p, period: e.target.value}))} data-testid="score-period-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="score-value">Score (1-5)</Label>
              <Select value={String(scoreForm.score)} onValueChange={(v) => setScoreForm(p => ({...p, score: v}))}>
                <SelectTrigger id="score-value" data-testid="score-value-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="score-notes">Notes</Label>
              <Input id="score-notes" value={scoreForm.notes} onChange={(e) => setScoreForm(p => ({...p, notes: e.target.value}))} placeholder="Optional remarks" data-testid="score-notes-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScoreUser(null)}>Cancel</Button>
            <Button onClick={handleLogScore} disabled={scoreSaving} className="bg-amber-600 hover:bg-amber-700 text-white gap-2" data-testid="save-score-btn">
              {scoreSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}Log Score
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}