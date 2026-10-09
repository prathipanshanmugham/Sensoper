/* Phone location + photo stamping helpers (site GPS, site photos). */

/** Current GPS position → { lat, lng, accuracy } or throws an Error with a plain-language message. */
export function getPosition({ timeout = 15000, maximumAge = 0, highAccuracy = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('This phone or browser cannot share its location.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy || 0) }),
      (e) => reject(new Error(
        e.code === 1 ? 'Location is blocked. Allow location for this site in the browser settings, then try again.'
          : e.code === 3 ? 'Getting the location took too long. Step outside or near a window and try again.'
            : 'Could not get the location. Turn on GPS / location and try again.')),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge });
  });
}

/** Best-effort location for tagging a photo: never throws, gives up quickly, and only asks the browser
 *  when location is already allowed (so an office user adding a bill isn't nagged for GPS). */
export async function tryPosition() {
  try {
    const st = navigator.permissions ? await navigator.permissions.query({ name: 'geolocation' }) : null;
    if (st && st.state !== 'granted') return null;
    return await getPosition({ timeout: 6000, maximumAge: 120000, highAccuracy: true });
  } catch { return null; }
}

/** Draws a strip under the photo with the given lines (customer, date, GPS …) and returns a JPEG File.
 *  The strip is added below the picture, so nothing in the photo is covered. */
export async function stampImage(file, lines, maxSide = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const font = Math.max(16, Math.round(w / 42));
    const pad = Math.round(font * 0.7);
    const strip = pad * 2 + lines.length * Math.round(font * 1.35);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h + strip;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, h, w, strip);
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top';
    lines.forEach((t, i) => {
      ctx.font = `${i === 0 ? '600 ' : ''}${font}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.fillText(String(t), pad, h + pad + i * Math.round(font * 1.35), w - pad * 2);
    });
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return blob ? new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export const mapsLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
