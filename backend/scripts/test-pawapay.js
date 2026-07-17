/* eslint-disable no-console */
const pawapay = require('../src/services/pawapay');
const config = require('../src/config');

async function main() {
  if (!pawapay.isConfigured()) {
    throw new Error('PAWAPAY_API_TOKEN est absent. Ajoutez le token sandbox dans backend/.env.');
  }
  if (config.pawapay.mode !== 'sandbox') {
    throw new Error('Test refusé : PAWAPAY_MODE doit être sandbox.');
  }
  const data = await pawapay.activeConfiguration();
  const countries = (data.countries || []).map((country) => ({
    country: country.country,
    providers: (country.providers || []).map((provider) => provider.provider),
  }));
  console.log(JSON.stringify({ ok: true, mode: config.pawapay.mode, companyName: data.companyName, countries }, null, 2));
}

main().catch((error) => {
  console.error(error.response?.data || error.message);
  process.exitCode = 1;
});
