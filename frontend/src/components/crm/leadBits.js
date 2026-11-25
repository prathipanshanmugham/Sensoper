/* Small shared pieces for Leads: stage colours, WhatsApp links, "when" labels and the list of options (meta). */
import { crmAPI } from '../../utils/api';
import { todayISO, addDaysISO, fmtDate } from '../kit/PageBits';

export const STAGE_TONE = { new: 'amber', contacted: 'blue', site_visit: 'violet', quoted: 'blue', won: 'green', lost: 'slate' };
export const HEAT_TONE = { hot: 'red', warm: 'amber', cold: 'blue' };
export const OPEN_STAGES = ['new', 'contacted', 'site_visit', 'quoted'];

export const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
export const waLink = (phone, text = '') => `https://wa.me/91${digits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const telLink = (phone) => `tel:+91${digits(phone)}`;
export const firstName = (name) => (String(name || '').trim().split(/\s+/)[0] || 'there');

export const ago = (iso) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d} day${d === 1 ? '' : 's'} ago` : fmtDate(iso);
};

const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

/** "Today 11:00", "Tomorrow", "3 days late", "Mon 2 Dec" — for the next follow-up. */
export function whenLabel(day, time) {
  if (!day) return '';
  const today = todayISO();
  const t = time ? ` ${time}` : '';
  if (day === today) return `Today${t}`;
  const diff = daysBetween(today, day);
  if (diff === 1) return `Tomorrow${t}`;
  if (diff < 0) return `${-diff} day${diff === -1 ? '' : 's'} late`;
  if (diff < 7) return `${new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}${t}`;
  return `${fmtDate(day, { day: 'numeric', month: 'short' })}${t}`;
}

/** Quick picks for the next follow-up. */
export function followUpChoices() {
  const t = todayISO();
  const d = new Date();
  const toMonday = ((8 - d.getDay()) % 7) || 7;
  return [
    { key: 'today', label: 'Today', day: t },
    { key: 'tomorrow', label: 'Tomorrow', day: addDaysISO(t, 1) },
    { key: '3d', label: 'In 3 days', day: addDaysISO(t, 3) },
    { key: 'week', label: 'Next week', day: addDaysISO(t, toMonday) },
  ];
}

let metaPromise = null;
/** The options (stages, sources, people…) — fetched once per session. */
export function loadMeta(force = false) {
  if (!metaPromise || force) metaPromise = crmAPI.meta().then((r) => r.data).catch((e) => { metaPromise = null; throw e; });
  return metaPromise;
}

export const inrPlain = (v) => (v || v === 0 ? `₹${Math.round(Number(v)).toLocaleString('en-IN')}` : '');

/** Tell other screens a lead changed (the Leads page reloads; the menu badge updates). */
export const leadsChanged = () => window.dispatchEvent(new Event('sensoper:leads-changed'));
