import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

const GATEWAYS = [
  { id: 'orange', name: 'Orange Money', color: '#ff7900', icon: 'phone-portrait' },
  { id: 'mtn', name: 'MTN MoMo', color: '#ffcc00', icon: 'phone-portrait' },
  { id: 'wave', name: 'Wave', color: '#1dc3f2', icon: 'water' },
  { id: 'moov', name: 'Moov Money', color: '#0066b3', icon: 'phone-portrait' },
];

const PERKS = [
  'Top 3 pronostics IA sur toutes les courses',
  'Value Bets & Records Chrono illimités',
  'Combinaisons Quinté+ (74% de réussite)',
  'Alertes push avant chaque départ',
  'Mode hors-ligne complet',
];

export default function PaywallScreen({ navigation }) {
  const { subscribe } = useAuth();
  const { currency } = useSettings();
  const priceLabel = `${currency.price.toLocaleString('fr-FR')} ${currency.symbol}`;
  const [selected, setSelected] = useState(GATEWAYS[0].id);
  const [processing, setProcessing] = useState(false);

  const onPay = async () => {
    setProcessing(true);
    // Simulate a Mobile Money transaction round-trip.
    setTimeout(async () => {
      await subscribe();
      setProcessing(false);
      Alert.alert(
        'Paiement confirmé ✅',
        'Votre abonnement VIP est actif. Bonne chance sur les courses !',
        [{ text: 'Super !', onPress: () => navigation.goBack() }]
      );
    }, 1500);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Ionicons name="diamond" size={40} color={COLORS.gold} />
          <Text style={styles.title}>Passez VIP</Text>
          <Text style={styles.price}>
            {priceLabel}
            <Text style={styles.per}> / mois</Text>
          </Text>
          <Text style={styles.subtitle}>Sans engagement · Résiliable à tout moment</Text>
        </View>

        <View style={styles.perks}>
          {PERKS.map((p) => (
            <View key={p} style={styles.perkRow}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
              <Text style={styles.perkText}>{p}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Choisissez votre moyen de paiement</Text>
        {GATEWAYS.map((g) => {
          const active = selected === g.id;
          return (
            <Pressable
              key={g.id}
              style={[styles.gateway, active && styles.gatewayActive]}
              onPress={() => setSelected(g.id)}
            >
              <View style={[styles.gwIcon, { backgroundColor: g.color }]}>
                <Ionicons name={g.icon} size={18} color="#0f172a" />
              </View>
              <Text style={styles.gwName}>{g.name}</Text>
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={active ? COLORS.accent : COLORS.textFaint}
              />
            </Pressable>
          );
        })}

        <Pressable
          style={[styles.payBtn, processing && { opacity: 0.7 }]}
          onPress={onPay}
          disabled={processing}
        >
          {processing ? (
            <ActivityIndicator color="#06251c" />
          ) : (
            <>
              <Ionicons name="lock-open" size={18} color="#06251c" />
              <Text style={styles.payText}>Payer {priceLabel}</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.secure}>
          🔒 Paiement sécurisé via Mobile Money (simulation)
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  hero: { alignItems: 'center', marginVertical: SPACING.lg },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900', marginTop: SPACING.sm },
  price: { color: COLORS.gold, fontSize: 30, fontWeight: '900', marginTop: SPACING.sm },
  per: { color: COLORS.textMuted, fontSize: FONT.md, fontWeight: '600' },
  subtitle: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 4 },
  perks: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 6 },
  perkText: { color: COLORS.text, fontSize: FONT.md, flex: 1 },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT.lg,
    fontWeight: '900',
    marginBottom: SPACING.sm,
  },
  gateway: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  gatewayActive: { borderColor: COLORS.accent },
  gwIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gwName: { color: COLORS.text, fontSize: FONT.md, fontWeight: '700', flex: 1 },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    marginTop: SPACING.lg,
  },
  payText: { color: '#06251c', fontWeight: '900', fontSize: FONT.lg },
  secure: { color: COLORS.textFaint, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.md },
});
