// Cantabria Places Map — static snapshot of the Notion "Places & Activities" database.
// Data lives in /data/places.json (see scripts/build-data.mjs). Add a category by adding an entry to CATEGORIES.

const CATEGORIES = {
  hike:       { label: 'Hikes',   single: 'Hike',            color: '#2f855a', glyph: '🥾' },
  family:     { label: 'Family',  single: 'Family activity', color: '#2b6cb0', glyph: '🎈' },
  walk:       { label: 'Walks',   single: 'Easy walk',       color: '#0e7490', glyph: '🚶' },
  attraction: { label: 'Places',  single: 'Place',           color: '#dd6b20', glyph: '📍' },
  cultura:    { label: 'Culture', single: 'Pasaporte Cultura', color: '#805ad5', glyph: '🏛️' }
};
const STAGES = ['Do now', 'Build towards', 'Major objective'];
const STAGE_HELP = { 'Do now': 'Ready to do this year', 'Build towards': 'Needs some fitness or planning first', 'Major objective': 'Big day, mountain experience needed' };
const KIND_LABEL = { 'Museum': 'Museum / exhibition centre', 'Cultural site': 'Historic or archaeological site', 'Cave': 'Cave (guided visit, book ahead)', 'Viewpoint': 'Viewpoint', 'Day trip': 'Day-trip idea' };
const KIND_GLYPH = { 'Museum': '🏛️', 'Cultural site': '🏰', 'Cave': '🔦', 'Viewpoint': '🔭', 'Day trip': '🧭' };
const RAIN = { Good: 'Good in rain', Poor: 'Poor in rain', Mixed: 'Mixed in rain' };

const LOCATION_LABEL = {
  verified: 'Verified location',
  approximate: 'Approximate position',
  unverified: 'Position still needs verification'
};

const BASES = [
  { name: 'Streets', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, crossOrigin: true, attribution: '&copy; OpenStreetMap contributors' } },
  { name: 'Terrain', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opt: { maxZoom: 17, crossOrigin: true, attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)' } }
];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeStore = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const A = reduce ? { animate: false } : {}; // passed to every programmatic map move
const wide = matchMedia('(min-width:720px)');
const phone = () => !wide.matches;

const map = L.map('map', { zoomControl: false, tap: true, zoomAnimation: !reduce, fadeAnimation: !reduce, markerZoomAnimation: !reduce }).setView([43.1, -4.3], 9);
const zoomCtl = L.control.zoom({ position: 'bottomright' });
const syncZoom = () => { if (wide.matches && !zoomCtl._map) zoomCtl.addTo(map); else if (!wide.matches) zoomCtl.remove(); };
syncZoom();
wide.addEventListener('change', () => { syncZoom(); layoutSheet(true); });
map.attributionControl.setPrefix(false);
const lo = () => map.getContainer().classList.toggle('map-lo', map.getZoom() <= 9); // overview: small dots instead of full pins
map.on('zoomend', lo); lo();

let baseIdx = safeStore.get('base') === '1' ? 1 : 0;
let baseLayer = L.tileLayer(BASES[baseIdx].url, BASES[baseIdx].opt).addTo(map);
const baseLabel = () => {
  const b = $('btn-base'), msg = 'Map style: ' + BASES[baseIdx].name + '. Switch to ' + BASES[1 - baseIdx].name;
  b.title = msg; b.setAttribute('aria-label', msg);
};
baseLabel();
$('btn-base').addEventListener('click', () => {
  baseIdx = 1 - baseIdx;
  safeStore.set('base', String(baseIdx));
  map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(BASES[baseIdx].url, BASES[baseIdx].opt).addTo(map);
  baseLabel();
});

// Small non-blocking message (role=status), fades after 3 s
const toastEl = Object.assign(document.createElement('div'), { id: 'toast' });
toastEl.setAttribute('role', 'status');
document.body.appendChild(toastEl);
let toastT = 0;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3000);
}

const groups = {};   // category -> L.layerGroup
const markers = {};  // id -> L.marker
const byId = {};
let selected = null;
let routeLayer = null, routeBounds = null, routeSeq = 0; // route line of the selected hike (drawn from /routes/<id>.json)
let prevView = null, autoView = null, autoUntil = 0;     // view before the first selection / view after our own fit (to restore on close)
let revealPlace = () => {};                              // set in init: re-enables whatever filter hides a place

const typeLabel = p => p.kind || (CATEGORIES[p.category] || CATEGORIES.attraction).single;

function pinIcon(p, sel) {
  const cat = CATEGORIES[p.category] || CATEGORIES.attraction;
  const glyph = KIND_GLYPH[p.kind] || cat.glyph;
  const cls = 'pin' + (openStatus(p).open === false ? ' closed' : '') + (sel ? ' sel' : '') + (p.locationStatus === 'approximate' ? ' approx' : p.locationStatus === 'unverified' ? ' unverified' : '');
  return L.divIcon({ className: 'pinwrap', html: `<div class="${cls}" style="--c:${cat.color}" aria-hidden="true">${glyph}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const madridFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
// "Today" is judged in Spanish time wherever the phone is
function madrid(d = new Date()) {
  const o = {};
  for (const x of madridFmt.formatToParts(d)) o[x.type] = x.value;
  return { day: WD.indexOf(o.weekday.slice(0, 3)), md: o.month + '-' + o.day, year: +o.year };
}
const fmtMD = s => parseInt(s.slice(3), 10) + ' ' + MONTHS[parseInt(s.slice(0, 2), 10) - 1];
const inSeason = (s, t) => s.from <= s.to ? t >= s.from && t <= s.to : t >= s.from || t <= s.to; // from > to wraps the new year
// Is this place open on weekday `day` (default: today), judged in today's season? -> {open: true|false|null, text}
function openStatus(p, day, when = new Date()) {
  const o = p.open;
  if (!o) return { open: null, text: '' };
  const m = madrid(when), t = m.md;
  day ??= m.day;
  let days = o.days ?? [0, 1, 2, 3, 4, 5, 6], res;
  const stale = o.year && m.year > o.year ? ' (dates may be out of date)' : '';
  if (o.seasons) {
    const s = o.seasons.find(s => inSeason(s, t));
    if (!s) {
      const froms = o.seasons.map(s => s.from).sort();
      return { open: false, text: 'Closed today: out of season, reopens ' + fmtMD(froms.find(f => f > t) || froms[0]) + stale };
    }
    days = s.days ?? days;
  }
  res = days.includes(day) ? { open: true, text: 'Usually open ' + DAY_NAMES[day] + 's' + stale } : { open: false, text: 'Closed today: closed on ' + DAY_NAMES[day] + 's' + stale };
  return res;
}
const money = n => (n === 0 ? 'Free' : '€' + String(n).replace(/\.5$/, '.50'));
const gmapsLink = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;

function row(label, value) { return value || value === 0 ? `<div class="row"><span>${esc(label)}</span><b>${esc(value)}</b></div>` : ''; }
function stat(label, value) { return value || value === 0 ? `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>` : ''; }
function kv(label, value) { return value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : ''; }
function link(href, text, primary) { return href && /^https?:\/\//i.test(href) ? `<a ${primary ? 'class="primary" ' : ''}href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : ''; }
const tags = list => { const l = list.filter(Boolean).slice(0, 3); return l.length ? `<div class="tags">${l.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''; };
const statusLine = p => { const s = openStatus(p); return s.open === null ? '' : `<div class="status ${s.open ? 'ok' : 'warn'}">${esc(s.text)}</div>`; };
const nbHyphen = s => s.replace(/\b[A-Z]{2,}-(?=[A-Z0-9])/g, m => m.slice(0, -1) + '‑'); // keep codes like CA-ENP35 on one line

function renderHike(p) {
  const h = p.hike || {};
  const warn = h.exposure ? `<div class="callout"><b>Exposure / scrambling:</b> ${esc(h.exposure)}</div>` : '';
  const hasInfo = Object.keys(h).length > 0 || p.route;
  const geometry = p.route || (h.routeGeometry === 'Full track' && h.gpxUrl) ? 'GPX track available' : h.routeGeometry === 'Trailhead only' ? 'Trailhead only — no GPX track yet' : 'No GPX track yet';
  const dist = p.route ? stat(p.route.circular ? 'Loop' : 'One way', p.route.km + ' km') : stat('Distance', h.distanceKm != null ? h.distanceKm + ' km' : (h.distanceText || ''));
  const stats = [dist, stat('Ascent', h.ascentM != null ? h.ascentM + ' m' : ''), stat('Duration', h.duration)];
  const driveQuick = p.drive && stats.filter(Boolean).length < 2;
  if (driveQuick) stats.push(stat('Drive', p.drive));
  return [`
    ${tags([h.stage, h.difficulty, p.route ? '' : h.routeType, p.familyFriendly ? 'Family friendly' : ''])}
    <div class="stats">${stats.join('')}</div>`, `
    ${h.plannedVersion ? `<div class="callout"><b>Planned version:</b> ${esc(h.plannedVersion)}</div>` : ''}
    ${p.route?.note ? `<div class="callout">${esc(p.route.note)}</div>` : ''}
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}
    ${warn}
    <dl class="kv">
      ${kv('Children', h.childSuitability)}
      ${kv('Best months / conditions', h.conditions)}
      ${kv(p.category === 'walk' ? 'Start' : 'Trailhead / start', h.trailhead)}
      ${kv('Parking', h.parking)}
      ${kv('Terrain', h.terrain)}
      ${driveQuick ? '' : kv('Drive from base', p.drive)}
      ${hasInfo ? kv('Track', [h.trackSource, geometry].filter(Boolean).join(' · ')) : ''}
    </dl>`];
}

function renderPlace(p) {
  const prices = p.adult != null ? `${money(p.adult)} adult${p.child != null ? ' · ' + money(p.child) + ' child' : ''}` : '';
  const rows = [row('Visit time', p.visitTime), row('Price', prices)].filter(Boolean);
  const driveQuick = p.drive && rows.length < 2;
  if (driveQuick) rows.push(row('Drive from base', p.drive));
  return [`
    ${tags([p.familyFriendly ? 'Family friendly' : '', p.rainyDay ? (RAIN[p.rainyDay] || p.rainyDay) : ''])}
    ${statusLine(p)}
    <div class="rows">${rows.join('')}</div>`, `
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}
    ${driveQuick ? '' : `<div class="rows">${row('Drive from base', p.drive)}</div>`}
    ${p.booking ? `<div class="callout">${esc(p.booking)}</div>` : ''}
    ${p.open?.seasonNote ? `<div class="callout">${esc(p.open.seasonNote)}</div>` : ''}
    ${p.hours ? `<details><summary>Opening hours</summary><p>${esc(p.hours)}</p></details>` : ''}`];
}

function rememberView() { if (!prevView) { prevView = { c: map.getCenter(), z: map.getZoom() }; autoView = null; } }

function openSheet(p) {
  rememberView();
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false));
  selected = p.id;
  markers[p.id].setIcon(pinIcon(p, true));
  const h = p.hike || {};
  const im = p.image;
  const [quick, more] = p.category === 'hike' || p.category === 'walk' ? renderHike(p) : renderPlace(p);
  $('sheet-body').innerHTML = `
    <h2 id="sheet-title" tabindex="-1">${nbHyphen(esc(p.name))}</h2>
    <div class="sub">${esc([typeLabel(p), p.area].filter(Boolean).join(' · '))}</div>
    ${quick}
    <div class="actions">
      ${link(gmapsLink(p), p.category === 'hike' || p.category === 'walk' ? 'Google Maps (start)' : 'Google Maps', true)}
      <button class="more-btn" type="button" aria-expanded="false">Details ▴</button>
    </div>
    <div class="sh-more">
      ${im ? `<figure class="hero"><img src="${esc(im.src)}" alt="${esc(p.name)}" loading="lazy"><figcaption>Photo: ${esc(im.credit)} · ${im.page && /^https?:\/\//i.test(im.page) ? `<a href="${esc(im.page)}" target="_blank" rel="noopener">${esc(im.license || 'Wikimedia Commons')}</a>` : esc(im.license || '')}</figcaption></figure>` : ''}
      ${more}
      <div class="links">
        ${link(h.officialUrl, 'Official route')}
        ${link(h.allTrailsUrl, 'AllTrails')}
        ${link(h.gpxUrl, 'GPX / track')}
        ${link(p.link, p.category === 'cultura' ? 'Official page' : 'More info')}
      </div>
      <div class="locnote">${esc(LOCATION_LABEL[p.locationStatus] || '')}</div>
    </div>`;
  const s = $('sheet');
  s.classList.remove('exp'); document.body.classList.remove('sheet-exp');
  $('sheet-grab').setAttribute('aria-expanded', 'false');
  s.hidden = false;
  $('sheet-body').scrollTop = 0;
  closePanels();
  history.replaceState(null, '', '#' + p.id);
  layoutSheet(true);
  showRoute(p);
  $('sheet-title').focus({ preventScroll: true });
}

function clearRoute() {
  routeSeq++;
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = null; routeBounds = null;
}
async function showRoute(p) {
  clearRoute();
  if (!p.route) return;
  const my = ++routeSeq;
  try {
    const res = await fetch('/routes/' + encodeURIComponent(p.id) + '.json');
    if (!res.ok) return;
    const r = await res.json();
    if (my !== routeSeq || selected !== p.id || !r.points?.length) return; // another place was picked meanwhile
    const o = { lineCap: 'round', lineJoin: 'round', interactive: false };
    const end = r.circular ? [] : [L.circleMarker(r.end, { radius: 6, color: '#fff', weight: 2, fillColor: '#f76707', fillOpacity: 1, interactive: false })];
    routeLayer = L.layerGroup([
      L.polyline(r.points, { ...o, color: '#fff', weight: 11, opacity: 0.8 }),
      L.polyline(r.points, { ...o, color: '#7a2a00', weight: 8, opacity: 0.95 }),
      L.polyline(r.points, { ...o, color: '#f76707', weight: 4.5, opacity: 1 }), ...end]).addTo(map);
    routeBounds = L.latLngBounds(r.points);
    layoutSheet(true);
    setTimeout(() => { if (selected === p.id && my === routeSeq) layoutSheet(true); }, 700); // again once any zoom animation / sheet transition has settled
  } catch { /* offline and not cached yet: the pin is still shown */ }
}

// Phone sheet: "peek" (name, key facts, Google Maps) <-> expanded (everything, scrolls). Desktop shows it all as a side card.
function setExpanded(on) {
  const s = $('sheet'), b = s.querySelector('.more-btn');
  s.classList.toggle('exp', on);
  document.body.classList.toggle('sheet-exp', on);
  if (b) { b.textContent = on ? 'Less ▾' : 'Details ▴'; b.setAttribute('aria-expanded', String(on)); }
  $('sheet-grab').setAttribute('aria-expanded', String(on));
  layoutSheet(true);
}
// Keep the floating buttons above the sheet and (in the peek layout) the selected pin / route inside the part of the map that is still visible.
function layoutSheet(reveal) {
  const s = $('sheet'), root = document.documentElement.style;
  if (s.hidden || !phone()) root.removeProperty('--ctrl-b'); else root.setProperty('--ctrl-b', (window.innerHeight - s.getBoundingClientRect().top + 12) + 'px');
  if (reveal) requestAnimationFrame(() => {
    if (!selected || s.hidden || (phone() && s.classList.contains('exp'))) return; // an expanded sheet never moves the map
    const p = byId[selected], pt = map.latLngToContainerPoint([p.lat, p.lon]), size = map.getSize(), r = s.getBoundingClientRect();
    const box = phone() ? { l: 24, t: 70, r: size.x - 24, b: r.top - 28 } : { l: r.right + 24, t: 70, r: size.x - 70, b: size.y - 24 };
    autoUntil = Date.now() + 1200;
    if (routeBounds) { // fit the whole route into the map area not covered by the sheet
      map.fitBounds(routeBounds, { paddingTopLeft: [box.l, box.t], paddingBottomRight: [Math.max(0, size.x - box.r), Math.max(0, size.y - box.b)], maxZoom: 15, ...A });
      return;
    }
    if (pt.x > box.l && pt.x < box.r && pt.y > box.t && pt.y < box.b) return;
    map.panBy([pt.x - (box.l + box.r) / 2, pt.y - (box.t + box.b) / 2], A);
  });
}
map.on('moveend', () => { if (Date.now() < autoUntil) autoView = { c: map.getCenter(), z: map.getZoom() }; });
new ResizeObserver(() => layoutSheet(false)).observe($('sheet'));
let lastPhone = phone(), lastLand = innerWidth > innerHeight;
window.addEventListener('resize', () => { // only a real layout change (breakpoint / rotation) may move the map
  const ph = phone(), land = innerWidth > innerHeight, cross = ph !== lastPhone || land !== lastLand;
  lastPhone = ph; lastLand = land; syncZoom(); layoutSheet(cross); // syncZoom again: some embedded webviews skip the media-query change event
});
$('sheet-body').addEventListener('click', e => { if (e.target.closest('.more-btn')) setExpanded(!$('sheet').classList.contains('exp')); });
$('sheet-grab').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!$('sheet').classList.contains('exp')); } });
// Swipe up/down on the handle (or up on the compact sheet); tap the handle to toggle. Only the handle (or the x) closes the compact sheet by swiping down.
(() => {
  const s = $('sheet'); let y0 = null, moved = false, fromGrab = false;
  s.addEventListener('pointerdown', e => { if (!phone() || e.target.closest('#sheet-close')) return; fromGrab = !!e.target.closest('#sheet-grab'); if (fromGrab || !s.classList.contains('exp')) { y0 = e.clientY; moved = false; } });
  s.addEventListener('pointermove', e => { if (y0 !== null && Math.abs(e.clientY - y0) > 8) moved = true; });
  s.addEventListener('pointerup', e => {
    if (y0 === null) return;
    const dy = e.clientY - y0, exp = s.classList.contains('exp'); y0 = null;
    if (moved && Math.abs(dy) > 36) { if (dy < 0) setExpanded(true); else if (exp) setExpanded(false); else if (fromGrab) closeSheet(); }
    else if (!moved && fromGrab) setExpanded(!exp);
  });
  s.addEventListener('pointercancel', () => { y0 = null; });
})();

function buildLegend(places, unplaced) {
  const cats = new Set(places.map(p => p.category));
  const kinds = [...new Set(places.map(p => p.kind).filter(Boolean))];
  const status = new Set(places.map(p => p.locationStatus));
  const types = [
    ...['hike', 'walk', 'family'].filter(k => cats.has(k)).map(k => [CATEGORIES[k].glyph, CATEGORIES[k].single]),
    ...(places.some(p => p.category === 'attraction' && !p.kind) ? [[CATEGORIES.attraction.glyph, 'Place']] : []),
    ...kinds.map(k => [KIND_GLYPH[k] || '', KIND_LABEL[k] || k])
  ];
  $('legend').innerHTML = `
    <div class="lh"><h3>Key</h3><button class="x" type="button" aria-label="Close key">×</button></div>
    <h4>Icon = type</h4>
    ${types.map(([g, t]) => `<div class="lg"><span class="ic">${g}</span>${esc(t)}</div>`).join('')}
    <h4>Pins and lines</h4>
    ${places.some(p => p.open) ? '<div class="lg"><span class="sw fade"></span>Faded pin: closed today / out of season</div>' : ''}
    ${places.some(p => p.route) ? '<div class="lg"><span class="sw line"></span>Orange line: hike route</div>' : ''}
    ${status.has('approximate') ? '<div class="lg"><span class="sw ring dashed"></span>Dashed outline: approximate position</div>' : ''}
    ${status.has('unverified') ? '<div class="lg"><span class="sw ring dotted"></span>Dotted outline: needs verifying</div>' : ''}
    ${unplaced.length ? `<details class="unplaced"><summary>${unplaced.length} not on the map yet (no start point found)</summary><ul>${unplaced.map(u => `<li>${esc(u.name)}</li>`).join('')}</ul></details>` : ''}
    <p class="credit">Map data © OpenStreetMap contributors</p>`;
}
function closePanels() {
  $('legend').hidden = true; $('fpanel').hidden = true;
  $('btn-filters').setAttribute('aria-expanded', 'false'); $('btn-legend').setAttribute('aria-expanded', 'false');
}
const panelOpen = () => !$('legend').hidden || !$('fpanel').hidden;
function togglePanel(panel, btn) {
  const show = panel.hidden; closePanels();
  if (show) { if (!phone()) closeSheet(); panel.hidden = false; } // on desktop the side card and the panels overlap
  btn.setAttribute('aria-expanded', String(show));
  return show;
}
$('btn-legend').addEventListener('click', e => { e.stopPropagation(); if (togglePanel($('legend'), e.currentTarget)) $('legend').querySelector('.x')?.focus({ preventScroll: true }); });
$('legend').addEventListener('click', e => { if (e.target.closest('.x')) { closePanels(); $('btn-legend').focus(); } });
$('btn-filters').addEventListener('click', e => { e.stopPropagation(); togglePanel($('fpanel'), e.currentTarget); });

function closeSheet(restoreFocus) {
  const was = selected;
  $('sheet').hidden = true;
  $('sheet').classList.remove('exp'); document.body.classList.remove('sheet-exp');
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false));
  selected = null;
  clearRoute();
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  layoutSheet(false);
  if (prevView) { // put the map back where it was, unless the user has moved it since we framed the place
    const moved = !autoView || Math.abs(map.getZoom() - autoView.z) > 0.01 || map.latLngToContainerPoint(map.getCenter()).distanceTo(map.latLngToContainerPoint(autoView.c)) > 4;
    if (!moved) map.flyTo(prevView.c, prevView.z, { duration: 1, ...A });
    prevView = null; autoView = null;
  }
  if (restoreFocus === true && was && markers[was]?.getElement()) markers[was].getElement().focus({ preventScroll: true });
}
$('sheet-close').addEventListener('click', () => closeSheet(true));
map.on('click', () => {
  if (panelOpen()) { closePanels(); return; }
  if ($('sheet').hidden) return;
  if (phone() && $('sheet').classList.contains('exp')) setExpanded(false); else closeSheet();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (panelOpen()) { closePanels(); return; }
  closeSheet(true);
});

let meMarker = null;
$('btn-locate').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!navigator.geolocation) { toast("Location isn't available here"); return; }
  if (b.getAttribute('aria-busy') === 'true') return;
  b.setAttribute('aria-busy', 'true');
  navigator.geolocation.getCurrentPosition(pos => {
    b.removeAttribute('aria-busy');
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (meMarker) meMarker.setLatLng(ll);
    else meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, keyboard: false }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 11), A);
  }, () => { b.removeAttribute('aria-busy'); toast("Couldn't get your location"); }, { enableHighAccuracy: true, timeout: 10000 });
});

function openFromHash() {
  let id = '';
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* malformed hash */ }
  const p = byId[id];
  if (!p) { if (!id && selected) closeSheet(); return; }
  if (selected === p.id && !$('sheet').hidden) return;
  revealPlace(p);
  rememberView();
  if (!p.route) map.setView([p.lat, p.lon], 12, A); // routes zoom themselves
  openSheet(p);
}
window.addEventListener('hashchange', openFromHash);

async function init() {
  let data;
  try {
    const res = await fetch('/data/places.json');
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    $('filters').innerHTML = '<span class="chip">Could not load places</span>';
    return;
  }
  const places = data.places.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const saved = (() => { try { return JSON.parse(safeStore.get('layers') || 'null'); } catch { return null; } })();
  const on = {};
  const ui = { layer: {}, stage: {}, rb: null, sel: null };

  for (const p of places) {
    byId[p.id] = p;
    const g = groups[p.category] || (groups[p.category] = L.layerGroup());
    const m = L.marker([p.lat, p.lon], { icon: pinIcon(p, false), title: p.name + ', ' + typeLabel(p), riseOnHover: true })
      .on('click', e => { L.DomEvent.stopPropagation(e); openSheet(p); })
      .on('add', () => { const el = m.getElement(); if (el) el.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); openSheet(p); } }; }) // Enter and Space (Leaflet only maps Enter via keypress)
      .addTo(g);
    markers[p.id] = m;
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
  const sync = () => { // bring the controls in line with the state
    for (const k in ui.layer) ui.layer[k].setAttribute('aria-pressed', String(on[k]));
    for (const s in ui.stage) ui.stage[s].setAttribute('aria-pressed', String(stageOn[s]));
    ui.rb?.setAttribute('aria-pressed', String(opt.rainy));
    if (ui.sel) ui.sel.value = opt.day;
  };
  const refresh = () => {
    const shown = {};
    let n = 0;
    for (const p of places) {
      const g = groups[p.category], m = markers[p.id];
      if (visible(p)) { g.addLayer(m); n++; shown[p.category] = (shown[p.category] || 0) + 1; } else g.removeLayer(m);
    }
    const nf = STAGES.filter(s => stageOn[s] === false).length + (opt.rainy ? 1 : 0) + (opt.day !== 'any' ? 1 : 0) + Object.values(on).filter(v => !v).length;
    const badge = $('btn-filters').querySelector('.badge');
    badge.hidden = !nf; badge.textContent = nf;
    $('fcount').innerHTML = `Showing ${n} of ${places.length} places<div class="lc">${Object.keys(on).map(k => `${esc(CATEGORIES[k].label)} ${shown[k] || 0}/${places.filter(p => p.category === k).length}`).join(' · ')}</div>`;
    $('freset').hidden = !nf;
    if (selected && !visible(byId[selected])) closeSheet();
    safeStore.set('layers', JSON.stringify(on));
    safeStore.set('stages', JSON.stringify(stageOn));
    if (stageBar) stageBar.hidden = !on.hike;
    if (stageHead) stageHead.hidden = !on.hike;
    sync();
  };
  revealPlace = p => {
    on[p.category] = true;
    if (p.hike?.stage) stageOn[p.hike.stage] = true;
    if (opt.rainy && p.rainyDay !== 'Good') opt.rainy = false;
    if (opt.day !== 'any' && openStatus(p, +opt.day).open === false) opt.day = 'any';
    refresh();
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
    b.innerHTML = `<span class="dot"></span>${esc(cat.label)}`;
    b.setAttribute('aria-pressed', String(on[key]));
    groups[key].addTo(map);
    b.addEventListener('click', () => { on[key] = !on[key]; refresh(); });
    ui.layer[key] = b;
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
      sb.innerHTML = `${esc(s)} <span class="n">${counts[i]}</span>`;
      sb.addEventListener('click', () => { stageOn[s] = !stageOn[s]; refresh(); });
      ui.stage[s] = sb;
      stageBar.appendChild(sb);
    });
    panel.append(stageHead, stageBar);
  }
  // Planning filters: rainy-day options and "open on" a weekday (only places with opening data can be ruled out)
  if (places.some(p => p.rainyDay || p.open)) {
    const bar = document.createElement('div');
    bar.id = 'planbar'; bar.className = 'frow';
    const rb = document.createElement('button');
    rb.className = 'chip small rainy'; rb.type = 'button';
    rb.textContent = '☔ Rainy-day options';
    rb.addEventListener('click', () => { opt.rainy = !opt.rainy; refresh(); });
    const sel = document.createElement('select');
    sel.className = 'chip small'; sel.setAttribute('aria-label', 'Open on');
    const today = madrid().day;
    sel.innerHTML = '<option value="any">Open: any day</option>' +
      '<option value="' + today + '">Open today (' + DAY_NAMES[today] + ')</option>' +
      [1, 2, 3, 4, 5, 6, 0].map(d => '<option value="' + d + '">Open ' + DAY_NAMES[d] + '</option>').join('');
    sel.addEventListener('change', () => { opt.day = sel.value; refresh(); });
    ui.rb = rb; ui.sel = sel;
    bar.append(rb, sel);
    const ph = document.createElement('h4'); ph.textContent = 'Planning';
    panel.append(ph, bar);
  }
  const rs = document.createElement('button');
  rs.id = 'freset'; rs.type = 'button'; rs.textContent = 'Reset filters';
  rs.addEventListener('click', () => {
    STAGES.forEach(s => { stageOn[s] = true; });
    for (const k in on) on[k] = true;
    opt.rainy = false; opt.day = 'any';
    refresh();
  });
  panel.appendChild(rs);
  refresh();
  buildLegend(places, data.unplaced || []);

  if (places.length) map.fitBounds(L.latLngBounds(places.map(p => [p.lat, p.lon])), { padding: [70, 70], maxZoom: 9, animate: false });
  openFromHash();
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
