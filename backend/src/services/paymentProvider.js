const config = require('../config');
const cinetpay = require('./cinetpay');
const fedapay = require('./fedapay');
const paydunya = require('./paydunya');
const ligdicash = require('./ligdicash');
const feexpay = require('./feexpay');
const pawapay = require('./pawapay');
const yengapay = require('./yengapay');

// Registry of supported payment providers. Both expose the same interface:
//   initiatePayment({ transactionId, amount, currency, description, customer })
//     -> { mode, paymentUrl, providerRef?, notifyUrl, returnUrl }
//   verifyPayment(paymentRecord) -> { status, method, raw }
//   isConfigured() -> boolean
const REGISTRY = {
  fedapay: { impl: fedapay, label: 'FedaPay' },
  cinetpay: { impl: cinetpay, label: 'CinetPay' },
  paydunya: { impl: paydunya, label: 'PayDunya' },
  ligdicash: { impl: ligdicash, label: 'LigdiCash' },
  // FeexPay expose deux flux : mobile money (route dédiée /payments/feexpay/mobile)
  // et carte (interface redirect standard via initiatePayment).
  feexpay: { impl: feexpay, label: 'FeexPay' },
  pawapay: { impl: pawapay, label: 'pawaPay Sandbox' },
  yengapay: { impl: yengapay, label: 'YengaPay' },
};

// Configured default (PAYMENT_PROVIDER env), falling back to fedapay.
const defaultName = REGISTRY[config.payments.provider] ? config.payments.provider : 'fedapay';

// Resolve a provider by name (falls back to the default for unknown names).
// Returns the impl augmented with its `name` and `label`.
function getProvider(name) {
  const key = REGISTRY[name] ? name : defaultName;
  const { impl, label } = REGISTRY[key];
  return {
    name: key,
    label,
    initiatePayment: impl.initiatePayment,
    verifyPayment: impl.verifyPayment,
    isConfigured: impl.isConfigured,
  };
}

// Providers usable right now = configured with real keys, or (in dev) mock-able.
// The app calls this to only show payment options that will actually work.
function availableProviders() {
  return Object.entries(REGISTRY)
    .filter(([id]) => !config.payments.disabled.includes(id)) // hidden via env
    .map(([id, { impl, label }]) => ({
      id,
      label,
      configured: impl.isConfigured(),
      usable: impl.isConfigured() || config.allowMock,
    }))
    .filter((p) => p.usable);
}

module.exports = { getProvider, availableProviders, defaultName, REGISTRY };
