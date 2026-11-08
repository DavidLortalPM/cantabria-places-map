// Cantabria Places Map — static snapshot of the Notion "Places & Activities" database.
// Data lives in /data/places.json (see scripts/build-data.mjs). Add a category by adding an entry to CATEGORIES.

const CATEGORIES = {
  hike:       { label: 'Hikes',              color: '#2f855a', glyph: '🥾' },
  family:     { label: 'Family',             color: '#2b6cb0', glyph: '🎈' },
  walk:       { label: 'Easy walks',         color: '#2c9c91', glyph: '🚶' },
  attraction: { label: 'Places & day trips', color: '#dd6b20', glyph: '📍' },
  cultura:    { label: 'Pasaporte Cultura',  color: '#805ad5', glyph: '🏛️' }
};
const STAGES = ['Do now', 'Build towards', 'Major objective'];
const STAGE_HELP = { 'Do now': 'Ready to do this year', 'Build towards': 'Needs some fitness or planning first', 'Major objective': 'Big day, mountain experience needed' };
const KIND_LABEL = { 'Museum': 'Museum / exhibition centre', 'Cultural site': 'Historic or archaeological site', 'Cave': 'Cave (guided visit, book ahead)', 'Viewpoint': 'Viewpoint', 'Day trip': 'Day-trip idea' };
const KIND_GLYPH = { 'Museum': '🏛️', 'Cultural site': '🏰', 'Cave': '🔦', 'Viewpoint': '🔭', 'Day trip': '🗺️' };

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
let routeLayer = null, routeBounds = null; // route line of the selected hike (drawn from /routes/<id>.json)

function pinIcon(p, sel) {
  const cat = CATEGORIES[p.category] || CATEGORIES.attraction;
  const glyph = KIND_GLYPH[p.kind] || cat.glyph;
  const cls = 'pin' + (openStatus(p).open === false ? ' closed' : '') + (sel ? ' sel' : '') + (p.locationStatus === 'approximate' ? ' approx' : p.locationStatus === 'unverified' ? ' unverified' : '');
  return L.divIcon({ className: '', html: `<div class="${cls}" style="--c:${cat.color}">${glyph}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = d => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fmtMD = s => parseInt(s.slice(3), 10) + ' ' + MONTHS[parseInt(s.slice(0, 2), 10) - 1];
// Is this place open on weekday `day`, judged in today's season? -> {open: true|false|null, text}
function openStatus(p, day = new Date().getDay(), when = new Date()) {
  const o = p.open;
  if (!o) return { open: null, text: '' };
  if (o.seasons) {
    const t = md(when);
    if (!o.seasons.some(s => t >= s.from && t <= s.to)) {
      const froms = o.seasons.map(s => s.from).sort();
      return { open: false, text: 'Out of season — next opening ' + fmtMD(froms.find(f => f > t) || froms[0]) };
    }
  }
  return o.days.includes(day) ? { open: true, text: 'Usually open ' + DAY_NAMES[day] + 's' } : { open: false, text: 'Closed on ' + DAY_NAMES[day] + 's' };
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
  const geometry = p.route ? 'Route drawn from the track (' + p.route.km + ' km)' : h.routeGeometry === 'Full track' && h.gpxUrl ? 'Track/GPX link held' : h.routeGeometry === 'Trailhead only' ? 'Trailhead only — no track yet' : 'No track held';
  return [`
    <div class="tags">
      ${h.stage ? `<span class="tag">${esc(h.stage)}</span>` : ''}
      ${h.difficulty ? `<span class="tag">${esc(h.difficulty)}</span>` : ''}
      ${h.routeType ? `<span class="tag">${esc(h.routeType)}</span>` : ''}
      ${p.familyFriendly ? '<span class="tag">Family friendly</span>' : ''}
      ${p.route ? '<span class="tag ok">Route on map</span>' : ''}
    </div>
    <div class="stats">${stat('Distance', h.distanceKm != null ? h.distanceKm + ' km' : (h.distanceText || ''))}${stat('Ascent', h.ascentM != null ? h.ascentM + ' m' : '')}${stat('Duration', h.duration)}</div>`, `
    ${h.plannedVersion ? `<div class="callout"><b>Planned version:</b> ${esc(h.plannedVersion)}</div>` : ''}
    ${p.route?.note ? `<div class="callout">${esc(p.route.note)}</div>` : ''}
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}
    ${warn}
    <dl class="kv">
      ${kv('Children', h.childSuitability)}
      ${kv('Best months / conditions', h.conditions)}
      ${kv('Trailhead / start', h.trailhead)}
      ${kv('Parking', h.parking)}
      ${kv('Terrain', h.terrain)}
      ${kv('Drive from base', p.drive)}
      ${kv('Track', [h.trackSource, geometry].filter(Boolean).join(' · '))}
    </dl>`];
}

function renderPlace(p) {
  const prices = p.adult != null ? `${money(p.adult)} adult${p.child != null ? ' · ' + money(p.child) + ' child' : ''}` : '';
  return [`
    <div class="tags">
      ${p.familyFriendly ? '<span class="tag">Family friendly</span>' : ''}
      ${p.rainyDay ? `<span class="tag">Rainy day: ${esc(p.rainyDay)}</span>` : ''}
      ${(() => { const s = openStatus(p); return s.open === null ? '' : `<span class="tag ${s.open ? 'ok' : 'warn'}">${s.open ? 'Open today' : 'Closed today'}</span>`; })()}
      ${p.category === 'cultura' ? '<span class="tag">Included in Pasaporte Cultura</span>' : ''}
    </div>
    <div class="rows">${row('Visit time', p.visitTime)}${row('Price', prices)}</div>`, `
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}
    <div class="rows">${row('Drive from base', p.drive)}</div>
    ${p.booking ? `<div class="callout">${esc(p.booking)}</div>` : ''}
    ${p.open?.seasonNote ? `<div class="callout">${esc(p.open.seasonNote)}</div>` : ''}
    ${p.hours ? `<details><summary>Opening hours</summary><p>${esc(p.hours)}</p></details>` : ''}`];
}

function openSheet(p) {
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false));
  selected = p.id;
  markers[p.id].setIcon(pinIcon(p, true));
  const cat = CATEGORIES[p.category];
  const h = p.hike || {};
  const im = p.image;
  const [quick, more] = p.category === 'hike' || p.category === 'walk' ? renderHike(p) : renderPlace(p);
  $('sheet-body').innerHTML = `
    <h2>${esc(p.name)}</h2>
    <div class="sub">${esc([p.kind || cat.label, p.area].filter(Boolean).join(' · '))}</div>
    ${quick}
    <div class="actions">
      ${link(gmapsLink(p), p.category === 'hike' || p.category === 'walk' ? 'Google Maps (start)' : 'Google Maps', true)}
      <button class="more-btn" type="button" aria-expanded="false">Details ▴</button>
    </div>
    <div class="sh-more">
      ${im ? `<figure class="hero"><img src="${esc(im.src)}" alt="${esc(p.name)}" loading="lazy"><figcaption>Photo: ${esc(im.credit)} · <a href="${esc(im.page)}" target="_blank" rel="noopener">${esc(im.license || 'Wikimedia Commons')}</a></figcaption></figure>` : ''}
      ${more}
      <div class="links">
        ${link(h.officialUrl, 'Official route')}
        ${link(h.allTrailsUrl, 'AllTrails')}
        ${link(h.gpxUrl, 'GPX / track')}
        ${link(p.link, p.category === 'cultura' ? 'Official page' : 'More info')}
      </div>
      <div class="locnote">${esc(LOCATION_LABEL[p.locationStatus] || '')}${p.locationSource ? ' — ' + esc(p.locationSource) : ''}</div>
    </div>`;
  $('sheet').classList.remove('exp');
  $('sheet').hidden = false;
  $('sheet-body').scrollTop = 0;
  $('fpanel').hidden = true; $('btn-filters').setAttribute('aria-expanded', 'false');
  layoutSheet(true);
  showRoute(p);
}

function clearRoute() {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = null; routeBounds = null;
}
async function showRoute(p) {
  clearRoute();
  if (!p.route) return;
  try {
    const r = await (await fetch('/routes/' + encodeURIComponent(p.id) + '.json')).json();
    if (selected !== p.id || !r.points?.length) return; // another place was picked meanwhile
    const casing = { color: '#fff', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false };
    const line = { color: '#d9480f', weight: 4.5, opacity: 0.98, lineCap: 'round', lineJoin: 'round', interactive: false };
    const end = r.circular ? [] : [L.circleMarker(r.end, { radius: 6, color: '#fff', weight: 2, fillColor: '#d9480f', fillOpacity: 1, interactive: false })];
    routeLayer = L.layerGroup([L.polyline(r.points, casing), L.polyline(r.points, line), ...end]).addTo(map);
    routeBounds = L.latLngBounds(r.points);
    layoutSheet(true);
    setTimeout(() => { if (selected === p.id) layoutSheet(true); }, 700); // again once any zoom animation / sheet transition has settled
  } catch { /* offline and not cached yet: the pin is still shown */ }
}

// Phone sheet: "peek" (name, key facts, Google Maps) <-> expanded (everything, scrolls). Desktop shows it all as a side card.
const phone = () => window.innerWidth < 720;
function setExpanded(on) {
  const s = $('sheet'), b = s.querySelector('.more-btn');
  s.classList.toggle('exp', on);
  b.textContent = on ? 'Less ▾' : 'Details ▴'; b.setAttribute('aria-expanded', String(on));
  layoutSheet(true);
}
// Keep the floating buttons above the sheet and the selected pin inside the part of the map that is still visible.
function layoutSheet(reveal) {
  const s = $('sheet'), root = document.documentElement.style;
  if (s.hidden || !phone()) root.removeProperty('--ctrl-b'); else root.setProperty('--ctrl-b', (window.innerHeight - s.getBoundingClientRect().top + 12) + 'px');
  if (reveal) requestAnimationFrame(() => {
    if (!selected || s.hidden) return;
    const p = byId[selected], pt = map.latLngToContainerPoint([p.lat, p.lon]), size = map.getSize(), r = s.getBoundingClientRect();
    const box = phone() ? { l: 24, t: 70, r: size.x - 24, b: r.top - 28 } : { l: r.right + 24, t: 70, r: size.x - 70, b: size.y - 24 };
    if (routeBounds) { // fit the whole route into the map area not covered by the sheet
      map.fitBounds(routeBounds, { paddingTopLeft: [box.l, box.t], paddingBottomRight: [Math.max(0, size.x - box.r), Math.max(0, size.y - box.b)], maxZoom: 15 });
      return;
    }
    if (pt.x > box.l && pt.x < box.r && pt.y > box.t && pt.y < box.b) return;
    map.panBy([pt.x - (box.l + box.r) / 2, pt.y - (box.t + box.b) / 2]);
  });
}
new ResizeObserver(() => layoutSheet(false)).observe($('sheet'));
window.addEventListener('resize', () => layoutSheet(true));
$('sheet-body').addEventListener('click', e => { if (e.target.closest('.more-btn')) setExpanded(!$('sheet').classList.contains('exp')); });
$('sheet-grab').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!$('sheet').classList.contains('exp')); } });
// Swipe up/down on the handle (or anywhere on the compact sheet); tap the handle to toggle. Swipe down on the compact sheet closes it.
(() => {
  const s = $('sheet'); let y0 = null, moved = false, fromGrab = false;
  s.addEventListener('pointerdown', e => { if (!phone() || e.target.closest('#sheet-close')) return; fromGrab = !!e.target.closest('#sheet-grab'); if (fromGrab || !s.classList.contains('exp')) { y0 = e.clientY; moved = false; } });
  s.addEventListener('pointermove', e => { if (y0 !== null && Math.abs(e.clientY - y0) > 8) moved = true; });
  s.addEventListener('pointerup', e => {
    if (y0 === null) return;
    const dy = e.clientY - y0, exp = s.classList.contains('exp'); y0 = null;
    if (moved && Math.abs(dy) > 36) { if (dy < 0) setExpanded(true); else if (exp) setExpanded(false); else closeSheet(); }
    else if (!moved && fromGrab) setExpanded(!exp);
  });
  s.addEventListener('pointercancel', () => { y0 = null; });
})();
function buildLegend(places, unplaced) {
  const cats = Object.entries(CATEGORIES).filter(([k]) => places.some(p => p.category === k));
  const kinds = [...new Set(places.map(p => p.kind).filter(Boolean))];
  const status = new Set(places.map(p => p.locationStatus));
  $('legend').innerHTML = `
    <button class="x" type="button" aria-label="Close key">×</button>
    <h3>Key</h3>
    <h4>Colour = layer</h4>
    ${cats.map(([, c]) => `<div class="lg"><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</div>`).join('')}
    <h4>Icon = type</h4>
    ${kinds.map(k => `<div class="lg"><span class="ic">${KIND_GLYPH[k] || ''}</span>${esc(KIND_LABEL[k] || k)}</div>`).join('')}
    ${cats.map(([k, c]) => ({ hike: 'Hike start (trailhead)', walk: 'Easy walk start', family: 'Family activity', attraction: 'Place / other' })[k] ? `<div class="lg"><span class="ic">${c.glyph}</span>${({ hike: 'Hike start (trailhead)', walk: 'Easy walk start', family: 'Family activity', attraction: 'Place / other' })[k]}</div>` : '').join('')}
    ${cats.some(([k]) => k === 'hike') ? `<h4>Hike stage</h4>${STAGES.map(s => `<div class="lg"><span><b>${esc(s)}</b> — ${esc(STAGE_HELP[s])}</span></div>`).join('')}` : ''}
    <h4>Outline = location accuracy</h4>
    <div class="lg"><span class="sw ring"></span>Solid: verified</div>
    ${status.has('approximate') || cats.some(([k]) => k === 'hike') ? '<div class="lg"><span class="sw ring dashed"></span>Dashed: approximate start</div>' : ''}
    ${status.has('unverified') || cats.some(([k]) => k === 'hike') ? '<div class="lg"><span class="sw ring dotted"></span>Dotted: needs verifying</div>' : ''}
    ${unplaced.length ? `<details class="unplaced"><summary>${unplaced.length} not on the map yet (no start point found)</summary><ul>${unplaced.map(u => `<li>${esc(u.name)}</li>`).join('')}</ul></details>` : ''}`;
}
const closePanels = () => { $('legend').hidden = true; $('fpanel').hidden = true; $('btn-filters').setAttribute('aria-expanded', 'false'); };
$('btn-legend').addEventListener('click', e => { e.stopPropagation(); const show = $('legend').hidden; closePanels(); $('legend').hidden = !show; });
$('legend').addEventListener('click', e => { if (e.target.closest('.x')) $('legend').hidden = true; });
$('btn-filters').addEventListener('click', e => { e.stopPropagation(); const show = $('fpanel').hidden; closePanels(); $('fpanel').hidden = !show; e.currentTarget.setAttribute('aria-expanded', String(show)); });
map.on('click', closePanels);

function closeSheet() {
  $('sheet').hidden = true;
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false));
  selected = null;
  clearRoute();
}
$('sheet-close').addEventListener('click', closeSheet);
map.on('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheet(); closePanels(); } });

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
  const opt = { rainy: false, day: 'any' };
  const visible = p => {
    if (!on[p.category]) return false;
    if (p.category === 'hike' && stageOn[p.hike?.stage] === false) return false;
    if (opt.rainy && p.rainyDay !== 'Good') return false;
    if (opt.day !== 'any' && openStatus(p, +opt.day).open === false) return false;
    return true;
  };
  const refresh = () => {
    let shown = 0;
    for (const p of places) {
      const g = groups[p.category], m = markers[p.id];
      if (visible(p)) { g.addLayer(m); shown++; } else g.removeLayer(m);
    }
    const nf = STAGES.filter(s => stageOn[s] === false).length + (opt.rainy ? 1 : 0) + (opt.day !== 'any' ? 1 : 0);
    const badge = $('btn-filters').querySelector('.badge');
    badge.hidden = !nf; badge.textContent = nf;
    $('fcount').textContent = `Showing ${shown} of ${places.length} places`;
    $('freset').hidden = !nf;
    if (selected && !visible(byId[selected])) closeSheet();
    safeStore.set('layers', JSON.stringify(on));
    safeStore.set('stages', JSON.stringify(stageOn));
    if (stageBar) stageBar.hidden = !on.hike;
    if (stageHead) stageHead.hidden = !on.hike;
  };
  let stageBar = null, stageHead = null;
  const panel = $('fpanel');
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
  const fade = () => chips.classList.toggle('more', chips.scrollLeft + chips.clientWidth < chips.scrollWidth - 4);
  chips.addEventListener('scroll', fade, { passive: true }); window.addEventListener('resize', fade); fade();

  // Hiking Stage sub-filter (only when there are hikes)
  const counts = STAGES.map(s => places.filter(p => p.category === 'hike' && p.hike?.stage === s).length);
  if (counts.some(Boolean)) {
    const savedStages = (() => { try { return JSON.parse(safeStore.get('stages') || 'null'); } catch { return null; } })();
    stageHead = document.createElement('h4'); stageHead.textContent = 'Hiking stage';
    stageBar = document.createElement('div');
    stageBar.id = 'stages'; stageBar.className = 'frow';
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
    panel.append(stageHead, stageBar);
  }
  // Planning filters: rainy-day options and "open on" a weekday (only places with opening data can be ruled out)
  if (places.some(p => p.rainyDay || p.open)) {
    const bar = document.createElement('div');
    bar.id = 'planbar'; bar.className = 'frow';
    const rb = document.createElement('button');
    rb.className = 'chip small rainy'; rb.type = 'button'; rb.setAttribute('aria-pressed', 'false');
    rb.textContent = '☔ Rainy-day options';
    rb.addEventListener('click', () => { opt.rainy = !opt.rainy; rb.setAttribute('aria-pressed', String(opt.rainy)); refresh(); });
    const sel = document.createElement('select');
    sel.className = 'chip small'; sel.setAttribute('aria-label', 'Open on');
    const today = new Date().getDay();
    sel.innerHTML = '<option value="any">Open: any day</option>' +
      '<option value="' + today + '">Open today (' + DAY_NAMES[today] + ')</option>' +
      [1, 2, 3, 4, 5, 6, 0].map(d => '<option value="' + d + '">Open ' + DAY_NAMES[d] + '</option>').join('');
    sel.addEventListener('change', () => { opt.day = sel.value; refresh(); });
    bar.append(rb, sel);
    const ph = document.createElement('h4'); ph.textContent = 'Planning';
    panel.append(ph, bar);
  }
  const rs = document.createElement('button');
  rs.id = 'freset'; rs.type = 'button'; rs.textContent = 'Reset filters';
  rs.addEventListener('click', () => {
    STAGES.forEach(s => { stageOn[s] = true; });
    opt.rainy = false; opt.day = 'any';
    panel.querySelectorAll('button[aria-pressed]').forEach(b => b.setAttribute('aria-pressed', String(!b.classList.contains('rainy'))));
    const dsel = panel.querySelector('select'); if (dsel) dsel.value = 'any';
    refresh();
  });
  panel.appendChild(rs);
  refresh();
  buildLegend(places, data.unplaced || []);

  if (places.length) map.fitBounds(L.latLngBounds(places.map(p => [p.lat, p.lon])), { padding: [50, 50], maxZoom: 10, animate: false });

  const hash = decodeURIComponent(location.hash.slice(1));
  if (byId[hash]) { if (!byId[hash].route) map.setView([byId[hash].lat, byId[hash].lon], 12); openSheet(byId[hash]); } // routes zoom themselves
}
init();

// Stay current: look for a new version on load and whenever the app comes back to the foreground, and reload once
// when a new service worker takes over (unless a place sheet is open) so updates show without a second open.
if ('serviceWorker' in navigator) {
  let hadController = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading && $('sheet').hidden) { reloading = true; location.reload(); }
    hadController = true;
  });
  navigator.serviceWorker.register('/sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}
