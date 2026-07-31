import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, RADIUS, SPACING } from '../theme/colors';

const {
  combinationCount,
  grandCarnetCost,
} = require('../../shared/burkinaGameRules');

function formatFcfa(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
}

function HorseNumbers({ horses, gold = false }) {
  return (
    <View style={styles.horseNumbers}>
      {(horses || []).map((horse, index) => (
        <React.Fragment key={`${horse.number}-${index}`}>
          {index > 0 && <Text style={styles.horseSeparator}>–</Text>}
          <View style={[styles.horseNumber, gold && styles.horseNumberGold]}>
            <Text style={styles.horseNumberText}>{horse.number}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

export default function NationalGameCard({ game }) {
  const [expanded, setExpanded] = useState(true);
  const [selectedHorses, setSelectedHorses] = useState(String(game?.podium || 0));

  useEffect(() => {
    setSelectedHorses(String(game?.podium || 0));
  }, [game?.podium]);

  const selectedCount = Number.parseInt(selectedHorses, 10);
  const totals = useMemo(() => {
    const safeCount = Number.isInteger(selectedCount) ? selectedCount : 0;
    return {
      combinations: combinationCount(safeCount, game?.podium),
      cost: grandCarnetCost(safeCount, game?.podium, game?.stake),
    };
  }, [game?.podium, game?.stake, selectedCount]);

  if (!game) return null;

  const changeHorseCount = (change) => {
    const current = Number.isInteger(selectedCount) ? selectedCount : game.podium;
    const next = Math.max(game.podium, Math.min(20, current + change));
    setSelectedHorses(String(next));
  };

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.heading}
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${game.label} du jour en ${game.countryName}. Afficher la stratégie`}
      >
        <View style={styles.icon}>
          <Ionicons name="flag" size={18} color="#06251c" />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.kicker}>
            {game.verified ? 'RÈGLES VÉRIFIÉES' : 'FORMAT NATIONAL DU JOUR'} · {game.countryName?.toUpperCase()}
          </Text>
          <Text style={styles.title}>{game.label} du jour</Text>
          <Text style={styles.subtitle}>
            {game.podium} chevaux au podium · {game.stake
              ? `${formatFcfa(game.stake)} par combinaison`
              : 'mise selon l’opérateur national'}
          </Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={COLORS.gold}
        />
      </Pressable>

      {expanded && (
        <View style={styles.details}>
          {game.proposal ? (
            <View style={styles.proposal}>
              <Text style={styles.proposalKicker}>PROPOSITIONS DE JEUX · COURSE NATIONALE</Text>
              <Text style={styles.proposalTitle}>Tickets conseillés aujourd’hui</Text>
              <Text style={styles.proposalHelp}>
                Hiérarchie actualisée · non-partants exclus.
              </Text>

              <View style={styles.podiumTicket}>
                <Text style={styles.ticketLabel}>Podium proposé</Text>
                <HorseNumbers horses={game.proposal.podiumSelection} />
              </View>

              <Text style={styles.sectionTitle}>Couplés proposés</Text>
              <View style={styles.coupleTickets}>
                {(game.proposal.couples || []).map((ticket) => (
                  <View key={ticket.id} style={styles.coupleTicket}>
                    <Text style={styles.ticketLabel}>{ticket.label}</Text>
                    <HorseNumbers horses={ticket.horses} />
                    <Text style={styles.ticketNames} numberOfLines={1}>
                      {(ticket.horses || []).map((horse) => horse.name).join(' · ')}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.grandCarnetProposal}>
                <View style={styles.grandCarnetHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.grandCarnetKicker}>GRAND CARNET {game.label?.toUpperCase()}</Text>
                    <Text style={styles.grandCarnetTitle}>
                      {game.proposal.grandCarnet.selectedHorses} chevaux retenus
                    </Text>
                  </View>
                  <Text style={styles.combinationBadge}>
                    {game.proposal.grandCarnet.combinationsCount} comb.
                  </Text>
                </View>
                <HorseNumbers horses={game.proposal.grandCarnet.horses} gold />
                <Text style={styles.grandCarnetBudget}>
                  {game.proposal.grandCarnet.cost != null
                    ? `Budget complet : ${formatFcfa(game.proposal.grandCarnet.cost)}`
                    : 'Mise à confirmer auprès de l’opérateur national'}
                </Text>
                <Text style={styles.combinationsTitle}>
                  Toutes les combinaisons
                </Text>
                <View style={styles.combinationList}>
                  {(game.proposal.grandCarnet.combinations || []).map((combination, index) => (
                    <View key={`${combination.join('-')}-${index}`} style={styles.combinationChip}>
                      <Text style={styles.combinationIndex}>{index + 1}</Text>
                      <Text style={styles.combinationText}>{combination.join(' – ')}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.proposalPending}>
              <Text style={styles.proposalKicker}>PROPOSITIONS DE JEUX</Text>
              <Text style={styles.proposalTitle}>Analyse en cours</Text>
              <Text style={styles.proposalHelp}>
                Les tickets apparaîtront dès que la hiérarchie nationale sera validée.
              </Text>
            </View>
          )}

          {!!game.schedule?.length && (
            <>
              <Text style={styles.sectionTitle}>Calendrier des jeux</Text>
              {game.schedule.map((item) => (
                <View key={item.label} style={styles.ruleRow}>
                  <View style={styles.ruleBadge}>
                    <Text style={styles.ruleBadgeText}>{item.label}</Text>
                  </View>
                  <View style={styles.ruleCopy}>
                    <Text style={styles.ruleDays}>{item.days}</Text>
                    <Text style={styles.ruleNote}>
                      {item.podium} arrivées · {formatFcfa(item.stake)} / combinaison
                      {item.note ? ` · ${item.note}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}

          <Text style={styles.sectionTitle}>Stratégies de couverture</Text>
          <View style={styles.strategies}>
            {(game.strategies || []).map((strategy) => (
              <View
                key={strategy.id}
                style={[styles.strategy, strategy.id === 'coverage' && styles.strategyRecommended]}
              >
                <View style={styles.strategyHead}>
                  <Text style={styles.strategyLabel}>{strategy.label}</Text>
                  {strategy.id === 'coverage' && (
                    <Text style={styles.recommendedBadge}>CONSEILLÉ</Text>
                  )}
                </View>
                <Text style={styles.strategyValue}>
                  {strategy.selectedHorses} chevaux · {strategy.combinations} combinaison{strategy.combinations > 1 ? 's' : ''}
                </Text>
                <Text style={styles.strategyText}>
                  {strategy.cost != null ? `${formatFcfa(strategy.cost)} · ` : ''}{strategy.description}
                </Text>
              </View>
            ))}
          </View>

          {!!game.couples?.length && (
            <>
              <Text style={styles.sectionTitle}>Couplés possibles</Text>
              <View style={styles.couples}>
                {game.couples.map((couple) => (
                  <View key={couple.label} style={styles.couple}>
                    <Text style={styles.coupleLabel}>{couple.label}</Text>
                    <Text style={styles.coupleText}>{couple.description}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={styles.calculator}>
            <View style={styles.calculatorHeading}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Grand carnet</Text>
                <Text style={styles.calculatorHelp}>
                  Choisissez au moins {game.podium} chevaux.
                </Text>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepButton}
                  onPress={() => changeHorseCount(-1)}
                  accessibilityRole="button"
                  accessibilityLabel="Retirer un cheval"
                >
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <TextInput
                  style={styles.horseInput}
                  value={selectedHorses}
                  onChangeText={(value) => setSelectedHorses(value.replace(/\D/g, '').slice(0, 2))}
                  onBlur={() => changeHorseCount(0)}
                  keyboardType="number-pad"
                  maxLength={2}
                  selectTextOnFocus
                  accessibilityLabel="Nombre de chevaux choisis"
                />
                <Pressable
                  style={styles.stepButton}
                  onPress={() => changeHorseCount(1)}
                  accessibilityRole="button"
                  accessibilityLabel="Ajouter un cheval"
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.totalRow}>
              <View>
                <Text style={styles.totalLabel}>Combinaisons</Text>
                <Text style={styles.totalValue}>{totals.combinations}</Text>
              </View>
              <View style={styles.totalDivider} />
              <View>
                <Text style={styles.totalLabel}>Mise totale</Text>
                <Text style={[styles.totalValue, styles.totalCost]}>
                  {game.stake ? formatFcfa(totals.cost) : 'À confirmer'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.38)',
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(251,191,36,0.07)',
    overflow: 'hidden',
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.lg,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gold,
  },
  headingCopy: { flex: 1 },
  kicker: { color: COLORS.gold, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginTop: 3 },
  subtitle: { color: COLORS.textMuted, fontSize: FONT.sm - 1, marginTop: 2 },
  details: {
    padding: SPACING.lg,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(251,191,36,0.18)',
  },
  proposal: {
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.45)',
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  proposalPending: {
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  proposalKicker: { color: COLORS.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  proposalTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginTop: 3 },
  proposalHelp: { color: COLORS.textMuted, fontSize: 10, marginTop: 3 },
  podiumTicket: {
    marginTop: SPACING.md,
    padding: SPACING.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  ticketLabel: { color: COLORS.text, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  horseNumbers: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  horseNumber: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: COLORS.accent,
  },
  horseNumberGold: { backgroundColor: COLORS.gold },
  horseNumberText: { color: '#06251c', fontSize: FONT.sm, fontWeight: '900' },
  horseSeparator: { color: COLORS.textMuted, fontSize: 10, fontWeight: '900' },
  coupleTickets: { gap: SPACING.sm },
  coupleTicket: {
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
  },
  ticketNames: { color: COLORS.textMuted, fontSize: 9, marginTop: 5 },
  grandCarnetProposal: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.38)',
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(251,191,36,0.07)',
  },
  grandCarnetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  grandCarnetKicker: { color: COLORS.gold, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  grandCarnetTitle: { color: COLORS.text, fontSize: FONT.md, fontWeight: '900', marginTop: 3 },
  combinationBadge: {
    color: '#3b2b00',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 9,
    fontWeight: '900',
  },
  grandCarnetBudget: { color: COLORS.accent, fontSize: FONT.sm, fontWeight: '800', marginTop: SPACING.sm },
  combinationsTitle: { color: COLORS.textMuted, fontSize: 9, fontWeight: '900', marginTop: SPACING.md, textTransform: 'uppercase' },
  combinationList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm },
  combinationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
  },
  combinationIndex: { color: COLORS.textFaint, fontSize: 8 },
  combinationText: { color: COLORS.text, fontSize: 9, fontWeight: '800' },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT.md,
    fontWeight: '900',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  ruleBadge: {
    minWidth: 58,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceAlt,
  },
  ruleBadgeText: { color: COLORS.gold, textAlign: 'center', fontSize: 10, fontWeight: '900' },
  ruleCopy: { flex: 1 },
  ruleDays: { color: COLORS.text, fontSize: FONT.sm, fontWeight: '800' },
  ruleNote: { color: COLORS.textMuted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  couples: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  strategies: { gap: SPACING.sm },
  strategy: {
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  strategyRecommended: {
    borderColor: 'rgba(16,185,129,0.55)',
    backgroundColor: 'rgba(16,185,129,0.10)',
  },
  strategyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  strategyLabel: { color: COLORS.text, fontSize: FONT.sm, fontWeight: '900' },
  recommendedBadge: { color: COLORS.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  strategyValue: { color: COLORS.gold, fontSize: FONT.sm, fontWeight: '900', marginTop: 4 },
  strategyText: { color: COLORS.textMuted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  couple: {
    width: '48%',
    flexGrow: 1,
    padding: SPACING.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceAlt,
  },
  coupleLabel: { color: COLORS.info, fontSize: 10, fontWeight: '900' },
  coupleText: { color: COLORS.textMuted, fontSize: 10, marginTop: 2 },
  calculator: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
  },
  calculatorHeading: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  calculatorHelp: { color: COLORS.textMuted, fontSize: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepButton: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceAlt,
  },
  stepText: { color: COLORS.gold, fontSize: FONT.xl, fontWeight: '900' },
  horseInput: {
    width: 42,
    height: 36,
    padding: 0,
    color: COLORS.text,
    backgroundColor: COLORS.background,
    textAlign: 'center',
    fontSize: FONT.lg,
    fontWeight: '900',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  totalDivider: { width: 1, height: 30, backgroundColor: COLORS.border, marginHorizontal: SPACING.xl },
  totalLabel: { color: COLORS.textMuted, fontSize: 10, textTransform: 'uppercase' },
  totalValue: { color: COLORS.text, fontSize: FONT.xl, fontWeight: '900', marginTop: 2 },
  totalCost: { color: COLORS.accent },
});
