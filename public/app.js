// Cantabria Places Map — static snapshot of the Notion "Places & Activities" database.
// Data lives in /data/places.json (see scripts/build-data.mjs). Add a category by adding an entry to CATEGORIES.

const CATEGORIES = {
  hike:       { label: 'Hikes',              color: '#2f855a', glyph: '🥾' },
  family:     { label: 'Family',             color: '#2b6cb0', glyph: '🎈' },
  attraction: { label: 'Places & day trips', color: '#dd6b20', glyph: '📍' },
  cultura:    { label: 'Pasaporte Cultura',  color: '#805ad5', glyph: '🏛️' }
};
const STAGES = ['Do now', 'Build towards', 'Major objective'];
const STAGE_HELP = { 'Do now': 'Ready to do this year', 'Build towards': 'Needs some fitness or planning first', 'Major objective': 'Big day, mountain experience needed' };
const KIND_LABEL = { 'Museum': 'Museum / exhibition centre', 'Cultural site': 'Historic or archaeological site', 'Cave': 'Cave (guided visit, book ahead)' };
const KIND_GLYPH = { 'Museum': '🏛️', 'Cultural site': '🏰', 'Cave': '🔦' };

const LOCATION_LABEL = {
  verified: 'Verified location',
  approximate: 'Approximate location (trailhead/start not yet exact)',
  unverified: 'Location still needs verification'
};

const BASES = [
  { name: 'Streets', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' } },
  { name: 'Terrain', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opt: { maxZoom: 17, attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)' } }
];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeStore = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};

const map = L.map('map', { zoomControl: false, tap: true }).setView([43.1, -4.3], 9);
if (window.innerWidth >= 720) L.control.zoom({ position: 'bottomright' }).addTo(map);
map.attributionControl.setPrefix(false);

let baseIdx = safeStore.get('base') === '1' ? 1 : 0;
let baseLayer = L.tileLayer(BASES[baseIdx].url, BASES[baseIdx].opt).addTo(map);
$('btn-base').title = 'Map style: ' + BASES[baseIdx].name;
$('btn-base').addEventListener('click', () => {
  baseIdx = 1 - baseIdx;
  safeStore.set('base', String(baseIdx));
  map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(BASES[baseIdx].url, BASES[baseIdx].opt).addTo(map);
  $('btn-base').title = 'Map style: ' + BASES[baseIdx].name;
});

const groups = {};   // category -> L.layerGroup
const markers = {};  // id -> L.marker
const byId = {};
let selected = null;

function pinIcon(p, sel) {
  const cat = CATEGORIES[p.category] || CATEGORIES.attraction;
  const glyph = KIND_GLYPH[p.kind] || cat.glyph;
  const cls = 'pin' + (sel ? ' sel' : '') + (p.locationStatus === 'approximate' ? ' approx' : p.locationStatus === 'unverified' ? ' unverified' : '');
  return L.divIcon({ className: '', html: `<div class="${cls}" style="--c:${cat.color}">${glyph}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}

const money = n => (n === 0 ? 'Free' : '€' + String(n).replace(/\.5$/, '.50'));
const gmapsLink = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;

function row(label, value) { return value || value === 0 ? `<div class="row"><span>${esc(label)}</span><b>${esc(value)}</b></div>` : ''; }
function stat(label, value) { return value || value === 0 ? `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>` : ''; }
function kv(label, value) { return value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : ''; }
function link(href, text, primary) { return href ? `<a ${primary ? 'class="primary" ' : ''}href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : ''; }

function renderHike(p) {
  const h = p.hike || {};
  const warn = h.exposure ? `<div class="callout"><b>Exposure / scrambling:</b> ${esc(h.exposure)}</div>` : '';
  const geometry = h.routeGeometry === 'Full track' && h.gpxUrl ? 'Track/GPX link held' : h.routeGeometry === 'Trailhead only' ? 'Trailhead only — no track yet' : 'No track held';
  return `
    <div class="tags">
      ${h.stage ? `<span class="tag">${esc(h.stage)}</span>` : ''}
      ${h.difficulty ? `<span class="tag">${esc(h.difficulty)}</span>` : ''}
      ${h.routeType ? `<span class="tag">${esc(h.routeType)}</span>` : ''}
      ${p.familyFriendly ? '<span class="tag">Family friendly</span>' : ''}
    </div>
    ${h.plannedVersion ? `<div class="callout"><b>Planned version:</b> ${esc(h.plannedVersion)}</div>` : ''}
    <div class="stats">${stat('Distance', h.distanceKm != null ? h.distanceKm + ' km' : (h.distanceText || ''))}${stat('Ascent', h.ascentM != null ? h.ascentM + ' m' : '')}${stat('Duration', h.duration)}</div>
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}
    ${warn}
    <dl class="kv">
      ${kv('Children', h.childSuitability)}
      ${kv('Best months / conditions', h.conditions)}
      ${kv('Trailhead / start', h.trailhead)}
      ${kv('Parking', h.parking)}
      ${kv('Terrain', h.terrain)}
      ${kv('Drive from Mortera', p.drive)}
      ${kv('Track', [h.trackSource, geometry].filter(Boolean).join(' · '))}
    </dl>`;
}

function renderPlace(p) {
  const prices = p.adult != null ? `${money(p.adult)} adult${p.child != null ? ' · ' + money(p.child) + ' child' : ''}` : '';
  return `
    <div class="tags">
      ${p.familyFriendly ? '<span class="tag">Family friendly</span>' : ''}
      ${p.rainyDay ? `<span class="tag">Rainy day: ${esc(p.rainyDay)}</span>` : ''}
      ${p.category === 'cultura' ? '<span class="tag">Included in Pasaporte Cultura</span>' : ''}
    </div>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}
    <div class="rows">${row('Visit time', p.visitTime)}${row('Price', prices)}${row('Drive from Mortera', p.drive)}</div>
    ${p.booking ? `<div class="callout">${esc(p.booking)}</div>` : ''}
    ${p.hours ? `<details><summary>Opening hours</summary><p>${esc(p.hours)}</p></details>` : ''}`;
}

function openSheet(p) {
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false));
  selected = p.id;
  markers[p.id].setIcon(pinIcon(p, true));
  const cat = CATEGORIES[p.category];
  const h = p.hike || {};
  const im = p.image;
  $('sheet-body').innerHTML = `
    ${im ? `<figure class="hero"><img src="${esc(im.src)}" alt="${esc(p.name)}" loading="lazy"><figcaption>Photo: ${esc(im.credit)} · <a href="${esc(im.page)}" target="_blank" rel="noopener">${esc(im.license || 'Wikimedia Commons')}</a></figcaption></figure>` : ''}
    <h2>${esc(p.name)}</h2>
    <div class="sub">${esc([p.kind || cat.label, p.area].filter(Boolean).join(' · '))}</div>
    ${p.category === 'hike' ? renderHike(p) : renderPlace(p)}
    <div class="links">
      ${link(gmapsLink(p), p.category === 'hike' ? 'Google Maps (start)' : 'Google Maps', true)}
      ${link(h.officialUrl, 'Official route')}
      ${link(h.allTrailsUrl, 'AllTrails')}
      ${link(h.gpxUrl, 'GPX / track')}
      ${link(p.link, p.category === 'cultura' ? 'Official page' : 'More info')}
      ${link(p.notion, 'Notion')}
    </div>
    <div class="locnote">${esc(LOCATION_LABEL[p.locationStatus] || '')}${p.locationSource ? ' — ' + esc(p.locationSource) : ''}</div>`;
  $('sheet').hidden = false;
  $('sheet').scrollTop = 0;
  if (window.innerWidth < 720) { // keep the pin visible above the bottom sheet
    const y = map.latLngToContainerPoint([p.lat, p.lon]).y;
    if (y > window.innerHeight * 0.35) map.panBy([0, y - window.innerHeight * 0.2]);
  }
}
function buildLegend(places, unplaced) {
  const cats = Object.entries(CATEGORIES).filter(([k]) => places.some(p => p.category === k));
  const kinds = [...new Set(places.map(p => p.kind).filter(Boolean))];
  const status = new Set(places.map(p => p.locationStatus));
  $('legend').innerHTML = `
    <h3>Key</h3>
    <h4>Colour = layer</h4>
    ${cats.map(([, c]) => `<div class="lg"><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</div>`).join('')}
    <h4>Icon = type</h4>
    ${kinds.map(k => `<div class="lg"><span class="ic">${KIND_GLYPH[k] || ''}</span>${esc(KIND_LABEL[k] || k)}</div>`).join('')}
    ${cats.some(([k]) => k === 'hike') ? `<div class="lg"><span class="ic">🥾</span>Hike start (trailhead)</div>` : ''}
    ${cats.some(([k]) => k === 'hike') ? `<h4>Hike stage</h4>${STAGES.map(s => `<div class="lg"><b>${esc(s)}</b>&nbsp;— ${esc(STAGE_HELP[s])}</div>`).join('')}` : ''}
    <h4>Outline = location accuracy</h4>
    <div class="lg"><span class="sw ring"></span>Solid: verified</div>
    ${status.has('approximate') || cats.some(([k]) => k === 'hike') ? '<div class="lg"><span class="sw ring dashed"></span>Dashed: approximate start</div>' : ''}
    ${status.has('unverified') || cats.some(([k]) => k === 'hike') ? '<div class="lg"><span class="sw ring dotted"></span>Dotted: needs verifying</div>' : ''}
    ${unplaced.length ? `<details class="unplaced"><summary>${unplaced.length} hikes not on the map yet (no start point found)</summary><ul>${unplaced.map(u => `<li>${esc(u.name)}</li>`).join('')}</ul></details>` : ''}`;
}
$('btn-legend').addEventListener('click', e => { e.stopPropagation(); $('legend').hidden = !$('legend').hidden; });
map.on('click', () => { $('legend').hidden = true; });

function closeSheet() {
  $('sheet').hidden = true;
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false));
  selected = null;
}
$('sheet-close').addEventListener('click', closeSheet);
map.on('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

$('btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 11));
  }, () => {}, { enableHighAccuracy: true, timeout: 10000 });
});

async function init() {
  let data;
  try {
    data = await (await fetch('/data/places.json')).json();
  } catch {
    $('filters').innerHTML = '<span class="chip">Could not load places</span>';
    return;
  }
  const places = data.places.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const saved = (() => { try { return JSON.parse(safeStore.get('layers') || 'null'); } catch { return null; } })();
  const on = {};

  for (const p of places) {
    byId[p.id] = p;
    const g = groups[p.category] || (groups[p.category] = L.layerGroup());
    markers[p.id] = L.marker([p.lat, p.lon], { icon: pinIcon(p, false), title: p.name, riseOnHover: true })
      .on('click', e => { L.DomEvent.stopPropagation(e); openSheet(p); })
      .addTo(g);
  }

  const stageOn = Object.fromEntries(STAGES.map(s => [s, true]));
  const visible = p => on[p.category] && (p.category !== 'hike' || stageOn[p.hike?.stage] !== false);
  const refresh = () => {
    for (const p of places) {
      const g = groups[p.category], m = markers[p.id];
      visible(p) ? g.addLayer(m) : g.removeLayer(m);
    }
    if (selected && !visible(byId[selected])) closeSheet();
    safeStore.set('layers', JSON.stringify(on));
    safeStore.set('stages', JSON.stringify(stageOn));
    if (stageBar) stageBar.hidden = !on.hike;
  };
  let stageBar = null;
  const chips = $('filters');
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const n = places.filter(p => p.category === key).length;
    if (!n) continue; // empty categories stay hidden until they have data
    on[key] = saved ? saved[key] !== false : true;
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.style.setProperty('--c', cat.color);
    b.innerHTML = `<span class="dot"></span>${esc(cat.label)} <span class="n">${n}</span>`;
    b.setAttribute('aria-pressed', String(on[key]));
    groups[key].addTo(map);
    b.addEventListener('click', () => { on[key] = !on[key]; b.setAttribute('aria-pressed', String(on[key])); refresh(); });
    chips.appendChild(b);
  }

  // Hiking Stage sub-filter (only when there are hikes)
  const counts = STAGES.map(s => places.filter(p => p.category === 'hike' && p.hike?.stage === s).length);
  if (counts.some(Boolean)) {
    const savedStages = (() => { try { return JSON.parse(safeStore.get('stages') || 'null'); } catch { return null; } })();
    stageBar = document.createElement('div');
    stageBar.id = 'stages';
    STAGES.forEach((s, i) => {
      if (!counts[i]) return;
      if (savedStages) stageOn[s] = savedStages[s] !== false;
      const sb = document.createElement('button');
      sb.className = 'chip small'; sb.type = 'button'; sb.title = STAGE_HELP[s];
      sb.setAttribute('aria-pressed', String(stageOn[s]));
      sb.innerHTML = `${esc(s)} <span class="n">${counts[i]}</span>`;
      sb.addEventListener('click', () => { stageOn[s] = !stageOn[s]; sb.setAttribute('aria-pressed', String(stageOn[s])); refresh(); });
      stageBar.appendChild(sb);
    });
    document.body.appendChild(stageBar);
  }
  refresh();
  buildLegend(places, data.unplaced || []);

  if (places.length) map.fitBounds(L.latLngBounds(places.map(p => [p.lat, p.lon])), { padding: [50, 50], maxZoom: 10 });

  const hash = decodeURIComponent(location.hash.slice(1));
  if (byId[hash]) { map.setView([byId[hash].lat, byId[hash].lon], 12); openSheet(byId[hash]); }
}
init();
