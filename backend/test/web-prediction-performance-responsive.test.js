const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'backend', 'public', 'index.html'), 'utf8');
const webApp = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'backend', 'public', 'styles.css'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'backend', 'public', 'sw.js'), 'utf8');
const racesRoute = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'races.js'), 'utf8');

test('le site explique et charge la mesure réelle des bases placées', () => {
  assert.match(html, /id="prediction-performance"/);
  assert.match(html, /Taux de bases placées/);
  assert.match(html, /classé n°1[\s\S]*Jumelé ordre à 2[\s\S]*Trio à 3 dès 8 partants[\s\S]*Quarté à 4[\s\S]*Quinté à 5/);
  assert.match(html, /id="success-rate-all"/);
  assert.match(html, /id="success-rate-ecd"/);
  assert.match(html, /id="success-rate-national"/);
  assert.match(html, /id="success-rate-30"/);
  assert.match(html, /30 derniers jours/);
  assert.match(webApp, /stats\/success-rate\?country=\$\{encodeURIComponent\(state\.nationalCountry\)\}/);
  assert.match(webApp, /modelRows\.slice\(0, 3\)/);
  assert.match(webApp, /stats\?\.sampleSize/);
  assert.match(webApp, /stats\?\.last30Days\?\.sampleSize/);
  assert.match(webApp, /stats\?\.last30Days\?\.rate/);
});

test('le pronostic web conserve un ordre canonique et ne fait varier que sa longueur', () => {
  assert.match(webApp, /state\.selectedRaceMode === 'ecd' && state\.ecdProfile\?\.verified !== true/);
  assert.match(webApp, /Format ECD non validé pour ce pays/);
  assert.match(webApp, /function canonicalPredictionPicks\(prediction, detail = \{\}\)/);
  assert.match(webApp, /prediction\?\.topPicks \|\| \[\]/);
  assert.match(webApp, /Number\(left\.pick\?\.rank \|\| 999\) - Number\(right\.pick\?\.rank \|\| 999\)/);
  assert.match(webApp, /detail\.id[\s\S]*state\.nationalRaceId[\s\S]*state\.nationalGame\?\.podium/);
  assert.match(webApp, /activeRunners > 0 && activeRunners < 8[\s\S]*\? 2[\s\S]*: 3/);
  assert.match(webApp, /activeRunnerCount[\s\S]*PARTANTS ACTIFS[\s\S]*nonRunnerCount/);
  assert.match(webApp, /ARRIVÉE OFFICIELLE PARTIELLE/);
  assert.match(webApp, /positions disponibles · bilan suspendu/);
  assert.match(webApp, /ARRIVÉE EN VALIDATION/);
  assert.match(webApp, /detail\?\.startsAt/);
  assert.match(racesRoute, /startsAt: parisStartIso\(race\.date, full\.time\)/);
  assert.match(webApp, /const desiredSize = podium \+ 2/);
  assert.match(webApp, /podium === 2 \? 'Jumelé ordre \+ 2' : 'Trio \+ 2'/);
  assert.match(webApp, /const selected = canonical\.slice\(0, profile\.selectionSize\)/);
  assert.match(webApp, /function canonicalPredictionRoles\(selected = \[\]\)/);
  assert.match(webApp, /canonicalPredictionRoles\(selected\)/);
  assert.doesNotMatch(webApp, /const selectedSource = groups\.selected/);
  assert.doesNotMatch(webApp, /const groups = prediction\.groups/);
});

test('une course hybride conserve le contexte de l onglet qui l ouvre', () => {
  assert.match(webApp, /selectedRaceMode: null/);
  assert.match(webApp, /selectRace\(button\.dataset\.raceId, 'ecd'\)/);
  assert.match(webApp, /selectRace\(button\.dataset\.nationalRace, 'national'\)/);
  assert.match(webApp, /selectRace\(button\.dataset\.resultRace, state\.resultCategory\)/);
  assert.match(webApp, /state\.selectedRaceMode === 'national'[\s\S]*state\.nationalRaceId/);
});

test('l’onglet ECD utilise la variante historique ECD fournie par l’API', () => {
  assert.match(webApp, /function resultPredictionVariant\(result = \{\}\)/);
  assert.match(webApp, /state\.resultCategory !== 'ecd' \|\| !Array\.isArray\(result\.ecdTopPicks\)/);
  assert.match(webApp, /topPicks: result\.ecdTopPicks/);
  assert.match(webApp, /groups: result\.ecdGroups \|\| null/);
  assert.match(webApp, /state\.resultCategory === 'national'[\s\S]*grandCarnetOutcomeMarkup\(result\.grandCarnetOutcome, result\)[\s\S]*ecdTicketOutcomeMarkup\(result\.ecdTicketOutcome\)/);
  assert.match(webApp, /ecdGainsTableMarkup\(displayResult\)/);
});

test('les états officiels inconnus ou partiels ne sont jamais présentés comme vérifiés ou perdants', () => {
  assert.match(webApp, /arrivalComplete === false[\s\S]*Arrivée officielle en cours de complétion/);
  assert.match(webApp, /arrivalComplete == null[\s\S]*Statut officiel à confirmer/);
  assert.match(webApp, /function grandCarnetFallbackMarkup\(result = \{\}\)/);
  assert.match(webApp, /Arrivée officielle partielle · calcul suspendu/);
  assert.match(webApp, /Aucun gain ni aucune perte ne sont calculés avant la publication de l’arrivée complète/);
  assert.match(webApp, /gainStatus === 'report-partial'/);
  assert.match(webApp, /gainStatus === 'official-report-indeterminate'/);
  assert.match(webApp, /gainStatus === 'not-winning'/);
  assert.match(webApp, /outcome\.gainStatus === 'not-winning'/);
  assert.match(webApp, /reportStatus === 'partial' \|\| reportStatus === 'arrival-incomplete'/);
  assert.match(webApp, /Rapport partiel · calcul suspendu/);
  assert.match(webApp, /Number\(row\.amount\) <= 0/);
  assert.match(webApp, /montant non calculable/);
  assert.match(webApp, /proposal\.source && proposal\.source !== 'market-ranking'/);
  assert.doesNotMatch(webApp, /latest-analysis/);
  assert.match(styles, /\.grand-carnet-outcome\.partial/);
  assert.match(styles, /\.grand-carnet-outcome\.unknown/);
  assert.match(styles, /\.ecd-ticket-outcome\.indeterminate/);
});

test('la couche responsive finale laisse le programme et les tableaux accessibles à 320–360 px', () => {
  const finalLayer = styles.slice(styles.indexOf('performance mesurée et finition petits écrans'));
  assert.match(finalLayer, /@media \(max-width: 760px\)[\s\S]*html,[\s\S]*body \{ width: 100%; min-width: 0; max-width: 100%; \}/);
  assert.match(finalLayer, /\.race-workspace,[\s\S]*\.race-detail,[\s\S]*\.result-card,[\s\S]*min-width: 0; max-width: 100%;/);
  assert.match(finalLayer, /\.race-list \{[\s\S]*max-height: none;[\s\S]*overflow: visible;/);
  assert.match(finalLayer, /\.horizontal-scroll-hint \{[\s\S]*display: block;/);
  assert.match(finalLayer, /\.ecd-gains-scroll,[\s\S]*scrollbar-color:/);
  assert.match(finalLayer, /\.horse-table \{ min-width: 560px; \}/);
  assert.match(finalLayer, /\.star-rating input \{[\s\S]*width: 1px;[\s\S]*clip-path: inset\(50%\);/);
  assert.match(finalLayer, /@media \(max-width: 480px\)[\s\S]*\.modal \{[\s\S]*width: calc\(100% - 8px\);/);
  assert.match(finalLayer, /@media \(max-width: 480px\)[\s\S]*\.grand-carnet-outcome-lines,[\s\S]*grid-template-columns: 1fr;/);
  assert.match(finalLayer, /@media \(max-width: 360px\)[\s\S]*\.race-detail \{ padding: 14px; \}/);
  assert.match(webApp, /class="ecd-gains-scroll" tabindex="0"/);
  assert.match(webApp, /class="table-wrap" tabindex="0"/);
});

test('le cache du site est renouvelé avec les nouveaux fichiers', () => {
  assert.match(html, /styles\.css\?v=20260811-2/);
  assert.match(html, /app\.js\?v=20260811-2/);
  assert.match(serviceWorker, /parispromax-shell-20260811-2/);
  assert.match(serviceWorker, /styles\.css\?v=20260811-2/);
  assert.match(serviceWorker, /app\.js\?v=20260811-2/);
});
