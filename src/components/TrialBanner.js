import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getPlan } from '../services/plans';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// Subscription status banner (no free trial).
// - Subscribed -> gold VIP banner with plan + expiry
// - Not subscribed -> call-to-subscribe banner
export default function TrialBanner() {
  const { hasPaid, plan, paidUntil } = useAuth();

  if (hasPaid) {
    const p = getPlan(plan);
    const until = paidUntil ? new Date(paidUntil).toLocaleDateString('fr-FR') : null;
    return (
      <View style={[styles.banner, styles.paid]}>
        <Text style={styles.text}>
          👑 Abonnement {p ? p.label : 'VIP'} actif{until ? ` — jusqu'au ${until}` : ''}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.cta]}>
      <Text style={styles.text}>
        🔒 Abonnez-vous pour débloquer tous les pronostics IA
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.sm,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
  },
  paid: { backgroundColor: COLORS.gold },
  cta: { backgroundColor: COLORS.accent },
  text: {
    color: '#06251c',
    fontWeight: '800',
    fontSize: FONT.sm + 1,
    textAlign: 'center',
  },
});
