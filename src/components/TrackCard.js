import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from './PressableScale';
import { COLORS, SPACING, RADIUS, FONT, TRACK_CONDITIONS } from '../theme/colors';

function formatXOF(amount) {
  if (amount == null) return '—';
  return amount.toLocaleString('fr-FR') + ' XOF';
}

// A racetrack (hippodrome) summary card with its races. Tapping a race calls
// onRacePress(track, race).
export default function TrackCard({ track, onRacePress }) {
  const cond = TRACK_CONDITIONS[track.condition] || TRACK_CONDITIONS.dry;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{track.name}</Text>
          <Text style={styles.discipline}>{track.discipline}</Text>
        </View>
        <View style={[styles.condition, { backgroundColor: cond.color }]}>
          <Ionicons name={cond.icon} size={13} color="#0f172a" />
          <Text style={styles.conditionText}>{cond.label}</Text>
        </View>
      </View>

      <View style={styles.prizeRow}>
        <Ionicons name="trophy" size={14} color={COLORS.gold} />
        <Text style={styles.prize}>Dotation : {formatXOF(track.prizePool)}</Text>
      </View>

      {track.races.map((race) => (
        <PressableScale
          key={race.id}
          style={styles.race}
          onPress={() => onRacePress?.(track, race)}
        >
          <View style={styles.raceNumber}>
            <Text style={styles.raceNumberText}>{race.number}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.raceName} numberOfLines={1}>
              {race.name}
            </Text>
            <Text style={styles.raceMeta} numberOfLines={1}>
              {race.time ? `🕐 ${race.time} · ` : ''}
              {race.type ? `${race.type} · ` : ''}
              {race.distance ? `${race.distance} · ` : ''}
              {race.runners || race.horses?.length} partants
              {race.prize ? ` · ${Number(race.prize).toLocaleString('fr-FR')} €` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    color: COLORS.text,
    fontSize: FONT.xl,
    fontWeight: '900',
  },
  discipline: {
    color: COLORS.accent,
    fontSize: FONT.sm,
    fontWeight: '700',
    marginTop: 2,
  },
  condition: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  conditionText: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: FONT.sm - 1,
  },
  prizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  prize: {
    color: COLORS.textMuted,
    fontSize: FONT.sm,
    fontWeight: '600',
  },
  race: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.sm,
  },
  raceNumber: {
    width: 38,
    height: 30,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  raceNumberText: {
    color: COLORS.accent,
    fontWeight: '900',
    fontSize: FONT.sm,
  },
  raceName: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: FONT.md,
  },
  raceMeta: {
    color: COLORS.textFaint,
    fontSize: FONT.sm - 1,
    marginTop: 2,
  },
});
