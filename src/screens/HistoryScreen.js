import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import EcdGainsTable from '../components/EcdGainsTable';
import EcdTicketOutcomeCard from '../components/EcdTicketOutcomeCard';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';
import countryCatalog from '../../shared/countries.json';

function formatXof(value) {
  return Number(value || 0).toLocaleString('fr-FR');
}

export default function HistoryScreen() {
  const { country, hasAccess } = useAuth();
  const countryName = countryCatalog.find((item) => item.code === country)?.name || country;
  const [history, setHistory] = useState([]);
  const [category, setCategory] = useState('ecd');
  const [stat, setStat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([api.raceHistory(country), api.successRate()]);
      setHistory(h.history || []);
      setStat(s);
    } catch (e) {
      // offline / not critical
    }
  }, [country]);
  const visibleHistory = history.filter((item) => category === 'ecd'
    ? item.isEcd || item.category === 'ecd'
    : item.category === 'national');

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

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
        <Text style={styles.title}>Résultats</Text>
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, category === 'national' && styles.tabActive]}
          onPress={() => setCategory('national')}
        >
          <Text style={[styles.tabText, category === 'national' && styles.tabTextActive]}>Course nationale</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, category === 'ecd' && styles.tabActive]}
          onPress={() => setCategory('ecd')}
        >
          <Text style={[styles.tabText, category === 'ecd' && styles.tabTextActive]}>ECD · Tickets & gains</Text>
        </Pressable>
      </View>

      <View style={styles.resultsVisual}>
        <Image source={require('../../assets/race-finish.jpg')} style={styles.resultsVisualImage} />
        <View style={styles.resultsVisualShade}>
          <Text style={styles.resultsVisualLabel}>ARRIVÉES OFFICIELLES</Text>
        </View>
      </View>

      {/* Subscriber report: performance of archived predictions. */}
      {hasAccess ? <View style={styles.rateBanner}>
        <Ionicons name="trending-up" size={20} color={COLORS.onAccent} />
        {stat && stat.rate != null ? (
          <Text style={styles.rateText}>
            Taux de réussite : {stat.rate}% ({stat.sampleSize} courses)
          </Text>
        ) : (
          <Text style={styles.rateText}>Taux de réussite : en cours de mesure</Text>
        )}
      </View> : null}

      <FlatList
        data={visibleHistory}
        keyExtractor={(h, i) => (h.id != null ? String(h.id) : String(i))}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={40} color={COLORS.textFaint} />
            <Text style={styles.emptyText}>
              Aucune course terminée pour l'instant. Les résultats apparaîtront ici
              automatiquement après chaque course.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const arrival = item.winners || [];
          const podium = arrival.slice(0, 5);
          const selectionSize = item.groups?.selectionSize || Math.min(Math.max(arrival.length, 3), 5) + 2;
          const predictions = (item.topPicks || [])
            .slice()
            .sort((a, b) => (a.rank || 999) - (b.rank || 999))
            .slice(0, selectionSize);
          const outcome = item.grandCarnetOutcome;
          const gainDisplay = outcome?.gain == null
            ? 'À CONFIRMER'
            : `${formatXof(outcome.gain)} FCFA`;
          return (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.race} numberOfLines={1}>{item.race}</Text>
                  <Text style={styles.meta}>
                    {item.number ? `${item.number} · ` : ''}{item.track} · {item.date}
                  </Text>
                </View>
                {hasAccess && item.aiHit ? (
                  <View style={styles.win}><Text style={styles.winText}>PRONOSTIC PLACÉ</Text></View>
                ) : hasAccess ? (
                  <View style={styles.miss}><Text style={styles.missText}>Non placé</Text></View>
                ) : null}
              </View>

              {/* Our AI prediction */}
              {hasAccess && predictions.length > 0 && (
                <View style={styles.line}>
                  <Text style={styles.lineLabel}>Pronostic</Text>
                  <View style={styles.chips}>
                    {predictions.map((p, index) => {
                      const hit = podium.includes(p.number);
                      return (
                        <View key={`${p.number}-${p.rank || index}`} style={[styles.chip, hit && styles.chipHit]}>
                          <Text style={[styles.chipText, hit && styles.chipTextHit]}>{p.number}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Actual arrival */}
              <View style={styles.line}>
                <Text style={styles.lineLabel}>🏁 Arrivée</Text>
                <View style={styles.chips}>
                  {podium.map((w, i) => (
                    <View key={i} style={[styles.chip, i === 0 && styles.chipWin]}>
                      <Text style={[styles.chipText, i === 0 && styles.chipTextWin]}>{w}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {hasAccess && (item.category === 'ecd' || item.isEcd) ? (
                <>
                  <EcdTicketOutcomeCard outcome={item.ecdTicketOutcome} />
                  <EcdGainsTable
                    arrival={arrival}
                    payouts={item.payouts || []}
                    predictions={predictions}
                    countryName={countryName}
                  />
                </>
              ) : null}

              {hasAccess && country === 'bf' && item.category === 'national' && outcome ? (
                <View style={styles.gainsBox}>
                  <Text style={styles.gainsKicker}>TABLEAU DES GAINS · BURKINA FASO</Text>
                  <Text style={[styles.gainsStatus, outcome.isWinning ? styles.gainsWon : styles.gainsLost]}>
                    {outcome.isWinning ? 'Grand Carnet gagnant' : 'Grand Carnet non gagnant'}
                  </Text>

                  <View style={styles.gainsTable}>
                    <View style={styles.gainsRow}>
                      <Text style={styles.gainsLabel}>Pronostic couvert</Text>
                      <Text style={styles.gainsValue}>{outcome.selection.join(' - ')}</Text>
                    </View>
                    <View style={styles.gainsRow}>
                      <Text style={styles.gainsLabel}>Mise unitaire</Text>
                      <Text style={styles.gainsValue}>{formatXof(outcome.unitStake)} FCFA</Text>
                    </View>
                    <View style={styles.gainsRow}>
                      <Text style={styles.gainsLabel}>Combinaisons jouées</Text>
                      <Text style={styles.gainsValue}>{outcome.combinationsCount}</Text>
                    </View>
                    <View style={styles.gainsRow}>
                      <Text style={styles.gainsLabel}>Mise totale</Text>
                      <Text style={styles.gainsValue}>{formatXof(outcome.totalStake)} FCFA</Text>
                    </View>
                    <View style={[styles.gainsRow, styles.gainsRowLast]}>
                      <Text style={styles.gainsLabel}>Combinaison gagnante</Text>
                      <Text style={styles.gainsValue}>{outcome.winningCombinations}</Text>
                    </View>
                  </View>

                  <View style={styles.gainHero}>
                    <Text style={styles.gainHeroLabel}>GAIN SELON LE PRONOSTIC GRAND CARNET</Text>
                    <Text style={styles.gainHeroAmount}>{gainDisplay}</Text>
                    {outcome.gainStatus === 'pending-official-report' ? (
                      <Text style={styles.gainHeroNote}>Montant publié dès réception du rapport officiel.</Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row', gap: SPACING.sm, marginHorizontal: SPACING.md,
    marginTop: SPACING.md, padding: 4, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceAlt,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: RADIUS.pill },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { color: COLORS.textMuted, fontSize: FONT.sm, fontWeight: '800' },
  tabTextActive: { color: COLORS.white },
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900' },
  rateBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.accent, marginHorizontal: SPACING.md, marginTop: SPACING.md,
    paddingVertical: SPACING.md, borderRadius: RADIUS.md,
  },
  rateText: { color: COLORS.onAccent, fontWeight: '900', fontSize: FONT.md },
  list: { padding: SPACING.md, paddingBottom: SPACING.xxl, flexGrow: 1 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: SPACING.xxl, gap: SPACING.md, paddingHorizontal: SPACING.xl },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', fontSize: FONT.sm, lineHeight: 20 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md,
    marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  race: { color: COLORS.text, fontWeight: '800', fontSize: FONT.md },
  meta: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 2 },
  win: { backgroundColor: 'rgba(34,197,94,0.15)', paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.sm },
  winText: { color: COLORS.success, fontWeight: '800', fontSize: FONT.sm - 2 },
  miss: { backgroundColor: 'rgba(148,163,184,0.15)', paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.sm },
  missText: { color: COLORS.textMuted, fontWeight: '700', fontSize: FONT.sm - 2 },
  line: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md, gap: SPACING.sm },
  lineLabel: { color: COLORS.textMuted, fontSize: FONT.sm, width: 110 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
  chip: {
    minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6, backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  chipText: { color: COLORS.textMuted, fontWeight: '800', fontSize: FONT.sm },
  chipHit: { backgroundColor: 'rgba(34,197,94,0.2)', borderColor: COLORS.success },
  chipTextHit: { color: COLORS.success },
  chipWin: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  chipTextWin: { color: '#06251c' },
  gainsBox: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: '#C9DED3',
    backgroundColor: '#F3F8F5',
  },
  gainsKicker: { color: COLORS.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  gainsStatus: { alignSelf: 'flex-start', marginTop: 6, fontSize: FONT.sm, fontWeight: '900' },
  gainsWon: { color: COLORS.success },
  gainsLost: { color: COLORS.textMuted },
  gainsTable: { marginTop: SPACING.sm, borderWidth: 1, borderColor: '#C9DED3', borderRadius: RADIUS.sm, overflow: 'hidden' },
  gainsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm, padding: 9, borderBottomWidth: 1, borderBottomColor: '#C9DED3' },
  gainsRowLast: { borderBottomWidth: 0 },
  gainsLabel: { color: COLORS.textMuted, fontSize: FONT.sm, flex: 1 },
  gainsValue: { color: COLORS.text, fontSize: FONT.sm, fontWeight: '900', textAlign: 'right', flex: 1 },
  gainHero: { alignItems: 'center', marginTop: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: COLORS.primary },
  gainHeroLabel: { color: COLORS.white, fontSize: 9, fontWeight: '900', letterSpacing: 0.7, textAlign: 'center' },
  gainHeroAmount: { color: COLORS.gold, fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 3, textAlign: 'center' },
  gainHeroNote: { color: COLORS.white, opacity: 0.78, fontSize: FONT.sm - 1, marginTop: 2, textAlign: 'center' },
  resultsVisual: {
    height: 150,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    overflow: 'hidden',
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.primary,
  },
  resultsVisualImage: { width: '100%', height: '100%' },
  resultsVisualShade: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    backgroundColor: 'rgba(6, 37, 28, 0.72)',
  },
  resultsVisualLabel: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
