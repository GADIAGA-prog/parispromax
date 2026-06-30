// PARISPROMAX — Subscription plans (app copy, mirrors backend src/plans.js).
// Prices in XOF. The backend remains the source of truth for charging.

export const PLANS = [
  { id: 'daily', label: 'Journalier', sub: '1 jour', days: 1, priceNormal: 400, pricePromo: 400 },
  { id: 'weekly', label: 'Hebdomadaire', sub: '7 jours', days: 7, priceNormal: 2800, pricePromo: 2600 },
  { id: 'monthly', label: 'Mensuel', sub: '30 jours', days: 30, priceNormal: 12000, pricePromo: 10800 },
  { id: 'quarterly', label: 'Trimestriel', sub: '90 jours', days: 90, priceNormal: 36000, pricePromo: 30600 },
  { id: 'annual', label: 'Annuel', sub: '365 jours', days: 365, priceNormal: 144000, pricePromo: 108000 },
];

PLANS.forEach((p) => {
  p.discount = p.priceNormal > 0 ? Math.round((1 - p.pricePromo / p.priceNormal) * 10000) / 100 : 0;
  p.currency = 'XOF';
});

export function fmtXOF(n) {
  return `${Number(n).toLocaleString('fr-FR')} XOF`;
}

export function getPlan(id) {
  return PLANS.find((p) => p.id === id) || null;
}

export default PLANS;
