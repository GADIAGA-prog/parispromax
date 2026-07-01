const config = require('../config');
const cinetpay = require('./cinetpay');
const fedapay = require('./fedapay');

// Selects the active payment provider from config (PAYMENT_PROVIDER env).
// Both providers expose the same interface:
//   initiatePayment({ transactionId, amount, currency, description, customer })
//     -> { mode, paymentUrl, providerRef?, notifyUrl, returnUrl }
//   verifyPayment(paymentRecord) -> { status, method, raw }
//   isConfigured() -> boolean
const providers = { cinetpay, fedapay };
const name = providers[config.payments.provider] ? config.payments.provider : 'fedapay';
const active = providers[name];

module.exports = {
  name,
  initiatePayment: active.initiatePayment,
  verifyPayment: active.verifyPayment,
  isConfigured: active.isConfigured,
};
