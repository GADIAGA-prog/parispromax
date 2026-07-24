import React, { useEffect, useState } from 'react';
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
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import api from '../services/api';
import {
  DEFAULT_PAYMENT_COUNTRIES,
  countryByCode,
  toE164Phone,
} from '../services/countries';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

const DEFAULT_RECOVERY_QUESTIONS = [
  { id: 'first_school', label: 'Quel est le nom de votre première école ?' },
  { id: 'childhood_nickname', label: "Quel était votre surnom d'enfance ?" },
  { id: 'childhood_district', label: "Dans quel quartier avez-vous grandi ?" },
  { id: 'first_teacher', label: 'Quel était le prénom de votre premier enseignant ?' },
];
const SIGNUP_URL = 'https://www.parispromax.com/?auth=register';

function normalizeBirthDateInput(raw) {
  const value = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

// Connexion par numéro + MOT DE PASSE (aucun SMS ni email). Le reset de mot de
// passe est autonome : un CODE DE RÉCUPÉRATION est remis à l'inscription.
export default function LoginScreen() {
  const { login, adoptSession } = useAuth();
  const { completeOnboarding } = useSettings();
  const [mode, setMode] = useState('login'); // 'login' | 'reset'
  const [countries, setCountries] = useState(DEFAULT_PAYMENT_COUNTRIES);
  const [countryCode, setCountryCode] = useState('bf');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [recoveryQuestions, setRecoveryQuestions] = useState(DEFAULT_RECOVERY_QUESTIONS);
  const [recoveryQuestion, setRecoveryQuestion] = useState(DEFAULT_RECOVERY_QUESTIONS[0].id);
  const [questionPickerOpen, setQuestionPickerOpen] = useState(false);
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [resetMethod, setResetMethod] = useState('code'); // code | question | support
  const [paymentReference, setPaymentReference] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Après register/reset, le code est affiché avant la prochaine étape. Une
  // inscription revient à la connexion ; seul un reset adopte la session.
  const [recovery, setRecovery] = useState(null);

  const selected = countryByCode(countryCode, countries)
    || countries[0]
    || DEFAULT_PAYMENT_COUNTRIES[0];
  const isRegister = mode === 'register';
  const isReset = mode === 'reset';
  const selectedRecoveryQuestion = recoveryQuestions.find(
    (question) => question.id === recoveryQuestion
  ) || recoveryQuestions[0];

  // Le backend renvoie uniquement les pays couverts par au moins un moyen de
  // paiement actif. La liste YengaPay locale sert de repli hors connexion.
  useEffect(() => {
    let cancelled = false;
    api.paymentCountries()
      .then((data) => {
        const list = Array.isArray(data?.countries) ? data.countries : [];
        if (cancelled || !list.length) return;
        setCountries(list);
        setCountryCode((current) => (
          list.some((country) => country.code === current) ? current : list[0].code
        ));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Build a clean E.164 number, tolerant of any way the user typed it: with or
  // without the country code, a leading "+", "00", or national "0".
  const fullPhone = () => toE164Phone(phone, selected);

  const onSubmit = async () => {
    const normalizedPhone = fullPhone();
    const normalizedBirthDate = normalizeBirthDateInput(birthDate);
    if (!normalizedPhone) {
      setError('Entrez un numéro de téléphone valide.');
      return;
    }
    if (isRegister) {
      if (firstName.trim().length < 2 || lastName.trim().length < 2) {
        setError('Prénom et nom : 2 caractères minimum.');
        return;
      }
      if (!normalizedBirthDate || birthPlace.trim().length < 2) {
        setError('Date (JJ/MM/AAAA) et lieu de naissance requis.');
        return;
      }
      if (!selectedRecoveryQuestion || recoveryAnswer.trim().length < 2) {
        setError('Choisissez une question et saisissez votre réponse secrète.');
        return;
      }
    }
    if (isReset && resetMethod === 'code' && resetCode.replace(/[^a-zA-Z0-9]/g, '').length < 8) {
      setError('Entrez votre code de récupération (8 ou 12 caractères).');
      return;
    }
    if (password.length < 8) {
      setError('Mot de passe : 8 caractères minimum.');
      return;
    }
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (isRegister) {
        const res = await api.register({
          phone: normalizedPhone,
          password,
          country: countryCode,
          referralCode,
          firstName,
          lastName,
          birthDate: normalizedBirthDate,
          birthPlace,
          recoveryQuestion: selectedRecoveryQuestion.id,
          recoveryAnswer,
        });
        await completeOnboarding();
        setRecovery({ code: res.recoveryCode, next: 'login' });
      } else if (isReset) {
        const res = await api.resetPassword(normalizedPhone, resetCode, password);
        setRecovery({ code: res.recoveryCode, next: 'session', session: res });
      } else {
        await login(normalizedPhone, password, countryCode);
        await completeOnboarding();
        // On success the navigator switches automatically.
      }
    } catch (e) {
      if (e.status === 409) {
        setError('Ce numéro a déjà un compte. Passez sur « Connexion ».');
      } else if (e.status === 401) {
        setError(
          isReset
            ? 'Numéro ou code de récupération incorrect.'
            : 'Numéro ou mot de passe incorrect.'
        );
      } else if (e.status === 429) {
        setError('Trop de tentatives. Réessayez dans quelques minutes.');
      } else {
        setError(e.message || 'Impossible de joindre le serveur. Réessayez dans un instant.');
      }
    } finally {
      setBusy(false);
    }
  };

  // Après inscription, revenir explicitement à la connexion. Après un reset,
  // conserver le comportement existant et adopter la session obtenue.
  const onRecoveryNoted = async () => {
    const next = recovery?.next;
    const session = recovery?.session;
    setRecovery(null);
    if (next === 'login') {
      setMode('login');
      setPassword('');
      setReferralCode('');
      setRecoveryAnswer('');
      setNotice('Compte créé avec succès. Connectez-vous avec votre numéro et votre mot de passe.');
      return;
    }
    if (session) await adoptSession(session);
  };

  const submitSupportRequest = async () => {
    const normalizedPhone = fullPhone();
    const normalizedBirthDate = normalizeBirthDateInput(birthDate);
    if (!normalizedPhone) return setError('Entrez un numéro de téléphone valide.');
    if (
      firstName.trim().length < 2 ||
      lastName.trim().length < 2 ||
      !normalizedBirthDate ||
      birthPlace.trim().length < 2
    ) {
      setError("Complétez les informations d'identité demandées.");
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.requestRecoverySupport({
        phone: normalizedPhone,
        firstName,
        lastName,
        birthDate: normalizedBirthDate,
        birthPlace,
        paymentReference,
      });
      setNotice(result.message || 'Demande transmise au support.');
    } catch (e) {
      setError(e.message || "Impossible d'envoyer la demande pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  const identityFields = (
    <>
      <View style={styles.nameGrid}>
        <View style={styles.nameField}>
          <Text style={styles.label}>Prénom</Text>
          <View style={styles.inputRow}>
            <Ionicons name="person-outline" size={18} color={COLORS.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Prénom"
              placeholderTextColor={COLORS.textFaint}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              maxLength={80}
              editable={!busy}
            />
          </View>
        </View>
        <View style={styles.nameField}>
          <Text style={styles.label}>Nom</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Nom"
              placeholderTextColor={COLORS.textFaint}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="characters"
              maxLength={80}
              editable={!busy}
            />
          </View>
        </View>
      </View>
      <Text style={[styles.label, { marginTop: SPACING.md }]}>Date de naissance</Text>
      <View style={styles.inputRow}>
        <Ionicons name="calendar-outline" size={18} color={COLORS.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="JJ/MM/AAAA"
          placeholderTextColor={COLORS.textFaint}
          keyboardType="numbers-and-punctuation"
          value={birthDate}
          onChangeText={setBirthDate}
          maxLength={10}
          editable={!busy}
        />
      </View>
      <Text style={[styles.label, { marginTop: SPACING.md }]}>Lieu de naissance</Text>
      <View style={styles.inputRow}>
        <Ionicons name="location-outline" size={18} color={COLORS.textMuted} />
        <TextInput
          style={styles.input}
          placeholder="Ville / localité"
          placeholderTextColor={COLORS.textFaint}
          value={birthPlace}
          onChangeText={setBirthPlace}
          autoCapitalize="words"
          maxLength={120}
          editable={!busy}
        />
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.logoWrap}>
          <Image
            source={require('../../assets/logo-emblem-app.png')}
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
              <View style={[styles.tab, styles.tabActive]}>
                <Text style={[styles.tabText, styles.tabTextActive]}>Connexion</Text>
              </View>
              <Pressable
                style={styles.tab}
                onPress={() => WebBrowser.openBrowserAsync(SIGNUP_URL)}
                disabled={busy}
              >
                <Text style={styles.tabText}>Créer un compte</Text>
              </Pressable>
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

          {isRegister && (
            <>
              <Text style={styles.sectionTitle}>Informations personnelles</Text>
              {identityFields}
              <Text style={styles.sectionTitle}>Récupération du compte</Text>
              <Text style={styles.label}>Question secrète</Text>
              <Pressable
                style={styles.countrySelect}
                onPress={() => setQuestionPickerOpen(true)}
                disabled={busy}
              >
                <Text style={[styles.countryText, { flex: 1 }]} numberOfLines={2}>
                  {selectedRecoveryQuestion?.label}
                </Text>
                <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
              </Pressable>
              <Text style={[styles.label, { marginTop: SPACING.md }]}>Votre réponse secrète</Text>
              <View style={styles.inputRow}>
                <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Réponse que vous retiendrez"
                  placeholderTextColor={COLORS.textFaint}
                  value={recoveryAnswer}
                  onChangeText={setRecoveryAnswer}
                  autoCapitalize="sentences"
                  maxLength={100}
                  editable={!busy}
                />
              </View>
              <Text style={styles.supportHint}>
                La réponse est hachée et ne pourra jamais être relue par le support.
              </Text>
            </>
          )}

          {isReset && (
            <>
              <Text style={styles.sectionTitle}>Choisissez une méthode</Text>
              <View style={styles.tabs}>
                {[
                  { key: 'code', label: 'Code' },
                  { key: 'support', label: 'Assistance' },
                ].map((item) => (
                  <Pressable
                    key={item.key}
                    style={[styles.tab, resetMethod === item.key && styles.tabActive]}
                    onPress={() => {
                      setResetMethod(item.key);
                      setError('');
                      setNotice('');
                      setRecoveryAnswer('');
                    }}
                    disabled={busy}
                  >
                    <Text style={[styles.tabText, resetMethod === item.key && styles.tabTextActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {resetMethod === 'code' && (
                <>
                  <Text style={styles.label}>Code de récupération</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="key" size={18} color={COLORS.textMuted} />
                    <TextInput
                      style={[styles.input, { letterSpacing: 2 }]}
                      placeholder="XXXX-XXXX-XXXX"
                      placeholderTextColor={COLORS.textFaint}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      value={resetCode}
                      onChangeText={setResetCode}
                      maxLength={14}
                      editable={!busy}
                    />
                  </View>
                </>
              )}

              {resetMethod === 'support' && (
                <>
                  <Text style={styles.supportIntro}>
                    Votre demande sera envoyée par le serveur. L'adresse destinataire reste masquée.
                  </Text>
                  {identityFields}
                  <Text style={[styles.label, { marginTop: SPACING.md }]}>Référence YengaPay (facultative)</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="receipt-outline" size={18} color={COLORS.textMuted} />
                    <TextInput
                      style={styles.input}
                      placeholder="Référence du dernier paiement"
                      placeholderTextColor={COLORS.textFaint}
                      value={paymentReference}
                      onChangeText={setPaymentReference}
                      autoCapitalize="characters"
                      maxLength={120}
                      editable={!busy}
                    />
                  </View>
                  <Text style={styles.supportHint}>
                    Ne communiquez jamais votre PIN Mobile Money ni votre ancien mot de passe.
                  </Text>
                </>
              )}
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

          {(!isReset || resetMethod !== 'support') && (
            <>
              <Text style={[styles.label, { marginTop: SPACING.md }]}>
                {isRegister
                  ? 'Choisissez un mot de passe (8 caractères min.)'
                  : isReset
                    ? 'Nouveau mot de passe (8 caractères min.)'
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
            </>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          <Pressable
            style={[styles.button, busy && styles.busy]}
            onPress={isReset && resetMethod === 'support' ? submitSupportRequest : onSubmit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#06251c" />
            ) : (
              <>
                <Text style={styles.buttonText}>
                  {isRegister
                    ? 'Créer mon compte'
                    : isReset && resetMethod === 'support'
                      ? 'Envoyer ma demande'
                      : isReset
                        ? 'Réinitialiser & me connecter'
                        : 'Se connecter'}
                </Text>
                <Ionicons
                  name={
                    isRegister
                      ? 'person-add'
                      : isReset && resetMethod === 'support'
                        ? 'send'
                        : isReset
                          ? 'key'
                          : 'arrow-forward'
                  }
                  size={18}
                  color="#06251c"
                />
              </>
            )}
          </Pressable>

          {mode === 'login' && (
            <Pressable onPress={() => { setMode('reset'); setError(''); setNotice(''); }} hitSlop={8}>
              <Text style={styles.forgotHint}>Mot de passe oublié ? Récupérer mon compte</Text>
            </Pressable>
          )}
          {isReset && (
            <Pressable onPress={() => { setMode('login'); setError(''); setNotice(''); }} hitSlop={8}>
              <Text style={styles.forgotHint}>← Retour à la connexion</Text>
            </Pressable>
          )}

          <View style={styles.trialNote}>
            <Ionicons name="pricetags" size={14} color={COLORS.accent} />
            <Text style={styles.trialNoteText}>Abonnements à partir de 200 XOF/jour.</Text>
          </View>
        </View>

        <Text style={styles.footer}>Optimisé pour les connexions lentes 🌍 · Mode hors-ligne intégré</Text>

        {/* Code de récupération — affiché UNE fois avant de continuer. */}
        <Modal visible={!!recovery} transparent animationType="fade" onRequestClose={() => {}}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>🔑 Votre code de récupération</Text>
              <Text style={styles.recoveryCode} selectable>
                {recovery?.code}
              </Text>
              <Text style={styles.recoveryText}>
                Notez ce code et gardez-le précieusement (photo, papier…).{'\n\n'}
                C'est le moyen le plus rapide de récupérer votre compte. Si vous
                perdez aussi ce code, le support pourra vous aider par e-mail
                après vérification de votre identité.
              </Text>
              <Pressable style={styles.button} onPress={onRecoveryNoted}>
                <Ionicons name="checkmark" size={18} color="#06251c" />
                <Text style={styles.buttonText}>
                  {recovery?.next === 'login'
                    ? "J'ai noté le code · Me connecter"
                    : "J'ai noté mon code"}
                </Text>
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
                {countries.map((c) => (
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

        <Modal
          visible={questionPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setQuestionPickerOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setQuestionPickerOpen(false)}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Choisissez votre question secrète</Text>
              <ScrollView>
                {recoveryQuestions.map((question) => (
                  <Pressable
                    key={question.id}
                    style={[
                      styles.questionRow,
                      question.id === recoveryQuestion && styles.countryRowActive,
                    ]}
                    onPress={() => {
                      setRecoveryQuestion(question.id);
                      setQuestionPickerOpen(false);
                    }}
                  >
                    <Text style={styles.questionRowText}>{question.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  keyboard: { flex: 1 },
  container: { flexGrow: 1, padding: SPACING.xl, justifyContent: 'center' },
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
  sectionTitle: {
    color: COLORS.accent, fontSize: FONT.md, fontWeight: '900',
    marginTop: SPACING.lg, marginBottom: SPACING.md,
  },
  nameGrid: { flexDirection: 'row', gap: SPACING.sm },
  nameField: { flex: 1 },
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
  supportLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: SPACING.md,
  },
  supportLinkText: {
    color: COLORS.gold, fontSize: FONT.sm, fontWeight: '800',
    textDecorationLine: 'underline',
  },
  supportHint: {
    color: COLORS.textFaint, fontSize: 11, lineHeight: 16,
    textAlign: 'center', marginTop: 6,
  },
  supportIntro: {
    color: COLORS.textMuted, fontSize: FONT.sm, lineHeight: 19,
    backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.accent,
    borderRadius: RADIUS.md, paddingVertical: SPACING.md,
  },
  secondaryButtonText: { color: COLORS.accent, fontWeight: '800', fontSize: FONT.sm },
  questionCard: {
    color: COLORS.gold, fontSize: FONT.md, fontWeight: '800', lineHeight: 22,
    backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md,
    marginVertical: SPACING.md,
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
  questionRow: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.md },
  questionRowText: { color: COLORS.text, fontSize: FONT.md, lineHeight: 22 },
  input: { flex: 1, color: COLORS.text, fontSize: FONT.lg, paddingVertical: SPACING.md, letterSpacing: 2 },
  error: { color: COLORS.danger, marginTop: SPACING.sm, fontSize: FONT.sm },
  notice: { color: COLORS.accent, marginTop: SPACING.sm, fontSize: FONT.sm, lineHeight: 19 },
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
