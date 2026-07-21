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
import { countryByCode } from '../services/countries';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

function yengaPaymentHelp(country, operator, amount) {
  const op = String(operator || '').toUpperCase();
  if (op === 'ORANGE' && country === 'bf') {
    return `Composez *144*4*6*${amount}# depuis le numéro Orange Money, validez avec votre code secret, puis saisissez ici l’OTP reçu.`;
  }
  if (op === 'ORANGE') {
    return `Depuis le numéro Orange Money, ouvrez le menu USSD ou l’application Orange Money, choisissez le paiement en ligne et générez un OTP de ${fmtXOF(amount)}.`;
  }
  if (op === 'CORISM' || op === 'SANKM') {
    return `Appuyez sur « Recevoir le code OTP ». ${op === 'CORISM' ? 'Coris Money' : 'Sank Money'} enverra ensuite le code par SMS au numéro indiqué.`;
  }
  if (op === 'MOOV') {
    return 'Aucun OTP à saisir dans ParisPromax : validez la demande Moov Money reçue sur votre téléphone.';
  }
  if (op === 'TELECEL') {
    return 'Générez votre code de paiement depuis le menu ou l’application Telecel Money, puis saisissez cet OTP ici. Ne saisissez jamais votre code PIN secret.';
  }
  if (op === 'MTN') {
    return 'Aucun OTP à générer ici : validez la demande MTN MoMo reçue sur votre téléphone.';
  }
  return 'Suivez la demande envoyée par votre opérateur sur le téléphone associé au compte Mobile Money.';
}

const PERKS = [
  'Synthèse de course : forme, piste et indice de confiance',
  'Sélections hiérarchisées : bases, chances, outsiders et regret',
  '7 chevaux proposés pour le Quinté+ et pronostics sur toutes les courses',
  'Tuyaux utiles : déferrage, associations et chevaux à surveiller',
  'Alertes de départ, résultats officiels et portefeuille de suivi',
];

export default function PaywallScreen({ navigation }) {
  const { refreshAccess, country, phone, referral } = useAuth();
  const [planId, setPlanId] = useState('monthly');
  const [providers, setProviders] = useState([]);
  const [providerId, setProviderId] = useState(null);
  const [processing, setProcessing] = useState(false);
  // FeexPay mobile money — saisie in-app (opérateur + numéro).
  const [operators, setOperators] = useState([]);
  const [operatorDetails, setOperatorDetails] = useState([]);
  const [otpNetworks, setOtpNetworks] = useState([]);
  const [otpRequestNetworks, setOtpRequestNetworks] = useState([]);
  const [redirectNetworks, setRedirectNetworks] = useState([]);
  const [network, setNetwork] = useState(null);
  const [mmPhone, setMmPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [yengaPendingTxn, setYengaPendingTxn] = useState(null);

  const plan = PLANS.find((p) => p.id === planId);
  const referralPrice = (p) => referral?.firstPaymentEligible
    ? Math.max(200, p.pricePromo - Math.round(p.pricePromo * referral.discountPercent / 100))
    : p.pricePromo;
  const countryName = countryByCode(country)?.name || 'votre pays';
  const providerLabel = providers.find((p) => p.id === providerId)?.label || 'notre partenaire';
  const isFeex = providerId === 'feexpay';
  const isYenga = providerId === 'yengapay';

  // Load the payment providers actually available (FedaPay / CinetPay).
  useEffect(() => {
    let cancelled = false;
    api
      .paymentProviders(country)
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
  }, [country]);

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
        setOperatorDetails([]);
        setOtpNetworks(d.otpRequired || []);
        setOtpRequestNetworks([]);
        setRedirectNetworks(d.redirectRequired || []);
        setNetwork((n) => (ops.includes(n) ? n : ops[0] || null));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isFeex, country, phone]);

  useEffect(() => {
    if (!isYenga) return;
    let cancelled = false;
    setMmPhone((v) => v || String(phone || '').replace(/[^\d+]/g, ''));
    api.yengapayOperators(country)
      .then((d) => {
        if (cancelled) return;
        const ops = d.operators || [];
        setOperators(ops);
        setOperatorDetails(d.operatorDetails || []);
        setOtpNetworks(d.otpRequired || []);
        setOtpRequestNetworks(d.otpRequestRequired || []);
        setRedirectNetworks([]);
        setYengaPendingTxn(null);
        setOtp('');
        setNetwork((n) => (ops.includes(n) ? n : ops[0] || null));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isYenga, country, phone]);

  useEffect(() => {
    setYengaPendingTxn(null);
    setOtp('');
  }, [planId]);

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

  // FeexPay mobile money : certains opérateurs poussent une demande sur le
  // téléphone, tandis qu'Orange/Moov BF poursuivent sur une page FeexPay.
  const needsOtp = otpNetworks.includes(network);
  const needsServerOtp = isYenga && otpRequestNetworks.includes(network);
  const needsRedirect = redirectNetworks.includes(network);

  const onPayFeexMobile = async () => {
    if (!network) return Alert.alert('Opérateur requis', 'Choisissez votre opérateur Mobile Money.');
    const num = String(mmPhone || '').replace(/[^\d+]/g, '');
    if (num.replace(/\D/g, '').length < 8) {
      return Alert.alert('Numéro invalide', 'Entrez le numéro de votre compte Mobile Money.');
    }
    if (needsOtp && otp.trim().length < 4) {
      return Alert.alert('Code OTP requis', `${network} exige un code de validation. Obtenez-le sur votre téléphone puis saisissez-le.`);
    }
    setProcessing(true);
    try {
      const res = await api.feexpayMobile({ planId, phone: num, network, country, otp: otp.trim() });
      if (res.status === 'success') {
        await refreshAccess();
        return Alert.alert('Paiement confirmé ✅', 'Votre abonnement est actif. Bonne chance !', [
          { text: 'Super !', onPress: () => navigation.goBack() },
        ]);
      }

      // Trois cas : page FeexPay à ouvrir, simulation locale, ou notification
      // poussée sur le téléphone (MTN, Moov Bénin…).
      if (res.paymentUrl) {
        await WebBrowser.openBrowserAsync(res.paymentUrl, {
          showTitle: true,
          enableBarCollapsing: false,
        });
      } else if (res.mode === 'mock') {
        Alert.alert(
          '🧪 MODE TEST — paiement simulé',
          "Aucun argent réel : le serveur est en mode test (pas de clés FeexPay). Le paiement sera validé automatiquement dans quelques secondes."
        );
      } else if (res.redirectExpected || needsRedirect) {
        Alert.alert(
          'Redirection FeexPay indisponible',
          [
            res.providerMessage,
            "FeexPay n’a pas fourni la page sécurisée attendue pour cet opérateur. Aucun code PIN ne doit être saisi dans ParisPromax.",
            'Veuillez réessayer plus tard ou choisir un autre réseau.',
          ]
            .filter(Boolean)
            .join('\n\n')
        );
        return;
      } else {
        // On n'invente AUCUNE instruction : seul le message du prestataire fait
        // foi (un mauvais code USSD enverrait l'argent au mauvais endroit).
        Alert.alert(
          'Validez votre paiement 📲',
          [
            res.providerMessage,
            `Suivez les instructions reçues sur le ${num} pour confirmer le paiement ${network}.`,
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

  const onPayYengaMobile = async () => {
    if (!network) return Alert.alert('Opérateur requis', 'Choisissez votre opérateur Mobile Money.');
    const num = String(mmPhone || '').replace(/[^\d+]/g, '');
    if (num.replace(/\D/g, '').length < 8) {
      return Alert.alert('Numéro invalide', 'Entrez le numéro de votre compte Mobile Money.');
    }
    if (needsOtp && !needsServerOtp && otp.trim().length < 4) {
      return Alert.alert('Code OTP requis', `Obtenez le code OTP ${network} puis saisissez-le ici.`);
    }
    if (needsServerOtp && yengaPendingTxn && otp.trim().length < 4) {
      return Alert.alert('Code OTP requis', 'Saisissez le code reçu par SMS avant de finaliser le paiement.');
    }
    setProcessing(true);
    try {
      const res = await api.yengapayMobile({
        planId,
        phone: num,
        operator: network,
        country,
        otp: otp.trim(),
        transactionId: needsServerOtp ? yengaPendingTxn : null,
      });
      if (res.status === 'otp_required') {
        setYengaPendingTxn(res.transactionId);
        return Alert.alert(
          'Code OTP envoyé',
          res.providerMessage || 'Consultez vos SMS, saisissez le code reçu puis appuyez sur « Payer ».'
        );
      }
      if (res.status === 'success') {
        setYengaPendingTxn(null);
        await refreshAccess();
        return Alert.alert('Paiement confirmé ✅', 'Votre abonnement est actif. Bonne chance !', [
          { text: 'Super !', onPress: () => navigation.goBack() },
        ]);
      }
      Alert.alert(
        'Validez votre paiement 📲',
        [
          res.providerMessage,
          'Après validation auprès de votre opérateur, revenez ici : votre abonnement s’activera automatiquement.',
        ].filter(Boolean).join('\n\n')
      );
      const status = await pollStatus(res.transactionId, 48);
      if (status === 'success') {
        await refreshAccess();
        Alert.alert('Paiement confirmé ✅', 'Votre abonnement est actif. Bonne chance !', [
          { text: 'Super !', onPress: () => navigation.goBack() },
        ]);
      } else if (status === 'pending') {
        Alert.alert('Paiement en attente', 'La validation peut prendre quelques instants. Rafraîchissez ensuite votre profil.');
      } else {
        Alert.alert('Paiement non abouti', 'Le paiement a échoué ou a été annulé. Réessayez.');
      }
    } catch (e) {
      Alert.alert('Paiement impossible', e.data?.reason || 'Vérifiez le numéro, l’opérateur et le code OTP, puis réessayez.');
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
              onPress={() => {
                setPlanId(p.id);
                setOtp('');
                setYengaPendingTxn(null);
              }}
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
                <Text style={styles.pricePromo}>{fmtXOF(referralPrice(p))}</Text>
                {referral?.firstPaymentEligible && (
                  <Text style={styles.referralPrice}>Parrainage -{referral.discountPercent}%</Text>
                )}
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
                  onPress={() => {
                    setProviderId(pr.id);
                    setOtp('');
                    setYengaPendingTxn(null);
                  }}
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

        {isFeex || isYenga ? (
          /* Paiement mobile direct : validation selon l'opérateur. */
          <>
            <Text style={styles.sectionTitle}>Votre Mobile Money ({countryName})</Text>
            <View style={styles.opRow}>
              {operators.map((op) => {
                const active = op === network;
                const operatorName = operatorDetails.find((item) => item.code === op)?.name || op;
                return (
                  <Pressable
                    key={op}
                    style={[styles.opChip, active && styles.opChipActive]}
                    onPress={() => {
                      setNetwork(op);
                      setOtp('');
                      setYengaPendingTxn(null);
                    }}
                  >
                    <Text style={[styles.opChipText, active && styles.opChipTextActive]}>{operatorName}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={styles.phoneInput}
              value={mmPhone}
              onChangeText={(value) => {
                setMmPhone(value);
                if (yengaPendingTxn) {
                  setYengaPendingTxn(null);
                  setOtp('');
                }
              }}
              placeholder="Numéro Mobile Money"
              placeholderTextColor={COLORS.textFaint}
              keyboardType="phone-pad"
            />
            {/* Code OTP — le mode exact est fourni par le backend pour chaque opérateur. */}
            {needsOtp && (
              <>
                <TextInput
                  style={styles.phoneInput}
                  value={otp}
                  onChangeText={setOtp}
                  placeholder="Code OTP de validation"
                  placeholderTextColor={COLORS.textFaint}
                  keyboardType="number-pad"
                  maxLength={10}
                />
                {isYenga && (
                  <Text style={styles.otpHint}>
                    {yengaPaymentHelp(country, network, referralPrice(plan))}
                  </Text>
                )}
                {isFeex && network === 'ORANGE' && country === 'sn' && (
                  <Text style={styles.otpHint}>
                    Composez *144*391# sur votre téléphone pour recevoir votre code OTP.
                  </Text>
                )}
              </>
            )}

            <View style={styles.payInfo}>
              <Ionicons
                name={isFeex && needsRedirect ? 'open-outline' : 'phone-portrait'}
                size={18}
                color={COLORS.accent}
              />
              <Text style={styles.payInfoText}>
                {isFeex && needsRedirect
                  ? 'Après « Continuer », la page sécurisée FeexPay s’ouvrira pour terminer le paiement. Revenez ensuite dans ParisPromax.'
                  : isYenga && needsOtp
                    ? 'Votre code secret ou PIN Mobile Money reste confidentiel : ne le saisissez jamais dans ParisPromax.'
                    : isYenga
                      ? yengaPaymentHelp(country, network, referralPrice(plan))
                    : 'Une demande de paiement sera envoyée sur votre téléphone. Validez-la avec votre code Mobile Money.'}
              </Text>
            </View>

            {isFeex && needsRedirect && (
              <Text style={styles.redirectHint}>
                Votre code PIN Mobile Money reste confidentiel et ne doit jamais être saisi dans ParisPromax.
              </Text>
            )}

            <Pressable
              style={[styles.payBtn, processing && { opacity: 0.7 }]}
              onPress={isYenga ? onPayYengaMobile : onPayFeexMobile}
              disabled={processing}
            >
              {processing ? (
                <ActivityIndicator color="#06251c" />
              ) : (
                <>
                  <Ionicons name={isFeex && needsRedirect ? 'open-outline' : 'phone-portrait'} size={18} color="#06251c" />
                  <Text style={styles.payText}>
                    {needsServerOtp && !yengaPendingTxn
                      ? 'Recevoir le code OTP'
                      : `${isFeex && needsRedirect ? 'Continuer' : 'Payer'} ${plan ? fmtXOF(referralPrice(plan)) : ''}`}
                  </Text>
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

        <Text style={styles.secure}>🔒 Paiement sécurisé · Aucun code PIN n’est conservé</Text>
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
  referralPrice: { color: COLORS.gold, fontWeight: '800', fontSize: FONT.sm - 2, marginTop: 2 },
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
  otpHint: { color: COLORS.textMuted, fontSize: FONT.sm - 1, marginBottom: SPACING.sm },
  redirectHint: {
    color: COLORS.textFaint,
    fontSize: FONT.sm - 1,
    lineHeight: 17,
    marginTop: SPACING.sm,
  },
});
