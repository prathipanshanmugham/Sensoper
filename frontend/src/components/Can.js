/* Shows its children only when Settings → Permissions allows it, e.g.
 *   <Can module="module_inventory" action="export"><Button>Excel</Button></Can>
 *   <Can option="can_approve_quotation">…</Can>
 * Admins always pass. */
import { useAuth } from '../contexts/AuthContext';

export default function Can({ module, action = 'view', option, children, fallback = null }) {
  const { can } = useAuth();
  const ok = option ? can(option) : can(module, action);
  return ok ? children : fallback;
}
