/* "From Odoo" box on a lead or quotation that the Odoo sync brought in: what Odoo says (stage, salesperson,
 * the extra Odoo fields chosen in Set up) and a link to open the record in Odoo. */
import { ExternalLink, CloudDownload } from 'lucide-react';

export const odooLink = (url, model, id) => (url && model && id ? `${url.replace(/\/+$/, '')}/web#id=${id}&model=${encodeURIComponent(model)}&view_type=form` : null);

const shown = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
};
const prettyKey = (k) => k.replace(/^x_(studio_)?/, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function FromOdoo({ odoo, url, labels = {}, rows = [], className = '', editable = true }) {
  if (!odoo?.id) return null;
  const extra = Object.entries(odoo.extra || {}).map(([k, v]) => [labels[k] || prettyKey(k), shown(v)]).filter(([, v]) => v !== null);
  const all = [...rows.filter(([, v]) => v), ...extra];
  const href = odooLink(url, odoo.model, odoo.id);
  return (
    <div className={`rounded-lg border border-violet-200 bg-violet-50/40 p-3 ${className}`} data-testid="from-odoo">
      <div className="mb-1.5 flex items-center gap-1.5">
        <CloudDownload className="h-4 w-4 text-violet-700" />
        <p className="mr-auto text-xs font-semibold text-violet-900">From Odoo</p>
        {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-violet-800 hover:underline">Open in Odoo<ExternalLink className="h-3 w-3" /></a>}
      </div>
      {all.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {all.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[11px] text-slate-500">{k}</dt><dd className="break-words text-slate-800">{v}</dd></div>)}
        </dl>
      )}
      {odoo.synced_at && <p className="mt-1.5 text-[11px] text-slate-500">Last copied {new Date(odoo.synced_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.{editable ? ' Changes you make here are kept; Odoo only updates fields you haven’t changed.' : ''}</p>}
    </div>
  );
}
