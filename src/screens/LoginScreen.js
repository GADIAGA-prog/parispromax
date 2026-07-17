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
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// Pays supportés par FeexPay (Mobile Money) — seuls pays d'inscription.
// Le pays choisi détermine les opérateurs proposés au paiement (Orange/Moov BF…).
const COUNTRIES = [
  { code: 'bf', name: 'Burkina Faso', dial: '+226', flag: '🇧🇫' },
  { code: 'ci', name: "Côte d'Ivoire", dial: '+225', flag: '🇨🇮' },
  { code: 'sn', name: 'Sénégal', dial: '+221', flag: '🇸🇳' },
  { code: 'tg', name: 'Togo', dial: '+228', flag: '🇹🇬' },
  { code: 'bj', name: 'Bénin', dial: '+229', flag: '🇧🇯' },
  { code: 'cg', name: 'Congo-Brazzaville', dial: '+242', flag: '🇨🇬' },
];

// Connexion par numéro + MOT DE PASSE (aucun SMS ni email). Le reset de mot de
// passe est autonome : un CODE DE RÉCUPÉRATION est remis à l'inscription.
export default function LoginScreen() {
  const { login, adoptSession } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'reset'
  const [countryCode, setCountryCode] = useState('bf');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Après register/reset : { code, session } — on affiche le code de
  // récupération et on n'adopte la session qu'une fois le code noté.
  const [recovery, setRecovery] = useState(null);

  const selected = COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];
  const isRegister = mode === 'register';
  const isReset = mode === 'reset';

  // Build a clean E.164 number, tolerant of any way the user typed it: with or
  // without the country code, a leading "+", "00", or national "0".
  const fullPhone = () => {
    const cc = selected.dial.replace('+', ''); // "226"
    let d = phone.replace(/\D/g, '').replace(/^00/, '').replace(/^0+/, '');
    while (d.startsWith(cc) && d.length - cc.length >= 8) d = d.slice(cc.length);
    return `+${cc}${d}`;
  };

  const onSubmit = async () => {
    const local = phone.replace(/\D/g, '').replace(/^0+/, '');
    if (local.length < 8) {
      setError('Entrez un numéro de téléphone valide.');
      return;
    }
    if (isReset && resetCode.replace(/[^a-zA-Z0-9]/g, '').length < 8) {
      setError('Entrez votre code de récupération (8 caractères).');
      return;
    }
    if (password.length < 6) {
      setError('Mot de passe : 6 caractères minimum.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (isRegister) {
        const res = await api.register(fullPhone(), password, countryCode, referralCode);
        setRecovery({ code: res.recoveryCode, session: res });
      } else if (isReset) {
        const res = await api.resetPassword(fullPhone(), resetCode, password);
        setRecovery({ code: res.recoveryCode, session: res });
      } else {
        await login(fullPhone(), password, countryCode);
        // On success the navigator switches automatically.
      }
    } catch (e) {
      if (e.status === 409) {
        setError('Ce numéro a déjà un compte. Passez sur « Connexion ».');
      } else if (e.status === 401) {
        setError(isReset ? 'Numéro ou code de récupération incorrect.' : 'Numéro ou mot de passe incorrect.');
      } else if (e.status === 429) {
        setError('Trop de tentatives. Réessayez dans quelques minutes.');
      } else {
        setError(e.message && e.status ? e.message : 'Échec. Vérifiez votre connexion internet.');
      }
    } finally {
      setBusy(false);
    }
  };

  // L'utilisateur a noté son code -> on adopte la session (navigation bascule).
  const onRecoveryNoted = async () => {
    const session = recovery?.session;
    setRecovery(null);
    if (session) await adoptSession(session);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.logoWrap}>
          <Image
            source={require('../../assets/logo-emblem.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.brand}>PARISPROMAX</Text>
          <Text style={styles.tagline}>Pronostics IA · Courses PMU · Quinté+</Text>
        </View>

        <View style={styles.card}>
          {/* Onglets Connexion / Créer un compte (le reset a son propre titre) */}
          {isReset ? (
            <Text style={styles.resetTitle}>🔑 Réinitialiser le mot de passe</Text>
          ) : (
            <View style={styles.tabs}>
              {[
                { key: 'login', label: 'Connexion' },
                { key: 'register', label: 'Créer un compte' },
              ].map((t) => (
                <Pressable
                  key={t.key}
                  style={[styles.tab, mode === t.key && styles.tabActive]}
                  onPress={() => { setMode(t.key); setError(''); }}
                  disabled={busy}
                >
                  <Text style={[styles.tabText, mode === t.key && styles.tabTextActive]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

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

          {isReset && (
            <>
              <Text style={[styles.label, { marginTop: SPACING.md }]}>
                Code de récupération (remis à l'inscription)
              </Text>
              <View style={styles.inputRow}>
                <Ionicons name="key" size={18} color={COLORS.textMuted} />
                <TextInput
                  style={[styles.input, { letterSpacing: 2 }]}
                  placeholder="XXXX-XXXX"
                  placeholderTextColor={COLORS.textFaint}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={resetCode}
                  onChangeText={setResetCode}
                  maxLength={9}
                  editable={!busy}
                />
              </View>
            </>
          )}

          {isRegister && (
            <>
              <Text style={[styles.label, { marginTop: SPACING.md }]}>Code de parrainage (facultatif)</Text>
              <View style={styles.inputRow}>
                <Ionicons name="gift" size={18} color={COLORS.textMuted} />
                <TextInput
                  style={[styles.input, { letterSpacing: 1 }]}
                  placeholder="Ex. PPM12AB34CD"
                  placeholderTextColor={COLORS.textFaint}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={referralCode}
                  onChangeText={setReferralCode}
                  maxLength={16}
                  editable={!busy}
                />
              </View>
              <Text style={styles.referralHint}>Réduction sur votre premier paiement avec un code valide.</Text>
            </>
          )}

          <Text style={[styles.label, { marginTop: SPACING.md }]}>
            {isRegister
              ? 'Choisissez un mot de passe (6 caractères min.)'
              : isReset
                ? 'Nouveau mot de passe (6 caractères min.)'
                : 'Mot de passe'}
          </Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed" size={18} color={COLORS.textMuted} />
            <TextInput
              style={[styles.input, { letterSpacing: 1 }]}
              placeholder="Mot de passe"
              placeholderTextColor={COLORS.textFaint}
              secureTextEntry={!showPwd}
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
              maxLength={72}
              editable={!busy}
            />
            <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={10}>
              <Ionicons name={showPwd ? 'eye-off' : 'eye'} size={18} color={COLORS.textMuted} />
            </Pressable>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={[styles.button, busy && styles.busy]} onPress={onSubmit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#06251c" />
            ) : (
              <>
                <Text style={styles.buttonText}>
                  {isRegister ? 'Créer mon compte' : isReset ? 'Réinitialiser & me connecter' : 'Se connecter'}
                </Text>
                <Ionicons
                  name={isRegister ? 'person-add' : isReset ? 'key' : 'arrow-forward'}
                  size={18}
                  color="#06251c"
                />
              </>
            )}
          </Pressable>

          {mode === 'login' && (
            <Pressable onPress={() => { setMode('reset'); setError(''); }} hitSlop={8}>
              <Text style={styles.forgotHint}>Mot de passe oublié ? Utiliser mon code de récupération</Text>
            </Pressable>
          )}
          {isReset && (
            <Pressable onPress={() => { setMode('login'); setError(''); }} hitSlop={8}>
              <Text style={styles.forgotHint}>← Retour à la connexion</Text>
            </Pressable>
          )}

          <View style={styles.trialNote}>
            <Ionicons name="pricetags" size={14} color={COLORS.accent} />
            <Text style={styles.trialNoteText}>Abonnements à partir de 400 XOF/jour.</Text>
          </View>
        </View>

        <Text style={styles.footer}>Optimisé pour les connexions lentes 🌍 · Mode hors-ligne intégré</Text>

        {/* Code de récupération — affiché UNE fois ; la session n'est adoptée
            qu'après confirmation, sinon l'écran disparaîtrait trop tôt. */}
        <Modal visible={!!recovery} transparent animationType="fade" onRequestClose={() => {}}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>🔑 Votre code de récupération</Text>
              <Text style={styles.recoveryCode} selectable>
                {recovery?.code}
              </Text>
              <Text style={styles.recoveryText}>
                Notez ce code et gardez-le précieusement (photo, papier…).{'\n\n'}
                C'est le SEUL moyen de récupérer votre compte si vous oubliez
                votre mot de passe — nous n'envoyons ni SMS ni email.
              </Text>
              <Pressable style={styles.button} onPress={onRecoveryNoted}>
                <Ionicons name="checkmark" size={18} color="#06251c" />
                <Text style={styles.buttonText}>J'ai noté mon code</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

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
    width: 116, height: 116, marginBottom: SPACING.md,
  },
  brand: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900', letterSpacing: 1 },
  tagline: { color: COLORS.accent, fontSize: FONT.sm, marginTop: 4, fontWeight: '600' },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { color: COLORS.textMuted, fontSize: FONT.sm, marginBottom: SPACING.sm, fontWeight: '600' },
  tabs: {
    flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    padding: 4, marginBottom: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
  },
  tab: { flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, alignItems: 'center' },
  tabActive: { backgroundColor: COLORS.accent },
  tabText: { color: COLORS.textMuted, fontWeight: '800', fontSize: FONT.sm },
  tabTextActive: { color: '#06251c' },
  forgotHint: {
    color: COLORS.accent, textAlign: 'center', marginTop: SPACING.md,
    fontSize: FONT.sm, textDecorationLine: 'underline',
  },
  referralHint: { color: COLORS.accent, fontSize: FONT.sm, marginTop: 6 },
  resetTitle: {
    color: COLORS.text, fontSize: FONT.lg, fontWeight: '900',
    textAlign: 'center', marginBottom: SPACING.lg,
  },
  recoveryCode: {
    color: COLORS.gold, fontSize: 30, fontWeight: '900', letterSpacing: 3,
    textAlign: 'center', marginVertical: SPACING.md,
  },
  recoveryText: { color: COLORS.textMuted, fontSize: FONT.sm, lineHeight: 20 },
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
