import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { locationsAPI } from '../utils/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { MapPin } from 'lucide-react';

const ALL_VALUE = '__all__';

/** Shared location-scope state for report/export screens (Iter 45 Change 6).
 * Admins default to "All Locations — Consolidated" and may pick any location.
 * Everyone else is restricted to their assigned location(s); if they have exactly
 * one, it's auto-selected and the picker is disabled. */
export function useLocationScope(storageKey) {
  const { user, isAdmin } = useAuth();
  const key = storageKey && user ? `${storageKey}_${user.id}` : null;
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState(() => (key && localStorage.getItem(key)) || '');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    locationsAPI.list().then(r => {
      const locs = r.data || [];
      setLocations(locs);
      const stored = key && localStorage.getItem(key);
      if (!isAdmin) {
        if (locs.length === 1) setLocationId(locs[0].id);
        else if (locs.length > 0 && !locs.find(l => l.id === (stored || locationId))) setLocationId(locs[0].id);
        else if (stored) setLocationId(stored);
      } else if (stored && !locs.find(l => l.id === stored)) {
        setLocationId('');
      }
      setReady(true);
    }).catch(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, key]);

  useEffect(() => {
    if (key && ready) localStorage.setItem(key, locationId || '');
  }, [locationId, key, ready]);

  const singleLocation = !isAdmin && locations.length === 1;
  const locationLabel = !locationId ? 'All Locations — Consolidated' : (locations.find(l => l.id === locationId)?.name || 'Selected Location');

  return { locations, locationId, setLocationId, locationLabel, isAdmin, singleLocation, ready };
}

export function LocationScopeSelect({ scope, testIdPrefix = 'location-scope', className = 'h-9' }) {
  const { locations, locationId, setLocationId, isAdmin, singleLocation } = scope;
  if (!isAdmin && locations.length === 0) return null;
  return (
    <Select value={locationId || ALL_VALUE} onValueChange={(v) => setLocationId(v === ALL_VALUE ? '' : v)} disabled={singleLocation}>
      <SelectTrigger className={`${className} bg-white`} data-testid={`${testIdPrefix}-select`}>
        <MapPin className="h-3.5 w-3.5 mr-1 text-slate-400 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {isAdmin && <SelectItem value={ALL_VALUE}>All Locations — Consolidated</SelectItem>}
        {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
