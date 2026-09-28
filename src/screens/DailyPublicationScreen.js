import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import LockCard from '../components/LockCard';
import api from '../services/api';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

function formatDate(value) {
  if (!value) return 'Aujourd’hui';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function PredictionsTable({ rows }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
    <View style={styles.table}>
      <View style={styles.tableHeader}>{['Course', 'Informations', 'Pronostic IA', 'Résultat officiel'].map((label, i) => <Text key={label} style={[styles.headerCell, { width: [190, 135, 200, 180][i] }]}>{label}</Text>)}</View>
      {rows.map((entry, index) => <View key={entry.race.id} style={[styles.tableRow, index % 2 === 1 && styles.alternate]}>
        <View style={[styles.cell, { width: 190 }]}><Text style={styles.raceTitle}>{entry.race.reference} · {entry.race.track}</Text><Text style={styles.raceName}>{entry.race.name}</Text><Text style={styles.raceMeta}>{entry.contexts?.join(' · ') || 'Programme international'}</Text></View>
        <View style={[styles.cell, { width: 135 }]}><Text style={styles.raceTitle}>{entry.race.time || '—'} GMT</Text><Text style={styles.raceMeta}>{entry.race.discipline}</Text><Text style={styles.raceMeta}>{entry.race.distance} · {entry.race.runners} partants</Text></View>
        <View style={[styles.cell, { width: 200 }]}><Text style={styles.gameLabel}>{entry.label} · {entry.selectionSize} chevaux</Text><View style={styles.numbers}>{entry.selection.map((pick) => <View key={pick.number} style={styles.pickBall}><Text style={styles.pickNumber}>{pick.number}</Text></View>)}</View>{!entry.selection.length ? <Text style={styles.raceMeta}>{entry.predictionStatus === 'not-archived' ? 'Aucun pronostic archivé avant le départ' : 'En préparation'}</Text> : entry.predictionStatus === 'archived' ? <Text style={styles.raceMeta}>Figé avant le départ</Text> : null}</View>
        <View style={[styles.cell, { width: 180 }]}><Text style={styles.gameLabel}>{entry.race.result?.available ? (entry.race.result.complete ? 'Arrivée officielle' : 'Arrivée partielle') : 'En attente'}</Text><Text style={styles.arrivalValue}>{entry.race.result?.arrival?.join(' - ') || '—'}</Text></View>
      </View>)}
    </View>
  </ScrollView>;
}

export default function DailyPublicationScreen({ navigation }) {
  const { hasAccess } = useAuth();
  const [publication, setPublication] = useState(null);
  const [loading, setLoading] = useState(hasAccess);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!hasAccess) return;
    try {
      const data = await api.dailyPublication();
      setPublication(data);
      setError(null);
    } catch (requestError) {
      if (requestError?.status === 403) {
        setPublication(null);
        setError(null);
      } else {
        setError(requestError);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasAccess]);

  useEffect(() => {
    void load();
    // Results are polled while this premium sheet is open so an official
    // arrival becomes visible without requiring the subscriber to reopen it.
    const timer = hasAccess ? setInterval(() => { void load(); }, 60000) : null;
    return () => { if (timer) clearInterval(timer); };
  }, [hasAccess, load]);

  if (!hasAccess) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.lockedContent}>
          <Text style={styles.pageKicker}>PUBLICATION PREMIUM</Text>
          <Text style={styles.pageTitle}>Tous les pronostics</Text>
          <Text style={styles.pageIntro}>Programme national, ECD, sélections Podium + 2 et arrivées officielles au fil de la journée.</Text>
          <LockCard locked label="Publication réservée aux abonnés" onUnlockPress={() => navigation.navigate('Paywall')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loading) {
    return <SafeAreaView style={[styles.safe, styles.center]}><ActivityIndicator size="large" color={COLORS.accent} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={COLORS.accent} />}
      >
        <View style={styles.hero}>
          <Text style={styles.pageKicker}>PUBLICATION PREMIUM DU JOUR</Text>
          <Text style={styles.pageTitle}>{formatDate(publication?.date)}</Text>
          <Text style={styles.pageIntro}>Les résultats officiels se joignent automatiquement dès leur publication.</Text>
          {publication?.resultsAvailable ? <Text style={styles.liveResult}>{publication.resultsAvailable} résultat{publication.resultsAvailable > 1 ? 's' : ''} disponible{publication.resultsAvailable > 1 ? 's' : ''}</Text> : null}
        </View>
        {error ? (
          <View style={styles.errorBox}><Ionicons name="warning-outline" size={18} color={COLORS.gold} /><Text style={styles.errorText}>{error.message || 'La publication ne peut pas être chargée.'}</Text></View>
        ) : null}
        <Text style={styles.sectionTitle}>{publication?.rows?.length || 0} courses · un seul tableau</Text>
        <Text style={styles.pageIntro}>Faites glisser horizontalement pour comparer le pronostic et l’arrivée officielle.</Text>
        <PredictionsTable rows={publication?.rows || []} />
        {!publication?.national && !(publication?.ecd || []).length && !error ? <Text style={styles.empty}>La publication du jour est en préparation.</Text> : null}
        <Text style={styles.notice}>Information uniquement. ParisPromax ne prend ni n’encaisse aucun pari.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  table: { width: 705, marginTop: 16, borderWidth: 1, borderColor: COLORS.border },
  tableHeader: { flexDirection: 'row', backgroundColor: COLORS.primary },
  headerCell: { color: COLORS.white, fontSize: 12, fontWeight: '900', padding: 12 },
  tableRow: { flexDirection: 'row', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  alternate: { backgroundColor: '#EFF6F1' },
  cell: { padding: 12 },
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  lockedContent: { padding: SPACING.lg, gap: SPACING.md },
  hero: { paddingVertical: SPACING.md, marginBottom: SPACING.md },
  pageKicker: { color: COLORS.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  pageTitle: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900', marginTop: 4, textTransform: 'capitalize' },
  pageIntro: { color: COLORS.textMuted, fontSize: FONT.sm, lineHeight: 19, marginTop: 5 },
  liveResult: { alignSelf: 'flex-start', color: COLORS.primary, backgroundColor: '#DDF5E8', borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm, paddingVertical: 5, marginTop: SPACING.sm, fontSize: 11, fontWeight: '900' },
  raceCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.md },
  nationalCard: { borderColor: 'rgba(16,185,129,0.5)', backgroundColor: '#F1FAF5' },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  gameLabel: { color: COLORS.accent, fontSize: 10, fontWeight: '900', letterSpacing: .8 },
  pending: { color: COLORS.textMuted, fontSize: 10, fontWeight: '800' },
  resultBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  resultBadgeText: { color: COLORS.accent, fontSize: 10, fontWeight: '900' },
  raceTitle: { color: COLORS.primary, fontSize: FONT.md, fontWeight: '900', marginTop: SPACING.sm },
  raceName: { color: COLORS.text, fontSize: FONT.sm, fontWeight: '700', marginTop: 2 },
  raceMeta: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },
  selectionTitle: { color: COLORS.textMuted, fontSize: 9, letterSpacing: .8, fontWeight: '900', marginTop: SPACING.md },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm },
  numberWrap: { width: 43, alignItems: 'center' },
  pickBall: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary },
  pickNumber: { color: COLORS.white, fontSize: FONT.sm, fontWeight: '900' },
  pickName: { color: COLORS.textMuted, fontSize: 8, marginTop: 3, textAlign: 'center' },
  arrivalRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  arrivalLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  arrivalValue: { color: COLORS.primary, fontSize: FONT.md, fontWeight: '900' },
  sectionHead: { marginTop: SPACING.md, marginBottom: SPACING.sm },
  sectionKicker: { color: COLORS.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  sectionTitle: { color: COLORS.text, fontSize: FONT.xl, fontWeight: '900', marginTop: 2 },
  errorBox: { flexDirection: 'row', gap: SPACING.sm, borderWidth: 1, borderColor: 'rgba(251,191,36,.45)', backgroundColor: 'rgba(251,191,36,.10)', borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  errorText: { flex: 1, color: COLORS.text, fontSize: FONT.sm },
  empty: { color: COLORS.textMuted, textAlign: 'center', padding: SPACING.lg },
  notice: { color: COLORS.textFaint, textAlign: 'center', fontSize: 10, lineHeight: 15, marginTop: SPACING.md },
});
