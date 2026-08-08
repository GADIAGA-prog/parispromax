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
const { getEcdProfile } = require('../../shared/ecdRules');
const {
  historyPredictionVariant,
  contextualPodium,
  contextualArrivalComplete,
} = require('../../shared/historyPrediction');

function formatXof(value) {
  return Number(value || 0).toLocaleString('fr-FR');
}

function grandCarnetPresentation(outcome) {
  const status = outcome?.gainStatus;
  if (status === 'confirmed') {
    return {
      statusLabel: 'Grand Carnet gagnant · gain officiel confirmé',
      gainLabel: outcome?.gain == null ? 'GAIN INDISPONIBLE' : `${formatXof(outcome.gain)} FCFA`,
      note: 'Montant établi à partir du rapport officiel.',
    };
  }
  if (status === 'pending-official-report') {
    return {
      statusLabel: 'Grand Carnet gagnant · rapport officiel en attente',
      gainLabel: 'EN ATTENTE',
      note: 'Le gain sera publié dès réception du rapport officiel complet.',
    };
  }
  if (status === 'official-report-indeterminate') {
    return {
      statusLabel: 'Grand Carnet gagnant · gain non calculable',
      gainLabel: 'NON CALCULABLE',
      note: 'Le rapport officiel ne permet pas de déterminer un montant fiable pour cette combinaison.',
    };
  }
  if (status === 'report-partial') {
    return {
      statusLabel: 'Grand Carnet gagnant · rapport officiel partiel',
      gainLabel: 'RAPPORT PARTIEL',
      note: 'Le calcul reste suspendu jusqu’à validation du rapport officiel complet.',
    };
  }
  if (status === 'not-winning') {
    return {
      statusLabel: 'Grand Carnet non gagnant',
      gainLabel: '0 FCFA',
      note: null,
    };
  }
  return {
    statusLabel: 'Bilan Grand Carnet indisponible',
    gainLabel: 'À CONFIRMER',
    note: 'Le statut officiel de ce pronostic n’est pas encore disponible.',
  };
}

function winningTicketLabel(ticket) {
  const numbers = (ticket?.numbers || []).map(Number).filter(Number.isFinite).join(' - ');
  const outcomeLabels = { order: 'Ordre', disorder: 'Désordre', bonus: 'Bonus' };
  const outcome = ticket?.outcome ? ` · ${outcomeLabels[ticket.outcome] || ticket.outcome}` : '';
  const gain = ticket?.gain == null ? '' : ` · ${formatXof(ticket.gain)} FCFA`;
  return `${numbers || 'Combinaison'}${outcome}${gain}`;
}

export default function HistoryScreen() {
  const { country, hasAccess } = useAuth();
  const countryName = countryCatalog.find((item) => item.code === country)?.name || country;
  const ecdRulesVerified = getEcdProfile(country)?.verified === true;
  const [history, setHistory] = useState([]);
  const [category, setCategory] = useState('ecd');
  const [stat, setStat] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [rateError, setRateError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = useCallback(() => (
    api.raceHistory(country)
      .then((response) => {
        setHistory(response.history || []);
        setHistoryError(null);
      })
      .catch((error) => {
        setHistoryError(error || new Error('Résultats momentanément indisponibles.'));
      })
  ), [country]);
  const loadStat = useCallback(() => (
    api.successRate(country)
      .then((response) => {
        setStat(response);
        setRateError(null);
      })
      .catch((error) => {
        setStat(null);
        setRateError(error || new Error('Taux momentanément indisponible.'));
      })
  ), [country]);
  const load = useCallback(() => Promise.allSettled([loadHistory(), loadStat()]), [loadHistory, loadStat]);
  const visibleHistory = history.filter((item) => category === 'ecd'
    ? item.isEcd || item.category === 'ecd'
    : item.category === 'national');
  const contextualStat = stat?.byContext?.[category] || null;
  const contextualRateLabel = category === 'ecd' ? 'ECD' : 'course nationale';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadStat();
    loadHistory().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadHistory, loadStat]);

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

      <FlatList
        data={visibleHistory}
        keyExtractor={(h, i) => (h.id != null ? String(h.id) : String(i))}
        contentContainerStyle={styles.list}
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            <View style={styles.resultsVisual}>
              <Image source={require('../../assets/race-finish.jpg')} style={styles.resultsVisualImage} />
              <View style={styles.resultsVisualShade}>
                <Text style={styles.resultsVisualLabel}>ARRIVÉES OFFICIELLES</Text>
              </View>
            </View>

            {hasAccess ? <View style={styles.rateBanner}>
              <Ionicons name="trending-up" size={20} color={COLORS.onAccent} />
              {category === 'ecd' && !ecdRulesVerified ? (
                <Text style={styles.rateText}>
                  Taux ECD indisponible · règle non validée pour {countryName}
                </Text>
              ) : rateError ? (
                <Text style={styles.rateText}>
                  Taux de succès momentanément indisponible · actualisation requise
                </Text>
              ) : contextualStat?.rate != null ? (
                <Text style={styles.rateText}>
                  Base n°1 placée · {contextualRateLabel} : {contextualStat.rate}%
                  {contextualStat.sampleSize != null ? ` (${contextualStat.sampleSize} pronostics)` : ''}
                </Text>
              ) : (
                <Text style={styles.rateText}>Base n°1 placée · {contextualRateLabel} : mesure en cours</Text>
              )}
            </View> : null}
            {historyError ? (
              <View style={styles.historyUnavailable}>
                <Ionicons name="warning-outline" size={18} color={COLORS.gold} />
                <Text style={styles.historyUnavailableText}>
                  Résultats momentanément indisponibles. Les données déjà affichées peuvent ne pas être à jour.
                </Text>
              </View>
            ) : null}
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={40} color={COLORS.textFaint} />
            <Text style={styles.emptyText}>
              {historyError
                ? 'Impossible d’actualiser les résultats pour le moment. Tirez vers le bas pour réessayer.'
                : "Aucune course terminée pour l'instant. Les résultats apparaîtront ici automatiquement après chaque course."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const displayItem = historyPredictionVariant(item, category);
          const arrival = item.winners || [];
          const officialArrival = arrival.slice(0, 5);
          const podium = contextualPodium(displayItem, category);
          const selectionSize = displayItem.groups?.selectionSize
            || displayItem.topPicks?.length
            || 0;
          const predictions = (displayItem.topPicks || [])
            .slice()
            .sort((a, b) => (a.rank || 999) - (b.rank || 999))
            .slice(0, selectionSize);
          const outcome = item.grandCarnetOutcome;
          const contextRulesAvailable = category !== 'ecd' || ecdRulesVerified;
          const contextArrivalComplete = contextualArrivalComplete(item, category);
          const grandCarnet = grandCarnetPresentation(outcome);
          const winningTickets = Array.isArray(outcome?.winningTickets) ? outcome.winningTickets : [];
          const winningCombinations = Number(outcome?.winningCombinations || winningTickets.length || 0);
          return (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.race} numberOfLines={1}>{item.race}</Text>
                  <Text style={styles.meta}>
                    {item.number ? `${item.number} · ` : ''}{item.track} · {item.date}
                  </Text>
                </View>
                {hasAccess && contextRulesAvailable && contextArrivalComplete && predictions.length > 0 ? (
                  displayItem.aiHit ? (
                    <View style={styles.win}><Text style={styles.winText}>BASE PLACÉE</Text></View>
                  ) : (
                    <View style={styles.miss}><Text style={styles.missText}>Base non placée</Text></View>
                  )
                ) : null}
              </View>

              {/* Our AI prediction */}
              {hasAccess && contextRulesAvailable && predictions.length > 0 && (
                <View style={styles.line}>
                  <Text style={styles.lineLabel}>Pronostic</Text>
                  <View style={styles.chips}>
                    {predictions.map((p, index) => {
                      const hit = podium.includes(Number(p.number));
                      return (
                        <View key={`${p.number}-${p.rank || index}`} style={[styles.chip, hit && styles.chipHit]}>
                          <Text style={[styles.chipText, hit && styles.chipTextHit]}>{p.number}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
              {hasAccess && contextRulesAvailable && predictions.length === 0 ? (
                <View style={styles.predictionUnavailable}>
                  <Ionicons name="information-circle-outline" size={17} color={COLORS.gold} />
                  <Text style={styles.predictionUnavailableText}>
                    Pronostic archivé indisponible · aucun résultat de base n’est attribué.
                  </Text>
                </View>
              ) : null}

              {/* Actual arrival */}
              <View style={styles.line}>
                <Text style={styles.lineLabel}>🏁 Arrivée</Text>
                <View style={styles.chips}>
                  {officialArrival.map((w, i) => (
                    <View key={i} style={[styles.chip, i === 0 && styles.chipWin]}>
                      <Text style={[styles.chipText, i === 0 && styles.chipTextWin]}>{w}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {contextArrivalComplete === false ? (
                <View style={styles.predictionUnavailable}>
                  <Ionicons name="time-outline" size={17} color={COLORS.gold} />
                  <Text style={styles.predictionUnavailableText}>
                    Arrivée officielle en cours de complétion · le bilan du pronostic reste suspendu.
                  </Text>
                </View>
              ) : null}

              {hasAccess && (item.category === 'ecd' || item.isEcd) ? (
                ecdRulesVerified ? (
                  <>
                    <EcdTicketOutcomeCard outcome={item.ecdTicketOutcome} />
                    <EcdGainsTable
                      arrival={arrival}
                      payouts={item.payouts || []}
                      predictions={predictions}
                      countryName={countryName}
                      podiumSize={item.ecdTicketOutcome?.podiumSize || 3}
                      reportStatus={item.ecdReport?.status || 'pending'}
                    />
                  </>
                ) : (
                  <View style={styles.ecdUnavailable}>
                    <Text style={styles.ecdUnavailableTitle}>Règle et rapports ECD non disponibles</Text>
                    <Text style={styles.ecdUnavailableText}>
                      Le format ECD n’est pas encore validé pour {countryName}. Aucun podium, ticket ou gain n’est calculé avec les règles du Burkina Faso.
                    </Text>
                  </View>
                )
              ) : null}

              {hasAccess && country === 'bf' && item.category === 'national' && outcome ? (
                <View style={styles.gainsBox}>
                  <Text style={styles.gainsKicker}>TABLEAU DES GAINS · BURKINA FASO</Text>
                  <Text style={[
                    styles.gainsStatus,
                    outcome.gainStatus === 'not-winning' ? styles.gainsLost : styles.gainsWon,
                  ]}>
                    {grandCarnet.statusLabel}
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
                      <Text style={styles.gainsLabel}>
                        Combinaison{winningCombinations > 1 ? 's' : ''} gagnante{winningCombinations > 1 ? 's' : ''}
                      </Text>
                      <Text style={styles.gainsValue}>{winningCombinations}</Text>
                    </View>
                  </View>

                  {winningTickets.length ? (
                    <View style={styles.winningTickets}>
                      <Text style={styles.winningTicketsTitle}>Détail des combinaisons gagnantes</Text>
                      {winningTickets.map((ticket, index) => (
                        <Text key={`${(ticket.numbers || []).join('-')}-${index}`} style={styles.winningTicketText}>
                          {winningTicketLabel(ticket)}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.gainHero}>
                    <Text style={styles.gainHeroLabel}>GAIN SELON LE PRONOSTIC GRAND CARNET</Text>
                    <Text style={styles.gainHeroAmount}>{grandCarnet.gainLabel}</Text>
                    {grandCarnet.note ? <Text style={styles.gainHeroNote}>{grandCarnet.note}</Text> : null}
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
  listHeader: { marginBottom: SPACING.md },
  rateBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.accent, marginTop: SPACING.md,
    paddingVertical: SPACING.md, borderRadius: RADIUS.md,
  },
  rateText: {
    flexShrink: 1,
    color: COLORS.onAccent,
    fontWeight: '900',
    fontSize: FONT.md,
    lineHeight: 20,
    textAlign: 'center',
  },
  historyUnavailable: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm,
    marginTop: SPACING.sm, padding: SPACING.sm,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.45)',
    borderRadius: RADIUS.sm, backgroundColor: 'rgba(251,191,36,0.10)',
  },
  historyUnavailableText: { flex: 1, color: COLORS.text, fontSize: FONT.sm - 1, lineHeight: 18 },
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
  predictionUnavailable: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.sm,
    padding: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: 'rgba(251,191,36,0.08)',
  },
  predictionUnavailableText: { flex: 1, color: COLORS.textMuted, fontSize: FONT.sm - 1, lineHeight: 17 },
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
  winningTickets: { marginTop: SPACING.sm, padding: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.surface },
  winningTicketsTitle: { color: COLORS.text, fontSize: FONT.sm, fontWeight: '900', marginBottom: 4 },
  winningTicketText: { color: COLORS.textMuted, fontSize: FONT.sm - 1, lineHeight: 18 },
  gainHero: { alignItems: 'center', marginTop: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.sm, backgroundColor: COLORS.primary },
  gainHeroLabel: { color: COLORS.white, fontSize: 9, fontWeight: '900', letterSpacing: 0.7, textAlign: 'center' },
  gainHeroAmount: { color: COLORS.gold, fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 3, textAlign: 'center' },
  gainHeroNote: { color: COLORS.white, opacity: 0.78, fontSize: FONT.sm - 1, marginTop: 2, textAlign: 'center' },
  ecdUnavailable: {
    marginTop: SPACING.md, padding: SPACING.md, borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.5)', borderRadius: RADIUS.md,
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  ecdUnavailableTitle: { color: COLORS.text, fontSize: FONT.md, fontWeight: '900' },
  ecdUnavailableText: { color: COLORS.textMuted, fontSize: FONT.sm - 1, lineHeight: 18, marginTop: 4 },
  resultsVisual: {
    height: 150,
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
