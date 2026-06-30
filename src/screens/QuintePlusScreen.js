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
import { loadRaces } from '../services/dataService';
import api from '../services/api';
import { analyzeRace, confidenceLabel } from '../services/aiEngine';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// Picks the day's "featured" race = track with the biggest prize pool.
function pickFeatured(tracks) {
  let best = null;
  for (const t of tracks) {
    for (const r of t.races) {
      const score = (t.prizePool || 0) + (r.horses?.length || 0);
      if (!best || score > best.score) {
        best = { track: t, race: r, score };
      }
    }
  }
  return best;
}

export default function QuintePlusScreen({ navigation }) {
  const { isLocked } = useAuth();
  const [featured, setFeatured] = useState(null);
  const [rate, setRate] = useState(null); // real measured rate (null until data)
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await loadRaces();
      const tracks = (data.racetracks || []).map((t) => ({
        ...t,
        races: t.races.map((r) => analyzeRace(r)),
      }));
      setFeatured(pickFeatured(tracks));
      try {
        const s = await api.successRate();
        setRate(s.rate);
      } catch (e) {
        setRate(null);
      }
      setLoading(false);
    })();
  }, []);

  const top5 = useMemo(
    () => (featured ? featured.race.horses.slice(0, 5) : []),
    [featured]
  );

  const avgScore = useMemo(() => {
    if (!top5.length) return 0;
    return Math.round(top5.reduce((s, h) => s + (h.aiScore || 0), 0) / top5.length);
  }, [top5]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </SafeAreaView>
    );
  }

  if (!featured) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Text style={styles.muted}>Aucune course disponible.</Text>
      </SafeAreaView>
    );
  }

  const goPaywall = () => navigation.navigate('Paywall');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Quinté+ du jour</Text>
          {rate != null && (
            <View style={styles.ratePill}>
              <Ionicons name="trending-up" size={13} color="#06251c" />
              <Text style={styles.ratePillText}>{rate}%</Text>
            </View>
          )}
        </View>

        <TrialBanner />

        <Text style={styles.raceMeta}>
          {featured.track.name} · {featured.race.name}
        </Text>

        {/* Hero combination */}
        <LockCard locked={isLocked} onUnlockPress={goPaywall} label="Combinaison Quinté+ verrouillée">
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>🏆 Combinaison IA recommandée</Text>
            <View style={styles.comboRow}>
              {top5.map((h, i) => (
                <React.Fragment key={h.number}>
                  <View style={styles.comboBall}>
                    <Text style={styles.comboNum}>{h.number}</Text>
                  </View>
                  {i < top5.length - 1 && <Text style={styles.comboSep}>-</Text>}
                </React.Fragment>
              ))}
            </View>

            <View style={styles.confBar}>
              <View style={[styles.confFill, { width: `${avgScore}%` }]} />
            </View>
            <Text style={styles.confText}>
              Indice de confiance IA : {avgScore}/100 · {confidenceLabel(avgScore)}
            </Text>
          </View>
        </LockCard>

        {/* Detail of the 5 picks */}
        <Text style={styles.sectionTitle}>Le détail des 5 bases</Text>
        {top5.map((h) => (
          <HorseCard key={h.number} horse={h} showAI={!isLocked} />
        ))}

        <Pressable
          style={styles.cta}
          onPress={() =>
            navigation.navigate('RaceDetail', {
              trackName: featured.track.name,
              condition: featured.track.condition,
              race: featured.race,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  ratePillText: { color: '#06251c', fontWeight: '900', fontSize: FONT.sm },
  raceMeta: { color: COLORS.textMuted, fontSize: FONT.md, marginTop: SPACING.md, marginBottom: SPACING.sm, paddingHorizontal: SPACING.xs },
  hero: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  heroLabel: { color: COLORS.accent, fontWeight: '900', fontSize: FONT.lg, marginBottom: SPACING.md },
  comboRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: SPACING.lg },
  comboBall: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comboNum: { color: '#06251c', fontWeight: '900', fontSize: FONT.xl },
  comboSep: { color: COLORS.white, fontWeight: '900', fontSize: FONT.lg },
  confBar: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  confFill: { height: '100%', backgroundColor: COLORS.gold, borderRadius: 5 },
  confText: { color: COLORS.white, fontSize: FONT.sm, marginTop: SPACING.sm, fontWeight: '600' },
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
