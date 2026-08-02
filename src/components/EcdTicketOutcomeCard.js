import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING } from '../theme/colors';

function money(value, currency = 'FCFA') {
  if (value == null) return 'En attente';
  return `${Number(value || 0).toLocaleString('fr-FR')} ${currency}`;
}

export default function EcdTicketOutcomeCard({ outcome }) {
  if (!outcome || outcome.status === 'prediction-unavailable') {
    return (
      <View style={[styles.card, styles.pending]}>
        <Text style={styles.kicker}>BILAN DES TICKETS PARISPROMAX</Text>
        <Text style={styles.title}>Pronostic archivé indisponible</Text>
      </View>
    );
  }

  const settled = outcome.status === 'settled';
  const positive = settled && Number(outcome.netReturn || 0) >= 0;
  const currency = outcome.currency || 'FCFA';

  return (
    <View style={[styles.card, !settled && styles.pending, positive && styles.positive]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>BILAN DES TICKETS PARISPROMAX</Text>
          <Text style={styles.title}>
            {settled
              ? `${outcome.winningCount || 0} ticket${Number(outcome.winningCount || 0) > 1 ? 's' : ''} gagnant${Number(outcome.winningCount || 0) > 1 ? 's' : ''} sur ${outcome.ticketsCount || 0}`
              : `${outcome.ticketsCount || 0} tickets proposés · rapports en attente`}
          </Text>
        </View>
        <Text style={[styles.status, !settled && styles.statusPending]}>
          {settled ? 'CALCUL TERMINÉ' : 'À CONFIRMER'}
        </Text>
      </View>

      <View style={styles.metrics}>
        <Metric label="Tickets gagnants" value={settled ? `${outcome.winningCount || 0} / ${outcome.ticketsCount || 0}` : '—'} />
        <Metric label="Retour théorique" value={money(outcome.totalReturn, currency)} />
        <Metric label="Mise illustrative" value={money(outcome.totalStake, currency)} />
        <Metric label="Solde théorique" value={money(outcome.netReturn, currency)} positive={positive} />
      </View>

      {settled ? (
        <View style={styles.winners}>
          <Text style={styles.winnersTitle}>Tickets gagnants du pronostic</Text>
          {(outcome.winningTickets || []).length ? (outcome.winningTickets || []).map((ticket) => (
            <View key={ticket.id} style={styles.ticketRow}>
              <Text style={styles.ticketName}>{ticket.bet} · {(ticket.numbers || []).join(' - ')}</Text>
              <Text style={styles.ticketAmount}>{money(ticket.returnAmount, currency)}</Text>
            </View>
          )) : <Text style={styles.note}>Aucun ticket gagnant pour ce pronostic.</Text>}
        </View>
      ) : null}

      <Text style={styles.note}>
        Simulation du pronostic archivé à {money(outcome.unitStake, currency)} par ticket. Aucun pari n’est effectué ou encaissé par ParisPromax.
      </Text>
    </View>
  );
}

function Metric({ label, value, positive = false }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, positive && styles.metricPositive]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: '#9DCCBB',
    borderRadius: RADIUS.md,
    backgroundColor: '#F2F9F5',
  },
  pending: { borderStyle: 'dashed' },
  positive: { borderColor: COLORS.success },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  headerCopy: { flex: 1 },
  kicker: { color: COLORS.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  title: { marginTop: 4, color: COLORS.text, fontSize: FONT.md, fontWeight: '900' },
  status: { color: COLORS.white, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900' },
  statusPending: { color: COLORS.text, backgroundColor: COLORS.gold },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: SPACING.sm },
  metric: { width: '48%', flexGrow: 1, padding: 9, borderRadius: RADIUS.sm, backgroundColor: COLORS.surface },
  metricLabel: { color: COLORS.textMuted, fontSize: 9, textTransform: 'uppercase' },
  metricValue: { marginTop: 3, color: COLORS.text, fontSize: FONT.sm, fontWeight: '900' },
  metricPositive: { color: COLORS.success },
  winners: { marginTop: SPACING.sm, padding: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.surface },
  winnersTitle: { color: COLORS.text, fontSize: FONT.sm, fontWeight: '900' },
  ticketRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  ticketName: { flex: 1, color: COLORS.textMuted, fontSize: FONT.sm - 1 },
  ticketAmount: { color: COLORS.success, fontSize: FONT.sm - 1, fontWeight: '900' },
  note: { marginTop: SPACING.sm, color: COLORS.textMuted, fontSize: FONT.sm - 2, lineHeight: 16 },
});
