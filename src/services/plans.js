// PARISPROMAX — Subscription plans (app copy, mirrors backend src/plans.js).
// Prices in XOF. The backend remains the source of truth for charging.

export const PLANS = [
  { id: 'daily', label: 'Journalier', sub: '1 jour', days: 1, priceNormal: 200, pricePromo: 200 },
  { id: 'weekly', label: 'Hebdomadaire', sub: '7 jours', days: 7, priceNormal: 1400, pricePromo: 1300 },
  { id: 'monthly', label: 'Mensuel', sub: '30 jours', days: 30, priceNormal: 6000, pricePromo: 5400 },
  { id: 'quarterly', label: 'Trimestriel', sub: '90 jours', days: 90, priceNormal: 18000, pricePromo: 15300 },
  { id: 'annual', label: 'Annuel', sub: '365 jours', days: 365, priceNormal: 72000, pricePromo: 54000 },
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
