import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import TrialBanner from '../components/TrialBanner';
import LockCard from '../components/LockCard';
import HorseCard from '../components/HorseCard';
import Disclaimer from '../components/Disclaimer';
import { loadRaces } from '../services/dataService';
import api from '../services/api';
import { analyzeRace, confidenceLabel } from '../services/aiEngine';
import { buildRaceInsights } from '../services/raceInsights';
import { countActiveRunners } from '../services/raceContext';
import { usePrediction } from '../hooks/usePrediction';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';
const { formatRaceReference } = require('../../shared/raceReference');

function findRaceById(tracks, externalId) {
  for (const track of tracks || []) {
    const race = (track.races || []).find((item) => String(item.id) === String(externalId));
    if (race) return { track, race };
  }
  return null;
}

function mergeNationalRace(summary, cached, detail, date) {
  const cachedHorses = Array.isArray(cached?.horses) ? cached.horses : [];
  const detailHorses = Array.isArray(detail?.horses) ? detail.horses : [];
  const horses = detailHorses.length ? detailHorses : cachedHorses;
  const nonPartants = Array.isArray(detail?.nonPartants)
    ? detail.nonPartants
    : Array.isArray(cached?.nonPartants)
      ? cached.nonPartants
      : [];
  const scratched = new Set(nonPartants.map((number) => String(number)));
  const normalizedHorses = horses.map((horse) => ({
    ...horse,
    nonPartant: horse.nonPartant === true || scratched.has(String(horse.number)),
  }));
  return {
    ...(cached || {}),
    ...(summary || {}),
    ...(detail || {}),
    id: summary?.id || detail?.id || cached?.id,
    date: detail?.date || summary?.date || cached?.date || date || null,
    number: summary?.number || cached?.number || formatRaceReference(summary || detail || cached || {}),
    betType: summary?.betType || cached?.betType || null,
    bets: summary?.bets || cached?.bets || [],
    isQuinte: summary?.isQuinte ?? cached?.isQuinte ?? false,
    startsAt: cached?.startsAt || summary?.startsAt || null,
    nonPartants,
    runners: countActiveRunners({
      horses: normalizedHorses,
      nonPartants,
      runners: summary?.runners || cached?.runners || 0,
    }),
    horses: normalizedHorses,
  };
}

function NationalRatePill({ rate, sampleSize, resolved, error }) {
  const measured = rate != null;
  return (
    <View style={[styles.ratePill, !measured && styles.ratePillPending]}>
      <Ionicons name={measured ? 'trending-up' : 'time-outline'} size={13} color={COLORS.onAccent} />
      <Text style={styles.ratePillText}>
        {measured
          ? `Base nationale placée : ${rate}%${sampleSize != null ? ` · ${sampleSize} pronostics` : ''}`
          : error
            ? 'Base nationale placée : mesure indisponible'
            : resolved
              ? 'Base nationale placée : échantillon en cours de constitution'
              : 'Base nationale placée : mesure en cours'}
      </Text>
    </View>
  );
}

async function loadNationalFeature(country) {
  const [national, { data }] = await Promise.all([
    api.nationalRace(country),
    loadRaces(),
  ]);
  const summary = national?.pick?.race;
  if (!summary?.id) return { featured: null, game: national?.game || null };

  const located = findRaceById(data?.racetracks || [], summary.id);
  const detail = await api.raceDetail(summary.id).catch(() => null);
  const hydrated = mergeNationalRace(summary, located?.race, detail, national?.date);
  if (!hydrated.horses.length) return { featured: null, game: national?.game || null };

  return {
    game: national?.game || null,
    featured: {
      track: located?.track || {
        id: String(summary.track || 'course-nationale').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: summary.track || detail?.track || 'Course nationale',
        condition: detail?.condition || null,
      },
      race: analyzeRace(hydrated),
    },
  };
}

export default function QuintePlusScreen({ navigation }) {
  const { isLocked, country } = useAuth();
  const [featured, setFeatured] = useState(null);
  const [nationalGame, setNationalGame] = useState(null);
  const [rate, setRate] = useState(null);
  const [rateSample, setRateSample] = useState(null);
  const [rateResolved, setRateResolved] = useState(false);
  const [rateError, setRateError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFeatured(null);
    setNationalGame(null);
    setRate(null);
    setRateSample(null);
    setRateResolved(false);
    setRateError(false);
    setLoading(true);

    loadNationalFeature(country)
      .then(({ featured: nextFeatured, game }) => {
        if (!cancelled) {
          setFeatured(nextFeatured);
          setNationalGame(game);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    api.successRate(country)
      .then((stats) => {
        if (cancelled) return;
        const nationalRate = stats?.byContext?.national?.rate;
        const nationalSample = stats?.byContext?.national?.sampleSize;
        setRate(nationalRate != null && Number.isFinite(Number(nationalRate)) ? Number(nationalRate) : null);
        setRateSample(
          nationalSample != null && Number.isFinite(Number(nationalSample))
            ? Number(nationalSample)
            : null
        );
        setRateError(false);
        setRateResolved(true);
      })
      .catch(() => {
        if (!cancelled) {
          setRateError(true);
          setRateResolved(true);
        }
      });

    return () => { cancelled = true; };
  }, [country]);

  // Upgrade the featured race with the backend model for subscribers.
  const { race: heroRace } = usePrediction(featured?.race, !isLocked && !!featured);

  const insights = useMemo(
    () => buildRaceInsights(heroRace || {}, { game: nationalGame, mode: 'national' }),
    [heroRace, nationalGame]
  );
  const selection = insights.selected;

  const avgScore = useMemo(() => {
    if (!selection.length) return 0;
    return Math.round(selection.reduce((s, h) => s + (h.aiScore || 0), 0) / selection.length);
  }, [selection]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </SafeAreaView>
    );
  }

  if (!featured) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.emptyContent}>
          <View style={styles.header}>
            <Text style={styles.title}>{nationalGame?.label || 'Course nationale'} du jour</Text>
            <NationalRatePill rate={rate} sampleSize={rateSample} resolved={rateResolved} error={rateError} />
          </View>
          <View style={styles.emptyState}>
            <Ionicons name="flag-outline" size={30} color={COLORS.gold} />
            <Text style={styles.muted}>La course nationale est momentanément indisponible.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const goPaywall = () => navigation.navigate('Paywall');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{nationalGame?.label || 'Course nationale'} du jour</Text>
          <NationalRatePill rate={rate} sampleSize={rateSample} resolved={rateResolved} error={rateError} />
        </View>

        <TrialBanner />

        <Text style={styles.raceMeta}>
          {featured.race.number} · {featured.track.name} · {featured.race.name}
        </Text>

        {/* Hero combination */}
        <LockCard locked={isLocked} onUnlockPress={goPaywall} label="Combinaison nationale verrouillée">
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Combinaison recommandée</Text>
            <View style={styles.comboRow}>
              {selection.map((h, i) => (
                <React.Fragment key={h.number}>
                  <View style={styles.comboBall}>
                    <Text style={styles.comboNum}>{h.number}</Text>
                  </View>
                  {i < selection.length - 1 && <Text style={styles.comboSep}>-</Text>}
                </React.Fragment>
              ))}
            </View>

            <View style={styles.confBar}>
              <View style={[styles.confFill, { width: `${avgScore}%` }]} />
            </View>
            <Text style={styles.confText}>
              Indice de confiance : {avgScore}/100 · {confidenceLabel(avgScore)}
            </Text>
          </View>
        </LockCard>

        <Disclaimer />

        {/* Détail de la sélection : nombre à l'arrivée + 2. */}
        <Text style={styles.sectionTitle}>Le détail des {selection.length} chevaux</Text>
        {selection.map((h) => (
          <HorseCard key={h.number} horse={h} showAI={!isLocked} />
        ))}

        <Pressable
          style={styles.cta}
          onPress={() =>
            navigation.navigate('RaceDetail', {
              trackName: featured.track.name,
              condition: featured.track.condition,
              race: featured.race,
              nationalGame,
              predictionMode: 'national',
            })
          }
        >
          <Text style={styles.ctaText}>Voir tous les partants</Text>
          <Ionicons name="arrow-forward" size={16} color={COLORS.accent} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: COLORS.textMuted },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  header: {
    alignItems: 'flex-start',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900' },
  ratePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.accent,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  ratePillPending: { backgroundColor: COLORS.primary },
  ratePillText: { color: COLORS.onAccent, fontWeight: '900', fontSize: FONT.sm, flexShrink: 1 },
  emptyContent: { flex: 1, padding: SPACING.md },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, padding: SPACING.xl },
  raceMeta: { color: COLORS.textMuted, fontSize: FONT.md, marginTop: SPACING.md, marginBottom: SPACING.sm, paddingHorizontal: SPACING.xs },
  hero: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  heroLabel: { color: COLORS.accent, fontWeight: '900', fontSize: FONT.lg, marginBottom: SPACING.md },
  comboRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
    gap: 4, marginBottom: SPACING.lg,
  },
  comboBall: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comboNum: { color: COLORS.onAccent, fontWeight: '900', fontSize: FONT.xl },
  comboSep: { color: COLORS.textMuted, fontWeight: '900', fontSize: FONT.lg },
  confBar: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.surfaceAlt,
    overflow: 'hidden',
  },
  confFill: { height: '100%', backgroundColor: COLORS.gold, borderRadius: 5 },
  confText: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.sm, fontWeight: '600' },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT.lg,
    fontWeight: '900',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  ctaText: { color: COLORS.accent, fontWeight: '800', fontSize: FONT.md },
});
