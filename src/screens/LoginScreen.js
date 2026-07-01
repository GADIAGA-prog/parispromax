import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// FedaPay-supported countries (Mobile Money). The chosen country drives which
// operators appear on the payment page (e.g. Orange/Moov Burkina).
const COUNTRIES = [
  { code: 'bf', name: 'Burkina Faso', dial: '+226', flag: '🇧🇫' },
  { code: 'ci', name: "Côte d'Ivoire", dial: '+225', flag: '🇨🇮' },
  { code: 'sn', name: 'Sénégal', dial: '+221', flag: '🇸🇳' },
  { code: 'tg', name: 'Togo', dial: '+228', flag: '🇹🇬' },
  { code: 'bj', name: 'Bénin', dial: '+229', flag: '🇧🇯' },
  { code: 'ne', name: 'Niger', dial: '+227', flag: '🇳🇪' },
  { code: 'ml', name: 'Mali', dial: '+223', flag: '🇲🇱' },
  { code: 'gn', name: 'Guinée', dial: '+224', flag: '🇬🇳' },
];

// Two-step phone OTP login against the backend.
export default function LoginScreen() {
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState('phone'); // 'phone' | 'code'
  const [countryCode, setCountryCode] = useState('bf');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];

  // Full international number (E.164) = dial code + local digits (no leading 0).
  const fullPhone = () => selected.dial + phone.replace(/\D/g, '').replace(/^0+/, '');

  const onRequest = async () => {
    const local = phone.replace(/\D/g, '').replace(/^0+/, '');
    if (local.length < 8) {
      setError('Entrez un numéro de téléphone valide.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const res = await requestOtp(fullPhone());
      setDevCode(res.devCode || null);
      setStep('code');
    } catch (e) {
      setError("Impossible d'envoyer le code. Vérifiez votre connexion.");
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    if (code.trim().length < 4) {
      setError('Entrez le code reçu par SMS.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await verifyOtp(fullPhone(), code.trim(), countryCode);
      // On success the navigator switches automatically.
    } catch (e) {
      setError(e.message === 'Code invalide ou expiré' ? 'Code invalide ou expiré.' : 'Échec de la vérification.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.logoWrap}>
          <View style={styles.logo}>
            <Ionicons name="trophy" size={40} color={COLORS.accent} />
          </View>
          <Text style={styles.brand}>PARISPROMAX</Text>
          <Text style={styles.tagline}>Pronostics IA · Courses PMU · Quinté+</Text>
        </View>

        <View style={styles.card}>
          {step === 'phone' ? (
            <>
              <Text style={styles.label}>Pays</Text>
              <Pressable
                style={styles.countrySelect}
                onPress={() => setPickerOpen(true)}
                disabled={busy}
              >
                <Text style={styles.countryText}>
                  {selected.flag}  {selected.name} ({selected.dial})
                </Text>
                <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
              </Pressable>

              <Text style={[styles.label, { marginTop: SPACING.md }]}>Numéro de téléphone</Text>
              <View style={styles.inputRow}>
                <Text style={styles.dialPrefix}>{selected.dial}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="70 00 00 00"
                  placeholderTextColor={COLORS.textFaint}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  maxLength={15}
                  editable={!busy}
                />
              </View>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable style={[styles.button, busy && styles.busy]} onPress={onRequest} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color="#06251c" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>Recevoir mon code</Text>
                    <Ionicons name="arrow-forward" size={18} color="#06251c" />
                  </>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>Code reçu par SMS (au {phone})</Text>
              <View style={styles.inputRow}>
                <Ionicons name="keypad" size={18} color={COLORS.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Code à 6 chiffres"
                  placeholderTextColor={COLORS.textFaint}
                  keyboardType="number-pad"
                  value={code}
                  onChangeText={setCode}
                  maxLength={6}
                  editable={!busy}
                />
              </View>
              {!!devCode && (
                <Text style={styles.devHint}>Code de test : {devCode}</Text>
              )}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable style={[styles.button, busy && styles.busy]} onPress={onVerify} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color="#06251c" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>Valider & démarrer</Text>
                    <Ionicons name="checkmark" size={18} color="#06251c" />
                  </>
                )}
              </Pressable>
              <Pressable onPress={() => { setStep('phone'); setError(''); setCode(''); }} hitSlop={10}>
                <Text style={styles.changeNumber}>← Changer de numéro</Text>
              </Pressable>
            </>
          )}

          <View style={styles.trialNote}>
            <Ionicons name="pricetags" size={14} color={COLORS.accent} />
            <Text style={styles.trialNoteText}>Abonnements à partir de 400 XOF/jour.</Text>
          </View>
        </View>

        <Text style={styles.footer}>Optimisé pour les connexions lentes 🌍 · Mode hors-ligne intégré</Text>

        <Modal
          visible={pickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPickerOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Choisissez votre pays</Text>
              <ScrollView>
                {COUNTRIES.map((c) => (
                  <Pressable
                    key={c.code}
                    style={[styles.countryRow, c.code === countryCode && styles.countryRowActive]}
                    onPress={() => {
                      setCountryCode(c.code);
                      setPickerOpen(false);
                    }}
                  >
                    <Text style={styles.countryRowText}>
                      {c.flag}  {c.name}
                    </Text>
                    <Text style={styles.countryRowDial}>{c.dial}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, padding: SPACING.xl, justifyContent: 'center' },
  logoWrap: { alignItems: 'center', marginBottom: SPACING.xxl },
  logo: {
    width: 84, height: 84, borderRadius: 24, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
  },
  brand: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900', letterSpacing: 1 },
  tagline: { color: COLORS.accent, fontSize: FONT.sm, marginTop: 4, fontWeight: '600' },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.sm, fontWeight: '600' },
  countrySelect: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  countryText: { color: COLORS.text, fontSize: FONT.md, fontWeight: '600' },
  dialPrefix: { color: COLORS.textMuted, fontSize: FONT.lg, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', padding: SPACING.xl,
  },
  modalCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    maxHeight: '70%', borderWidth: 1, borderColor: COLORS.border,
  },
  modalTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginBottom: SPACING.md },
  countryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.md,
  },
  countryRowActive: { backgroundColor: COLORS.primary },
  countryRowText: { color: COLORS.text, fontSize: FONT.md, fontWeight: '600' },
  countryRowDial: { color: COLORS.textMuted, fontSize: FONT.sm, fontWeight: '700' },
  input: { flex: 1, color: COLORS.text, fontSize: FONT.lg, paddingVertical: SPACING.md, letterSpacing: 2 },
  error: { color: COLORS.danger, marginTop: SPACING.sm, fontSize: FONT.sm },
  devHint: { color: COLORS.gold, marginTop: SPACING.sm, fontSize: FONT.sm, fontWeight: '700' },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: SPACING.md, marginTop: SPACING.lg,
  },
  busy: { opacity: 0.7 },
  buttonText: { color: '#06251c', fontWeight: '900', fontSize: FONT.lg },
  changeNumber: { color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.md, fontSize: FONT.sm },
  trialNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: SPACING.md },
  trialNoteText: { color: COLORS.textMuted, fontSize: FONT.sm },
  footer: { color: COLORS.textFaint, textAlign: 'center', marginTop: SPACING.xl, fontSize: FONT.sm },
});
