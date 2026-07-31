const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('les visuels hippiques illustrent le site et Android', () => {
  const html = read('backend', 'public', 'index.html');
  const webApp = read('backend', 'public', 'app.js');
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
  assert.match(webApp, /race-flat\.jpg/);
  assert.match(webApp, /race-harness\.jpg/);
  assert.match(html, /race-finish\.jpg/);
  assert.equal((html.match(/data-race-carousel/g) || []).length, 4);
  assert.equal((html.match(/race-carousel-slide active/g) || []).length, 4);
  assert.match(html, /Course nationale du jour/);
  assert.match(webApp, /function raceDiscipline/);
  assert.match(webApp, /TROT ATTELÉ/);
  assert.match(webApp, /TROT MONTÉ/);
  assert.match(webApp, /OBSTACLE/);
  assert.match(webApp, /race-discipline-badge/);
  assert.doesNotMatch(html, /Pronostic et mise, au même endroit|Indice forme/);
  assert.doesNotMatch(webApp, /JEU INTELLIGENT|ANALYSE COMMENTÉE|indice de forme/);
  assert.match(webApp, /raceCarouselPlaceholder/);
  assert.match(webApp, /setInterval/);
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


test('le texte saisi dans le chat reste visible sur fond sombre', () => {
  const styles = read('backend', 'public', 'styles.css');

  assert.match(styles, /\.chat-form input\{[^}]*color:#f3f7fb/);
  assert.match(styles, /caret-color:#2de2a0/);
  assert.match(styles, /\.chat-form input::placeholder\{[^}]*color:#91a2b8/);
  assert.match(styles, /-webkit-text-fill-color:#f3f7fb/);
});
