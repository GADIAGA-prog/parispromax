import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../context/AuthContext';
import { PLANS, fmtXOF } from '../services/plans';
import api from '../services/api';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// The actual Mobile Money operators shown depend on the user's country and are
// presented on the secure FedaPay page after tapping "Payer".
const COUNTRY_NAMES = {
  bf: 'Burkina Faso', ci: "Côte d'Ivoire", sn: 'Sénégal', tg: 'Togo',
  bj: 'Bénin', cg: 'Congo-Brazzaville',
};

// Certains opérateurs ne poussent pas de notification : le client doit composer
// un code USSD pour valider. Ces rappels complètent le message du prestataire.
const USSD_HINTS = {
  ORANGE: 'Sur Orange Money, composez *144*4*6*<montant># puis validez avec votre code secret.',
  MOOV: 'Sur Moov Money, composez *555# puis validez le paiement en attente avec votre code secret.',
};

const PERKS = [
  'Top 3 pronostics IA sur toutes les courses',
  'Value Bets & Records Chrono illimités',
  'Combinaisons Quinté+ optimisées par l’IA',
  'Alertes avant chaque départ',
  'Mode hors-ligne complet',
];

export default function PaywallScreen({ navigation }) {
  const { refreshAccess, country, phone } = useAuth();
  const [planId, setPlanId] = useState('monthly');
  const [providers, setProviders] = useState([]);
  const [providerId, setProviderId] = useState(null);
  const [processing, setProcessing] = useState(false);
  // FeexPay mobile money — saisie in-app (opérateur + numéro).
  const [operators, setOperators] = useState([]);
  const [network, setNetwork] = useState(null);
  const [mmPhone, setMmPhone] = useState('');

  const plan = PLANS.find((p) => p.id === planId);
  const countryName = COUNTRY_NAMES[country] || 'votre pays';
  const providerLabel = providers.find((p) => p.id === providerId)?.label || 'notre partenaire';
  const isFeex = providerId === 'feexpay';

  // Load the payment providers actually available (FedaPay / CinetPay).
  useEffect(() => {
    let cancelled = false;
    api
      .paymentProviders()
      .then((d) => {
        if (cancelled) return;
        const list = d.providers || [];
        setProviders(list);
        setProviderId(d.default && list.some((p) => p.id === d.default)
          ? d.default
          : list[0]?.id || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // When FeexPay is selected, load the mobile-money operators for the user's
  // country and prefill the phone with the account number.
  useEffect(() => {
    if (!isFeex) return;
    let cancelled = false;
    setMmPhone((v) => v || String(phone || '').replace(/[^\d+]/g, ''));
    api
      .feexpayOperators(country)
      .then((d) => {
        if (cancelled) return;
        const ops = d.operators || [];
        setOperators(ops);
        setNetwork((n) => (ops.includes(n) ? n : ops[0] || null));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isFeex, country, phone]);

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
      const init = await api.initiatePayment(planId, providerId);
      await WebBrowser.openBrowserAsync(init.paymentUrl);
      // Le webhook peut mettre du temps ; on re-vérifie côté serveur ~60 s.
      const status = await pollStatus(init.transactionId, 24);
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

  // FeexPay mobile money — paiement DIRECT : FeexPay pousse une demande de
  // confirmation sur le téléphone. Pas de page à ouvrir ; on suit par polling.
  const onPayFeexMobile = async () => {
    if (!network) return Alert.alert('Opérateur requis', 'Choisissez votre opérateur Mobile Money.');
    const num = String(mmPhone || '').replace(/[^\d+]/g, '');
    if (num.replace(/\D/g, '').length < 8) {
      return Alert.alert('Numéro invalide', 'Entrez le numéro de votre compte Mobile Money.');
    }
    setProcessing(true);
    try {
      const res = await api.feexpayMobile({ planId, phone: num, network, country });
      if (res.status === 'success') {
        await refreshAccess();
        return Alert.alert('Paiement confirmé ✅', 'Votre abonnement est actif. Bonne chance !', [
          { text: 'Super !', onPress: () => navigation.goBack() },
        ]);
      }

      // Trois cas : page de validation à ouvrir (Wave CI…), instruction de
      // l'opérateur (Orange/Moov BF : code USSD à composer), ou notification
      // poussée sur le téléphone (MTN, Moov Bénin…).
      if (res.paymentUrl) {
        await WebBrowser.openBrowserAsync(res.paymentUrl);
      } else if (res.mode === 'mock') {
        Alert.alert(
          '🧪 MODE TEST — paiement simulé',
          "Aucun argent réel : le serveur est en mode test (pas de clés FeexPay). Le paiement sera validé automatiquement dans quelques secondes."
        );
      } else {
        Alert.alert(
          'Validez votre paiement 📲',
          [
            res.providerMessage,
            USSD_HINTS[network] || `Confirmez la demande ${network} reçue sur le ${num}.`,
            'Revenez ensuite ici : votre abonnement s’activera automatiquement.',
          ]
            .filter(Boolean)
            .join('\n\n')
        );
      }
      const status = await pollStatus(res.transactionId, 48); // ~2 min
      if (status === 'success') {
        await refreshAccess();
        Alert.alert('Paiement confirmé ✅', 'Votre abonnement est actif. Bonne chance !', [
          { text: 'Super !', onPress: () => navigation.goBack() },
        ]);
      } else if (status === 'pending') {
        Alert.alert('Paiement en attente', "Si vous avez validé, votre accès s'activera sous peu (rafraîchissez le profil).");
      } else {
        Alert.alert('Paiement non abouti', 'Le paiement a échoué, expiré ou a été refusé. Réessayez.');
      }
    } catch (e) {
      // `reason` = message de validation renvoyé par FeexPay (numéro invalide,
      // opérateur indisponible…). Bien plus utile qu'un message générique.
      const reason = e.data?.reason;
      Alert.alert(
        'Paiement impossible',
        reason
          ? `${reason}\n\nVérifiez votre numéro et votre opérateur, puis réessayez.`
          : "Impossible de lancer le paiement Mobile Money. Vérifiez le numéro et réessayez."
      );
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

        {/* Provider choice — only when more than one is available */}
        {providers.length > 1 && (
          <>
            <Text style={styles.sectionTitle}>Prestataire de paiement</Text>
            {providers.map((pr) => {
              const active = pr.id === providerId;
              return (
                <Pressable
                  key={pr.id}
                  style={[styles.provider, active && styles.providerActive]}
                  onPress={() => setProviderId(pr.id)}
                >
                  <Ionicons name="wallet" size={20} color={active ? COLORS.accent : COLORS.textFaint} />
                  <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                    <Text style={styles.providerName}>{pr.label}</Text>
                    <Text style={styles.providerSub}>Mobile Money & cartes</Text>
                  </View>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? COLORS.accent : COLORS.textFaint}
                  />
                </Pressable>
              );
            })}
          </>
        )}

        {isFeex ? (
          /* FeexPay — saisie Mobile Money DANS l'app (paiement direct) */
          <>
            <Text style={styles.sectionTitle}>Votre Mobile Money ({countryName})</Text>
            <View style={styles.opRow}>
              {operators.map((op) => {
                const active = op === network;
                return (
                  <Pressable
                    key={op}
                    style={[styles.opChip, active && styles.opChipActive]}
                    onPress={() => setNetwork(op)}
                  >
                    <Text style={[styles.opChipText, active && styles.opChipTextActive]}>{op}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={styles.phoneInput}
              value={mmPhone}
              onChangeText={setMmPhone}
              placeholder="Numéro Mobile Money"
              placeholderTextColor={COLORS.textFaint}
              keyboardType="phone-pad"
            />
            <View style={styles.payInfo}>
              <Ionicons name="phone-portrait" size={18} color={COLORS.accent} />
              <Text style={styles.payInfoText}>
                Une demande de paiement sera envoyée sur votre téléphone.
                Validez-la avec votre code Mobile Money.
              </Text>
            </View>

            <Pressable
              style={[styles.payBtn, processing && { opacity: 0.7 }]}
              onPress={onPayFeexMobile}
              disabled={processing}
            >
              {processing ? (
                <ActivityIndicator color="#06251c" />
              ) : (
                <>
                  <Ionicons name="phone-portrait" size={18} color="#06251c" />
                  <Text style={styles.payText}>Payer {plan ? fmtXOF(plan.pricePromo) : ''}</Text>
                </>
              )}
            </Pressable>

            {/* Carte bancaire momentanément indisponible chez FeexPay (v2). */}
          </>
        ) : (
          /* Providers à page hébergée (FedaPay / CinetPay / PayDunya / LigdiCash) */
          <>
            <View style={styles.payInfo}>
              <Ionicons name="phone-portrait" size={18} color={COLORS.accent} />
              <Text style={styles.payInfoText}>
                Après « Payer », choisissez votre Mobile Money ({countryName}) sur la
                page sécurisée {providerLabel}.
              </Text>
            </View>

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
          </>
        )}

        <Text style={styles.secure}>🔒 Paiement sécurisé · Mobile Money & cartes</Text>
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
  payInfo: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  payInfoText: { color: COLORS.textMuted, fontSize: FONT.sm, flex: 1, lineHeight: 18 },
  provider: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  providerActive: { borderColor: COLORS.accent },
  providerName: { color: COLORS.text, fontWeight: '800', fontSize: FONT.md },
  providerSub: { color: COLORS.textFaint, fontSize: FONT.sm - 1, marginTop: 2 },
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
  opRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm },
  opChip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  opChipActive: { borderColor: COLORS.accent, backgroundColor: COLORS.surface },
  opChipText: { color: COLORS.textMuted, fontWeight: '800', fontSize: FONT.sm },
  opChipTextActive: { color: COLORS.accent },
  phoneInput: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, color: COLORS.text, fontSize: FONT.md,
    marginBottom: SPACING.sm,
  },
  cardLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.md, marginTop: SPACING.xs,
  },
  cardLinkText: { color: COLORS.textMuted, fontSize: FONT.sm, textDecorationLine: 'underline' },
});
