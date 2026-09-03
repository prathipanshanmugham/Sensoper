import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { hardDeleteAPI } from '../utils/api';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

/**
 * Admin-only permanent-deletion button. Wraps a confirmation dialog that captures a reason
 * and, when the backend flags GST-reporting risk, a second acknowledgement checkbox.
 * Distinct from cancellation/reversal — this permanently removes the record while preserving
 * a full snapshot in the audit log.
 */
export default function HardDeleteButton({ type, id, label = 'Hard Delete', onDeleted, testid }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [ackGst, setAckGst] = useState(false);
  const [needsGstAck, setNeedsGstAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apiFor = { sale: hardDeleteAPI.sale, purchase_order: hardDeleteAPI.purchaseOrder, delivery: hardDeleteAPI.delivery }[type];

  const doDelete = async () => {
    setError('');
    if (!reason || reason.trim().length < 3) { setError('A reason is required'); return; }
    setBusy(true);
    try {
      await apiFor(id, { reason: reason.trim(), gst_warning_acknowledged: ackGst });
      setOpen(false); setReason(''); setAckGst(false); setNeedsGstAck(false);
      onDeleted && onDeleted();
    } catch (e) {
      if (e.response?.status === 409) { setNeedsGstAck(true); setError(e.response.data?.detail || 'Please acknowledge the GST warning'); }
      else setError(e.response?.data?.detail || 'Delete failed');
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1" data-testid={testid || `hard-delete-${type}-${id}`}>
        <Trash2 className="h-3.5 w-3.5" />{label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid={`hard-delete-dialog-${type}`}>
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-5 w-5" />Permanent Deletion</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-slate-600">This removes the record permanently. Stock and credit side-effects will be reversed. A full snapshot with your reason is preserved in the audit log — nothing is unrecoverable, only removed from live views.</p>
            {error && <div className="p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">{error}</div>}
            <div className="space-y-1">
              <Label className="text-xs">Reason (required)</Label>
              <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Duplicate entry, wrong project selected" data-testid="hard-delete-reason" />
            </div>
            {needsGstAck && (
              <label className="flex items-start gap-2 text-xs p-2 border rounded bg-amber-50 border-amber-200" data-testid="gst-ack-label">
                <Checkbox checked={ackGst} onCheckedChange={setAckGst} data-testid="gst-ack-checkbox" />
                <span>This record is old enough to have been filed with GST. Deleting it will create a mismatch between the filing and the system. I understand and want to proceed.</span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={doDelete} disabled={busy || (needsGstAck && !ackGst)} data-testid="confirm-hard-delete-btn">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
