/* Site photo checklist — used in New project → Site photos (form mode) and on the project page (live mode).
 *
 * Form mode:  <SitePhotoChecklist value={formData.site_photos} onChange={(fn) => …} />   photos travel with the form
 * Live mode:  <SitePhotoChecklist projectId={id} />                                         each photo saves at once
 *
 * The server copies every photo into Google Drive (one folder per project, one sub-folder per section). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Check, CloudOff, CloudUpload, ExternalLink, FileText, Loader2, MapPin, RefreshCw, X } from 'lucide-react';
import { sitePhotosAPI, driveAPI, uploadAPI } from '../utils/api';
import { useAuth, formatApiErrorDetail } from '../contexts/AuthContext';
import { compressImage } from '../lib/format';
import { getPosition, tryPosition, stampImage } from '../lib/geo';
import { Section } from './FormBits';
import PhotoSourceButtons from './PhotoSourceButtons';

let checklistCache = null;
function loadChecklist() {
  if (!checklistCache) checklistCache = sitePhotosAPI.checklist().then((r) => r.data).catch((e) => { checklistCache = null; throw e; });
  return checklistCache;
}

function slotDone(slot, list) { return (list || []).length >= (slot.min || 1); }

function DriveDot({ photo, connected }) {
  if (!connected) return null;
  const s = photo.drive_status;
  if (s === 'uploaded') return <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white" title="Saved in Google Drive"><Check className="h-3 w-3" /></span>;
  if (s === 'error') return <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white" title={photo.drive_error || 'Not copied to Drive yet — will retry'}><AlertTriangle className="h-2.5 w-2.5" /></span>;
  return <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-500 text-white" title="Waiting to copy to Google Drive"><CloudUpload className="h-2.5 w-2.5" /></span>;
}

function Thumb({ photo, connected, onRemove, canEdit }) {
  const url = uploadAPI.getFileUrl(photo.storage_path);
  const isPdf = (photo.content_type || '').includes('pdf');
  return (
    <div className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50" data-testid={`photo-${photo.id}`}>
      <a href={photo.drive_link || url} target="_blank" rel="noopener noreferrer" className="block h-full w-full" title={photo.filename}>
        {isPdf
          ? <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500"><FileText className="h-6 w-6" /><span className="text-[10px] font-medium">PDF</span></span>
          : <img src={url} alt={photo.filename || 'Site photo'} loading="lazy" className="h-full w-full object-cover" />}
      </a>
      {(photo.lat != null && photo.lng != null) && <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/90 text-emerald-700" title={`GPS ${photo.lat}, ${photo.lng}`}><MapPin className="h-2.5 w-2.5" /></span>}
      <DriveDot photo={photo} connected={connected} />
      {canEdit && (
        <button type="button" onClick={() => onRemove(photo)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-white hover:bg-red-600" aria-label="Remove photo" data-testid={`remove-photo-${photo.id}`}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export default function SitePhotoChecklist({ value, onChange, projectId = null, customerName = '', canEdit = true, compact = false }) {
  const { isAdmin } = useAuth();
  const live = !!projectId;
  const [checklist, setChecklist] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [livePhotos, setLivePhotos] = useState(null);
  const [liveDrive, setLiveDrive] = useState({});
  const [drive, setDrive] = useState(null);
  const [busy, setBusy] = useState([]);               // [{key, slot, name, pct}]
  const [open, setOpen] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const refreshTimer = useRef(null);

  const photos = useMemo(() => (live ? livePhotos : value) || {}, [live, livePhotos, value]);
  const update = useCallback((fn) => (live ? setLivePhotos((p) => fn(p || {})) : onChange?.(fn)), [live, onChange]);

  const loadLive = useCallback(async () => {
    if (!live) return;
    try {
      const r = await sitePhotosAPI.list(projectId);
      setLivePhotos(r.data.site_photos || {});
      setLiveDrive(r.data.drive || {});
    } catch { /* card shows what it has */ }
  }, [live, projectId]);

  useEffect(() => {
    loadChecklist().then(setChecklist).catch(() => setLoadError('Could not load the photo checklist. Check the connection and reload.'));
    driveAPI.status().then((r) => setDrive(r.data)).catch(() => setDrive({ connected: false }));
    loadLive();
    return () => clearTimeout(refreshTimer.current);
  }, [loadLive]);

  const sections = useMemo(() => checklist?.sections || [], [checklist]);
  const slots = useMemo(() => checklist?.slots || {}, [checklist]);
  const maxPer = checklist?.max_per_slot || 12;
  const connected = !!drive?.connected;

  const progress = useMemo(() => {
    const req = Object.entries(slots).filter(([, s]) => !s.optional);
    const done = req.filter(([k, s]) => slotDone(s, photos[k])).length;
    const all = Object.values(photos).reduce((n, l) => n + (l || []).length, 0);
    const per = {};
    sections.forEach((c) => {
      const items = c.items.map((i) => slots[i.key]).filter(Boolean);
      const r = items.filter((s) => !s.optional);
      per[c.key] = { done: r.filter((s) => slotDone(s, photos[s.key])).length, total: r.length, photos: items.reduce((n, s) => n + (photos[s.key] || []).length, 0) };
    });
    return { done, total: req.length, all, per };
  }, [slots, sections, photos]);

  // First section with something missing opens by default
  useEffect(() => {
    if (open !== null || !sections.length || (live && livePhotos === null)) return;
    const first = sections.find((c) => progress.per[c.key]?.done < progress.per[c.key]?.total);
    setOpen(compact ? '' : (first ? first.key : ''));
  }, [sections, progress, open, compact, live, livePhotos]);

  const addFiles = async (slotKey, fileList) => {
    const slot = slots[slotKey];
    const limit = slot.max || maxPer;
    const files = Array.from(fileList || []).slice(0, Math.max(0, limit - (photos[slotKey] || []).length));
    if (!files.length) { toast.error(`Up to ${limit} files for this item.`); return; }
    for (const file of files) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setBusy((b) => [...b, { key, slot: slotKey, name: file.name, pct: 0 }]);
      try {
        const isImage = (file.type || '').startsWith('image/');
        let pos = null;
        let out = file;
        if (slot.geotag) {
          try { pos = await getPosition(); } catch (e) { toast.warning(`${e.message} The photo will be saved without GPS.`); }
          const when = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
          out = isImage ? await stampImage(file, [
            `Site visit${customerName ? ` · ${customerName}` : ''}`,
            when,
            pos ? `GPS ${pos.lat}, ${pos.lng}  (±${pos.accuracy} m)` : 'GPS not available',
          ]) : file;
        } else {
          [out, pos] = await Promise.all([isImage ? compressImage(file) : file, tryPosition()]);
        }
        const takenAt = new Date(file.lastModified || Date.now()).toISOString();
        const r = await sitePhotosAPI.upload(out, slotKey, { lat: pos?.lat, lng: pos?.lng, accuracy: pos?.accuracy, taken_at: takenAt }, projectId,
          (pct) => setBusy((b) => b.map((x) => (x.key === key ? { ...x, pct } : x))));
        update((p) => ({ ...p, [slotKey]: [...(p[slotKey] || []), r.data] }));
      } catch (e) {
        toast.error(e.response?.status === 413 ? `${file.name} is too large for the server.`
          : formatApiErrorDetail(e.response?.data?.detail) || `Could not upload ${file.name}. Check the connection and try again.`);
      } finally {
        setBusy((b) => b.filter((x) => x.key !== key));
      }
    }
    if (live && connected) { clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(loadLive, 6000); }
  };

  const remove = async (photo) => {
    if (!window.confirm('Remove this photo from the checklist?' + (photo.drive_status === 'uploaded' ? ' The copy in Google Drive stays there.' : ''))) return;
    if (live) {
      try { await sitePhotosAPI.remove(projectId, photo.id); } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not remove the photo'); return; }
    }
    update((p) => ({ ...p, [photo.slot]: (p[photo.slot] || []).filter((x) => x.id !== photo.id) }));
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await sitePhotosAPI.sync(projectId);
      const d = r.data;
      if (d.status === 'error') toast.error(d.error || 'Google Drive copy failed');
      else if (d.failed) toast.warning(`${d.uploaded} copied, ${d.failed} could not be copied — will retry.`);
      else toast.success(d.uploaded ? `${d.uploaded} file(s) copied to Google Drive` : 'Everything is already in Google Drive');
      await loadLive();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail) || 'Could not reach Google Drive'); }
    finally { setSyncing(false); }
  };

  if (loadError) return <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{loadError}</p>;
  if (!checklist || (live && livePhotos === null)) return <div className="flex items-center gap-2 p-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading photo checklist…</div>;

  const pending = Object.values(photos).flat().filter((p) => p.drive_status !== 'uploaded').length;
  const pctDone = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-3" data-testid="site-photo-checklist">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="font-['Outfit'] text-[15px] font-semibold text-slate-900">Site photos</p>
            <p className="text-xs text-slate-500">{progress.all} file{progress.all === 1 ? '' : 's'} · tap a section, then <span className="font-medium text-slate-700">Add photo</span> on each item</p>
          </div>
          <p className={`text-sm font-semibold tabular-nums ${progress.done === progress.total ? 'text-emerald-700' : 'text-slate-700'}`} data-testid="photo-progress">{progress.done} of {progress.total} required</p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pctDone}%` }} /></div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs" data-testid="drive-line">
          {drive === null ? <span className="text-slate-400">Checking Google Drive…</span>
            : connected ? (
              <span className="flex items-center gap-1.5 text-emerald-700"><CloudUpload className="h-4 w-4" />
                {pending ? `Copying to Google Drive automatically · ${pending} waiting` : 'Saved to Google Drive automatically'}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-700"><CloudOff className="h-4 w-4" />
                Google Drive isn&apos;t connected yet — photos are kept safely here and copy over once it is.
                {isAdmin && <Link to="/dashboard/pricing-config#google-drive" className="font-medium underline">Connect</Link>}
              </span>
            )}
          {live && liveDrive.folder_link && <a href={liveDrive.folder_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-blue-700 hover:underline" data-testid="photos-drive-folder"><ExternalLink className="h-3.5 w-3.5" />Open Drive folder</a>}
          {live && connected && pending > 0 && <button type="button" onClick={syncNow} disabled={syncing} className="flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900 disabled:opacity-50" data-testid="photos-sync-now"><RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />Copy now</button>}
        </div>
        {live && liveDrive.last_error && connected && <p className="mt-2 text-xs text-amber-700">{liveDrive.last_error}</p>}
      </div>

      {sections.map((c, ci) => {
        const pr = progress.per[c.key] || { done: 0, total: 0, photos: 0 };
        const complete = pr.total > 0 && pr.done === pr.total;
        const summary = complete ? `All done · ${pr.photos} file${pr.photos === 1 ? '' : 's'}` : (pr.photos ? `${pr.done} of ${pr.total} done · ${pr.photos} file${pr.photos === 1 ? '' : 's'}` : '');
        return (
          <Section key={c.key} n={ci + 1} title={c.title} hint={`${pr.done} of ${pr.total} required`} summary={complete ? summary : ''} open={open === c.key}
            onToggle={() => setOpen(open === c.key ? '' : c.key)} testid={`photo-section-${c.key}`}
            action={!complete && pr.photos > 0 ? <span className="text-xs font-medium text-slate-500">{pr.done}/{pr.total}</span> : null}>
            <ul className="divide-y divide-slate-100">
              {c.items.map((it) => {
                const s = slots[it.key] || it;
                const list = photos[it.key] || [];
                const done = slotDone(s, list);
                const uploading = busy.filter((b) => b.slot === it.key);
                return (
                  <li key={it.key} className="py-3 first:pt-0 last:pb-0" data-testid={`slot-${it.key}`}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'}`}>{done && <Check className="h-3.5 w-3.5" />}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">
                          {s.label}
                          {s.optional && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">if applicable</span>}
                          {(s.min || 1) > 1 && <span className="ml-1.5 text-xs font-normal text-slate-500">{Math.min(list.length, s.min)}/{s.min}</span>}
                        </p>
                        {s.hint && <p className="text-xs text-slate-500">{s.hint}</p>}
                        {(list.length > 0 || uploading.length > 0 || canEdit) && (
                          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                            {list.map((p) => <Thumb key={p.id} photo={p} connected={connected} onRemove={remove} canEdit={canEdit} />)}
                            {uploading.map((b) => (
                              <div key={b.key} className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 text-emerald-700">
                                <Loader2 className="h-5 w-5 animate-spin" /><span className="text-[11px] font-semibold tabular-nums">{b.pct ? `${b.pct}%` : '…'}</span>
                              </div>
                            ))}
                            {canEdit && list.length + uploading.length < (s.max || maxPer) && (
                              /* Proof of visit is camera-only: an old gallery photo would get today's GPS stamped on it */
                              <PhotoSourceButtons variant="tiles" onFiles={(f) => addFiles(it.key, f)} multiple={!s.geotag} allowGallery={!s.geotag}
                                allowPdf={!!s.docs} testid={`add-photo-${it.key}`} />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}
      <p className="px-1 text-[11px] text-slate-400">Photos are shrunk before upload to save mobile data. A <MapPin className="inline h-3 w-3" /> means the phone&apos;s GPS was recorded with the photo.</p>
    </div>
  );
}
