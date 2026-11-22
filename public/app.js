// Cantabria Places Map — static snapshot of the Notion "Places & Activities" database.
// Data lives in /data/places.json (see scripts/build-data.mjs). Add a category by adding an entry to CATEGORIES.

// Key order = order of the category strip, the Key and the intro
const CATEGORIES = {
  hike:       { label: 'Hikes',   single: 'Hike',            color: '#2f855a', glyph: '🥾' },
  walk:       { label: 'Walks',   single: 'Easy walk',       color: '#0e7490', glyph: '🚶' },
  restaurant: { label: 'Food',    single: 'Restaurant',      color: '#c53030', glyph: '🍽️' },
  cultura:    { label: 'Culture', single: 'Pasaporte Cultura', color: '#805ad5', glyph: '🏛️' },
  family:     { label: 'Family',  single: 'Family activity', color: '#2b6cb0', glyph: '🎈' },
  attraction: { label: 'Sights',  single: 'Sight',           color: '#dd6b20', glyph: '📍' }
};
const STAGES = ['Do now', 'Build towards', 'Major objective'];
const STAGE_HELP = { 'Do now': 'Ready to do this year', 'Build towards': 'Needs some fitness or planning first', 'Major objective': 'Big day, mountain experience needed' };
const KIND_GLYPH = { 'Tapas & pintxos': '🍢', 'Café / breakfast': '☕', 'Market': '🧺', 'Seafood': '🦐', 'Asador (grill)': '🥩', 'Sidrería': '🍺', 'Traditional Cantabrian': '🍲', 'Japanese': '🍣', 'Spanish-Moroccan': '🥘', 'Museum': '🏛️', 'Cultural site': '🏰', 'Cave': '🔦', 'Viewpoint': '🔭', 'Day trip': '🧭' };
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

// Languages of the "More details" texts. A new language = public/data/details.<lang>.json (scripts/build-details.mjs)
// + its code in LANGS + its strings in STRINGS. A language picker appears in More once there is more than one.
const LANGS = ['en'];
const LANG_NAMES = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };
const STRINGS = {
  en: {
    moreDetails: 'More details',
    sources: 'Sources',
    note: 'Translated from Spanish tourism sources (CANTUR / Turismo de Cantabria). Check opening times before you go.',
    uncertain: 'Some of these details could not be confirmed.',
    language: 'Language'
  }
};
let lang = (() => {
  const saved = safeStore.get('lang');
  if (LANGS.includes(saved)) return saved;
  const nav = String(navigator.language || '').slice(0, 2).toLowerCase();
  return LANGS.includes(nav) ? nav : 'en';
})();
const t = k => STRINGS[lang]?.[k] ?? STRINGS.en[k] ?? k;

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
  for (const x of $('seg-base').children) x.setAttribute('aria-pressed', String(x.dataset.base === String(baseIdx)));
};
baseLabel();
function setBase(i) {
  if (i === baseIdx) return;
  baseIdx = i;
  safeStore.set('base', String(baseIdx));
  map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(BASES[baseIdx].url, BASES[baseIdx].opt).addTo(map);
  baseLabel();
}
$('btn-base').addEventListener('click', () => setBase(1 - baseIdx));
$('seg-base').addEventListener('click', e => { const b = e.target.closest('[data-base]'); if (b) setBase(+b.dataset.base); });

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
let isVisible = () => true;                              // set in init: does the current filter show this place?

const catOf = p => CATEGORIES[p.category] || CATEGORIES.attraction;
const typeLabel = p => p.kind || catOf(p).single;        // the one name for a place's type (sheet, list, Key, pin title)
const glyphOf = p => KIND_GLYPH[p.kind] || catOf(p).glyph;
// Scheme memberships are extra tags on top of the one category (pin colour); a place can be in several
const PASS = 'Pasaporte Cultura';
const inPass = p => !!p.schemes?.includes(PASS);
let passOk = () => true;                                 // set in init: does the "Cultural Pass sites only" filter allow this place?
// Restaurants, cafés and markets have no rain rating: the rainy-day filter does not rule them out
const rainOk = p => p.rainyDay === 'Good' || (p.category === 'restaurant' && !p.rainyDay);

function pinIcon(p, sel) {
  const cat = catOf(p);
  const glyph = glyphOf(p);
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
// Sheet tags: the category (in its pin colour) first, then up to 4 short facts
const tags = (p, list) => {
  const c = catOf(p), l = list.filter(Boolean).slice(0, 4);
  return `<div class="tags"><span class="tag cat" style="--c:${c.color}">${esc(c.label)}</span>${(p.schemes || []).map(s => `<span class="tag scheme">${s === PASS ? '<span aria-hidden="true">🎫 </span>' : ''}${esc(s)}</span>`).join('')}${l.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
};
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
    ${tags(p, [h.stage, h.difficulty, p.route ? '' : h.routeType, p.familyFriendly ? 'Family friendly' : ''])}
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
  const rows = [row('Visit time', p.visitTime), row('Price', prices), row('Phone', p.phone), row('Address', p.address)].filter(Boolean);
  const driveQuick = p.drive && rows.length < 2;
  if (driveQuick) rows.push(row('Drive from base', p.drive));
  const facts = p.category === 'restaurant'
    ? [typeLabel(p), p.priceLevel, p.reservations]
    : [p.familyFriendly && p.category !== 'family' ? 'Family friendly' : '', p.rainyDay ? (RAIN[p.rainyDay] || p.rainyDay) : '', p.priceLevel];
  return [`
    ${tags(p, facts)}
    ${statusLine(p)}
    <div class="rows">${rows.join('')}</div>`, `
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${p.why ? `<p>${esc(p.why)}</p>` : ''}
    ${driveQuick ? '' : `<div class="rows">${row('Drive from base', p.drive)}</div>`}
    ${p.booking ? `<div class="callout">${esc(p.booking)}</div>` : ''}
    ${p.open?.seasonNote ? `<div class="callout">${esc(p.open.seasonNote)}</div>` : ''}
    ${p.hours ? `<details><summary>Opening hours</summary><p>${esc(p.hours)}</p></details>` : ''}`];
}

// "More details": longer texts per place from /data/details.<lang>.json, fetched once on first need and kept in memory.
// A failed fetch is silent (no section shown) and is retried the next time it is needed.
const details = { lang: null, data: null, req: null };
function loadDetails() {
  if (details.lang === lang && details.data) return Promise.resolve(details.data);
  if (details.lang === lang && details.req) return details.req;
  const my = lang;
  details.lang = my; details.data = null;
  details.req = fetch('/data/details.' + encodeURIComponent(my) + '.json')
    .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(d => {
      if (details.lang !== my) return details.req;
      details.data = d && typeof d === 'object' ? d : {};
      for (const [id, x] of Object.entries(details.data)) if (hay.has(id) && x?.summary) hay.set(id, hay.get(id).split('\u0001')[0] + '\u0001' + fold(x.summary)); // search also matches the summary
      return details.data;
    })
    .catch(() => { if (details.lang === my) details.req = null; return null; });
  return details.req;
}
// Phone numbers (Spanish 9-digit, optional +34), emails and URLs inside a fact value become links; the rest is escaped text
const LINKY = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|((?:\+34[\s.]?)?[6789]\d{2}(?:[\s.]?\d{3}[\s.]?\d{3}|[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}))(?!\d)/g;
function linkify(s) {
  let out = '', i = 0;
  for (const m of String(s).matchAll(LINKY)) {
    let [all, url, mail, tel] = m, tail = '';
    if (url) { const k = url.match(/[.,;:!?)\]]+$/); if (k) { tail = k[0]; url = url.slice(0, -tail.length); } }
    const text = url || mail || tel;
    const href = url ? (/^www\./i.test(url) ? 'https://' + url : url) : mail ? 'mailto:' + mail : 'tel:' + tel.replace(/[\s.]/g, '');
    out += esc(s.slice(i, m.index)) + `<a href="${esc(href)}"${url ? ' target="_blank" rel="noopener"' : ''}>${esc(text)}</a>` + esc(tail);
    i = m.index + all.length;
  }
  return out + esc(s.slice(i));
}
function renderDetails(d) {
  const paras = String(d.summary || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const facts = (d.facts || []).filter(f => Array.isArray(f) && f[0] && f[1]);
  const srcs = (d.sources || []).filter(s => /^https?:\/\//i.test(s?.url || ''));
  return `<details class="xd" lang="${esc(lang)}">
      <summary>${esc(t('moreDetails'))}</summary>
      ${d.uncertain ? `<div class="callout">${esc(typeof d.uncertain === 'string' ? d.uncertain : t('uncertain'))}</div>` : ''}
      ${paras.map(p => `<p>${esc(p)}</p>`).join('')}
      ${facts.length ? `<dl class="kv">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${linkify(v)}</dd>`).join('')}</dl>` : ''}
      ${srcs.length ? `<h3 class="xd-h">${esc(t('sources'))}</h3><ul class="xd-src">${srcs.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || s.url)}</a></li>`).join('')}</ul>` : ''}
      <p class="xd-note">${esc(t('note'))}</p>
    </details>`;
}
async function showDetails(p) {
  const d = await loadDetails();
  const slot = $('sheet-xd');
  if (!slot || selected !== p.id || $('sheet').hidden) return; // another place was picked meanwhile
  const x = d?.[p.id];
  slot.innerHTML = x && (x.summary || x.facts?.length) ? renderDetails(x) : '';
}
// Language picker (More dialog), only when there is more than one language
if (LANGS.length > 1) {
  const h = document.createElement('h3'); h.textContent = t('language');
  const seg = document.createElement('div');
  seg.className = 'seg'; seg.id = 'seg-lang'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', t('language'));
  seg.innerHTML = LANGS.map(l => `<button type="button" data-lang="${esc(l)}" lang="${esc(l)}" aria-pressed="${l === lang}">${esc(LANG_NAMES[l] || l)}</button>`).join('');
  seg.addEventListener('click', e => {
    const b = e.target.closest('[data-lang]'); if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang; safeStore.set('lang', lang);
    for (const x of seg.children) x.setAttribute('aria-pressed', String(x.dataset.lang === lang));
    if (selected && !$('sheet').hidden) showDetails(byId[selected]);
  });
  $('seg-base').after(h, seg);
}

function rememberView() { if (!prevView) { prevView = { c: map.getCenter(), z: map.getZoom() }; autoView = null; } }

function openSheet(p) {
  rememberView();
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false)).setZIndexOffset(0);
  selected = p.id;
  markers[p.id].setIcon(pinIcon(p, true)).setZIndexOffset(2000); // above other pins and a searched town's label
  const h = p.hike || {};
  const im = p.image;
  const [quick, more] = p.category === 'hike' || p.category === 'walk' ? renderHike(p) : renderPlace(p);
  const sub = [p.category === 'restaurant' ? '' : typeLabel(p), p.area].filter(Boolean).join(' · '); // a restaurant's type is its first tag
  $('sheet-body').innerHTML = `
    <h2 id="sheet-title" tabindex="-1">${nbHyphen(esc(p.name))}</h2>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
    ${quick}
    <div class="actions">
      ${link(p.gmaps || gmapsLink(p), p.category === 'hike' || p.category === 'walk' ? 'Google Maps (start)' : 'Google Maps', true)}
      <button class="near-btn" type="button">What's nearby</button>
      <button class="more-btn" type="button" aria-expanded="false">Details ▴</button>
    </div>
    <div class="sh-more">
      ${im ? `<figure class="hero"><img src="${esc(im.src)}" alt="${esc(p.name)}" loading="lazy"><figcaption>Photo: ${esc(im.credit)} · ${im.page && /^https?:\/\//i.test(im.page) ? `<a href="${esc(im.page)}" target="_blank" rel="noopener">${esc(im.license || 'Wikimedia Commons')}</a>` : esc(im.license || '')}</figcaption></figure>` : ''}
      ${more}
      <div id="sheet-xd"></div>
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
  showDetails(p);
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
    const t = topClear(); // keep clear of the category strip and the search pill
    const box = phone() ? { l: 24, t, r: size.x - 24, b: r.top - 28 } : { l: r.right + 24, t, r: size.x - 70, b: size.y - $('tabs').getBoundingClientRect().height - 36 };
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
$('sheet-body').addEventListener('click', e => {
  if (e.target.closest('.more-btn')) setExpanded(!$('sheet').classList.contains('exp'));
  else if (e.target.closest('.near-btn') && selected) { const p = byId[selected]; showNear({ lat: p.lat, lon: p.lon, name: p.name, sub: [typeLabel(p), p.area].filter(Boolean).join(' · '), exclude: p.id }); }
});
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

const fmtDate = s => { const [y, m, d] = String(s || '').split('-'); return d ? +d + ' ' + MONTHS[m - 1] + ' ' + y : ''; };
// Key (in the More dialog): one group per category with its pin colour, then the icons used in it
function buildLegend(places, unplaced, generated) {
  const status = new Set(places.map(p => p.locationStatus));
  const groupsHtml = Object.entries(CATEGORIES).map(([k, c]) => {
    const types = new Map();
    for (const p of places) if (p.category === k && !types.has(typeLabel(p))) types.set(typeLabel(p), glyphOf(p));
    if (!types.size) return '';
    return `<div class="lgc"><div class="lg lgh"><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</div>
      ${[...types].map(([t, g]) => `<div class="lg"><span class="ic" aria-hidden="true">${g}</span>${esc(t)}</div>`).join('')}</div>`;
  }).join('');
  $('legend').innerHTML = `
    ${groupsHtml}
    <h4>Pins and lines</h4>
    <div class="lg"><span class="sw dot"></span>Pin colour = category; zoomed out, pins are plain dots</div>
    ${places.some(p => p.open) ? '<div class="lg"><span class="sw fade"></span>Faded pin: closed today / out of season</div>' : ''}
    ${places.some(p => p.route) ? '<div class="lg"><span class="sw line"></span>Orange line: hike route</div>' : ''}
    ${status.has('approximate') ? '<div class="lg"><span class="sw ring dashed"></span>Dashed outline: approximate position</div>' : ''}
    ${status.has('unverified') ? '<div class="lg"><span class="sw ring dotted"></span>Dotted outline: needs verifying</div>' : ''}`;
  $('about-info').innerHTML = `
    <p class="credit">${places.length} places${generated ? ' · updated ' + esc(fmtDate(generated)) : ''}</p>
    ${unplaced.length ? `<details class="unplaced"><summary>${unplaced.length} not on the map yet (no start point found)</summary><ul>${unplaced.map(u => `<li>${esc(u.name)}</li>`).join('')}</ul></details>` : ''}
    <button class="about" type="button">About this map</button>
    <p class="credit">Map data © OpenStreetMap contributors</p>
    <p class="credit">Town search sends only the text you type to OpenStreetMap's Nominatim service, and searches are not saved.</p>`;
}
$('about-info').addEventListener('click', e => { if (e.target.closest('.about')) openIntro(); });

// Filters and More are native modal dialogs (bottom sheets on phones). Esc and the back gesture close them natively.
function closePanels() { for (const d of document.querySelectorAll('dialog[open]')) d.close(); }
for (const d of document.querySelectorAll('dialog.bsheet, #dlg-search')) d.addEventListener('click', e => { if (e.target.closest('[data-close]')) d.close(); });
// Tap outside closes (closedby="any"); Safari has no closedby yet, so do it by hand there
if (!('closedBy' in HTMLDialogElement.prototype)) {
  for (const d of document.querySelectorAll('dialog[closedby="any"]')) {
    const out = e => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    let down = false;
    d.addEventListener('pointerdown', e => { down = e.target === d && out(e); });
    d.addEventListener('pointerup', e => { if (down && e.target === d && out(e)) d.close(); down = false; });
  }
}

// Intro / About: shown on the first visit (not when arriving on a shared #place link); reopened from More > About this map
const intro = $('intro');
$('intro-layers').innerHTML = Object.values(CATEGORIES).map(c => `<li><i style="--c:${c.color}"></i>${esc(c.label)}</li>`).join('');
function openIntro() { if (!intro.open) intro.showModal(); }
intro.addEventListener('close', () => { safeStore.set('introSeen', '1'); intro.returnValue = ''; });

// Bottom tabs: Map and List are views; Filters and More open dialogs and leave the current view as it is
function setTab(t) {
  if (t === 'filters' || t === 'more') { $('dlg-' + t).showModal(); return; }
  const list = t === 'list';
  $('listview').hidden = !list;
  for (const b of document.querySelectorAll('#tabs [data-tab]')) {
    if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (list) {
    if (!$('sheet').hidden) closeSheet();
    renderList();
    loadDetails().then(d => { if (d && !$('listview').hidden && $('q').value.trim()) renderList(); });
  }
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });

// List view: search + Nearest / A-Z over the places the current filters show
let sortBy = safeStore.get('sort') === 'near' ? 'near' : 'az', here = null; // here = L.LatLng of the last locate
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); // case- and accent-blind
const hay = new Map(); // id -> folded text a search matches against (name, area, type, category); filled in init
const fmtKm = km => km.toFixed(km < 10 ? 1 : 0) + ' km';
const placeRow = (p, right) => { const c = catOf(p); return `<span class="gl" style="--c:${c.color}" aria-hidden="true">${glyphOf(p)}</span>
      <span><span class="nm">${esc(p.name)}</span>${inPass(p) ? ' <span class="pp" role="img" aria-label="Pasaporte Cultura" title="Pasaporte Cultura">🎫</span>' : ''}<br><span class="mt">${esc([typeLabel(p), p.area].filter(Boolean).join(' · '))}</span></span>${right != null ? `<span class="rt">${esc(right)}</span>` : ''}`; };
function renderList() {
  $('lv-near').hidden = !near; $('lv-head').hidden = !!near;
  if (near) { renderNear(); return; }
  const q = fold($('q').value.trim());
  const l = Object.values(byId).filter(p => isVisible(p) && (!q || hay.get(p.id).includes(q)));
  const d = p => here ? here.distanceTo([p.lat, p.lon]) / 1000 : null;
  l.sort(sortBy === 'near' && here ? (a, b) => d(a) - d(b) : (a, b) => a.name.localeCompare(b.name, 'es'));
  for (const x of $('seg-sort').children) x.setAttribute('aria-pressed', String(x.dataset.sort === sortBy));
  $('lv-count').textContent = l.length + (l.length === 1 ? ' place' : ' places') + (sortBy === 'near' && !here ? ' · allow location to sort by distance' : '');
  $('lv').innerHTML = l.map(p => {
    const s = openStatus(p), km = d(p);
    return `<li><a href="#${encodeURIComponent(p.id)}" data-id="${esc(p.id)}">${placeRow(p, km != null ? fmtKm(km) : s.open === false ? 'Closed today' : '')}</a></li>`;
  }).join('') || '<li class="lv-count">No places match. Try clearing the search or filters.</li>';
}

// Nearby: our places within a radius of a town (from the search) or of a place (its sheet's "What's nearby"), nearest first.
// Shown in the List view; respects the category toggles and filters. Distances are straight lines.
let near = null, nearR = 15, nearCat = '', nearMarker = null, nearCircle = null; // near = { lat, lon, name, sub, exclude?, town? }
function kmBetween(a, b) { // haversine
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function renderNear() {
  const inR = Object.values(byId).filter(p => p.id !== near.exclude).map(p => ({ p, d: kmBetween(near, p) })).filter(x => x.d <= nearR);
  const vis = inR.filter(x => isVisible(x.p)), hidden = inR.length - vis.length, counts = {};
  for (const x of vis) counts[x.p.category] = (counts[x.p.category] || 0) + 1;
  if (nearCat && !counts[nearCat]) nearCat = '';
  const l = vis.filter(x => !nearCat || x.p.category === nearCat).sort((a, b) => a.d - b.d);
  $('ln-title').textContent = 'Near ' + near.name;
  $('ln-sub').textContent = near.sub || '';
  for (const b of $('seg-r').children) b.setAttribute('aria-pressed', String(+b.dataset.r === nearR));
  const cats = Object.keys(CATEGORIES).filter(k => counts[k]);
  const chip = (k, label, n, c) => `<button type="button" data-cat="${k}" aria-pressed="${nearCat === k}" style="--c:${c}"${k ? ` title="${esc(CATEGORIES[k].label)}"` : ''}>${label} <span class="n">${n}</span></button>`;
  $('ln-cats').innerHTML = cats.length > 1 ? chip('', 'All', vis.length, 'var(--accent)') + cats.map(k => chip(k, `<span aria-hidden="true">${CATEGORIES[k].glyph}</span><span class="cl">${esc(CATEGORIES[k].label)}</span>`, counts[k], CATEGORIES[k].color)).join('') : '';
  $('lv-count').textContent = `${l.length} ${l.length === 1 ? 'place' : 'places'} within ${nearR} km, as the crow flies` + (hidden ? ` · ${hidden} more hidden by filters` : '');
  $('lv').innerHTML = l.map(x => `<li><a href="#${encodeURIComponent(x.p.id)}" data-id="${esc(x.p.id)}">${placeRow(x.p, fmtKm(x.d))}</a></li>`).join('')
    || `<li class="lv-count">None of our places are within ${nearR} km${nearR < 30 ? '. Try a wider radius.' : '.'}${hidden ? ' Some are hidden by your filters.' : ''}</li>`;
}
const nearStyle = { color: '#1f4d3a', weight: 1.5, dashArray: '6 6', fillColor: '#1f4d3a', fillOpacity: 0.05, interactive: false };
function clearNearLayers() { for (const l of [nearMarker, nearCircle]) if (l) map.removeLayer(l); nearMarker = nearCircle = null; }
function syncNearPill() {
  $('near-pill').hidden = !near;
  $('find').classList.toggle('has-near', !!near);
  if (near) { $('near-name').textContent = 'Near ' + near.name; $('near-x').setAttribute('aria-label', 'Clear nearby ' + near.name); }
}
function fitNear() {
  const b = L.latLng(near.lat, near.lon).toBounds(nearR * 2000), t = topClear(), tabsH = $('tabs').getBoundingClientRect().height;
  map.fitBounds(b, phone() ? { paddingTopLeft: [16, t], paddingBottomRight: [16, tabsH + 16], ...A }
    : { paddingTopLeft: [$('listview').getBoundingClientRect().right + 24, t], paddingBottomRight: [70, tabsH + 36], ...A });
}
function showNear(n) {
  clearNearLayers();
  near = n; nearCat = '';
  if (n.town) nearMarker = L.marker([n.lat, n.lon], { icon: L.divIcon({ className: 'townwrap', html: `<div class="townpin"><b>${esc(n.name)}</b></div>`, iconSize: [0, 0], iconAnchor: [0, 0] }), title: n.name + ': show what is nearby', zIndexOffset: 1000 })
    .on('click', e => { L.DomEvent.stopPropagation(e); setTab('list'); }).addTo(map);
  nearCircle = L.circle([n.lat, n.lon], { ...nearStyle, radius: nearR * 1000 }).addTo(map);
  syncNearPill();
  setTab('list');
  fitNear();
  $('ln-title').focus({ preventScroll: true });
}
function clearNear() {
  clearNearLayers(); near = null; nearCat = '';
  syncNearPill();
  if (!$('listview').hidden) renderList();
}
$('seg-r').addEventListener('click', e => {
  const b = e.target.closest('[data-r]'); if (!b || !near) return;
  nearR = +b.dataset.r; nearCircle?.setRadius(nearR * 1000);
  renderList(); fitNear();
});
$('ln-cats').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { nearCat = nearCat === b.dataset.cat ? '' : b.dataset.cat; renderList(); } });
$('ln-x').addEventListener('click', () => { clearNear(); setTab('map'); });
$('near-x').addEventListener('click', () => { clearNear(); $('btn-search').focus(); });
$('near-open').addEventListener('click', () => { setTab('list'); $('ln-title').focus({ preventScroll: true }); });
$('q').addEventListener('input', renderList);
$('seg-sort').addEventListener('click', e => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  sortBy = b.dataset.sort; safeStore.set('sort', sortBy);
  if (sortBy === 'near' && !here) locate(); else renderList();
});
$('lv').addEventListener('click', e => { // same row twice gives no hashchange
  const a = e.target.closest('a[data-id]');
  if (a && location.hash === '#' + encodeURIComponent(a.dataset.id)) { e.preventDefault(); openFromHash(); }
});

function closeSheet(restoreFocus) {
  const was = selected;
  $('sheet').hidden = true;
  $('sheet').classList.remove('exp'); document.body.classList.remove('sheet-exp');
  if (selected && markers[selected]) markers[selected].setIcon(pinIcon(byId[selected], false)).setZIndexOffset(0);
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
  if ($('sheet').hidden) return;
  if (phone() && $('sheet').classList.contains('exp')) setExpanded(false); else closeSheet();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return; // an open dialog closes itself
  if (!$('listview').hidden) { setTab('map'); return; }
  closeSheet(true);
});

let meMarker = null;
function locate() {
  const b = $('btn-locate');
  if (!navigator.geolocation) { toast("Location isn't available here"); return; }
  if (b.getAttribute('aria-busy') === 'true') return;
  b.setAttribute('aria-busy', 'true');
  navigator.geolocation.getCurrentPosition(pos => {
    b.removeAttribute('aria-busy');
    const ll = [pos.coords.latitude, pos.coords.longitude];
    here = L.latLng(ll);
    if (meMarker) meMarker.setLatLng(ll);
    else meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, keyboard: false }).addTo(map);
    if ($('listview').hidden) map.setView(ll, Math.max(map.getZoom(), 11), A); else renderList();
  }, () => { b.removeAttribute('aria-busy'); toast("Couldn't get your location"); }, { enableHighAccuracy: true, timeout: 10000 });
}
$('btn-locate').addEventListener('click', locate);

function openFromHash() {
  let id = '';
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* malformed hash */ }
  const p = byId[id];
  if (!p) { if (!id && selected) closeSheet(); return; }
  if (!$('listview').hidden) setTab('map');
  if (selected === p.id && !$('sheet').hidden) return;
  revealPlace(p);
  rememberView();
  if (!p.route) map.setView([p.lat, p.lon], 12, A); // routes zoom themselves
  openSheet(p);
}
window.addEventListener('hashchange', openFromHash);
// Top edge of the free map area: below the category strip and the search pill
function topClear() { return Math.max($('cats').getBoundingClientRect().bottom, $('find').getBoundingClientRect().bottom) + 12; }

// Search (native modal dialog): our places match instantly as you type; towns and villages come from OpenStreetMap
// Nominatim (only the typed text is sent; debounced, max 1 request a second, previous request aborted, cached in memory only).
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=es&accept-language=en&viewbox=-6.4,42.7,-3.0,43.8&bounded=0&q=';
const TOWN_TYPE = { city: 'City', town: 'Town', village: 'Village', hamlet: 'Hamlet', isolated_dwelling: 'Hamlet', suburb: 'District', quarter: 'District', neighbourhood: 'Neighbourhood', municipality: 'Municipality', county: 'County', province: 'Province', state: 'Region', locality: 'Locality', peak: 'Peak', beach: 'Beach' };
const SETTLEMENT = new Set(['City', 'Town', 'Village', 'Hamlet', 'District', 'Neighbourhood', 'Municipality', 'Locality']);
const sdlg = $('dlg-search'), sq = $('sq');
const town = { cache: new Map(), ctl: null, timer: 0, last: 0, state: '', list: [] }; // state: '' | 'wait' | 'ok' | 'err'
let sayT = 0;

function localMatches(q) {
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const rank = p => { const n = fold(p.name); return n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2; };
  return Object.values(byId).filter(p => passOk(p) && words.every(w => hay.get(p.id).includes(w)))
    .map(p => ({ p, r: rank(p) })).sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name, 'es')).slice(0, 40).map(x => x.p);
}
function parseTowns(arr) {
  const seen = new Set();
  return (Array.isArray(arr) ? arr : []).map((r, i) => {
    const parts = String(r.display_name || '').split(',').map(s => s.trim()).filter(Boolean);
    const t = String(r.addresstype || r.type || '');
    const x = { name: r.name || parts[0] || '', lat: +r.lat, lon: +r.lon, i,
      where: parts.slice(1).filter(s => !/^\d/.test(s) && !/^(spain|españa)$/i.test(s)).slice(-2).join(', '),
      type: TOWN_TYPE[t] || (t ? t[0].toUpperCase() + t.slice(1).replace(/_/g, ' ') : 'Place') };
    x.inBox = x.lon >= -6.4 && x.lon <= -3.0 && x.lat >= 42.7 && x.lat <= 43.8; // Cantabria, Asturias and around
    return x;
  }).filter(x => x.name && Number.isFinite(x.lat) && Number.isFinite(x.lon))
    .sort((a, b) => (b.inBox - a.inBox) || a.i - b.i)
    .filter(x => { const k = fold(x.name + '|' + x.where); if (seen.has(k)) return false; seen.add(k); return true; });
}
function queueTowns(now) {
  clearTimeout(town.timer);
  town.ctl?.abort();
  const q = sq.value.trim(), key = fold(q);
  if (key.length < 3) { town.state = ''; town.list = []; return; }
  if (town.cache.has(key)) { town.state = 'ok'; town.list = town.cache.get(key); return; }
  if (!navigator.onLine) { town.state = 'err'; town.list = []; return; }
  town.state = 'wait'; town.list = [];
  town.timer = setTimeout(() => fetchTowns(q, key), Math.max(now ? 0 : 700, 1000 - (Date.now() - town.last)));
}
async function fetchTowns(q, key) {
  const ctl = town.ctl = new AbortController();
  let timedOut = false;
  const to = setTimeout(() => { timedOut = true; ctl.abort(); }, 8000);
  town.last = Date.now();
  try {
    const res = await fetch(NOMINATIM + encodeURIComponent(q), { signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(res.status);
    const list = parseTowns(await res.json());
    town.cache.set(key, list);
    if (fold(sq.value.trim()) !== key) return;
    town.state = 'ok'; town.list = list;
  } catch {
    if ((ctl.signal.aborted && !timedOut) || fold(sq.value.trim()) !== key) return; // superseded by newer typing
    town.state = 'err'; town.list = [];
  } finally { clearTimeout(to); }
  if (sdlg.open) renderSearch();
}

function renderSearch() {
  const raw = sq.value.trim(), q = fold(raw), local = localMatches(q);
  let html = '';
  if (!q) html = '<p class="s-hint">Find one of our places, or a town or village to see what is nearby.</p>';
  for (const [k, c] of Object.entries(CATEGORIES)) {
    const l = local.filter(p => p.category === k);
    if (l.length) html += `<h3 class="s-h"><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</h3><ul class="res" role="list">${l.map(p => `<li><button type="button" data-id="${esc(p.id)}">${placeRow(p)}</button></li>`).join('')}</ul>`;
  }
  if (q && !local.length) html += `<p class="s-hint">None of our places match${passOk({}) ? '' : ' (Filters: Cultural Pass sites only is on)'}.</p>`;
  if (q.length >= 3) {
    html += '<h3 class="s-h">Towns &amp; places</h3>';
    if (town.state === 'wait') html += '<p class="s-hint">Searching towns…</p>';
    else if (town.state === 'err') html += '<p class="s-hint">Town search unavailable</p>';
    else if (town.state === 'ok') html += town.list.length
      ? `<ul class="res" role="list">${town.list.map((t, i) => `<li><button type="button" data-town="${i}"><span class="gl town" aria-hidden="true">${SETTLEMENT.has(t.type) ? '🏘️' : '📌'}</span><span><span class="nm">${esc(t.name)}</span><br><span class="mt">${esc([t.type, t.where].filter(Boolean).join(' · '))}</span></span></button></li>`).join('')}</ul><p class="s-credit">Towns: © OpenStreetMap contributors, via Nominatim</p>`
      : '<p class="s-hint">No towns or places found.</p>';
  } else if (q) html += '<p class="s-hint">Type 3 or more letters to look up towns and villages.</p>';
  $('s-res').innerHTML = html;
  clearTimeout(sayT); // announce the counts once typing pauses
  sayT = setTimeout(() => {
    const n = local.length, tn = town.state === 'ok' ? town.list.length : 0;
    $('s-status').textContent = !q ? '' : `${n} of our ${n === 1 ? 'place' : 'places'}` + (q.length < 3 ? '' : town.state === 'wait' ? ', searching towns' : town.state === 'err' ? ', town search unavailable' : `, ${tn} ${tn === 1 ? 'town' : 'towns'}`);
  }, 500);
}
function openSearch() {
  if (sdlg.open) return;
  sdlg.showModal();
  sq.select();
  loadDetails().then(d => { if (d && sdlg.open && sq.value.trim()) renderSearch(); }); // summaries join the search once loaded
  queueTowns(false);
  renderSearch();
}
$('btn-search').addEventListener('click', openSearch);
sq.addEventListener('input', () => { queueTowns(false); renderSearch(); });
$('s-form').addEventListener('submit', e => { e.preventDefault(); if (town.state !== 'ok') { queueTowns(true); renderSearch(); } });
sq.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { const b = $('s-res').querySelector('button'); if (b) { e.preventDefault(); b.focus(); } } });
sdlg.addEventListener('close', () => { clearTimeout(town.timer); town.ctl?.abort(); if (town.state === 'wait') town.state = ''; });
$('s-res').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.id) {
    sdlg.close();
    const h = '#' + encodeURIComponent(b.dataset.id);
    if (location.hash === h) openFromHash(); else location.hash = h; // the same place twice gives no hashchange
  } else if (b.dataset.town) {
    const t = town.list[+b.dataset.town]; if (!t) return;
    sdlg.close();
    showNear({ lat: t.lat, lon: t.lon, name: t.name, sub: [t.type, t.where].filter(Boolean).join(' · '), town: true });
  }
});

async function init() {
  let data;
  try {
    const res = await fetch('/data/places.json');
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    $('cats').innerHTML = '<p class="cats-err">Could not load places</p>';
    return;
  }
  $('intro-meta').textContent = `${data.places.length} places · updated ${fmtDate(data.generated)}`;
  const places = data.places.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const saved = (() => { try { return JSON.parse(safeStore.get('layers') || 'null'); } catch { return null; } })();
  const on = {};
  const ui = { layer: {}, stage: {}, rb: null, sel: null };

  for (const p of places) {
    byId[p.id] = p;
    hay.set(p.id, fold([p.name, p.area, p.kind, typeLabel(p), catOf(p).label, catOf(p).single, ...(p.schemes || []), inPass(p) ? 'cultural pass passport' : ''].join(' ')));
    const g = groups[p.category] || (groups[p.category] = L.layerGroup());
    const m = L.marker([p.lat, p.lon], { icon: pinIcon(p, false), title: p.name + ', ' + typeLabel(p), riseOnHover: true })
      .on('click', e => { L.DomEvent.stopPropagation(e); openSheet(p); })
      .on('add', () => { const el = m.getElement(); if (el) el.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); openSheet(p); } }; }) // Enter and Space (Leaflet only maps Enter via keypress)
      .addTo(g);
    markers[p.id] = m;
  }

  const stageOn = Object.fromEntries(STAGES.map(s => [s, true]));
  const opt = { rainy: false, day: 'any', pass: false };
  passOk = p => !opt.pass || inPass(p);
  const visible = p => {
    if (!on[p.category] || !passOk(p)) return false;
    if (p.category === 'hike' && stageOn[p.hike?.stage] === false) return false;
    if (opt.rainy && !rainOk(p)) return false;
    if (opt.day !== 'any' && openStatus(p, +opt.day).open === false) return false;
    return true;
  };
  isVisible = visible;
  const sync = () => { // bring the controls in line with the state
    for (const k in ui.layer) ui.layer[k].setAttribute('aria-pressed', String(on[k]));
    for (const s in ui.stage) ui.stage[s].setAttribute('aria-pressed', String(stageOn[s]));
    ui.rb?.setAttribute('aria-pressed', String(opt.rainy));
    ui.pb?.setAttribute('aria-pressed', String(opt.pass));
    if (ui.sel) ui.sel.value = opt.day;
  };
  const refresh = () => {
    const shown = {};
    let n = 0;
    for (const p of places) {
      const g = groups[p.category], m = markers[p.id];
      if (visible(p)) { g.addLayer(m); n++; shown[p.category] = (shown[p.category] || 0) + 1; } else g.removeLayer(m);
    }
    // the badge counts only what is inside the Filters dialog; the category toggles are on screen already
    const nf = STAGES.filter(s => stageOn[s] === false).length + (opt.rainy ? 1 : 0) + (opt.day !== 'any' ? 1 : 0) + (opt.pass ? 1 : 0);
    const badge = document.querySelector('#tabs [data-tab=filters] .badge');
    badge.hidden = !nf; badge.textContent = nf;
    $('fcount').innerHTML = `Showing ${n} of ${places.length} places<div class="lc">${Object.keys(on).map(k => `${esc(CATEGORIES[k].label)} ${shown[k] || 0}/${places.filter(p => p.category === k).length}`).join(' · ')}</div>`;
    $('f-done').textContent = 'Show ' + n + (n === 1 ? ' place' : ' places');
    $('freset').hidden = !nf && Object.values(on).every(Boolean);
    if (!$('listview').hidden) renderList();
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
    if (opt.rainy && !rainOk(p)) opt.rainy = false;
    if (!passOk(p)) opt.pass = false;
    if (opt.day !== 'any' && openStatus(p, +opt.day).open === false) opt.day = 'any';
    refresh();
  };
  let stageBar = null, stageHead = null;
  const panel = $('fpanel');
  const chips = $('cats');
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const n = places.filter(p => p.category === key).length;
    if (!n) continue; // empty categories stay hidden until they have data
    on[key] = saved ? saved[key] !== false : true;
    const b = document.createElement('button');
    b.type = 'button'; b.style.setProperty('--c', cat.color);
    b.innerHTML = `<span class="g" aria-hidden="true">${cat.glyph}</span>${esc(cat.label)}`;
    b.setAttribute('aria-pressed', String(on[key]));
    groups[key].addTo(map);
    b.addEventListener('click', () => { on[key] = !on[key]; refresh(); });
    ui.layer[key] = b;
    chips.appendChild(b);
  }

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
  // plus "Cultural Pass sites only", across every category (the category toggles still apply on top)
  const nPass = places.filter(inPass).length;
  if (places.some(p => p.rainyDay || p.open) || nPass) {
    const bar = document.createElement('div');
    bar.id = 'planbar'; bar.className = 'frow';
    if (nPass) {
      const pb = document.createElement('button');
      pb.className = 'chip small'; pb.type = 'button'; pb.title = 'Only places in the Pasaporte Cultura (Cantabria cultural pass), in any category';
      pb.innerHTML = `<span aria-hidden="true">🎫</span> Cultural Pass sites only <span class="n">${nPass}</span>`;
      pb.addEventListener('click', () => { opt.pass = !opt.pass; refresh(); });
      ui.pb = pb; bar.append(pb);
    }
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
    opt.rainy = false; opt.day = 'any'; opt.pass = false;
    refresh();
  });
  panel.appendChild(rs);
  refresh();
  buildLegend(places, data.unplaced || [], data.generated);

  // restaurants can be anywhere (e.g. Oviedo), so they do not stretch the opening view.
  // Pad only for the bars that cover the map, so Cantabria fills a phone screen.
  const core = places.filter(p => p.category !== 'restaurant');
  const top = topClear() - 12, tabsH = $('tabs').getBoundingClientRect().height;
  if (core.length) map.fitBounds(L.latLngBounds(core.map(p => [p.lat, p.lon])), phone()
    ? { paddingTopLeft: [16, top + 8], paddingBottomRight: [16, tabsH + 16], maxZoom: 10, animate: false }
    : { paddingTopLeft: [70, top + 20], paddingBottomRight: [70, tabsH + 40], maxZoom: 9, animate: false });
  openFromHash();
}
init();
if (!safeStore.get('introSeen') && !location.hash) openIntro();

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
