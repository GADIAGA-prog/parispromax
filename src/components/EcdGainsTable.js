import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING } from '../theme/colors';

function normalizeBet(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function betKind(value) {
  const bet = normalizeBet(value);
  if (bet.includes('trio')) return 'trio';
  if (bet.includes('ordre')) return 'jum-order';
  if (bet.includes('jum') && bet.includes('place')) return 'jum-place';
  if (bet.includes('jum')) return 'jum-win';
  if (bet.includes('place')) return 'place';
  return 'win';
}

function numbers(value) {
  return String(value || '').match(/\d+/g)?.map(Number) || [];
}

function pairs(values) {
  if (values.length < 3) return values.slice(0, 2).join(' - ');
  return `${values[0]} - ${values[1]} / ${values[0]} - ${values[2]} / ${values[1]} - ${values[2]}`;
}

function predictionFor(kind, prediction, podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  if (kind === 'win') return String(prediction[0] || '—');
  if (kind === 'place') return prediction.slice(0, podium).join(' - ') || '—';
  if (kind === 'jum-place') return pairs(prediction.slice(0, 3)) || '—';
  if (kind === 'trio') return prediction.slice(0, 3).join(' - ') || '—';
  return prediction.slice(0, 2).join(' - ') || '—';
}

function isCovered(kind, officialValue, prediction, podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  const official = numbers(officialValue);
  if (!official.length || !prediction.length) return false;
  if (kind === 'win') return official[0] === prediction[0];
  if (kind === 'place') return prediction.slice(0, podium).includes(official[0]);
  if (kind === 'jum-order') return official[0] === prediction[0] && official[1] === prediction[1];
  if (kind === 'jum-win') {
    const expected = new Set(prediction.slice(0, 2));
    return official.length >= 2 && official.slice(0, 2).every((value) => expected.has(value));
  }
  return official.every((value) => prediction.slice(0, 3).includes(value));
}

function fallbackRows(arrival, podiumSize = 3) {
  const podium = Math.max(2, Math.min(3, Number(podiumSize) || 3));
  const [first, second, third] = arrival.slice(0, podium);
  const rows = [
    { bet: 'Gagnant', numbers: first },
    ...arrival.slice(0, podium).map((number) => ({ bet: 'Placé', numbers: number })),
  ];
  if (podium === 2) {
    rows.push({ bet: 'Jumelé ordre', numbers: `${first} - ${second}` });
  } else {
    rows.push(
      { bet: 'Jumelé gagnant', numbers: `${first} - ${second}` },
      { bet: 'Jumelé placé', numbers: `${first} - ${second}` },
      { bet: 'Jumelé placé', numbers: `${first} - ${third}` },
      { bet: 'Jumelé placé', numbers: `${second} - ${third}` },
      { bet: 'Trio', numbers: `${first} - ${second} - ${third}` }
    );
  }
  return rows.filter((row) => !String(row.numbers).includes('undefined'));
}

function amount(value, reportsAvailable) {
  if (!reportsAvailable) return 'En attente';
  if (Number.isFinite(Number(value)) && Number(value) <= 0) return 'Non calculable';
  return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
}

export default function EcdGainsTable({
  arrival = [],
  payouts = [],
  predictions = [],
  countryName = 'votre pays',
  podiumSize = 3,
  reportStatus = 'pending',
}) {
  const prediction = useMemo(
    () => predictions
      .slice()
      .sort((a, b) => (a.rank || 999) - (b.rank || 999))
      .map((item) => Number(item.number))
      .filter(Number.isFinite),
    [predictions]
  );
  const reportsAvailable = reportStatus === 'complete' && payouts.length > 0;
  const rows = reportsAvailable ? payouts : fallbackRows(arrival, podiumSize);
  const pendingLabel = reportStatus === 'partial' || reportStatus === 'arrival-incomplete'
    ? 'Rapport partiel · calcul suspendu'
    : 'Rapports en attente';

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text style={styles.kicker}>GAINS ECD · {String(countryName).toUpperCase()}</Text>
        {!reportsAvailable ? <Text style={styles.pending}>{pendingLabel}</Text> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.betCell, styles.headerText]}>PARI</Text>
            <Text style={[styles.cell, styles.numberCell, styles.headerText]}>N°</Text>
            <Text style={[styles.cell, styles.amountCell, styles.headerText]}>MONTANT</Text>
            <Text style={[styles.cell, styles.countCell, styles.headerText]}>NB</Text>
            <Text style={[styles.cell, styles.predictionCell, styles.headerText]}>PRONOSTIC PARISPROMAX</Text>
          </View>
          {rows.map((row, index) => {
            const kind = betKind(row.bet);
            const covered = isCovered(kind, row.numbers, prediction, podiumSize);
            return (
              <View key={`${row.bet}-${row.numbers}-${index}`} style={styles.row}>
                <Text style={[styles.cell, styles.betCell, styles.betText]}>{String(row.bet).toUpperCase()}</Text>
                <Text style={[styles.cell, styles.numberCell]}>{row.numbers || '—'}</Text>
                <Text style={[styles.cell, styles.amountCell]}>{amount(row.amount, reportsAvailable)}</Text>
                <Text style={[styles.cell, styles.countCell]}>{reportsAvailable ? row.winnerCount ?? 0 : '—'}</Text>
                <View style={[styles.cell, styles.predictionCell, covered && styles.coveredCell]}>
                  <Text style={[styles.predictionText, covered && styles.coveredText]}>
                    {predictionFor(kind, prediction, podiumSize)}{covered ? '  ✓ Couvert' : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: SPACING.md },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm, marginBottom: SPACING.sm },
  kicker: { flexShrink: 1, color: COLORS.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  pending: { flexShrink: 1, color: COLORS.gold, fontSize: FONT.sm - 2, fontWeight: '900', textAlign: 'right' },
  table: { minWidth: 720, borderWidth: 1, borderColor: COLORS.primary, borderRadius: RADIUS.sm, overflow: 'hidden' },
  row: { minHeight: 38, flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerRow: { minHeight: 34, backgroundColor: COLORS.primary },
  cell: { paddingHorizontal: 7, paddingVertical: 8, color: COLORS.text, fontSize: FONT.sm - 1, borderRightWidth: 1, borderRightColor: COLORS.border, textAlignVertical: 'center' },
  headerText: { color: COLORS.white, fontWeight: '900', fontSize: 10 },
  betCell: { width: 112 },
  numberCell: { width: 82, textAlign: 'center' },
  amountCell: { width: 120, textAlign: 'right' },
  countCell: { width: 48, textAlign: 'center' },
  predictionCell: { width: 354, borderRightWidth: 0 },
  betText: { fontWeight: '900', color: COLORS.primary },
  predictionText: { color: COLORS.accent, fontSize: FONT.sm - 1, fontWeight: '900' },
  coveredCell: { backgroundColor: 'rgba(34,197,94,0.14)' },
  coveredText: { color: COLORS.success },
});
