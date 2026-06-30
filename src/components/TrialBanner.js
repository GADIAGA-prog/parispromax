import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// Persistent banner shown at the top of premium screens.
// - Trial active   -> green countdown ("X heures restantes")
// - Subscribed     -> gold VIP banner
// - Expired        -> red lockdown notice
export default function TrialBanner() {
  const { isTrialActive, hoursRemaining, hasPaid } = useAuth();

  if (hasPaid) {
    return (
      <View style={[styles.banner, styles.paid]}>
        <Text style={styles.text}>
          👑 Abonnement VIP Actif — Accès illimité aux pronostics IA
        </Text>
      </View>
    );
  }

  if (isTrialActive) {
    return (
      <View style={[styles.banner, styles.active]}>
        <Text style={styles.text}>
          🔥 Essai Gratuit Actif : Il vous reste {hoursRemaining}{' '}
          {hoursRemaining > 1 ? 'heures' : 'heure'} pour profiter des pronostics
          VIP !
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.expired]}>
      <Text style={styles.text}>
        ⛔ Essai terminé — Abonnez-vous pour débloquer les pronostics IA
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
  active: {
    backgroundColor: COLORS.accent,
  },
  paid: {
    backgroundColor: COLORS.gold,
  },
  expired: {
    backgroundColor: COLORS.danger,
  },
  text: {
    color: '#06251c',
    fontWeight: '800',
    fontSize: FONT.sm + 1,
    textAlign: 'center',
  },
});
