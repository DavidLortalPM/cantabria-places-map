// Cantabria Places Map — static snapshot of the Notion "Places & Activities" database.
// Data lives in /data/places.json (see scripts/build-data.mjs). Add a category by adding an entry to CATEGORIES.

const CATEGORIES = {
  hike:       { label: 'Hikes',              color: '#2f855a', glyph: '🥾' },
  family:     { label: 'Family',             color: '#2b6cb0', glyph: '🎈' },
  attraction: { label: 'Places & day trips', color: '#dd6b20', glyph: '📍' },
  cultura:    { label: 'Pasaporte Cultura',  color: '#805ad5', glyph: '🏛️' }
};
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

function stat(label, value) { return value || value === 0 ? `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>` : ''; }
function kv(label, value) { return value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : ''; }
function link(href, text, primary) { return href ? `<a ${primary ? 'class="primary" ' : ''}href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : ''; }

function renderHike(p) {
  const h = p.hike || {};
  const warn = h.exposure ? `<div class="callout"><b>Exposure / scrambling:</b> ${esc(h.exposure)}</div>` : '';
  const geometry = h.routeGeometry === 'Full track' ? 'Full track available' : h.routeGeometry === 'Trailhead only' ? 'Trailhead only — no track yet' : h.routeGeometry ? 'Route geometry missing' : '';
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
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}
    <div class="stats">${stat('Visit', p.visitTime)}${stat('Price', prices)}${stat('Drive', p.drive)}</div>
    ${p.booking ? `<div class="callout">${esc(p.booking)}</div>` : ''}
    ${p.hours ? `<details><summary>Opening hours</summary><p>${esc(p.hours)}</p></details>` : ''}`;
}

function openSheet(p) {
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false));
  selected = p.id;
  markers[p.id].setIcon(pinIcon(p, true));
  const cat = CATEGORIES[p.category];
  const h = p.hike || {};
  $('sheet-body').innerHTML = `
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

  const chips = $('filters');
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const n = places.filter(p => p.category === key).length;
    if (!n) continue; // empty categories stay hidden until they have data
    on[key] = saved ? saved[key] !== false : true;
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.style.setProperty('--c', cat.color);
    b.innerHTML = `<span class="dot"></span>${esc(cat.label)} <span class="n">${n}</span>`;
    const apply = () => {
      b.setAttribute('aria-pressed', String(on[key]));
      on[key] ? groups[key].addTo(map) : map.removeLayer(groups[key]);
      if (selected && byId[selected].category === key && !on[key]) closeSheet();
      safeStore.set('layers', JSON.stringify(on));
    };
    b.addEventListener('click', () => { on[key] = !on[key]; apply(); });
    chips.appendChild(b);
    apply();
  }

  if (places.length) map.fitBounds(L.latLngBounds(places.map(p => [p.lat, p.lon])), { padding: [50, 50], maxZoom: 10 });

  const hash = decodeURIComponent(location.hash.slice(1));
  if (byId[hash]) { map.setView([byId[hash].lat, byId[hash].lon], 12); openSheet(byId[hash]); }
}
init();
