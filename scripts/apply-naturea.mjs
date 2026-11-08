// One-off: applies exact starts read from the first point of each official Naturea Cantabria GPX
// (self-guided routes CA-ENP..) to data/hike-coords.json, and records the GPX link in data/hike-overrides.json.
import fs from 'node:fs';
const R = [
 ['Acantilados de San Vicente (CA-ENP01)', 43.392862, -4.391590, '1CBw-P39JF61Uzd8GmE0cNTcu9w1UrMQn', 'acantilados-de-san-vicente', 'Circular'],
 ['Alto de La Guarda (CA-ENP03)', 43.146203, -4.195658, '1MtmgQbaEdvPj-_qMphjLgPppsksQt_6d', 'alto-de-la-guarda', 'Circular'],
 ['Braña de los Tejos (CA-ENP06)', 43.236999, -4.550048, '1YxoQOxgKUfWNx_sk-M1pNQ8Qbs9cVrYf', 'brana-tejos', 'Circular'],
 ['Peñas de Bejes (CA-ENP07)', 43.241304, -4.645783, '1spXvCPTzethmExS13ke0VdpAkequIud9', 'branas-de-bejes', 'Circular'],
 ['Canto Pilanco (CA-ENP10)', 43.129728, -4.296748, '1s30CRZ1DluDqchI0YbTgNIyNjM1BoJy6', 'canto-pilanco', 'Circular'],
 ['Cascada del Tobazo (CA-ENP route)', 42.830975, -3.834853, '1h7GA8frTlryYw80LI4KvEaA8lsuTwtzA', 'cascada-del-tobazo', 'Circular'],
 ['Hayedo de La Zamina (CA-ENP21)', 43.208956, -3.703007, '10m3faLbBOWM59EsrPCkA_SkKnrkP5nFB', 'hayedo-zamina', 'Circular'],
 ['La Garma — Nacimiento del Pisueña (CA-ENP23)', 43.190801, -3.763589, '1iilxWsa10vV05Hg_2X63v4oQ_UoI68NZ', 'nacimiento-del-pisuena-la-garma', 'Circular'],
 ['Las Praizas de Cucayo (CA-ENP25)', 43.057533, -4.639037, '1YY2ymFqpLWYyqjVxHF-Pwf1Dx_eRIyvG', 'praizas-cucayo', 'Circular'],
 ['Praderas de Ruyemas (CA-ENP29)', 43.146025, -3.722529, '1LRBFWOPhn5uGsMhvcjWmmXO0Xt43nnfn', 'praderas-de-ruyemas', 'Circular'],
 ['Los Bosques del Monte Corona (CA-ENP33)', 43.317520, -4.260802, '17h715Wb4FBezoEGEKaCQjTTZkrUBwdau', 'bosques_monte_corona', 'Circular'],
 ['Senda Fluvial del Nansa (CA-ENP34)', 43.360376, -4.489394, '1f4idd-EamJZJOJ67udaKuxF_8lXF1-eL', 'senda-fluvial-nansa', 'Linear'],
 ['Sendero de los Puentes (CA-ENP35)', 43.235661, -4.219394, '16sIztAgSqLuB9KQKyajtf5E-N_VSF2qB', 'sendero-de-los-puentes', 'Circular'],
 ['Altos de Carmona (CA-ENP38)', 43.254524, -4.357378, '1Lt_dX0Ra1s848J60c9zc4d87BApHCjeH', 'altos-carmona', 'Circular']
];
const coords = JSON.parse(fs.readFileSync('data/hike-coords.json', 'utf8'));
const ov = JSON.parse(fs.readFileSync('data/hike-overrides.json', 'utf8'));
for (const [name, lat, lon, id, slug, type] of R) {
  if (!coords[name]) throw new Error('unknown hike ' + name);
  coords[name] = { lat, lon, status: 'verified', source: 'First point of the official Naturea Cantabria GPX for this route', note: '' };
  const o = ov[name] || (ov[name] = {});
  o.hike = { ...(o.hike || {}),
    gpxUrl: 'https://drive.google.com/uc?export=download&id=' + id,
    officialUrl: 'https://natureacantabria.com/rutas-autoguiadas/' + slug + '/',
    routeGeometry: 'Full track', trackSource: 'Official (Naturea GPX)', routeType: type };
}
fs.writeFileSync('data/hike-coords.json', JSON.stringify(coords, null, 1));
fs.writeFileSync('data/hike-overrides.json', JSON.stringify(ov, null, 1));
console.log('applied', R.length);
