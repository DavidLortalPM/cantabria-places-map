// Derives the `tags` array of a place from fields we already hold. Rules only: nothing is guessed from free text.
// A tag is the string "Group: Label". A place can carry many; `listedBy` and `extraTags` in the source rows add or override.
//   Listed by  Official (Cantabria tourism sources: Naturea routes, official route pages, the Pasaporte Cultura)
//              Owner pick (set only when a row says so with listedBy: "Owner pick"); restaurants stay untagged until classified
//   Suits      Family friendly, Easy walk, Good in rain, Free
//   Type       Beach, Cave, Museum, Viewpoint, Heritage, Park & garden, Hike, Walk, Sight, Family activity; for food: Local cuisine, Seafood, Grill, Cider house, Tapas, Cafe, Market
//   Practical  Book ahead, Loop route
//   Level      Easy, Moderate, Hard (hikes and walks)

const TYPE_BY_KIND = {
  Beach: 'Beach', Cave: 'Cave', Museum: 'Museum', Viewpoint: 'Viewpoint', Walk: 'Walk',
  'Historic house': 'Heritage', Mansion: 'Heritage', Palace: 'Heritage', Tower: 'Heritage', Convent: 'Heritage', Monument: 'Heritage',
  'Cultural site': 'Heritage', Heritage: 'Heritage', 'Heritage / church': 'Heritage', 'Heritage / museum': 'Museum', 'Heritage / coast': 'Heritage',
  'Cultural centre': 'Museum', Garden: 'Park & garden', Park: 'Park & garden', Harbour: 'Sight', Estuary: 'Sight', 'Day trip': 'Sight'
};
const FOOD_BY_KIND = {
  'Traditional Cantabrian': 'Local cuisine', Seafood: 'Seafood', 'Asador (grill)': 'Grill', Sidrería: 'Cider house',
  'Tapas & pintxos': 'Tapas', 'Café / breakfast': 'Cafe', Market: 'Market'
};
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
  else if (p.category === 'restaurant') add('Type', FOOD_BY_KIND[p.kind]);
  else add('Type', TYPE_BY_KIND[p.kind] || (p.category === 'attraction' ? 'Sight' : ''));

  // Practical
  if (p.reservations === 'Book ahead') add('Practical', 'Book ahead');
  if (p.route?.circular) add('Practical', 'Loop route');

  // Level
  if (['Easy', 'Moderate', 'Hard'].includes(h.difficulty)) add('Level', h.difficulty);

  for (const x of p.extraTags || []) t.add(x);
  return [...t];
}
