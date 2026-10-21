/* A row of photos you can add straight from the phone camera or gallery (no links to paste).
 * Holds storage paths (what /api/upload/image returns); the first photo is the main one. */
import { useState } from 'react';
import { Loader2, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadAPI } from '../utils/api';
import { compressImage } from '../lib/format';
import PhotoSourceButtons from './PhotoSourceButtons';

export const fileUrl = (path) => (path ? uploadAPI.getFileUrl(path) : null);

/** The picture to show for an inventory item: its first uploaded photo, else the old image link. */
export const itemImage = (item) => (item?.photos?.length ? fileUrl(item.photos[0]) : item?.image_url || null);

export default function PhotoStrip({ value = [], onChange, max = 6, compress = true, disabled = false, testid = 'photos', label = 'Photos', hint }) {
  const [busy, setBusy] = useState(0);
  const photos = Array.isArray(value) ? value : [];
  const room = Math.max(0, max - photos.length);

  const add = async (files) => {
    const list = Array.from(files).slice(0, room);
    if (!list.length) { toast.error(`Up to ${max} photos`); return; }
    setBusy(list.length);
    const added = [];
    for (const f of list) {
      try {
        if (!f.type?.startsWith('image/')) throw new Error('Only pictures can be added here');
        const small = compress ? await compressImage(f) : f;
        if (small.size > 5 * 1024 * 1024) throw new Error('That picture is over 5 MB');
        added.push((await uploadAPI.uploadImage(small)).data.storage_path);
      } catch (e) {
        toast.error(e.response?.data?.detail || e.message || 'Could not add the photo');
      } finally { setBusy((n) => n - 1); }
    }
    if (added.length) onChange([...photos, ...added]);
  };
  const remove = (i) => onChange(photos.filter((_, j) => j !== i));
  const makeMain = (i) => onChange([photos[i], ...photos.filter((_, j) => j !== i)]);

  return (
    <div className="space-y-1.5" data-testid={testid}>
      {label && <p className="text-sm font-medium text-slate-800">{label}</p>}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((p, i) => (
          <div key={p} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50" data-testid={`${testid}-thumb-${i}`}>
            <img src={fileUrl(p)} alt={i === 0 ? 'Main photo' : `Photo ${i + 1}`} className="h-full w-full object-cover" />
            {i === 0 && photos.length > 1 && <span className="absolute bottom-0 inset-x-0 bg-slate-900/70 py-0.5 text-center text-[10px] font-medium text-white">Main</span>}
            {!disabled && (
              <>
                <button type="button" onClick={() => remove(i)} aria-label="Remove photo" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow" data-testid={`${testid}-remove-${i}`}><X className="h-3.5 w-3.5" /></button>
                {i > 0 && <button type="button" onClick={() => makeMain(i)} aria-label="Make this the main photo" className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-amber-600 shadow" data-testid={`${testid}-main-${i}`}><Star className="h-3.5 w-3.5" /></button>}
              </>
            )}
          </div>
        ))}
        {busy > 0 && Array.from({ length: busy }).map((_, i) => (
          <div key={`busy-${i}`} className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ))}
        {!disabled && room > 0 && <PhotoSourceButtons variant="tiles" multiple={room > 1} onFiles={add} disabled={busy > 0} testid={`${testid}-add`} />}
      </div>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}
