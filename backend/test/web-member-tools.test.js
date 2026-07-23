const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWebFunctions(search = '', origin = 'https://www.parispromax.com') {
  const appPath = path.join(__dirname, '..', 'public', 'app.js');
  const source = fs.readFileSync(appPath, 'utf8').replace(/\nboot\(\);\s*$/, '\n');
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const context = vm.createContext({
    console,
    document,
    window: {
      location: { origin, search },
      matchMedia: () => ({ matches: false }),
      addEventListener: () => {},
      navigator: {},
    },
    location: { origin, search },
    navigator: {},
    sessionStorage: storage,
    localStorage: storage,
    URL,
    URLSearchParams,
    Intl,
    Date,
    setTimeout,
    clearTimeout,
    AbortController,
    FormData,
  });
  vm.runInContext(source, context);
  return context;
}

function loadPhoneNormalizer(countries) {
  const web = loadWebFunctions();
  web.__testCountries = countries;
  vm.runInContext('state.countries = __testCountries', web);
  return web.normalizePhone;
}

test('le lien de parrainage intègre un code normalisé', () => {
  const web = loadWebFunctions();
  assert.equal(
    web.referralUrl(' ppm-ab12 '),
    'https://www.parispromax.com/?ref=PPMAB12'
  );
});

test('la chatbox dirige une difficulté de connexion vers le bon parcours', () => {
  const web = loadWebFunctions();
  const answer = web.chatAnswer('Erreur serveur quand je veux me connecter');
  assert.equal(answer.auth, 'login');
  assert.match(answer.text, /Mot de passe oublié/);
});

test('une erreur serveur de connexion reçoit un message utile', () => {
  const web = loadWebFunctions();
  assert.match(web.loginErrorMessage({ status: 500 }), /temporairement indisponible/);
});

test('les anciennes adresses utilisent directement le domaine www pour les API', () => {
  assert.equal(
    loadWebFunctions('', 'https://parispromax.com').publicWebOrigin(),
    'https://www.parispromax.com'
  );
  assert.equal(
    loadWebFunctions('', 'https://parispromax-backend.onrender.com').publicWebOrigin(),
    'https://www.parispromax.com'
  );
  assert.equal(
    loadWebFunctions('', 'http://localhost:4000').publicWebOrigin(),
    'http://localhost:4000'
  );
});

test("un numéro avec l'indicatif sans signe plus n'est pas préfixé deux fois", () => {
  const normalizePhone = loadPhoneNormalizer([
    { code: 'bf', dial: '+226', nationalLength: 8 },
  ]);

  assert.equal(normalizePhone('22676251570', 'bf'), '+22676251570');
  assert.equal(normalizePhone('00226 76 25 15 70', 'bf'), '+22676251570');
});

test('les formats international et national restent normalisés en E.164', () => {
  const normalizePhone = loadPhoneNormalizer([
    { code: 'bf', dial: '+226', nationalLength: 8 },
    { code: 'ci', dial: '+225', nationalLength: 10, keepLeadingZero: true },
  ]);

  assert.equal(normalizePhone('+226 76 25 15 70', 'bf'), '+22676251570');
  assert.equal(normalizePhone('76 25 15 70', 'bf'), '+22676251570');
  assert.equal(normalizePhone('076251570', 'bf'), '+22676251570');
  assert.equal(normalizePhone('07 12 34 56 78', 'ci'), '+2250712345678');
  assert.equal(normalizePhone('2250712345678', 'ci'), '+2250712345678');
});

test('la connexion envoie une seule requête, même en cas de réponse serveur 5xx', () => {
  const web = loadWebFunctions();
  const loginSource = web.login.toString();
  const authCalls = loginSource.match(/api\(['"]\/auth\/login['"]/g) || [];

  assert.equal(authCalls.length, 1);
  assert.doesNotMatch(loginSource, /catch\s*\(/);
});
