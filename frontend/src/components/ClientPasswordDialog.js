/* The one-time password for a customer login, with a ready WhatsApp message (Website page and project page). */
import { toast } from 'sonner';
import { Copy, MessageCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';

const LIVE_SITE = 'https://sensoper.in';
const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const wa = (phone, text) => `https://wa.me/91${digits(phone)}?text=${encodeURIComponent(text)}`;

export default function ClientPasswordDialog({ result, onClose }) {
  const { account, password } = result;
  const first = (account.name || '').split(' ')[0];
  const message = `Hi ${first}, your Sensoper customer login is ready.\n\nOpen ${LIVE_SITE}/account\nMobile number: ${account.phone}\nPassword: ${password}\n\nYou’ll choose your own password after you sign in. You can see your savings, payments and service, and raise a request any time.`;
  const copy = async () => { try { await navigator.clipboard.writeText(message); toast.success('Copied'); } catch { toast.error('Copy didn’t work — select the text instead'); } };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="password-dialog">
        <DialogHeader><DialogTitle>Send {first || 'the customer'} their login</DialogTitle><DialogDescription>This password is shown only now. They’ll pick their own after signing in.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 p-4 text-center"><p className="text-xs text-slate-500">Mobile +91 {account.phone}</p><p className="mt-1 select-all font-mono text-2xl font-semibold tracking-wider text-slate-900" data-testid="client-password">{password}</p></div>
          <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 p-3 font-sans text-xs text-slate-600">{message}</pre>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={copy} className="gap-1.5"><Copy className="h-4 w-4" />Copy message</Button>
          <a href={wa(account.phone, message)} target="_blank" rel="noopener noreferrer"><Button className="w-full gap-1.5 bg-[#12803D] text-white hover:bg-[#0F6E34]" data-testid="client-send-wa"><MessageCircle className="h-4 w-4" />Send on WhatsApp</Button></a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
