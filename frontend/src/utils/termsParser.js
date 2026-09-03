import DOMPurify from 'dompurify';

/** Parse a Terms & Conditions HTML blob into a flat list of plain-text lines
 * for PDF rendering — shared by the Kit Quotation and GST Invoice generators. */
export function parseTermsHtml(html) {
  const clean = DOMPurify.sanitize(html || '');
  const liRegex = /<li[^>]*>(.*?)<\/li>/gi;
  const matches = [...clean.matchAll(liRegex)];
  if (matches.length > 0) return matches.map(m => DOMPurify.sanitize(m[1], { ALLOWED_TAGS: [] }));
  return DOMPurify.sanitize(html || '', { ALLOWED_TAGS: [] }).split('\n').filter(line => line.trim());
}
