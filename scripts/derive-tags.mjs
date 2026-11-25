// Derives the `tags` array of a place from fields we already hold. Rules only: nothing is guessed from free text.
// A tag is the string "Group: Label". A place can carry many; `listedBy` and `extraTags` in the source rows add or override.
//   Listed by  Official (Cantabria tourism sources: Naturea routes, official route pages, the Pasaporte Cultura)
//              Owner pick (set only when a row says so with listedBy: "Owner pick"); restaurants stay untagged until classified
//   Suits      Family friendly, Easy walk, Good in rain, Free
//   Type       Beach, Cave, Museum, Viewpoint, Heritage, Park & garden, Hike, Walk, Sight, Family activity; for food: Local cuisine, Seafood, Grill, Cider house, Tapas, Cafe, Market
//   Cuisine    restaurants: Local cuisine, Seafood, ... and international groups (see CUISINE)
//   Rating     4.5+, 4.0+ (Google rating from the owner's restaurant list)   Price  €, €€, €€€ and up
//   Practical  Book ahead, Loop route, Open for lunch, Open every day
//   Level      Easy, Moderate, Hard (hikes and walks)

const TYPE_BY_KIND = {
  Beach: 'Beach', Cave: 'Cave', Museum: 'Museum', Viewpoint: 'Viewpoint', Walk: 'Walk',
  'Historic house': 'Heritage', Mansion: 'Heritage', Palace: 'Heritage', Tower: 'Heritage', Convent: 'Heritage', Monument: 'Heritage',
  'Cultural site': 'Heritage', Heritage: 'Heritage', 'Heritage / church': 'Heritage', 'Heritage / museum': 'Museum', 'Heritage / coast': 'Heritage',
  'Cultural centre': 'Museum', Garden: 'Park & garden', Park: 'Park & garden', Harbour: 'Sight', Estuary: 'Sight', 'Day trip': 'Sight'
};
const FOOD_BY_KIND = {
  'Traditional Cantabrian': 'Local cuisine', Seafood: 'Seafood', 'Asador (grill)': 'Grill', Sidrería: 'Cider house',
  'Tapas & pintxos': 'Tapas', 'Café / breakfast': 'Cafe', 'Ice cream / crêperie': 'Cafe', Market: 'Market'
};
// Cuisine groups for restaurants: the first rule whose words appear in the cuisine (or kind) text wins, checked in this order
const CUISINE = [
  ['Latin American', /peruvian-|peruvian|venezuel|colombi|argentin|brazil|bolivi|ecuador|paraguay|urugua|nicaragu|cuban|caribbean|latin|south american|hondur|empanada/],
  ['Japanese & sushi', /japanese|sushi|ramen|nikkei|omakase|izakaya/],
  ['Italian & pizza', /italian|pizza|pinsa|pasta/],
  ['Burgers', /burger|smash/],
  ['Kebab & Turkish', /kebab|turkish|shawarma|halal fast/],
  ['Mexican', /mexican|tex-mex|taco/],
  ['Chinese & wok', /chinese|chifa|dumpling|noodle|wok/],
  ['Indian & Nepali', /indian|nepali|pakistani|afghan/],
  ['Asian', /thai|korean|vietnam|asian|bao/],
  ['Poke', /poke|hawaiian/],
  ['Mediterranean & Middle Eastern', /moroccan|lebanese|middle eastern|greek|georgian|mediterranean/],
  ['Other international', /american|bbq|irish|french|crêpe|creperie|swiss|portuguese|ukrain|slavic|african|senegal|camero/]
];
const cuisineOf = t => { const s = String(t || '').toLowerCase(); let best = null, at = 1e9;
  for (const [label, re] of CUISINE) { const m = s.search(re); if (m >= 0 && m < at) { best = label; at = m; } } return best; };
const FREE_KINDS = new Set(['Beach', 'Viewpoint', 'Walk', 'Park', 'Garden', 'Harbour', 'Estuary']);

export function deriveTags(p) {
  const t = new Set();
  const add = (g, l) => l && t.add(g + ': ' + l);
  const h = p.hike || {};

  // Listed by
  if (p.listedBy) add('Listed by', p.listedBy);
  else if (p.schemes?.includes('Pasaporte Cultura') || /naturea|official/i.test(h.trackSource || '') || h.officialUrl) add('Listed by', 'Official');

  // Suits
  if (p.familyFriendly || p.category === 'walk' || p.category === 'family') add('Suits', 'Family friendly');
  if (p.category === 'walk') add('Suits', 'Easy walk');
  if (p.rainyDay === 'Good') add('Suits', 'Good in rain');
  if (p.adult === 0 || p.category === 'hike' || p.category === 'walk' || FREE_KINDS.has(p.kind)) add('Suits', 'Free');

  // Type
  if (p.category === 'hike') add('Type', 'Hike');
  else if (p.category === 'walk') add('Type', 'Walk');
  else if (p.category === 'family') add('Type', 'Family activity');
  else if (p.category === 'restaurant') add('Cuisine', FOOD_BY_KIND[p.kind] || cuisineOf(p.cuisine || p.kind));
  else add('Type', TYPE_BY_KIND[p.kind] || (p.category === 'attraction' ? 'Sight' : ''));

  // Restaurants: rating, price, diet notes and lunch from the owner's list
  if (p.category === 'restaurant') {
    if (p.rating >= 4.5) add('Rating', '4.5+');
    if (p.rating >= 4) add('Rating', '4.0+');
    if (p.priceLevel) add('Price', p.priceLevel.length >= 3 ? '€€€ and up' : p.priceLevel);
    for (const n of p.notes || []) { const m = n.match(/^(Vegan|Vegetarian|Gluten-free) options$/); if (m) add('Suits', m[1]); }
    if (/^Yes/.test(p.lunch || '')) add('Practical', 'Open for lunch');
    if (p.closedOn === 'Open daily') add('Practical', 'Open every day');
  }

  // Practical
  if (p.reservations === 'Book ahead') add('Practical', 'Book ahead');
  if (p.route?.circular) add('Practical', 'Loop route');

  // Level
  if (['Easy', 'Moderate', 'Hard'].includes(h.difficulty)) add('Level', h.difficulty);

  for (const x of p.extraTags || []) t.add(x);
  return [...t];
}
