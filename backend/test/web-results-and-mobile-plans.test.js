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
const styles = fs.readFileSync(path.join(root, 'backend', 'public', 'styles.css'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'backend', 'public', 'sw.js'), 'utf8');
const appRoot = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const disclaimer = fs.readFileSync(path.join(root, 'src', 'components', 'Disclaimer.js'), 'utf8');
const lockCard = fs.readFileSync(path.join(root, 'src', 'components', 'LockCard.js'), 'utf8');
const insightsCard = fs.readFileSync(path.join(root, 'src', 'components', 'RaceInsightsCard.js'), 'utf8');
const androidColors = fs.readFileSync(path.join(root, 'src', 'theme', 'colors.js'), 'utf8');
const ageGate = fs.readFileSync(path.join(root, 'src', 'screens', 'AgeGateScreen.js'), 'utf8');
const login = fs.readFileSync(path.join(root, 'src', 'screens', 'LoginScreen.js'), 'utf8');
const onboarding = fs.readFileSync(path.join(root, 'src', 'screens', 'OnboardingScreen.js'), 'utf8');
const history = fs.readFileSync(path.join(root, 'src', 'screens', 'HistoryScreen.js'), 'utf8');
const quinte = fs.readFileSync(path.join(root, 'src', 'screens', 'QuintePlusScreen.js'), 'utf8');
const trialBanner = fs.readFileSync(path.join(root, 'src', 'components', 'TrialBanner.js'), 'utf8');

const navigator = fs.readFileSync(path.join(root, 'src', 'navigation', 'RootNavigator.js'), 'utf8');
const historyScreen = fs.readFileSync(path.join(root, 'src', 'screens', 'HistoryScreen.js'), 'utf8');
test('le site expose une section publique pour les arrivées officielles', () => {
  assert.match(html, /id="resultats"/);
  assert.match(html, /id="results-grid"/);
  assert.match(webApp, /races\/history\?country/);
  assert.match(webApp, /officialResultMarkup\(detail\)/);
});

test('le site affiche les références réunion/course et les gains Burkina', () => {
  assert.match(webApp, /function raceReference/);
  assert.match(webApp, /`R\$\{Number\(exact\[1\]\)\}C\$\{Number\(exact\[2\]\)\}`/);
  assert.match(webApp, /GAINS ECD · BURKINA FASO/);
  assert.match(webApp, /Pronostic ParisPromax/);
  assert.match(webApp, /Rapports officiels en attente/);
  assert.match(styles, /\.ecd-gains-table/);
});

test('le site publie le bilan de gain du Grand Carnet après la course', () => {
  assert.match(webApp, /BILAN GRAND CARNET PARISPROMAX/);
  assert.match(webApp, /gainStatus === 'confirmed'/);
  assert.match(webApp, /Pronostic gagnant · gain officiel en attente/);
  assert.match(webApp, /Pronostic non gagnant · gain 0 FCFA/);
  assert.match(styles, /\.grand-carnet-outcome/);
});

test('Android charge les tarifs officiels et affiche le montant réellement facturé', () => {
  assert.match(paywall, /api\s*\.\s*plans\(\)/);
  assert.match(paywall, /setPlans\(officialPlans\)/);
  assert.match(paywall, /fmtXOF\(referralPrice\(plan\)\)/);
});

test('les tarifs officiels défilent en haut du site sans figer les petits écrans', () => {
  assert.match(html, /id="plan-ticker-track"/);
  assert.match(webApp, /plan-ticker-group/);
  assert.match(webApp, /ticker\.classList\.add\('is-ready'\)/);
  assert.match(webApp, /Number\(plan\.pricePromo\)\.toLocaleString/);
  assert.match(styles, /@keyframes plan-ticker-scroll/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.plan-ticker-track \{ width: auto; animation: none; \}/);
});

test('la fenêtre de paiement reste lisible après le passage du site au thème clair', () => {
  const finalContrastLayer = styles.slice(styles.indexOf('contraste explicite et couche responsive finale'));
  assert.match(finalContrastLayer, /\.modal \{[\s\S]*--text: #14212b;[\s\S]*background: #ffffff;/);
  assert.match(finalContrastLayer, /\.form-stack input,[\s\S]*color: #14212b;[\s\S]*background: #f7f9fa;/);
  assert.match(finalContrastLayer, /\.operator-chip\.active \{[\s\S]*background: #eaf7f1;/);
  assert.match(html, /styles\.css\?v=20260802-1/);
  assert.match(serviceWorker, /parispromax-shell-20260802-1/);
});

test('les règles responsive finales couvrent tablette et téléphone', () => {
  const finalResponsiveLayer = styles.slice(styles.indexOf('contraste explicite et couche responsive finale'));
  assert.match(finalResponsiveLayer, /@media \(max-width: 980px\)[\s\S]*\.hero \{ grid-template-columns: 1fr;/);
  assert.match(finalResponsiveLayer, /@media \(max-width: 760px\)[\s\S]*\.results-grid,[\s\S]*grid-template-columns: 1fr;/);
  assert.match(finalResponsiveLayer, /@media \(max-width: 480px\)[\s\S]*\.hero h1 \{ font-size: clamp/);
});

test('Android utilise des surfaces claires et des textes visibles', () => {
  assert.match(appRoot, /<StatusBar style="dark" \/>/);
  assert.doesNotMatch(lockCard, /backgroundColor: 'rgba\(15,23,42,0\.92\)'/);
  assert.match(lockCard, /backgroundColor: 'rgba\(238,242,244,0\.96\)'/);
  assert.match(insightsCard, /card: \{[\s\S]*backgroundColor: COLORS\.surface/);
});

test('les surfaces vertes Android utilisent un texte blanc suffisamment contrasté', () => {
  assert.match(androidColors, /accent: '#087554',[\s\S]*onAccent: '#ffffff'/);
  assert.match(ageGate, /buttonText: \{ color: COLORS\.onAccent/);
  assert.match(login, /tabTextActive: \{ color: COLORS\.onAccent/);
  assert.match(login, /buttonText: \{ color: COLORS\.onAccent/);
  assert.match(onboarding, /nextText: \{ color: COLORS\.onAccent/);
  assert.match(paywall, /payText: \{ color: COLORS\.onAccent/);
  assert.match(history, /rateText: \{ color: COLORS\.onAccent/);
  assert.match(quinte, /comboNum: \{ color: COLORS\.onAccent/);
  assert.match(insightsCard, /selectionCountValue: \{ color: COLORS\.onAccent/);
  assert.match(trialBanner, /ctaText: \{ color: COLORS\.onAccent/);
});

test('le site et Android indiquent qu’aucun pari n’est effectué', () => {
  assert.match(html, /Aucun jeu ni pari n’est effectué sur ParisPromax/);
  assert.match(webApp, /Simulation uniquement : aucun jeu ni pari n’est effectué sur ParisPromax/);
  assert.match(disclaimer, /ParisPromax n’effectue et n’encaisse aucun jeu ni pari/);
  assert.match(nationalCard, /propositions et montants sont illustratifs/);
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

test('le téléchargement Android reste visible en haut du site sur tous les écrans', () => {
  assert.match(html, /header-android-download-desktop[\s\S]*href="\/download\/android"/);
  assert.match(html, /header-android-download-mobile[\s\S]*href="\/download\/android"/);
  assert.match(html, />Télécharger Android</);
  assert.match(html, />Installer Android</);
  assert.match(styles, /\.header-android-download-mobile \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.header-android-download-mobile \{ display: inline-flex; \}/);
});

test('les actions de l’en-tête restent compactes et sur une seule ligne', () => {
  assert.match(styles, /-webkit-text-size-adjust: 100%/);
  assert.match(styles, /\.header-actions \.button \{[\s\S]*min-height: 34px;[\s\S]*font-size: 11px;[\s\S]*white-space: nowrap;/);
  assert.match(styles, /\.header-android-download \{[\s\S]*min-height: 34px;/);
});

test('tout le programme ECD reste consultable sur téléphone et tablette', () => {
  assert.match(webApp, /faites défiler pour toutes les voir/);
  assert.match(webApp, /window\.matchMedia\('\(max-width: 980px\)'\)/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.race-list \{[\s\S]*overflow-y: auto;/);
  assert.match(styles, /\.track-label \{[\s\S]*writing-mode: horizontal-tb;/);
});
