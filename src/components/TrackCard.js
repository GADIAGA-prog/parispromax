import React, { useEffect, useState } from 'react';
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
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const raceState = (race) => {
    const start = race.startsAt ? new Date(race.startsAt).getTime() : NaN;
    if (!Number.isFinite(start)) return { kind: 'future', label: null };
    const minutes = Math.ceil((start - now) / 60000);
    if (minutes <= 0) return { kind: 'past', label: race.result ? 'Voir le résultat' : 'Terminée' };
    if (minutes <= 60) return { kind: 'soon', label: `Départ dans ${minutes} min` };
    return { kind: 'future', label: null };
  };

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

      {track.races.map((race) => {
        const state = raceState(race);
        return (
        <PressableScale
          key={race.id}
          style={[styles.race, styles[`race_${state.kind}`]]}
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
            {state.label ? (
              <View style={[styles.stateBadge, styles[`badge_${state.kind}`]]}>
                <Ionicons
                  name={state.kind === 'soon' ? 'alarm' : race.result ? 'flag' : 'time'}
                  size={12}
                  color={state.kind === 'soon' ? '#78350f' : COLORS.textMuted}
                />
                <Text style={[styles.stateText, state.kind === 'soon' && styles.stateTextSoon]}>
                  {state.label}
                </Text>
              </View>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
        </PressableScale>
        );
      })}
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
  race_future: { backgroundColor: 'transparent' },
  race_soon: {
    backgroundColor: 'rgba(251,191,36,0.14)', borderLeftWidth: 3,
    borderLeftColor: COLORS.gold, paddingHorizontal: SPACING.sm,
  },
  race_past: { backgroundColor: 'rgba(148,163,184,0.08)', opacity: 0.78 },
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
  stateBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4,
    marginTop: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: RADIUS.pill,
  },
  badge_soon: { backgroundColor: COLORS.gold },
  badge_past: { backgroundColor: 'rgba(148,163,184,0.18)' },
  badge_future: { backgroundColor: 'transparent' },
  stateText: { color: COLORS.textMuted, fontSize: FONT.sm - 2, fontWeight: '800' },
  stateTextSoon: { color: '#78350f' },
});
