const axios = require('axios');
const config = require('../config');

// Pluggable SMS sender. In dev (no provider configured) it just logs the code.
// Providers supportés (SMS_PROVIDER) :
//   'twilio' — TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + SMS_SENDER (numéro ou
//              alphanumeric sender id).
//   'orange' — API SMS d'Orange (developer.orange.com, dispo Burkina Faso) :
//              ORANGE_CLIENT_ID + ORANGE_CLIENT_SECRET + ORANGE_SENDER (le
//              numéro dédié du contrat, ex. +2260000) + SMS_SENDER (nom).
// Retour: { delivered: boolean, dev?: boolean, error?: string }.

// --- Twilio ------------------------------------------------------------------
async function sendTwilio(phone, message) {
  const sid = config.sms.twilioSid;
  const token = config.sms.twilioToken;
  if (!sid || !token) {
    return { delivered: false, error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN manquants' };
  }
  const body = new URLSearchParams({
    To: phone,
    From: config.sms.sender,
    Body: message,
  });
  const { data } = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    body.toString(),
    {
      auth: { username: sid, password: token },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    }
  );
  // Twilio accepte le message (queued/sent) — l'échec réseau lèverait une erreur.
  return { delivered: !['failed', 'undelivered'].includes(data.status), providerId: data.sid };
}

// --- Orange SMS API ------------------------------------------------------------
// Jeton OAuth mis en cache jusqu'à ~1 min avant expiration.
let orangeToken = { value: null, expiresAt: 0 };

async function getOrangeToken() {
  if (orangeToken.value && Date.now() < orangeToken.expiresAt - 60 * 1000) {
    return orangeToken.value;
  }
  const basic = Buffer.from(`${config.sms.orangeClientId}:${config.sms.orangeClientSecret}`).toString('base64');
  const { data } = await axios.post(
    'https://api.orange.com/oauth/v3/token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    }
  );
  orangeToken = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return orangeToken.value;
}

async function sendOrange(phone, message) {
  if (!config.sms.orangeClientId || !config.sms.orangeClientSecret || !config.sms.orangeSender) {
    return { delivered: false, error: 'ORANGE_CLIENT_ID / ORANGE_CLIENT_SECRET / ORANGE_SENDER manquants' };
  }
  const token = await getOrangeToken();
  const senderTel = `tel:${config.sms.orangeSender}`;
  const dest = `tel:${phone.startsWith('+') ? phone : `+${phone}`}`;
  const payload = {
    outboundSMSMessageRequest: {
      address: dest,
      senderAddress: senderTel,
      senderName: config.sms.sender || undefined,
      outboundSMSTextMessage: { message },
    },
  };
  await axios.post(
    `https://api.orange.com/smsmessaging/v1/outbound/${encodeURIComponent(senderTel)}/requests`,
    payload,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  return { delivered: true };
}

// --- Dispatcher -----------------------------------------------------------------
async function sendSms(phone, message) {
  if (!config.sms.provider) {
    console.log(`[sms:dev] -> ${phone}: ${message}`);
    return { delivered: false, dev: true };
  }
  try {
    if (config.sms.provider === 'twilio') return await sendTwilio(phone, message);
    if (config.sms.provider === 'orange') return await sendOrange(phone, message);
    console.warn(`[sms] provider "${config.sms.provider}" inconnu (twilio | orange).`);
    return { delivered: false, error: `provider inconnu: ${config.sms.provider}` };
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
    console.error(`[sms:${config.sms.provider}] échec d'envoi -> ${phone}: ${detail}`);
    return { delivered: false, error: detail };
  }
}

module.exports = { sendSms };
