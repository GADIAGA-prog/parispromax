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
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../context/AuthContext';
import { PLANS, fmtXOF } from '../services/plans';
import api from '../services/api';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

const GATEWAYS = [
  { id: 'card', name: 'Carte bancaire', color: '#64748b', icon: 'card' },
  { id: 'orange-money', name: 'Orange Money', color: '#ff7900', icon: 'phone-portrait' },
  { id: 'mtn', name: 'MTN MoMo', color: '#ffcc00', icon: 'phone-portrait' },
  { id: 'wave', name: 'Wave', color: '#1dc3f2', icon: 'water' },
  { id: 'moov', name: 'Moov Money', color: '#0066b3', icon: 'phone-portrait' },
];

const PERKS = [
  'Top 3 pronostics IA sur toutes les courses',
  'Value Bets & Records Chrono illimités',
  'Combinaisons Quinté+ optimisées par l’IA',
  'Alertes avant chaque départ',
  'Mode hors-ligne complet',
];

export default function PaywallScreen({ navigation }) {
  const { refreshAccess } = useAuth();
  const [planId, setPlanId] = useState('monthly');
  const [gateway, setGateway] = useState(GATEWAYS[1].id);
  const [processing, setProcessing] = useState(false);

  const plan = PLANS.find((p) => p.id === planId);

  const pollStatus = async (txn, tries = 6) => {
    for (let i = 0; i < tries; i++) {
      try {
        const { status } = await api.paymentStatus(txn);
        if (status === 'success') return 'success';
        if (status === 'failed' || status === 'cancelled') return status;
      } catch (e) {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    return 'pending';
  };

  const onPay = async () => {
    setProcessing(true);
    try {
      const init = await api.initiatePayment(planId, gateway);
      await WebBrowser.openBrowserAsync(init.paymentUrl);
      const status = await pollStatus(init.transactionId);
      if (status === 'success') {
        await refreshAccess();
        Alert.alert('Paiement confirmé ✅', 'Votre abonnement est actif. Bonne chance !', [
          { text: 'Super !', onPress: () => navigation.goBack() },
        ]);
      } else if (status === 'pending') {
        Alert.alert('Paiement en cours', "Si vous avez payé, votre accès s'activera sous peu (rafraîchissez le profil).");
      } else {
        Alert.alert('Paiement non abouti', 'Le paiement a échoué ou a été annulé. Réessayez.');
      }
    } catch (e) {
      Alert.alert('Erreur', "Impossible de démarrer le paiement. Vérifiez votre connexion.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Ionicons name="diamond" size={36} color={COLORS.gold} />
          <Text style={styles.title}>Choisissez votre formule</Text>
          <Text style={styles.subtitle}>Sans engagement · Activation immédiate</Text>
        </View>

        {/* Plans */}
        {PLANS.map((p) => {
          const active = p.id === planId;
          const hasPromo = p.pricePromo < p.priceNormal;
          return (
            <Pressable
              key={p.id}
              style={[styles.plan, active && styles.planActive]}
              onPress={() => setPlanId(p.id)}
            >
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={active ? COLORS.accent : COLORS.textFaint}
              />
              <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                <Text style={styles.planLabel}>{p.label}</Text>
                <Text style={styles.planSub}>{p.sub}</Text>
              </View>
              <View style={styles.priceCol}>
                {hasPromo && <Text style={styles.priceStrike}>{fmtXOF(p.priceNormal)}</Text>}
                <Text style={styles.pricePromo}>{fmtXOF(p.pricePromo)}</Text>
                {hasPromo && (
                  <View style={styles.discount}>
                    <Text style={styles.discountText}>-{p.discount}%</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}

        {/* Perks */}
        <View style={styles.perks}>
          {PERKS.map((p) => (
            <View key={p} style={styles.perkRow}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.accent} />
              <Text style={styles.perkText}>{p}</Text>
            </View>
          ))}
        </View>

        {/* Payment method */}
        <Text style={styles.sectionTitle}>Moyen de paiement</Text>
        {GATEWAYS.map((g) => {
          const active = gateway === g.id;
          return (
            <Pressable key={g.id} style={[styles.gateway, active && styles.gatewayActive]} onPress={() => setGateway(g.id)}>
              <View style={[styles.gwIcon, { backgroundColor: g.color }]}>
                <Ionicons name={g.icon} size={16} color="#0f172a" />
              </View>
              <Text style={styles.gwName}>{g.name}</Text>
              <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={active ? COLORS.accent : COLORS.textFaint} />
            </Pressable>
          );
        })}

        <Pressable style={[styles.payBtn, processing && { opacity: 0.7 }]} onPress={onPay} disabled={processing}>
          {processing ? (
            <ActivityIndicator color="#06251c" />
          ) : (
            <>
              <Ionicons name="lock-open" size={18} color="#06251c" />
              <Text style={styles.payText}>Payer {plan ? fmtXOF(plan.pricePromo) : ''}</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.secure}>🔒 Paiement sécurisé via CinetPay (carte & mobile money)</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  hero: { alignItems: 'center', marginVertical: SPACING.md },
  title: { color: COLORS.text, fontSize: FONT.xl, fontWeight: '900', marginTop: SPACING.sm },
  subtitle: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 4 },
  plan: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  planActive: { borderColor: COLORS.accent },
  planLabel: { color: COLORS.text, fontWeight: '800', fontSize: FONT.md },
  planSub: { color: COLORS.textFaint, fontSize: FONT.sm - 1, marginTop: 2 },
  priceCol: { alignItems: 'flex-end' },
  priceStrike: { color: COLORS.textFaint, fontSize: FONT.sm - 1, textDecorationLine: 'line-through' },
  pricePromo: { color: COLORS.accent, fontWeight: '900', fontSize: FONT.md },
  discount: {
    backgroundColor: COLORS.gold, borderRadius: RADIUS.sm, paddingHorizontal: 6, paddingVertical: 1, marginTop: 2,
  },
  discountText: { color: '#06251c', fontWeight: '900', fontSize: FONT.sm - 3 },
  perks: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.border, marginVertical: SPACING.md,
  },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 4 },
  perkText: { color: COLORS.text, fontSize: FONT.sm, flex: 1 },
  sectionTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginBottom: SPACING.sm },
  gateway: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1.5, borderColor: COLORS.border,
  },
  gatewayActive: { borderColor: COLORS.accent },
  gwIcon: { width: 34, height: 34, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  gwName: { color: COLORS.text, fontSize: FONT.md, fontWeight: '700', flex: 1 },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: SPACING.md, marginTop: SPACING.lg,
  },
  payText: { color: '#06251c', fontWeight: '900', fontSize: FONT.lg },
  secure: { color: COLORS.textFaint, fontSize: FONT.sm, textAlign: 'center', marginTop: SPACING.md },
});
