import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
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
import { COLORS, SPACING, RADIUS, FONT, TRACK_CONDITIONS } from '../theme/colors';

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

export default function RaceDetailScreen({ route, navigation }) {
  const { trackName, condition, race } = route.params;
  const { isLocked } = useAuth();

  // Subscribers get the trained backend model; everyone falls back to local.
  const { race: analyzed, fromBackend } = usePrediction(race, !isLocked);
  // M3 — live push (odds + fresh IA predictions) without manual refresh.
  const { predictions: live } = useLiveRace(!isLocked ? race?.id : null);

  // Overlay live predictions when they arrive; otherwise keep the fetched analysis.
  const shown = useMemo(
    () => (live && live.length ? applyBackendPredictions(analyzed, livePicks(live)) : analyzed),
    [analyzed, live]
  );
  const isSmart = fromBackend || (live && live.length > 0);

  const horses = Array.isArray(shown?.horses) ? shown.horses : [];

  const cond = TRACK_CONDITIONS[condition] || TRACK_CONDITIONS.dry;
  const goPaywall = () => navigation.navigate('Paywall');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <TrialBanner />

        {/* Race header */}
        <View style={styles.head}>
          <Text style={styles.race}>{analyzed.name}</Text>
          <Text style={styles.sub}>
            {trackName} · {analyzed.distance}
            {analyzed.time ? ` · 🕐 ${analyzed.time}` : ''}
          </Text>
          {(analyzed.type || analyzed.autostart) ? (
            <Text style={styles.raceType}>
              🏇 {analyzed.type || 'Course'}
              {analyzed.autostart ? ' · Autostart' : ''}
              {analyzed.runners || horses.length ? ` · ${analyzed.runners || horses.length} partants` : ''}
            </Text>
          ) : null}
          {analyzed.prize ? (
            <Text style={styles.prize}>
              💰 {Number(analyzed.prize).toLocaleString('fr-FR')} € (≈{' '}
              {(Math.round((analyzed.prize * 655.957) / 1000) * 1000).toLocaleString('fr-FR')} F CFA)
            </Text>
          ) : null}
          <View style={[styles.cond, { backgroundColor: cond.color }]}>
            <Ionicons name={cond.icon} size={12} color="#0f172a" />
            <Text style={styles.condText}>Terrain {cond.label}</Text>
          </View>
        </View>

        {analyzed.result?.winners?.length ? (
          <View style={styles.resultBox}>
            <View style={styles.resultHead}>
              <Ionicons name="flag" size={18} color="#06251c" />
              <Text style={styles.resultTitle}>Résultat officiel</Text>
            </View>
            <View style={styles.ballRow}>
              {analyzed.result.winners.slice(0, 5).map((number, index) => (
                <View key={`${number}-${index}`} style={[styles.resultBall, index === 0 && styles.resultWinner]}>
                  <Text style={styles.resultBallText}>{number}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* AI prediction summary — locked behind paywall when trial expired */}
        <Text style={styles.sectionTitle}>🤖 Pronostics IA</Text>
        <LockCard
          locked={isLocked}
          onUnlockPress={goPaywall}
          label="Pronostics IA verrouillés"
        >
          <RaceInsightsCard race={shown} advanced={isSmart} />
        </LockCard>

        <Disclaimer />

        {/* Full field */}
        <Text style={styles.sectionTitle}>Partants ({horses.length})</Text>
        {horses.map((h) => (
          <HorseCard key={h.number} horse={h} showAI={!isLocked} />
        ))}

        {isLocked && (
          <Text style={styles.lockedHint}>
            🔒 Badges IA, scores et chronos masqués — abonnez-vous pour tout voir.
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
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: SPACING.sm },
  resultTitle: { color: COLORS.success, fontWeight: '900', fontSize: FONT.md },
  resultBall: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.success,
  },
  resultWinner: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  resultBallText: { color: COLORS.text, fontWeight: '900' },
  ballRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm, flexWrap: 'wrap' },
  lockedHint: {
    color: COLORS.textFaint,
    fontSize: FONT.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});
