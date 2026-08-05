import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildRaceInsights } from '../services/raceInsights';
import { hasVerifiedEcdRules } from '../services/raceContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';
const { buildNationalBetProposal } = require('../../shared/nationalBetProposal');

function HorseLine({ horse, accent = COLORS.text }) {
  if (!horse) return null;
  return (
    <View style={styles.horseLine}>
      <View style={[styles.number, { borderColor: accent }]}><Text style={[styles.numberText, { color: accent }]}>{horse.number}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.horseName}>{horse.name}</Text>
        <Text style={styles.horseMeta}>
          Indice {Math.round(horse.aiScore || 0)}/100
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

function EcdRulesUnavailable({ race }) {
  const countryName = race?.ecdProfile?.countryName || 'ce pays';
  return (
    <View style={[styles.card, styles.rulesUnavailable]}>
      <View style={styles.rulesUnavailableHead}>
        <Ionicons name="shield-outline" size={22} color={COLORS.gold} />
        <Text style={styles.rulesUnavailableTitle}>Règle ECD non disponible</Text>
      </View>
      <Text style={styles.rulesUnavailableText}>
        Le format Jumelé ordre / Trio n’est pas encore validé pour {countryName}. ParisPromax n’applique pas les règles du Burkina Faso à cette course et suspend le pronostic de jeu ainsi que la simulation des rapports.
      </Text>
    </View>
  );
}

export default function RaceInsightsCard(props) {
  if (props.mode === 'ecd' && !hasVerifiedEcdRules(props.race)) {
    return <EcdRulesUnavailable race={props.race} />;
  }
  return <RaceInsightsContent {...props} />;
}

function RaceInsightsContent({ race, advanced = false, game = null, mode = null }) {
  const activeGame = mode === 'national' ? game : null;
  const insights = useMemo(
    () => buildRaceInsights(race, { game: activeGame, mode }),
    [activeGame, mode, race]
  );
  const smartSelection = useMemo(() => {
    if (!activeGame?.recommendedSelectionSize) return insights.selected;
    const ranked = [...(race?.horses || [])].sort(
      (a, b) => Number(a.rank || 999) - Number(b.rank || 999)
        || Number(b.aiScore || 0) - Number(a.aiScore || 0)
    );
    const unique = [];
    const seen = new Set();
    for (const horse of [...insights.selected, ...ranked]) {
      const key = String(horse?.number ?? '');
      if (!horse || horse.nonPartant || !key || seen.has(key)) continue;
      seen.add(key);
      unique.push(horse);
    }
    return unique.slice(0, activeGame.recommendedSelectionSize);
  }, [activeGame?.recommendedSelectionSize, insights.selected, race?.horses]);
  const currentCouples = useMemo(() => {
    if (!activeGame) return [];
    return buildNationalBetProposal(activeGame, smartSelection, {
      nonPartants: race?.nonPartants || [],
      source: 'current-analysis',
    })?.couples || [];
  }, [activeGame, race?.nonPartants, smartSelection]);
  const stars = `${'★'.repeat(insights.confidence.stars)}${'☆'.repeat(5 - insights.confidence.stars)}`;
  const selectionSize = activeGame ? smartSelection.length : insights.selectionSize;

  return (
    <View style={styles.card}>
      <View style={styles.summary}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>SYNTHÈSE {advanced ? '· ANALYSE DÉTAILLÉE' : ''}</Text>
          <Text style={styles.confidence}>{stars}</Text>
          <Text style={styles.confidenceLabel}>{insights.confidence.label}</Text>
          <Text style={styles.reason}>{insights.confidence.reasons.join(' · ')}</Text>
        </View>
        <View style={styles.selectionCount}>
          <Text style={styles.selectionCountValue}>{selectionSize}</Text>
          <Text style={styles.selectionCountLabel}>chevaux</Text>
        </View>
      </View>

      {activeGame && (
        <View style={styles.smartGame}>
          <View style={styles.smartGameHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.smartGameKicker}>JEU INTELLIGENT · {activeGame.countryName?.toUpperCase()}</Text>
              <Text style={styles.smartGameTitle}>{activeGame.label} en couverture</Text>
            </View>
            <Text style={styles.smartGamePodium}>{activeGame.podium} à l’arrivée</Text>
          </View>
          <Text style={styles.help}>
            Sélection conseillée : {activeGame.recommendedSelectionSize} chevaux, soit {activeGame.recommendedCombinations} combinaison{activeGame.recommendedCombinations > 1 ? 's' : ''}.
            {activeGame.recommendedCost != null ? ` Budget complet : ${activeGame.recommendedCost.toLocaleString('fr-FR')} FCFA.` : ''}
          </Text>
          <View style={styles.smartNumbers}>
            {smartSelection.map((horse, index) => (
              <View key={horse.number} style={[styles.smartNumber, index < activeGame.podium && styles.smartNumberPodium]}>
                <Text style={styles.smartNumberText}>{horse.number}</Text>
              </View>
            ))}
          </View>
          {!!currentCouples.length && (
            <View style={styles.smartCouples}>
              {currentCouples.map((ticket) => (
                <View key={ticket.id} style={styles.smartCouple}>
                  <Text style={styles.smartCoupleLabel}>{ticket.label}</Text>
                  <Text style={styles.smartCoupleNumbers}>
                    {(ticket.horses || []).map((horse) => horse.number).join(' – ')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>La base</Text>
      {insights.bases.map((horse) => <HorseLine key={horse.number} horse={horse} accent={COLORS.accent} />)}

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Pronostic final · {insights.format.label}</Text>
      <Text style={styles.help}>
        Le podium attendu + 2 chevaux complémentaires, soit {activeGame?.recommendedSelectionSize || insights.selectionSize} chevaux au maximum.
      </Text>
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
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summary: { flexDirection: 'row', gap: SPACING.md, alignItems: 'center' },
  eyebrow: { color: COLORS.accent, fontSize: FONT.sm - 1, fontWeight: '900', letterSpacing: 1 },
  confidence: { color: COLORS.gold, fontSize: FONT.xl, letterSpacing: 2, marginTop: 3 },
  confidenceLabel: { color: COLORS.text, fontWeight: '900', fontSize: FONT.lg },
  reason: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 3, lineHeight: 18 },
  smartGame: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.38)',
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(251,191,36,0.08)',
  },
  smartGameHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  smartGameKicker: { color: COLORS.gold, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  smartGameTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginTop: 2 },
  smartGamePodium: { color: COLORS.gold, fontSize: 10, fontWeight: '900' },
  smartNumbers: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  smartNumber: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.info,
    borderRadius: 17,
    backgroundColor: 'rgba(56,189,248,0.12)',
  },
  smartNumberPodium: { borderColor: COLORS.accent, backgroundColor: 'rgba(16,185,129,0.15)' },
  smartNumberText: { color: COLORS.text, fontWeight: '900' },
  smartCouples: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm },
  smartCouple: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
  },
  smartCoupleLabel: { color: COLORS.textMuted, fontSize: 8, fontWeight: '800' },
  smartCoupleNumbers: { color: COLORS.accent, fontSize: 11, fontWeight: '900', marginTop: 2 },
  selectionCount: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  selectionCountValue: { color: COLORS.onAccent, fontSize: FONT.xxl, fontWeight: '900' },
  selectionCountLabel: { color: COLORS.onAccent, fontSize: FONT.sm - 1, fontWeight: '800' },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.md },
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
  rulesUnavailable: { borderColor: 'rgba(251,191,36,0.55)', backgroundColor: 'rgba(251,191,36,0.08)' },
  rulesUnavailableHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  rulesUnavailableTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900' },
  rulesUnavailableText: { color: COLORS.textMuted, fontSize: FONT.sm, lineHeight: 19, marginTop: SPACING.sm },
});
