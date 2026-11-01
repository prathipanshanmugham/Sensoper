/** Where to go after signing in: ?next=/connect-agent?request=… — only paths inside this app (never another site). */
export function nextPath(search = window.location.search) {
  const raw = new URLSearchParams(search).get('next') || '';
  return raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : '';
}
