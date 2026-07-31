const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('les visuels hippiques illustrent le site et Android', () => {
  const html = read('backend', 'public', 'index.html');
  const homeScreen = read('src', 'screens', 'HomeScreen.js');
  const historyScreen = read('src', 'screens', 'HistoryScreen.js');
  const assets = [
    ['backend', 'public', 'assets', 'race-flat.jpg'],
    ['backend', 'public', 'assets', 'race-harness.jpg'],
    ['backend', 'public', 'assets', 'race-finish.jpg'],
    ['assets', 'race-flat.jpg'],
    ['assets', 'race-harness.jpg'],
    ['assets', 'race-finish.jpg'],
  ];

  assets.forEach((asset) => assert.ok(fs.statSync(path.join(root, ...asset)).size > 100000));
  assert.match(html, /race-flat\.jpg/);
  assert.match(html, /race-harness\.jpg/);
  assert.match(html, /race-finish\.jpg/);
  assert.match(homeScreen, /race-flat\.jpg/);
  assert.match(homeScreen, /race-harness\.jpg/);
  assert.match(historyScreen, /race-finish\.jpg/);
});

test('les interfaces ne présentent plus ParisPromax comme un produit IA', () => {
  const visibleInterface = [
    read('backend', 'public', 'index.html'),
    read('backend', 'public', 'app.js'),
    read('src', 'components', 'Disclaimer.js'),
    read('src', 'components', 'HorseCard.js'),
    read('src', 'components', 'RaceInsightsCard.js'),
    read('src', 'components', 'TrialBanner.js'),
    read('src', 'screens', 'HistoryScreen.js'),
    read('src', 'screens', 'LoginScreen.js'),
    read('src', 'screens', 'OnboardingScreen.js'),
    read('src', 'screens', 'QuintePlusScreen.js'),
    read('src', 'screens', 'RaceDetailScreen.js'),
  ].join('\n');

  assert.doesNotMatch(visibleInterface, /Pronostics? IA|intelligence artificielle|Indice IA|IA \+ données|ANALYSE IA|MODÈLE IA|🤖|name="sparkles"/i);
});
