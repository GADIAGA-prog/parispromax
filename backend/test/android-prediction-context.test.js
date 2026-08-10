const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const transformModules = require('@babel/plugin-transform-modules-commonjs');

const root = path.join(__dirname, '..', '..');
const historyScreen = fs.readFileSync(path.join(root, 'src', 'screens', 'HistoryScreen.js'), 'utf8');
const homeScreen = fs.readFileSync(path.join(root, 'src', 'screens', 'HomeScreen.js'), 'utf8');
const detailScreen = fs.readFileSync(path.join(root, 'src', 'screens', 'RaceDetailScreen.js'), 'utf8');
const insightsCard = fs.readFileSync(path.join(root, 'src', 'components', 'RaceInsightsCard.js'), 'utf8');
const insightsServicePath = path.join(root, 'src', 'services', 'raceInsights.js');
const raceContextPath = path.join(root, 'src', 'services', 'raceContext.js');
const raceProgramPath = path.join(root, 'src', 'services', 'raceProgram.js');
const aiEnginePath = path.join(root, 'src', 'services', 'aiEngine.js');
const ecdGainsTable = fs.readFileSync(path.join(root, 'src', 'components', 'EcdGainsTable.js'), 'utf8');
const quinteScreen = fs.readFileSync(path.join(root, 'src', 'screens', 'QuintePlusScreen.js'), 'utf8');
const navigator = fs.readFileSync(path.join(root, 'src', 'navigation', 'RootNavigator.js'), 'utf8');
const {
  historyPredictionVariant,
  historyPodiumSize,
  contextualPodium,
  contextualArrivalComplete,
} = require('../../shared/historyPrediction');

function loadTranspiledModule(sourcePath, stubs = {}) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = babel.transformSync(source, {
    filename: sourcePath,
    babelrc: false,
    configFile: false,
    plugins: [transformModules],
  }).code;
  const loaded = new Module(sourcePath, module);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const nativeRequire = loaded.require.bind(loaded);
  loaded.require = (request) => (Object.prototype.hasOwnProperty.call(stubs, request)
    ? stubs[request]
    : nativeRequire(request));
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const raceContext = loadTranspiledModule(raceContextPath);
const raceProgram = loadTranspiledModule(raceProgramPath);

function loadRaceInsights() {
  return loadTranspiledModule(insightsServicePath, {
    './aiEngine': { BADGES: { VALUE: { key: 'VALUE' }, CHRONO: { key: 'CHRONO' } } },
    './raceContext': raceContext,
  });
}

function horses(count) {
  return Array.from({ length: count }, (_value, index) => ({
    number: index + 1,
    name: `Cheval ${index + 1}`,
    rank: index + 1,
    aiScore: 100 - index,
    probaPodium: 0.4 - index * 0.02,
  }));
}

test('Android fusionne toutes les courses avec le marquage ECD officiel', () => {
  const complete = [
    {
      id: 'track-r2',
      name: 'Réunion 2',
      races: [{ id: 'R2C1', number: 'R2C1', name: 'Course générique' }],
    },
    {
      id: 'track-r1',
      name: 'Réunion 1',
      races: [
        { id: 'R1C2', number: 'R1C2', name: 'Course 2' },
        { id: 'R1C1', number: 'R1C1', name: 'Course 1' },
      ],
    },
  ];
  const official = [{
    id: 'track-r1',
    name: 'Réunion 1',
    races: [{ id: 'R1C1', number: 'R1C1', ecd: { unitStake: 500 } }],
  }];

  const merged = raceProgram.mergeRacePrograms(complete, official);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.flatMap((track) => track.races.map((race) => race.id)), [
    'R1C1', 'R1C2', 'R2C1',
  ]);
  assert.equal(merged[0].races[0].ecd.unitStake, 500);
  assert.equal(merged[1].races[0].ecd, undefined);
  assert.equal(raceProgram.mergeRacePrograms(complete, []).length, 2);
  assert.deepEqual(
    raceProgram.mergeRacePrograms([], official).flatMap((track) => track.races.map((race) => race.id)),
    ['R1C1']
  );
  const staleEcd = raceProgram.mergeRacePrograms(complete, official, {
    programDate: '2026-08-09',
    ecdDate: '2026-08-08',
  });
  assert.equal(staleEcd[0].races[0].ecd, undefined);
});

test('l historique colore uniquement le podium contextuel de chaque jeu', () => {
  const hybrid = {
    winners: [1, 2, 3, 4, 5],
    topPicks: horses(6),
    nationalGroups: { format: { places: 4 }, selectionSize: 6 },
    ecdTopPicks: horses(5),
    ecdGroups: { format: { places: 2 }, selectionSize: 4 },
    ecdTicketOutcome: { podiumSize: 2 },
  };

  assert.equal(historyPodiumSize(hybrid, 'ecd'), 2);
  assert.deepEqual(contextualPodium(hybrid, 'ecd'), [1, 2]);
  assert.equal(historyPodiumSize(hybrid, 'national'), 4);
  assert.deepEqual(contextualPodium(hybrid, 'national'), [1, 2, 3, 4]);
  assert.equal(historyPredictionVariant(hybrid, 'ecd').topPicks.length, 5);
  assert.equal(contextualArrivalComplete({ ...hybrid, ecdArrivalComplete: false }, 'ecd'), false);
  assert.equal(
    historyPredictionVariant({ ...hybrid, ecdArrivalComplete: false, ecdAiHit: null }, 'ecd').aiHit,
    null
  );
});

test('Android publie les bons libelles +2 et le seuil tocard commun de 10 pour cent', () => {
  const { buildRaceInsights } = loadRaceInsights();
  const verifiedEcd = { verified: true, countryName: 'Burkina Faso' };
  const smallEcd = buildRaceInsights({ ecdProfile: verifiedEcd, horses: horses(7) }, { mode: 'ecd' });
  const trioEcd = buildRaceInsights({ ecdProfile: verifiedEcd, horses: horses(8) }, { mode: 'ecd' });
  const national = buildRaceInsights(
    { horses: horses(8) },
    { mode: 'national', game: { label: 'Quarté', podium: 4 } }
  );

  assert.equal(smallEcd.format.label, 'Jumelé ordre + 2');
  assert.equal(smallEcd.selectionSize, 4);
  assert.equal(trioEcd.format.label, 'Trio + 2');
  assert.equal(trioEcd.selectionSize, 5);
  assert.equal(national.format.label, 'Quarté + 2');
  assert.equal(national.selectionSize, 6);

  const thresholdRace = { horses: horses(4) };
  thresholdRace.horses[2] = { ...thresholdRace.horses[2], odds: 20, probaPodium: 0.09 };
  assert.equal(buildRaceInsights(thresholdRace, { mode: 'ecd' }).tocard, null);
  thresholdRace.horses[2] = { ...thresholdRace.horses[2], probaPodium: 0.1 };
  assert.equal(buildRaceInsights(thresholdRace, { mode: 'ecd' }).tocard.number, 3);
});

test('Android compte uniquement les partants actifs et bloque une regle ECD non verifiee', () => {
  const field = horses(8).map((horse) => (
    horse.number === 8 ? { ...horse, nonPartant: true } : horse
  ));
  assert.equal(raceContext.countActiveRunners({ horses: field }), 7);
  assert.equal(raceContext.countActiveRunners({ runners: 8, nonPartants: [8] }), 7);

  const { buildRaceInsights } = loadRaceInsights();
  const unavailable = buildRaceInsights({
    ecdProfile: { verified: false, countryName: "Côte d'Ivoire" },
    bets: ['Trio'],
    horses: field,
  }, { mode: 'ecd' });
  assert.equal(unavailable.format.label, 'Format ECD indisponible');
  assert.equal(unavailable.selectionSize, 0);
  assert.deepEqual(unavailable.selected, []);

  assert.match(detailScreen, /const displayedRunnerCount = countActiveRunners\(displayedRace\)/);
  assert.match(detailScreen, /const contextualResultPlaces = predictionMode === 'national'/);
  assert.match(detailScreen, /Arrivée officielle partielle/);
  assert.match(detailScreen, /le bilan reste suspendu/);
  assert.match(detailScreen, /Partants actifs \(\{displayedRunnerCount\}\)/);
  assert.match(detailScreen, /api\.raceDetail\(race\.id\)/);
  assert.match(detailScreen, /const predictionReady = Boolean\(shown\?\.horses\?\.length\)/);
  assert.doesNotMatch(detailScreen, /horses\.length \|\| displayedRace\.runners/);
  assert.match(insightsCard, /const hasDetailedRunners = Array\.isArray\(props\.race\?\.horses\)/);
  assert.match(insightsCard, /if \(!hasDetailedRunners\) return <PredictionPending \/>/);
  assert.match(insightsCard, /Pronostic en préparation/);
  assert.match(insightsCard, /mode === 'ecd' && !hasVerifiedEcdRules\(props\.race\)/);
  assert.match(insightsCard, /Règle ECD non disponible/);
});

test('le repli Android ne classe jamais un non-partant', () => {
  const { analyzeRace, applyBackendPredictions } = loadTranspiledModule(aiEnginePath);
  const field = horses(8).map((horse) => ({ ...horse, odds: horse.number + 1 }));
  const local = analyzeRace({ horses: field, nonPartants: [8] });
  const excluded = local.horses.find((horse) => horse.number === 8);
  assert.equal(excluded.nonPartant, true);
  assert.equal(excluded.rank, null);
  assert.equal(excluded.aiScore, null);
  assert.ok(local.horses.slice(0, 7).every((horse) => horse.number !== 8));

  const backend = applyBackendPredictions(local, [
    { number: 8, aiScore: 1000, rank: 1 },
    { number: '1', aiScore: 90, rank: 2 },
  ]);
  assert.equal(backend.horses.find((horse) => horse.number === 8).rank, null);
  assert.notEqual(backend.horses[0].number, 8);
  assert.equal(backend.horses.find((horse) => horse.number === 1).source, 'backend');
});

test('le contexte ECD ou national traverse la navigation jusqu a la synthese', () => {
  assert.match(homeScreen, /const isOfficialEcd = Boolean\(race\?\.ecd && ecdProfile\)/);
  assert.match(homeScreen, /isOfficialEcd \? \{ \.\.\.race, ecdProfile \} : race/);
  assert.match(homeScreen, /isOfficialEcd \? 'ecd' : 'program'/);
  assert.match(homeScreen, /'national',[\s\S]{0,80}nationalGame/);
  assert.match(detailScreen, /predictionMode: requestedPredictionMode/);
  assert.match(detailScreen, /mode=\{predictionMode\}/);
  assert.match(insightsCard, /mode === 'national' \? game : null/);
  assert.doesNotMatch(insightsCard, /game\.proposal\.couples/);
  assert.match(insightsCard, /buildNationalBetProposal\(activeGame, smartSelection/);
});

test('l historique charge resultats et taux independamment dans un en-tete defilant', () => {
  assert.match(historyScreen, /const loadHistory = useCallback/);
  assert.match(historyScreen, /api\.raceHistory\(country\)/);
  assert.match(historyScreen, /const loadStat = useCallback/);
  assert.match(historyScreen, /api\.successRate\(country\)/);
  assert.match(historyScreen, /Promise\.allSettled\(\[loadHistory\(\), loadStat\(\)\]\)/);
  assert.match(historyScreen, /loadStat\(\);[\s\S]{0,80}loadHistory\(\)\.finally/);
  assert.match(historyScreen, /ListHeaderComponent=/);
  assert.match(historyScreen, /stat\?\.byContext\?\.\[category\]/);
  assert.match(historyScreen, /contextualStat\.rate/);
  assert.match(historyScreen, /contextualStat\.sampleSize/);
  assert.doesNotMatch(historyScreen, /\{stat\.(?:rate|sampleSize)\}/);
  assert.match(historyScreen, />BASE PLACÉE</);
  assert.match(historyScreen, /hasAccess && contextRulesAvailable && contextArrivalComplete && predictions\.length > 0 \? \([\s\S]{0,160}displayItem\.aiHit/);
  assert.match(historyScreen, /Pronostic archivé indisponible · aucun résultat de base n’est attribué/);
  assert.match(historyScreen, /contextualPodium\(displayItem, category\)/);
  assert.match(historyScreen, /Règle et rapports ECD non disponibles/);
  assert.match(historyScreen, /setHistoryError/);
  assert.match(historyScreen, /Résultats momentanément indisponibles/);
  assert.match(historyScreen, /setRateError/);
  assert.match(historyScreen, /Taux de succès momentanément indisponible/);
});

test('Android charge le programme complet sans relabeller les courses generiques en ECD', () => {
  assert.match(homeScreen, /Promise\.allSettled/);
  assert.match(homeScreen, /api\.ecdRaces\(country\)/);
  assert.match(homeScreen, /api\.races\(\)/);
  assert.match(homeScreen, /mergeRacePrograms\(programTracks, ecdTracks, \{ programDate, ecdDate \}\)/);
  assert.match(homeScreen, /The full programme remains useful/);
  assert.match(homeScreen, /Toutes les courses du jour/);
  assert.match(homeScreen, /setNationalError/);
  assert.match(homeScreen, /Course nationale momentanément indisponible/);
  assert.match(homeScreen, /offlineText: \{ flexShrink: 1/);
  assert.match(homeScreen, /nationalSummaryText: \{[\s\S]{0,80}flexShrink: 1/);
  assert.match(ecdGainsTable, /Number\(value\) <= 0\) return 'Non calculable'/);
  assert.match(ecdGainsTable, /heading: \{ flexDirection: 'row', flexWrap: 'wrap'/);
  assert.match(ecdGainsTable, /pending: \{ flexShrink: 1/);
  assert.doesNotMatch(homeScreen, /\bloadRaces\b|data\.racetracks/);
});

test('QuintePlus suit exclusivement la course nationale canonique du pays', () => {
  assert.match(quinteScreen, /api\.nationalRace\(country\)/);
  assert.match(quinteScreen, /findRaceById\(data\?\.racetracks \|\| \[\], summary\.id\)/);
  assert.match(quinteScreen, /api\.raceDetail\(summary\.id\)/);
  assert.match(quinteScreen, /buildRaceInsights\(heroRace \|\| \{\}, \{ game: nationalGame, mode: 'national' \}\)/);
  assert.match(quinteScreen, /stats\?\.byContext\?\.national\?\.rate/);
  assert.match(quinteScreen, /stats\?\.byContext\?\.national\?\.sampleSize/);
  assert.doesNotMatch(quinteScreen, /\?\?\s*stats\?\.(?:rate|sampleSize)/);
  assert.match(quinteScreen, /api\.successRate\(country\)/);
  assert.match(quinteScreen, /predictionMode: 'national'/);
  assert.match(quinteScreen, /<NationalRatePill rate=\{rate\} sampleSize=\{rateSample\} resolved=\{rateResolved\} error=\{rateError\} \/>/);
  assert.match(navigator, /import QuintePlusScreen from '\.\.\/screens\/QuintePlusScreen'/);
  assert.match(navigator, /name="Nationale"[\s\S]{0,100}component=\{QuintePlusScreen\}/);
  assert.doesNotMatch(navigator, /<Tab\.Screen name="Nationale"/);
  assert.match(homeScreen, /navigation\.navigate\('Nationale'\)/);
  assert.doesNotMatch(quinteScreen, /pickFeatured|prizePool/);
});

test('l historique Android distingue tous les statuts de rapport Grand Carnet', () => {
  assert.match(historyScreen, /status === 'confirmed'/);
  assert.match(historyScreen, /status === 'pending-official-report'/);
  assert.match(historyScreen, /status === 'official-report-indeterminate'/);
  assert.match(historyScreen, /status === 'report-partial'/);
  assert.match(historyScreen, /contextualArrivalComplete/);
  assert.match(historyScreen, /contextArrivalComplete && predictions\.length > 0/);
  assert.match(historyScreen, /Arrivée officielle en cours de complétion/);
  assert.match(historyScreen, /status === 'not-winning'/);
  assert.match(historyScreen, /Array\.isArray\(outcome\?\.winningTickets\)/);
  assert.match(historyScreen, /Détail des combinaisons gagnantes/);
  assert.match(historyScreen, /grandCarnet\.gainLabel/);
});
