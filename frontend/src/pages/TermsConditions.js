import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { termsAPI } from '../utils/api';
import { formatApiErrorDetail } from '../contexts/AuthContext';
import DOMPurify from 'dompurify';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { 
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  Loader2,
  FileText,
  Eye
} from 'lucide-react';

export default function TermsConditions() {
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [editingTerm, setEditingTerm] = useState(null);
  const [previewContent, setPreviewContent] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    language: 'en'
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchTerms = useCallback(async () => {
    try {
      const res = await termsAPI.getAll();
      setTerms(res.data);
    } catch (error) {
      console.error('Failed to fetch terms:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTerms();
  }, [fetchTerms]);

  const openCreateDialog = () => {
    setEditingTerm(null);
    setFormData({ title: '', content: '', language: 'en' });
    setError('');
    setShowDialog(true);
  };

  const openEditDialog = (term) => {
    setEditingTerm(term);
    setFormData({
      title: term.title,
      content: term.content,
      language: term.language || 'en'
    });
    setError('');
    setShowDialog(true);
  };

  const handleSubmit = async () => {
    if (!formData.title || !formData.content) {
      setError('Title and content are required');
      return;
    }

    setActionLoading(true);
    setError('');

    try {
      if (editingTerm) {
        await termsAPI.update(editingTerm.id, formData);
      } else {
        await termsAPI.create(formData);
      }
      setShowDialog(false);
      fetchTerms();
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || 'Operation failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (term) => {
    if (!window.confirm('Are you sure you want to delete this version?')) return;
    
    try {
      await termsAPI.delete(term.id);
      fetchTerms();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete terms');
    }
  };

  const openPreview = (content) => {
    setPreviewContent(content);
    setShowPreviewDialog(true);
  };

  const defaultTermsTemplate = `<ol>
<li>This quotation is valid for 30 days from the date of issue.</li>
<li>50% advance payment required to confirm the order.</li>
<li>Balance payment due upon installation completion.</li>
<li>Installation timeline: 7-14 working days after material delivery.</li>
<li>5-year warranty on installation workmanship.</li>
<li>Panel warranty as per manufacturer terms (typically 25 years).</li>
<li>Inverter warranty as per manufacturer terms.</li>
<li>All prices are subject to change without prior notice.</li>
<li>Any additional civil work will be charged extra.</li>
<li>Net metering application fees not included.</li>
</ol>`;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="icon" className="text-slate-600" data-testid="back-btn">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">Terms & Conditions</h1>
              <p className="text-slate-500">Manage quotation terms with version control</p>
            </div>
          </div>
          <Button 
            onClick={openCreateDialog}
            className="bg-[#4ADE40] hover:bg-[#3dba35] text-black text-white"
            data-testid="add-terms-btn"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Version
          </Button>
        </div>

        {/* Info Card */}
        <Card className="border-blue-200 bg-blue-50 mb-6">
          <CardContent className="p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Create multiple Terms & Conditions templates. While creating a project you can pick which template to attach to that quotation.
              Use HTML tags for formatting (ol, li, strong, em, etc.)
            </p>
          </CardContent>
        </Card>

        {/* Terms List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#4ADE40]" />
          </div>
        ) : terms.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 text-slate-300" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No terms configured</h3>
              <p className="text-slate-500 mb-4">Create your first terms & conditions version</p>
              <Button onClick={openCreateDialog} className="bg-[#4ADE40] hover:bg-[#3dba35] text-black text-white">
                <Plus className="h-4 w-4 mr-2" />
                Create Terms
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {terms.map((term) => (
              <Card key={term.id} className="border-slate-200" data-testid={`terms-card-${term.id}`}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-slate-900">{term.title}</h3>
                        <Badge variant="outline" className="text-slate-500">v{term.version}</Badge>
                        <Badge className={term.language === 'en' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}>
                          {term.language === 'en' ? 'English' : 'Tamil'}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        Created by {term.created_by_name} • {new Date(term.created_at).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openPreview(term.content)}
                        data-testid={`preview-terms-${term.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openEditDialog(term)}
                        data-testid={`edit-terms-${term.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDelete(term)}
                        data-testid={`delete-terms-${term.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTerm ? 'Edit Terms' : 'Create New Terms Version'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
                {error}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Standard Terms v2"
                  data-testid="terms-title-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="language">Language</Label>
                <Select 
                  value={formData.language} 
                  onValueChange={(v) => setFormData(prev => ({ ...prev, language: v }))}
                >
                  <SelectTrigger data-testid="terms-language-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ta">Tamil</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="content">Content (HTML)</Label>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setFormData(prev => ({ ...prev, content: defaultTermsTemplate }))}
                >
                  Load Template
                </Button>
              </div>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Enter terms content with HTML formatting..."
                rows={15}
                className="font-mono text-sm"
                data-testid="terms-content-input"
              />
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <Label className="text-sm text-slate-500 mb-2 block">Preview:</Label>
              <div 
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(formData.content) }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={actionLoading}
              className="bg-[#4ADE40] hover:bg-[#3dba35] text-black"
              data-testid="save-terms-btn"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingTerm ? 'Save Changes' : 'Create Version'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Terms Preview</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div 
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewContent) }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}