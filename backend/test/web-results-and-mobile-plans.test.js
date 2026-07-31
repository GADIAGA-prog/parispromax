const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'backend', 'public', 'index.html'), 'utf8');
const webApp = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'), 'utf8');
const paywall = fs.readFileSync(path.join(root, 'src', 'screens', 'PaywallScreen.js'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'src', 'screens', 'ProfileScreen.js'), 'utf8');
const nationalCard = fs.readFileSync(path.join(root, 'src', 'components', 'NationalGameCard.js'), 'utf8');

const navigator = fs.readFileSync(path.join(root, 'src', 'navigation', 'RootNavigator.js'), 'utf8');
const historyScreen = fs.readFileSync(path.join(root, 'src', 'screens', 'HistoryScreen.js'), 'utf8');
test('le site expose une section publique pour les arrivées officielles', () => {
  assert.match(html, /id="resultats"/);
  assert.match(html, /id="results-grid"/);
  assert.match(webApp, /races\/history\?country/);
  assert.match(webApp, /officialResultMarkup\(detail\)/);
});

test('Android charge les tarifs officiels et affiche le montant réellement facturé', () => {
  assert.match(paywall, /api\s*\.\s*plans\(\)/);
  assert.match(paywall, /setPlans\(officialPlans\)/);
  assert.match(paywall, /fmtXOF\(referralPrice\(plan\)\)/);
});

test('le jeu intelligent national est visible sur le web et Android', () => {
  assert.match(webApp, /renderNationalGameGuide\(game\)/);
  assert.match(webApp, /nationalStrategyMarkup\(detail\)/);
  assert.match(webApp, /nationalProposalMarkup\(game\)/);
  assert.match(webApp, /Couplé et Grand Carnet/);
  assert.match(nationalCard, /game\.strategies/);
  assert.match(nationalCard, /game\.proposal\.couples/);
  assert.match(nationalCard, /Toutes les combinaisons/);
  assert.match(nationalCard, /Grand carnet/);
});

test('le support WhatsApp officiel est disponible sur le web et Android', () => {
  assert.match(html, /wa\.me\/22668254941/);
  assert.match(profile, /wa\.me\/22668254941/);
  assert.doesNotMatch(profile, /\+226 68 25 49 41/);
});

test('la navigation principale suit les quatre parcours demandés', () => {
  assert.match(html, /href="#courses-du-jour">Courses du jour/);
  assert.match(html, /href="#resultats">Résultats/);
  assert.match(html, /href="#abonnements">Abonnements/);
  assert.match(html, /href="#contact">Contact/);
  assert.match(navigator, /name="Courses du jour"/);
  assert.match(navigator, /name="Résultats"/);
  assert.match(navigator, /name="Abonnements"/);
  assert.match(navigator, /name="Contact"/);
});

test('les résultats et le contact séparent les parcours utiles', () => {
  assert.match(historyScreen, /Course nationale/);
  assert.match(historyScreen, />ECD</);
  assert.match(html, /data-results-category="national"/);
  assert.match(html, /data-results-category="ecd"/);
  assert.match(html, /href="https:\/\/t\.me\/ParisPromaxOfficiel"/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/parispromax"/);
  assert.match(html, /id="contact-referral-link"/);
  assert.match(profile, /t\.me\/ParisPromaxOfficiel/);
  assert.match(profile, /facebook\.com\/parispromax/);
  assert.match(profile, /Share\.share/);
});
