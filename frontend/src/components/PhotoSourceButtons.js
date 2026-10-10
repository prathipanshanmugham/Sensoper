/* Two clear choices for adding pictures on a phone: open the camera, or pick from the gallery.
 * (A single <input type="file"> leaves the choice to the phone; some phones jump straight to one or the other.) */
import { useRef } from 'react';
import { Camera, Images, FileUp } from 'lucide-react';

/** variant="tiles": two 80×80 tiles (photo strips). variant="buttons": two full-width buttons. */
export default function PhotoSourceButtons({ onFiles, multiple = true, allowGallery = true, allowPdf = false, disabled = false, variant = 'buttons', testid = 'photo-source' }) {
  const cam = useRef(null);
  const gal = useRef(null);
  const pick = (e) => { const f = e.target.files; if (f && f.length) onFiles(f); e.target.value = ''; };
  const GalleryIcon = allowPdf ? FileUp : Images;
  const galleryLabel = allowPdf ? 'Gallery / PDF' : 'Gallery';
  const inputs = (
    <>
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} data-testid={`${testid}-camera-input`} />
      {allowGallery && <input ref={gal} type="file" accept={allowPdf ? 'image/*,application/pdf' : 'image/*'} multiple={multiple} className="hidden" onChange={pick} data-testid={`${testid}-gallery-input`} />}
    </>
  );
  if (variant === 'tiles') {
    const tile = 'flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white text-slate-600 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-40';
    return (
      <>
        {inputs}
        <button type="button" disabled={disabled} onClick={() => cam.current?.click()} className={tile} data-testid={`${testid}-camera`}>
          <Camera className="h-5 w-5" /><span className="text-[11px] font-medium">Camera</span>
        </button>
        {allowGallery && (
          <button type="button" disabled={disabled} onClick={() => gal.current?.click()} className={tile} data-testid={`${testid}-gallery`}>
            <GalleryIcon className="h-5 w-5" /><span className="text-[11px] font-medium">{galleryLabel}</span>
          </button>
        )}
      </>
    );
  }
  const btn = 'flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white text-sm font-medium text-slate-700 hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-40';
  return (
    <div className="flex gap-2">
      {inputs}
      <button type="button" disabled={disabled} onClick={() => cam.current?.click()} className={btn} data-testid={`${testid}-camera`}><Camera className="h-4 w-4" />Take photo</button>
      {allowGallery && <button type="button" disabled={disabled} onClick={() => gal.current?.click()} className={btn} data-testid={`${testid}-gallery`}><GalleryIcon className="h-4 w-4" />From {galleryLabel.toLowerCase()}</button>}
    </div>
  );
}
