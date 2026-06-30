import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

// Phone login simulation. Any 8+ digit number starts the 48h free trial.
export default function LoginScreen() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const onSubmit = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8) {
      setError('Entrez un numéro de téléphone valide.');
      return;
    }
    setError('');
    await login(digits);
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
          <Text style={styles.tagline}>
            Pronostics IA · Courses PMU · Quinté+
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Numéro de téléphone</Text>
          <View style={styles.inputRow}>
            <Ionicons name="call" size={18} color={COLORS.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="Ex : 07 00 00 00 00"
              placeholderTextColor={COLORS.textFaint}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              maxLength={20}
            />
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={styles.button}
            onPress={onSubmit}
            android_ripple={{ color: 'rgba(0,0,0,0.2)' }}
          >
            <Text style={styles.buttonText}>Démarrer mon essai gratuit</Text>
            <Ionicons name="arrow-forward" size={18} color="#06251c" />
          </Pressable>

          <View style={styles.trialNote}>
            <Ionicons name="gift" size={14} color={COLORS.accent} />
            <Text style={styles.trialNoteText}>
              48h d'accès VIP offert — sans engagement.
            </Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Optimisé pour les connexions lentes 🌍 · Mode hors-ligne intégré
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: {
    flex: 1,
    padding: SPACING.xl,
    justifyContent: 'center',
  },
  logoWrap: { alignItems: 'center', marginBottom: SPACING.xxl },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  brand: {
    color: COLORS.text,
    fontSize: FONT.xxl,
    fontWeight: '900',
    letterSpacing: 1,
  },
  tagline: {
    color: COLORS.accent,
    fontSize: FONT.sm,
    marginTop: 4,
    fontWeight: '600',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  label: {
    color: COLORS.textMuted,
    fontSize: FONT.sm,
    marginBottom: SPACING.sm,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: FONT.lg,
    paddingVertical: SPACING.md,
  },
  error: { color: COLORS.danger, marginTop: SPACING.sm, fontSize: FONT.sm },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    marginTop: SPACING.lg,
  },
  buttonText: { color: '#06251c', fontWeight: '900', fontSize: FONT.lg },
  trialNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: SPACING.md,
  },
  trialNoteText: { color: COLORS.textMuted, fontSize: FONT.sm },
  footer: {
    color: COLORS.textFaint,
    textAlign: 'center',
    marginTop: SPACING.xl,
    fontSize: FONT.sm,
  },
});
