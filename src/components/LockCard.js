import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// Wraps premium content. When `locked` is true, the children are blurred and
// an interactive lock overlay redirects the user to the Paywall.
export default function LockCard({ locked, onUnlockPress, children, label }) {
  const { currency } = useSettings();
  if (!locked) return <>{children}</>;

  return (
    <View style={styles.wrap}>
      {/* The real content, rendered underneath but obscured. */}
      <View style={styles.hidden} pointerEvents="none">
        {children}
      </View>

      {/* Blur + lock overlay. */}
      <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
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
          <Text style={styles.ctaText}>
            Débloquer — {currency.price.toLocaleString('fr-FR')} {currency.symbol} / mois
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  hidden: {
    opacity: 0.5,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    backgroundColor: 'rgba(15,23,42,0.55)',
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
