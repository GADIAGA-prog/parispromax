import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { sendTestNotification } from '../services/NotificationService';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

export default function ProfileScreen({ navigation }) {
  const {
    phone,
    hasPaid,
    isTrialActive,
    hoursRemaining,
    logout,
    simulateDay1,
    simulateDay3,
  } = useAuth();
  const { currency, currencies, currencyCode, setCurrency } = useSettings();

  // The Dev Panel is hidden until the gear is tapped 5 times (discreet).
  const [taps, setTaps] = useState(0);
  const [devOpen, setDevOpen] = useState(false);

  const onGearTap = () => {
    const next = taps + 1;
    setTaps(next);
    if (next >= 5) setDevOpen(true);
  };

  const statusLabel = hasPaid
    ? 'VIP — Abonné'
    : isTrialActive
    ? `Essai gratuit · ${hoursRemaining}h restantes`
    : 'Essai expiré';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Mon profil</Text>
          <Pressable onPress={onGearTap} hitSlop={10}>
            <Ionicons name="settings-outline" size={22} color={COLORS.textMuted} />
          </Pressable>
        </View>

        {/* Account card */}
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={28} color={COLORS.accent} />
          </View>
          <Text style={styles.phone}>{phone ? `+${phone}` : 'Invité'}</Text>
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: hasPaid
                  ? COLORS.gold
                  : isTrialActive
                  ? COLORS.accent
                  : COLORS.danger,
              },
            ]}
          >
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
        </View>

        {/* Actions */}
        {!hasPaid && (
          <Pressable style={styles.action} onPress={() => navigation.navigate('Paywall')}>
            <Ionicons name="diamond" size={20} color={COLORS.gold} />
            <Text style={styles.actionText}>
              Passer VIP — {currency.price.toLocaleString('fr-FR')} {currency.symbol} / mois
            </Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </Pressable>
        )}

        <Pressable
          style={styles.action}
          onPress={async () => {
            const ok = await sendTestNotification();
            if (!ok) {
              Alert.alert(
                'Notifications',
                "Les notifications fonctionnent dans l'app installée (APK). Indisponibles dans Expo Go depuis le SDK 53."
              );
            }
          }}
        >
          <Ionicons name="notifications" size={20} color={COLORS.accent} />
          <Text style={styles.actionText}>Tester une notification</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </Pressable>

        {/* Currency selector */}
        <Text style={styles.sectionLabel}>Devise</Text>
        <View style={styles.currencyRow}>
          {Object.values(currencies).map((c) => {
            const active = c.code === currencyCode;
            return (
              <Pressable
                key={c.code}
                style={[styles.currencyChip, active && styles.currencyChipActive]}
                onPress={() => setCurrency(c.code)}
              >
                <Text style={[styles.currencyChipText, active && { color: '#06251c' }]}>
                  {c.symbol}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.action} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
          <Text style={[styles.actionText, { color: COLORS.danger }]}>Se déconnecter</Text>
        </Pressable>

        {/* Discreet Dev Panel */}
        {devOpen && (
          <View style={styles.devPanel}>
            <View style={styles.devHead}>
              <Ionicons name="construct" size={16} color={COLORS.gold} />
              <Text style={styles.devTitle}>Dev Panel</Text>
            </View>
            <Text style={styles.devHint}>
              Simulez l'état de l'essai pour tester la mise en page réactive.
            </Text>
            <Pressable
              style={[styles.devBtn, { backgroundColor: COLORS.accent }]}
              onPress={simulateDay1}
            >
              <Text style={styles.devBtnText}>Simulate Day 1 (Trial Active)</Text>
            </Pressable>
            <Pressable
              style={[styles.devBtn, { backgroundColor: COLORS.danger }]}
              onPress={simulateDay3}
            >
              <Text style={[styles.devBtnText, { color: '#fff' }]}>
                Simulate Day 3 (Trial Expired)
              </Text>
            </Pressable>
          </View>
        )}

        {!devOpen && (
          <Text style={styles.version}>ParisPromax v1.0.0</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900' },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  phone: { color: COLORS.text, fontSize: FONT.xl, fontWeight: '900' },
  statusPill: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  statusText: { color: '#06251c', fontWeight: '800', fontSize: FONT.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionText: { color: COLORS.text, fontSize: FONT.md, fontWeight: '700', flex: 1 },
  sectionLabel: {
    color: COLORS.textMuted,
    fontSize: FONT.sm,
    fontWeight: '700',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  currencyRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm, flexWrap: 'wrap' },
  currencyChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    minWidth: 56,
    alignItems: 'center',
  },
  currencyChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  currencyChipText: { color: COLORS.text, fontWeight: '800', fontSize: FONT.sm },
  devPanel: {
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  devHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  devTitle: { color: COLORS.gold, fontWeight: '900', fontSize: FONT.md },
  devHint: { color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.md },
  devBtn: {
    borderRadius: RADIUS.sm,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  devBtnText: { color: '#06251c', fontWeight: '900', fontSize: FONT.md },
  version: { color: COLORS.textFaint, textAlign: 'center', marginTop: SPACING.xl, fontSize: FONT.sm },
});
