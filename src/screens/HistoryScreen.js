import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadRaces, getHistory } from '../services/dataService';
import api from '../services/api';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

export default function HistoryScreen() {
  const [history, setHistory] = useState([]);
  const [stat, setStat] = useState(null); // { rate, sampleSize } from backend
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await loadRaces();
      setHistory(getHistory(data));
      try {
        setStat(await api.successRate()); // real measured rate
      } catch (e) {
        setStat(null);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Historique des résultats</Text>
      </View>

      {/* Success-rate banner — REAL measured rate (honest: null until data) */}
      <View style={styles.rateBanner}>
        <Ionicons name="trending-up" size={20} color="#06251c" />
        {stat && stat.rate != null ? (
          <Text style={styles.rateText}>
            Taux de réussite IA : {stat.rate}% ({stat.sampleSize} courses)
          </Text>
        ) : (
          <Text style={styles.rateText}>Taux de réussite : en cours de mesure</Text>
        )}
      </View>

      <FlatList
        data={history}
        keyExtractor={(h) => h.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.race}>{item.race}</Text>
                <Text style={styles.meta}>
                  {item.track} · {item.date}
                </Text>
              </View>
              {item.aiHit ? (
                <View style={styles.win}>
                  <Text style={styles.winText}>✅ PRONO IA GAGNANT</Text>
                </View>
              ) : (
                <View style={styles.miss}>
                  <Text style={styles.missText}>Non placé</Text>
                </View>
              )}
            </View>

            <View style={styles.arrivee}>
              <Text style={styles.arriveeLabel}>Arrivée :</Text>
              {item.winners.map((w, i) => (
                <View key={i} style={styles.numChip}>
                  <Text style={styles.numChipText}>{w}</Text>
                </View>
              ))}
            </View>

            {!!item.comment && <Text style={styles.comment}>{item.comment}</Text>}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900' },
  rateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.accent,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  rateText: { color: '#06251c', fontWeight: '900', fontSize: FONT.lg },
  list: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  race: { color: COLORS.text, fontWeight: '800', fontSize: FONT.md },
  meta: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 2 },
  win: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  winText: { color: COLORS.success, fontWeight: '800', fontSize: FONT.sm - 2 },
  miss: {
    backgroundColor: 'rgba(148,163,184,0.15)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  missText: { color: COLORS.textMuted, fontWeight: '700', fontSize: FONT.sm - 2 },
  arrivee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.md,
    flexWrap: 'wrap',
  },
  arriveeLabel: { color: COLORS.textMuted, fontSize: FONT.sm, marginRight: 4 },
  numChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numChipText: { color: COLORS.accent, fontWeight: '900', fontSize: FONT.sm },
  comment: { color: COLORS.textFaint, fontSize: FONT.sm, marginTop: SPACING.sm, fontStyle: 'italic' },
});
