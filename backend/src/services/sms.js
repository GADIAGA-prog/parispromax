const config = require('../config');

// Pluggable SMS sender. In dev (no provider configured) it just logs the code.
// To enable real delivery, set SMS_PROVIDER + SMS_API_KEY and implement the
// provider branch below (Twilio, Orange SMS API, etc.).
async function sendSms(phone, message) {
  if (!config.sms.provider) {
    console.log(`[sms:dev] -> ${phone}: ${message}`);
    return { delivered: false, dev: true };
  }

  // Example provider scaffolding (left intentionally generic):
  // if (config.sms.provider === 'twilio') { ... }
  // if (config.sms.provider === 'orange') { ... }
  console.warn(`[sms] provider "${config.sms.provider}" not implemented yet.`);
  return { delivered: false, dev: false };
}

module.exports = { sendSms };
