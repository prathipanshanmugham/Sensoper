/* Customer support — Sensoper's own help desk for every customer (with or without an AMC).
 * Its own page and permission (module_support). */
import { LifeBuoy } from 'lucide-react';
import SupportTicketsTab from './SupportTicketsTab';

export default function CustomerSupportPage() {
  return (
    <div className="px-4 py-5 sm:py-6" data-testid="customer-support-page">
      <div className="mx-auto max-w-7xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2 font-['Outfit'] text-2xl font-bold text-slate-900"><LifeBuoy className="h-6 w-6 text-emerald-600" />Customer support</h1>
          <p className="text-sm text-slate-500">Problems and requests from Sensoper customers — tickets, deadlines and ratings. Separate from planned AMC visits.</p>
        </div>
        <SupportTicketsTab />
      </div>
    </div>
  );
}
