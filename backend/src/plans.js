// PARISPROMAX — Subscription plans (single source of truth, backend).
// Prices in XOF. priceNormal = reference price, pricePromo = charged price.

const PLANS = [
  { id: 'daily',     label: 'Journalier',   days: 1,   priceNormal: 400,    pricePromo: 400 },
  { id: 'weekly',    label: 'Hebdomadaire', days: 7,   priceNormal: 2800,   pricePromo: 2600 },
  { id: 'monthly',   label: 'Mensuel',      days: 30,  priceNormal: 12000,  pricePromo: 10800 },
  { id: 'quarterly', label: 'Trimestriel',  days: 90,  priceNormal: 36000,  pricePromo: 30600 },
  { id: 'annual',    label: 'Annuel',       days: 365, priceNormal: 144000, pricePromo: 108000 },
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
