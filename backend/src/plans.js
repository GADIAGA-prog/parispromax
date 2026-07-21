// PARISPROMAX — Subscription plans (single source of truth, backend).
// Prices in XOF. priceNormal = reference price, pricePromo = charged price.

const PLANS = [
  { id: 'daily',     label: 'Journalier',   days: 1,   priceNormal: 200,   pricePromo: 200 },
  { id: 'weekly',    label: 'Hebdomadaire', days: 7,   priceNormal: 1400,  pricePromo: 1300 },
  { id: 'monthly',   label: 'Mensuel',      days: 30,  priceNormal: 6000,  pricePromo: 5400 },
  { id: 'quarterly', label: 'Trimestriel',  days: 90,  priceNormal: 18000, pricePromo: 15300 },
  { id: 'annual',    label: 'Annuel',       days: 365, priceNormal: 72000, pricePromo: 54000 },
];

// Attach computed discount percentage.
PLANS.forEach((p) => {
  p.discount =
    p.priceNormal > 0 ? Math.round((1 - p.pricePromo / p.priceNormal) * 10000) / 100 : 0;
  p.currency = 'XOF';
});

function getPlan(id) {
  return PLANS.find((p) => p.id === id) || null;
}

module.exports = { PLANS, getPlan };
