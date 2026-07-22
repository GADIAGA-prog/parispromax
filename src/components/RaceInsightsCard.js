import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildRaceInsights } from '../services/raceInsights';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

function HorseLine({ horse, accent = COLORS.text }) {
  if (!horse) return null;
  return (
    <View style={styles.horseLine}>
      <View style={[styles.number, { borderColor: accent }]}><Text style={[styles.numberText, { color: accent }]}>{horse.number}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.horseName}>{horse.name}</Text>
        <Text style={styles.horseMeta}>
          IA {Math.round(horse.aiScore || 0)}/100
          {horse.probaPodium != null ? ` · podium ${Math.round(horse.probaPodium * 100)}%` : ''}
          {horse.odds != null ? ` · cote ${horse.odds}` : ''}
        </Text>
      </View>
    </View>
  );
}

function Group({ title, horses, color }) {
  if (!horses?.length) return null;
  return (
    <View style={styles.group}>
      <Text style={[styles.groupTitle, { color }]}>{title}</Text>
      {horses.map((horse) => <HorseLine key={horse.number} horse={horse} accent={color} />)}
    </View>
  );
}

export default function RaceInsightsCard({ race, advanced = false }) {
  const insights = useMemo(() => buildRaceInsights(race), [race]);
  const stars = `${'★'.repeat(insights.confidence.stars)}${'☆'.repeat(5 - insights.confidence.stars)}`;

  return (
    <View style={styles.card}>
      <View style={styles.summary}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>SYNTHÈSE {advanced ? '· IA AVANCÉE' : ''}</Text>
          <Text style={styles.confidence}>{stars}</Text>
          <Text style={styles.confidenceLabel}>{insights.confidence.label}</Text>
          <Text style={styles.reason}>{insights.confidence.reasons.join(' · ')}</Text>
        </View>
        <View style={styles.selectionCount}>
          <Text style={styles.selectionCountValue}>{insights.selectionSize}</Text>
          <Text style={styles.selectionCountLabel}>chevaux</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>La base</Text>
      {insights.bases.map((horse) => <HorseLine key={horse.number} horse={horse} accent={COLORS.accent} />)}

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Pronostic final · {insights.format.label}</Text>
      <Text style={styles.help}>Le podium attendu + 2 chevaux complémentaires, soit 5 chevaux au maximum.</Text>
      <Group title="Couplé recommandé" horses={insights.couple} color={COLORS.accent} />
      <Group title="Chances régulières" horses={insights.chances} color={COLORS.info} />
      <Group title="Tocard" horses={insights.tocards} color={COLORS.gold} />
      <Group title="Regret" horses={insights.regret ? [insights.regret] : []} color={COLORS.textMuted} />

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Les tuyaux</Text>
      {insights.tips.length ? insights.tips.map(({ horse, reasons }) => (
        <View key={horse.number} style={styles.tip}>
          <Ionicons name="bulb" size={18} color={COLORS.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.tipName}>n°{horse.number} {horse.name}</Text>
            <Text style={styles.tipReason}>{reasons.join(' · ')}</Text>
          </View>
        </View>
      )) : <Text style={styles.help}>Aucun signal suffisamment convergent sur cette course.</Text>}

    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, padding: SPACING.lg },
  summary: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center' },
  eyebrow: { color: COLORS.accent, fontSize: FONT.sm - 1, fontWeight: '900', letterSpacing: 1 },
  confidence: { color: COLORS.gold, fontSize: FONT.xl, letterSpacing: 2, marginTop: 3 },
  confidenceLabel: { color: COLORS.text, fontWeight: '900', fontSize: FONT.lg },
  reason: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 3, lineHeight: 18 },
  selectionCount: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  selectionCountValue: { color: '#06251c', fontSize: FONT.xxl, fontWeight: '900' },
  selectionCountLabel: { color: '#06251c', fontSize: FONT.sm - 1, fontWeight: '800' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.14)', marginVertical: SPACING.md },
  sectionTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginBottom: SPACING.sm },
  help: { color: COLORS.textMuted, fontSize: FONT.sm, lineHeight: 18, marginBottom: SPACING.sm },
  group: { marginTop: SPACING.sm },
  groupTitle: { fontWeight: '900', fontSize: FONT.sm, textTransform: 'uppercase', marginBottom: 3 },
  horseLine: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 5 },
  number: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  numberText: { fontWeight: '900' },
  horseName: { color: COLORS.text, fontWeight: '800', fontSize: FONT.md },
  horseMeta: { color: COLORS.textMuted, fontSize: FONT.sm - 1, marginTop: 1 },
  tip: { flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.sm },
  tipName: { color: COLORS.text, fontWeight: '800' },
  tipReason: { color: COLORS.gold, fontSize: FONT.sm, marginTop: 2 },
});
