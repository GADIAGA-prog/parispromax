import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import HorseCard from '../components/HorseCard';
import RaceInsightsCard from '../components/RaceInsightsCard';
import LockCard from '../components/LockCard';
import TrialBanner from '../components/TrialBanner';
import Disclaimer from '../components/Disclaimer';
import { applyBackendPredictions } from '../services/aiEngine';
import { usePrediction } from '../hooks/usePrediction';
import { useLiveRace } from '../hooks/useLiveRace';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { countActiveRunners } from '../services/raceContext';
import { COLORS, SPACING, RADIUS, FONT, TRACK_CONDITIONS } from '../theme/colors';
const { formatRaceReference } = require('../../shared/raceReference');
const { ecdPredictionFormat } = require('../../shared/ecdRules');

// Maps the live LTR payload -> the backend-picks shape aiEngine understands.
function livePicks(preds) {
  return (preds || []).map((p) => ({
    number: p.number,
    name: p.name,
    aiScore: Math.round((p.proba_win || 0) * 1000) / 10,
    rank: p.rang_predit,
    probaGagnant: p.proba_win,
    probaPodium: p.proba_podium,
    valueBet: p.value_bet,
  }));
}

// List endpoints intentionally return compact race summaries. Keep their
// context-only fields (ECD variants, national bet type, reference, start time)
// while hydrating the runner field and official state from the detail endpoint.
function mergeRaceDetail(summary, detail) {
  const initial = summary || {};
  const fresh = detail || {};
  const initialHorses = Array.isArray(initial.horses) ? initial.horses : [];
  const freshHorses = Array.isArray(fresh.horses) ? fresh.horses : [];
  const horses = freshHorses.length ? freshHorses : initialHorses;
  const nonPartants = Array.isArray(fresh.nonPartants)
    ? fresh.nonPartants
    : Array.isArray(initial.nonPartants)
      ? initial.nonPartants
      : [];
  const scratched = new Set(nonPartants.map((number) => String(number)));
  const normalizedHorses = horses.map((horse) => ({
    ...horse,
    nonPartant: horse.nonPartant === true || scratched.has(String(horse.number)),
  }));
  const runners = countActiveRunners({
    horses: normalizedHorses,
    nonPartants,
    runners: fresh.runners ?? initial.runners ?? 0,
  });

  return {
    ...initial,
    ...fresh,
    // These fields describe how this race is presented in the selected country
    // and are absent from GET /races/:id. Never lose them during hydration.
    ecd: initial.ecd ?? fresh.ecd,
    betType: initial.betType ?? fresh.betType,
    bets: initial.bets ?? fresh.bets,
    isQuinte: initial.isQuinte ?? fresh.isQuinte,
    number: initial.number ?? fresh.number,
    startsAt: initial.startsAt ?? fresh.startsAt,
    runners,
    nonPartants,
    result: fresh.result ?? initial.result ?? null,
    horses: normalizedHorses,
  };
}

export default function RaceDetailScreen({ route, navigation }) {
  const {
    trackName,
    condition,
    race,
    nationalGame = null,
    predictionMode: requestedPredictionMode = null,
  } = route.params;
  const predictionMode = ['ecd', 'national', 'program'].includes(requestedPredictionMode)
    ? requestedPredictionMode
    : nationalGame
      ? 'national'
      : race?.ecd
        ? 'ecd'
        : 'program';
  const { isLocked } = useAuth();
  const [detailRace, setDetailRace] = useState(() => (
    race?.horses?.length ? mergeRaceDetail(race, null) : null
  ));
  const [detailResolved, setDetailResolved] = useState(!race?.id);
  const [detailError, setDetailError] = useState(null);

  // Les listes nationale/ECD et le cache peuvent contenir un résumé sans
  // partants. Hydrater toute la fiche avant le pronostic évite de transformer
  // cette optimisation de payload en faux état « Données insuffisantes ».
  useEffect(() => {
    let cancelled = false;
    const localFallback = mergeRaceDetail(race, null);
    setDetailRace(localFallback.horses.length ? localFallback : null);
    setDetailError(null);
    setDetailResolved(!race?.id);
    if (!race?.id) return undefined;

    api.raceDetail(race.id)
      .then((detail) => {
        if (!cancelled) setDetailRace(mergeRaceDetail(race, detail));
      })
      .catch((error) => {
        if (!cancelled) {
          // Une fiche déjà complète reste un repli local valable lorsque le
          // rafraîchissement échoue (hors-ligne, délai dépassé, erreur 5xx).
          setDetailRace(localFallback.horses.length ? localFallback : null);
          setDetailError(error);
        }
      })
      .finally(() => {
        if (!cancelled) setDetailResolved(true);
      });
    return () => { cancelled = true; };
  }, [race]);

  const hasRunners = Boolean(detailRace?.horses?.length);
  // A missing or empty backend prediction keeps usePrediction's local analysis
  // of the hydrated field visible to the subscriber.
  const { race: analyzed, fromBackend } = usePrediction(
    detailRace,
    !isLocked && hasRunners
  );
  // M3 — live push (odds + fresh IA predictions) without manual refresh.
  const { predictions: live } = useLiveRace(
    !isLocked ? (detailRace?.id || race?.id) : null
  );

  // Overlay live predictions when they arrive; otherwise keep the fetched analysis.
  const shown = useMemo(
    () => (live && live.length ? applyBackendPredictions(analyzed, livePicks(live)) : analyzed),
    [analyzed, live]
  );
  const isSmart = fromBackend || (live && live.length > 0);
  const predictionReady = Boolean(shown?.horses?.length);
  const displayedRace = shown || analyzed || detailRace || race || {};

  const horses = Array.isArray(displayedRace.horses) ? displayedRace.horses : [];
  const displayedRunnerCount = countActiveRunners(displayedRace);

  const cond = TRACK_CONDITIONS[displayedRace.condition || condition] || TRACK_CONDITIONS.dry;
  const goPaywall = () => navigation.navigate('Paywall');
  const winners = displayedRace.result?.winners || [];
  const contextualResultPlaces = predictionMode === 'national' && Number(nationalGame?.podium) > 0
    ? Number(nationalGame.podium)
    : predictionMode === 'ecd' && displayedRace.ecdProfile?.verified === true
      ? ecdPredictionFormat(displayedRunnerCount).podium
      : Math.min(3, displayedRunnerCount || 3);
  const resultComplete = winners.length >= contextualResultPlaces;
  const isPast = displayedRace.startsAt
    && new Date(displayedRace.startsAt).getTime() <= Date.now();
  const reference = formatRaceReference(displayedRace);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <TrialBanner />

        {/* Race header */}
        <View style={styles.head}>
          <Text style={styles.race}>{displayedRace.name}</Text>
          <Text style={styles.sub}>
            {reference ? `${reference} · ` : ''}{trackName} · {displayedRace.distance}
            {displayedRace.time ? ` · 🕐 ${displayedRace.time}` : ''}
          </Text>
          {(displayedRace.type || displayedRace.autostart) ? (
            <Text style={styles.raceType}>
              🏇 {displayedRace.type || 'Course'}
              {displayedRace.autostart ? ' · Autostart' : ''}
              {displayedRunnerCount > 0 ? ` · ${displayedRunnerCount} partants` : ''}
            </Text>
          ) : null}
          {displayedRace.prize ? (
            <Text style={styles.prize}>
              💰 {Number(displayedRace.prize).toLocaleString('fr-FR')} € (≈{' '}
              {(Math.round((displayedRace.prize * 655.957) / 1000) * 1000).toLocaleString('fr-FR')} F CFA)
            </Text>
          ) : null}
          <View style={[styles.cond, { backgroundColor: cond.color }]}>
            <Ionicons name={cond.icon} size={12} color="#0f172a" />
            <Text style={styles.condText}>Terrain {cond.label}</Text>
          </View>
        </View>

        {winners.length ? (
          <View style={[styles.resultBox, !resultComplete && styles.resultBoxPartial]}>
            <View style={styles.resultHead}>
              <Ionicons name={resultComplete ? 'flag' : 'time'} size={18} color={resultComplete ? '#06251c' : COLORS.gold} />
              <Text style={[styles.resultTitle, !resultComplete && styles.resultTitlePartial]}>
                {resultComplete ? 'Résultat officiel' : 'Arrivée officielle partielle'}
              </Text>
            </View>
            <View style={styles.ballRow}>
              {winners.slice(0, 5).map((number, index) => (
                <View key={`${number}-${index}`} style={[styles.resultBall, index === 0 && styles.resultWinner]}>
                  <Text style={styles.resultBallText}>{number}</Text>
                </View>
              ))}
            </View>
            {!resultComplete ? (
              <Text style={styles.resultPendingText}>
                {winners.length}/{contextualResultPlaces} positions disponibles · le bilan reste suspendu.
              </Text>
            ) : null}
          </View>
        ) : isPast ? (
          <View style={styles.resultPending}>
            <Ionicons name="time" size={17} color={COLORS.gold} />
            <View style={{ flex: 1 }}>
              <Text style={styles.resultPendingTitle}>Arrivée en cours de validation</Text>
              <Text style={styles.resultPendingText}>Le résultat officiel apparaîtra automatiquement dès sa publication.</Text>
            </View>
          </View>
        ) : null}

        {/* AI prediction summary — locked behind paywall when trial expired */}
        <Text style={styles.sectionTitle}>Pronostics ParisPromax</Text>
        <LockCard
          locked={isLocked}
          onUnlockPress={goPaywall}
          label="Pronostics détaillés verrouillés"
        >
          {(!detailResolved && !hasRunners) || (hasRunners && !predictionReady) ? (
            <View style={styles.detailState}>
              <ActivityIndicator color={COLORS.accent} />
              <Text style={styles.detailStateTitle}>Chargement des partants…</Text>
              <Text style={styles.detailStateText}>
                Le pronostic sera calculé dès que la fiche complète sera disponible.
              </Text>
            </View>
          ) : predictionReady ? (
            <RaceInsightsCard
              race={shown}
              advanced={isSmart}
              game={predictionMode === 'national' ? nationalGame : null}
              mode={predictionMode}
            />
          ) : (
            <View style={styles.detailState}>
              <Ionicons name="cloud-offline" size={24} color={COLORS.gold} />
              <Text style={styles.detailStateTitle}>Partants momentanément indisponibles</Text>
              <Text style={styles.detailStateText}>
                {detailError?.message || 'Actualisez la page lorsque la connexion sera revenue.'}
              </Text>
            </View>
          )}
        </LockCard>

        <Disclaimer />

        {/* Full field */}
        <Text style={styles.sectionTitle}>
          Partants actifs ({displayedRunnerCount})
          {horses.length > displayedRunnerCount
            ? ` · ${horses.length - displayedRunnerCount} non-partant${horses.length - displayedRunnerCount > 1 ? 's' : ''}`
            : ''}
        </Text>
        {!detailResolved && !horses.length ? (
          <View style={styles.runnersLoading}>
            <ActivityIndicator size="small" color={COLORS.accent} />
            <Text style={styles.detailStateText}>Mise à jour de la liste…</Text>
          </View>
        ) : null}
        {horses.map((h) => (
          <HorseCard key={h.number} horse={h} showAI={!isLocked} />
        ))}

        {isLocked && (
          <Text style={styles.lockedHint}>
            Indices, profils et chronos masqués — abonnez-vous pour tout voir.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  head: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  race: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900' },
  sub: { color: COLORS.textMuted, fontSize: FONT.md, marginTop: 2 },
  raceType: { color: COLORS.accent, fontSize: FONT.sm, marginTop: 4, fontWeight: '700' },
  prize: { color: COLORS.gold, fontSize: FONT.sm, marginTop: 4, fontWeight: '700' },
  cond: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    marginTop: SPACING.sm,
  },
  condText: { color: '#0f172a', fontWeight: '800', fontSize: FONT.sm - 1 },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT.lg,
    fontWeight: '900',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  resultBox: {
    backgroundColor: 'rgba(34,197,94,0.14)', borderWidth: 1, borderColor: COLORS.success,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm,
  },
  resultBoxPartial: { backgroundColor: 'rgba(251,191,36,0.10)', borderColor: 'rgba(251,191,36,0.4)' },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: SPACING.sm },
  resultTitle: { color: COLORS.success, fontWeight: '900', fontSize: FONT.md },
  resultTitlePartial: { color: COLORS.gold },
  resultBall: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.success,
  },
  resultWinner: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  resultBallText: { color: COLORS.text, fontWeight: '900' },
  resultPending: {
    flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start',
    backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)',
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm,
  },
  resultPendingTitle: { color: COLORS.gold, fontWeight: '900', fontSize: FONT.md },
  resultPendingText: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 2, lineHeight: 18 },
  ballRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm, flexWrap: 'wrap' },
  lockedHint: {
    color: COLORS.textFaint,
    fontSize: FONT.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  detailState: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailStateTitle: {
    color: COLORS.text,
    fontSize: FONT.md,
    fontWeight: '900',
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  detailStateText: {
    color: COLORS.textMuted,
    fontSize: FONT.sm,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
  },
  runnersLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.lg,
  },
});
