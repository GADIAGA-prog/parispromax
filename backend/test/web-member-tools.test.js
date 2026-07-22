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
