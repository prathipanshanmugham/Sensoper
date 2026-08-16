/**
 * India state-level choropleth for the Expansion module.
 *
 * Uses a compact centroid+rough-polygon representation of the 28 states
 * (drawn to scale in a normalised SVG viewBox). Colour intensity encodes
 * the max score of any district in the state; branches show as pins.
 *
 * When a state is clicked, the parent gets an onStateSelect(state) callback
 * so the ranked table below can filter to that state.
 *
 * Note: This is a simplified state-level view. A true district-level
 * choropleth requires a ~2MB India-districts GeoJSON, deferred to a
 * future iteration (see PRD).
 */
import { useMemo, useState } from 'react';

// Rough state polygons in the normalised SVG viewBox 0..1000 × 0..1000.
// Each entry: name + list of polygon points (x, y). These are drawn
// approximations — good enough to visualise regional strength.
const STATE_POLYGONS = {
  "Jammu and Kashmir": "260,60 380,50 450,120 400,180 300,190 250,140",
  "Ladakh":            "400,90 500,80 540,150 470,200 400,180",
  "Himachal Pradesh":  "360,180 440,180 450,230 380,250 340,220",
  "Punjab":            "290,190 370,200 375,255 310,260",
  "Uttarakhand":       "440,220 505,215 510,275 445,275",
  "Haryana":           "330,255 395,255 395,315 335,320",
  "Delhi":             "365,300 385,300 385,320 365,320",
  "Rajasthan":         "220,255 335,255 330,395 235,405 200,320",
  "Uttar Pradesh":     "395,280 555,285 580,395 480,410 400,370",
  "Bihar":             "580,335 675,335 680,395 585,400",
  "Sikkim":            "670,300 710,300 710,330 670,330",
  "Assam":             "760,320 855,310 870,395 780,395",
  "Arunachal Pradesh": "830,240 940,250 950,310 850,310",
  "Nagaland":          "870,335 910,335 910,375 870,375",
  "Manipur":           "870,380 915,380 915,425 870,425",
  "Mizoram":           "830,435 870,435 870,485 830,485",
  "Tripura":           "790,410 830,410 830,455 790,455",
  "Meghalaya":         "720,360 810,360 810,395 720,395",
  "West Bengal":       "660,395 725,390 735,505 680,510 665,455",
  "Odisha":            "530,470 660,460 670,555 545,565",
  "Jharkhand":         "570,395 655,395 660,460 570,460",
  "Chhattisgarh":      "460,430 555,435 560,530 465,530",
  "Madhya Pradesh":    "310,395 460,395 470,485 320,485",
  "Gujarat":           "170,375 285,375 295,470 195,490 155,440",
  "Maharashtra":       "215,485 460,485 465,600 230,595",
  "Goa":               "245,600 290,600 290,635 245,635",
  "Karnataka":         "280,600 415,595 415,750 275,740",
  "Andhra Pradesh":    "415,565 545,570 555,745 420,740",
  "Telangana":         "395,530 490,525 495,600 410,600",
  "Kerala":            "295,745 380,750 380,880 320,890 285,820",
  "Tamil Nadu":        "380,745 500,745 510,910 385,905",
  "Puducherry":        "490,780 505,780 505,795 490,795",
};

// Simplified state centroids for label placement
const STATE_CENTROIDS = Object.fromEntries(
  Object.entries(STATE_POLYGONS).map(([name, pts]) => {
    const coords = pts.split(' ').map(p => p.split(',').map(Number));
    const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    return [name, { cx, cy }];
  })
);


function scoreColor(score) {
  if (score == null || score === 0) return { fill: '#e2e8f0', text: '#94a3b8' };  // no data
  if (score >= 80) return { fill: '#10b981', text: 'white' };      // strong
  if (score >= 60) return { fill: '#f59e0b', text: 'white' };      // watch
  if (score >= 40) return { fill: '#38bdf8', text: 'white' };      // serve
  return { fill: '#f43f5e', text: 'white' };                        // no case
}


// Convert lat/lon (India range ~ 8..37N, 68..98E) to normalised svg 0..1000
export function latLonToSvg(lat, lon) {
  if (lat == null || lon == null) return null;
  const x = ((lon - 68) / (98 - 68)) * 1000;
  const y = ((37 - lat) / (37 - 8)) * 1000;
  return { x, y };
}


export default function IndiaChoropleth({ districts = [], branches = [], onStateSelect, selectedState = 'all' }) {
  const [hoverState, setHoverState] = useState(null);

  // Aggregate: max score, project count per state
  const stateAgg = useMemo(() => {
    const m = {};
    for (const d of districts) {
      const s = d.state || 'Unknown';
      if (!m[s]) m[s] = { max_score: 0, projects: 0, districts_count: 0, top_district: null };
      m[s].projects += d.metrics?.projects || 0;
      m[s].districts_count += 1;
      if (d.score > m[s].max_score) {
        m[s].max_score = d.score;
        m[s].top_district = d.district;
      }
    }
    return m;
  }, [districts]);

  return (
    <div className="relative rounded-lg border border-slate-200 bg-white p-3" data-testid="india-choropleth">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">India — Opportunity Map</p>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" />Strong</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block" />Watch</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-sky-500 inline-block" />Serve</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-rose-500 inline-block" />No Case</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-slate-200 inline-block" />No Data</span>
        </div>
      </div>

      <svg viewBox="0 0 1000 950" className="w-full h-auto max-h-[520px]">
        {/* State polygons */}
        {Object.entries(STATE_POLYGONS).map(([name, pts]) => {
          const agg = stateAgg[name];
          const c = scoreColor(agg?.max_score);
          const isSelected = selectedState === name;
          const isHover = hoverState === name;
          return (
            <g key={name}
               onClick={() => onStateSelect && onStateSelect(name)}
               onMouseEnter={() => setHoverState(name)}
               onMouseLeave={() => setHoverState(null)}
               style={{ cursor: 'pointer' }}
               data-testid={`state-${name.replace(/\s+/g, '-')}`}
            >
              <polygon
                points={pts}
                fill={c.fill}
                stroke={isSelected ? '#0f172a' : isHover ? '#334155' : 'white'}
                strokeWidth={isSelected ? 2.5 : isHover ? 1.8 : 1}
                opacity={agg ? 0.92 : 0.6}
              />
            </g>
          );
        })}
        {/* State labels */}
        {Object.entries(STATE_CENTROIDS).map(([name, { cx, cy }]) => {
          const agg = stateAgg[name];
          const c = scoreColor(agg?.max_score);
          return (
            <g key={`lbl-${name}`} pointerEvents="none">
              <text x={cx} y={cy - 2} textAnchor="middle" fontSize="10" fill={c.text} fontWeight="600" style={{ textShadow: '0 0 3px rgba(0,0,0,0.4)' }}>
                {name.length > 12 ? name.slice(0, 10) + '…' : name}
              </text>
              {agg && (
                <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill={c.text} opacity="0.9">
                  {agg.max_score.toFixed(0)} · {agg.projects} proj
                </text>
              )}
            </g>
          );
        })}
        {/* Branch pins */}
        {branches.map((b, i) => {
          const p = latLonToSvg(b.latitude, b.longitude);
          if (!p) return null;
          return (
            <g key={`br-${i}`} data-testid={`branch-pin-${b.name}`}>
              <circle cx={p.x} cy={p.y} r="6" fill="#0f172a" stroke="white" strokeWidth="2" />
              <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="9" fill="#0f172a" fontWeight="700">{b.name?.slice(0, 12)}</text>
            </g>
          );
        })}
        {/* District score pins on top of chart */}
        {districts.filter(d => d.metrics?.projects && !d.confidence_low).slice(0, 25).map((d, i) => {
          // Find one project lat/lon for this district — proxied by hovering district in ExpansionPage instead
          return null;   // (deferred until we get real district GeoJSON)
        })}
      </svg>

      {/* Hover tooltip */}
      {hoverState && stateAgg[hoverState] && (
        <div className="absolute top-2 right-2 rounded-lg border border-slate-200 bg-white shadow-lg p-2.5 text-xs max-w-xs" data-testid="choropleth-tooltip">
          <p className="font-bold text-slate-900">{hoverState}</p>
          <div className="grid grid-cols-2 gap-1 mt-1 text-[11px]">
            <div><span className="text-slate-500">Max Score</span><br/><span className="font-bold text-slate-800">{stateAgg[hoverState].max_score.toFixed(1)}</span></div>
            <div><span className="text-slate-500">Projects</span><br/><span className="font-bold text-slate-800">{stateAgg[hoverState].projects}</span></div>
            <div><span className="text-slate-500">Districts</span><br/><span className="font-bold text-slate-800">{stateAgg[hoverState].districts_count}</span></div>
            <div><span className="text-slate-500">Top District</span><br/><span className="font-bold text-slate-800 truncate">{stateAgg[hoverState].top_district || '—'}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
