// Which rows of the owner's restaurant list make it onto the map. Rules first, then named exceptions.
//   1. Google rating below 4.0: out.
//   2. Fewer than 30 reviews: out (too few to trust the score).
//   3. 4.0-4.1 with fewer than 150 reviews: out (middling score without the volume to back it).
//   4. Quick food (kebab, shawarma, wok / sushi buffets, all-you-can-eat) must have 4.3+ and 75+ reviews.
//   5. Not really a restaurant (pubs, bakeries, bubble tea): out.
// KEEP / DROP name exceptions that override the rules, each with the reason shown in the import report.
export const KEEP = {
  'NKO Eneko Restaurant': 'Michelin-recommended; the low score is about price, not food',
};
export const DROP = {};
const QUICK = /kebab|döner|doner|shawarma|halal fast|buffet|wok/i;
const NOT_RESTAURANT = /irish pub|bakery|bubble tea/i;
export function verdict(r) {
  const name = r.Name, rating = parseFloat(r.Rating), reviews = +String(r.Reviews || '').replace(/,/g, '') || 0;
  const text = `${r.Name} ${r.Cuisine} ${r['Good to know']}`;
  if (KEEP[name]) return { keep: true, why: 'kept: ' + KEEP[name] };
  if (DROP[name]) return { keep: false, why: DROP[name] };
  if (!(rating >= 4)) return { keep: false, why: rating ? `rating ${rating}` : 'no rating' };
  if (reviews < 30) return { keep: false, why: `only ${reviews} reviews` };
  if (rating < 4.2 && reviews < 150) return { keep: false, why: `${rating} from ${reviews} reviews` };
  if (NOT_RESTAURANT.test(`${r.Name} ${r.Cuisine}`)) return { keep: false, why: 'not really a restaurant' };
  if (QUICK.test(text) || /all-you-can-eat|buffet/i.test(r['Good to know'])) {
    if (rating < 4.3 || reviews < 75) return { keep: false, why: `quick food at ${rating} / ${reviews} reviews` };
  }
  return { keep: true };
}
