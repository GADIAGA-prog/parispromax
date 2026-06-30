import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AIBadgeRow } from './AIBadge';
import { confidenceLabel } from '../services/aiEngine';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// Colors for the bib-number circle, by rank/number (classic racing silks feel).
const NUMBER_COLORS = [
  '#ef4444', '#3b82f6', '#ffffff', '#fbbf24', '#22c55e',
  '#000000', '#ec4899', '#f97316', '#14b8a6', '#a855f7',
];

function numberColor(n) {
  const c = NUMBER_COLORS[(n - 1) % NUMBER_COLORS.length];
  return c;
}

// Racing card for one runner. `showAI` controls whether AI score/badges show.
export default function HorseCard({ horse, showAI = true }) {
  const bg = numberColor(horse.number);
  const darkText = bg === '#ffffff' || bg === '#fbbf24' || bg === '#22c55e';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {/* Bib number circle */}
        <View style={[styles.circle, { backgroundColor: bg }]}>
          <Text style={[styles.circleText, { color: darkText ? '#0f172a' : '#fff' }]}>
            {horse.number}
          </Text>
        </View>

        {/* Name + meta */}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {horse.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {horse.jockey ? `🏇 ${horse.jockey}` : ''}
            {horse.form ? `   ·   ${horse.form}` : ''}
          </Text>
          {showAI && <AIBadgeRow badges={horse.badges} />}
        </View>

        {/* Odds + AI score */}
        <View style={styles.right}>
          <Text style={styles.oddsLabel}>Cote</Text>
          <Text style={styles.odds}>{horse.odds != null ? horse.odds.toFixed(1) : '—'}</Text>
          {showAI && horse.aiScore != null && (
            <View style={styles.scorePill}>
              <Ionicons name="sparkles" size={11} color={COLORS.accent} />
              <Text style={styles.scoreText}>{Math.round(horse.aiScore)}</Text>
            </View>
          )}
        </View>
      </View>

      {showAI && horse.aiScore != null && (
        <Text style={styles.confidence}>IA : {confidenceLabel(horse.aiScore)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    marginRight: SPACING.md,
  },
  circleText: {
    fontWeight: '900',
    fontSize: FONT.lg,
  },
  info: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  name: {
    color: COLORS.text,
    fontWeight: '800',
    fontSize: FONT.lg,
  },
  meta: {
    color: COLORS.textMuted,
    fontSize: FONT.sm,
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    minWidth: 52,
  },
  oddsLabel: {
    color: COLORS.textFaint,
    fontSize: FONT.sm - 2,
    textTransform: 'uppercase',
  },
  odds: {
    color: COLORS.text,
    fontWeight: '900',
    fontSize: FONT.xl,
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    backgroundColor: 'rgba(16,185,129,0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
  },
  scoreText: {
    color: COLORS.accent,
    fontWeight: '800',
    fontSize: FONT.sm,
  },
  confidence: {
    color: COLORS.textFaint,
    fontSize: FONT.sm - 1,
    marginTop: SPACING.sm,
  },
});
