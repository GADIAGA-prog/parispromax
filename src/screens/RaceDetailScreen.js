import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import HorseCard from '../components/HorseCard';
import LockCard from '../components/LockCard';
import TrialBanner from '../components/TrialBanner';
import Disclaimer from '../components/Disclaimer';
import { analyzeRace, BADGES } from '../services/aiEngine';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING, RADIUS, FONT, TRACK_CONDITIONS } from '../theme/colors';

export default function RaceDetailScreen({ route, navigation }) {
  const { trackName, condition, race } = route.params;
  const { isLocked } = useAuth();

  // Ensure analysis (HomeScreen already analyzed, but be defensive).
  const analyzed = useMemo(
    () => (race.horses?.[0]?.aiScore != null ? race : analyzeRace(race)),
    [race]
  );

  const top3 = analyzed.horses.slice(0, 3);
  const valueBet = analyzed.horses.find((h) =>
    h.badges?.some((b) => b.key === BADGES.VALUE.key)
  );
  const chronoHorse = analyzed.horses.find((h) =>
    h.badges?.some((b) => b.key === BADGES.CHRONO.key)
  );

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
            {trackName} · {analyzed.distance} · {analyzed.time}
          </Text>
          <View style={[styles.cond, { backgroundColor: cond.color }]}>
            <Ionicons name={cond.icon} size={12} color="#0f172a" />
            <Text style={styles.condText}>Terrain {cond.label}</Text>
          </View>
        </View>

        {/* AI prediction summary — locked behind paywall when trial expired */}
        <Text style={styles.sectionTitle}>🤖 Pronostics IA</Text>
        <LockCard
          locked={isLocked}
          onUnlockPress={goPaywall}
          label="Pronostics IA verrouillés"
        >
          <View style={styles.aiBox}>
            <Text style={styles.aiHeading}>🏆 Top 3 du jour</Text>
            {top3.map((h, i) => (
              <View key={h.number} style={styles.topRow}>
                <Text style={styles.topRank}>{i + 1}.</Text>
                <Text style={styles.topName}>
                  n°{h.number} {h.name}
                </Text>
                <Text style={styles.topScore}>{Math.round(h.aiScore)}/100</Text>
              </View>
            ))}

            <View style={styles.divider} />

            <View style={styles.miniRow}>
              <Text style={styles.miniLabel}>⭐ Value Bet</Text>
              <Text style={styles.miniValue}>
                {valueBet ? `n°${valueBet.number} ${valueBet.name} (${valueBet.odds})` : '—'}
              </Text>
            </View>
            <View style={styles.miniRow}>
              <Text style={styles.miniLabel}>⏱️ Record Chrono</Text>
              <Text style={styles.miniValue}>
                {chronoHorse
                  ? `n°${chronoHorse.number} ${chronoHorse.name} (${chronoHorse.chrono}s)`
                  : 'N/A (plat)'}
              </Text>
            </View>
          </View>
        </LockCard>

        <Disclaimer />

        {/* Full field */}
        <Text style={styles.sectionTitle}>Partants ({analyzed.horses.length})</Text>
        {analyzed.horses.map((h) => (
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
  aiBox: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
  },
  aiHeading: { color: COLORS.accent, fontWeight: '900', fontSize: FONT.lg, marginBottom: SPACING.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: SPACING.sm,
  },
  topRank: { color: COLORS.gold, fontWeight: '900', fontSize: FONT.lg, width: 24 },
  topName: { color: COLORS.white, fontWeight: '700', fontSize: FONT.md, flex: 1 },
  topScore: { color: COLORS.accent, fontWeight: '900', fontSize: FONT.md },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: SPACING.sm,
  },
  miniRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  miniLabel: { color: 'rgba(255,255,255,0.85)', fontSize: FONT.sm, fontWeight: '600' },
  miniValue: { color: COLORS.white, fontSize: FONT.sm, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  lockedHint: {
    color: COLORS.textFaint,
    fontSize: FONT.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
});
