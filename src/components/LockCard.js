import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// Premium content is never mounted for locked users. A blurred copy would still
// expose the real values in the React tree and accessibility snapshot.
export default function LockCard({ locked, onUnlockPress, children, label }) {
  if (!locked) return <>{children}</>;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.overlay}
        onPress={onUnlockPress}
        android_ripple={{ color: 'rgba(16,185,129,0.2)' }}
      >
        <Ionicons name="lock-closed" size={28} color={COLORS.gold} />
        <Text style={styles.title}>{label || 'Contenu VIP verrouillé'}</Text>
        <Text style={styles.subtitle}>
          Abonnez-vous pour débloquer les pronostics IA, Value Bets & Chronos.
        </Text>
        <View style={styles.cta}>
          <Ionicons name="diamond" size={14} color="#06251c" />
          <Text style={styles.ctaText}>Voir les abonnements</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    minHeight: 220,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    backgroundColor: 'rgba(15,23,42,0.92)',
  },
  title: {
    color: COLORS.text,
    fontSize: FONT.lg,
    fontWeight: '900',
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: FONT.sm,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: SPACING.md,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.gold,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill,
  },
  ctaText: {
    color: '#06251c',
    fontWeight: '900',
    fontSize: FONT.sm,
  },
});
