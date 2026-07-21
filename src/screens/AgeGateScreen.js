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
import * as WebBrowser from 'expo-web-browser';
import { useSettings } from '../context/SettingsContext';
import { LEGAL_URLS } from '../services/legal';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

function isAtLeast18(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const birth = new Date(Date.UTC(y, m - 1, d));
  if (
    !Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)
    || birth.getUTCDate() !== d || birth.getUTCMonth() !== m - 1 || birth.getUTCFullYear() !== y
  ) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m
    || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 18;
}

export default function AgeGateScreen() {
  const { confirmAdult } = useSettings();
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);

  const verify = async () => {
    const adult = isAtLeast18(day, month, year);
    if (adult == null) {
      setBlocked(false);
      setMessage('Entrez une date de naissance valide.');
      return;
    }
    if (!adult) {
      setBlocked(true);
      setMessage('ParisPromax est strictement réservé aux personnes âgées de 18 ans ou plus.');
      return;
    }
    setMessage('');
    await confirmAdult();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.icon}>
          <Ionicons name="shield-checkmark" size={48} color={COLORS.gold} />
        </View>
        <Text style={styles.title}>Accès réservé aux adultes</Text>
        <Text style={styles.text}>
          ParisPromax présente des analyses et pronostics hippiques. Les jeux d’argent comportent des risques et sont interdits aux mineurs.
        </Text>

        <Text style={styles.label}>Votre date de naissance</Text>
        <View style={styles.row}>
          <TextInput style={styles.shortInput} value={day} onChangeText={(v) => setDay(v.replace(/\D/g, '').slice(0, 2))} placeholder="JJ" placeholderTextColor={COLORS.textFaint} keyboardType="number-pad" />
          <TextInput style={styles.shortInput} value={month} onChangeText={(v) => setMonth(v.replace(/\D/g, '').slice(0, 2))} placeholder="MM" placeholderTextColor={COLORS.textFaint} keyboardType="number-pad" />
          <TextInput style={styles.yearInput} value={year} onChangeText={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))} placeholder="AAAA" placeholderTextColor={COLORS.textFaint} keyboardType="number-pad" />
        </View>
        <Text style={styles.privacy}>La date saisie est vérifiée sur cet appareil et n’est pas transmise au serveur.</Text>

        {!!message && <Text style={[styles.message, blocked && styles.blocked]}>{message}</Text>}

        <Pressable style={styles.button} onPress={verify}>
          <Text style={styles.buttonText}>Vérifier mon âge</Text>
          <Ionicons name="arrow-forward" size={18} color="#06251c" />
        </Pressable>

        <Pressable onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.responsibleGambling)}>
          <Text style={styles.link}>Conseils de jeu responsable</Text>
        </Pressable>
        <Text style={styles.footer}>En continuant, vous acceptez les conditions d’utilisation et confirmez avoir au moins 18 ans.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, justifyContent: 'center', padding: SPACING.xl },
  icon: { width: 92, height: 92, borderRadius: 46, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, marginBottom: SPACING.lg },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900', textAlign: 'center' },
  text: { color: COLORS.textMuted, fontSize: FONT.md, textAlign: 'center', lineHeight: 22, marginTop: SPACING.md },
  label: { color: COLORS.text, fontWeight: '800', marginTop: SPACING.xl, marginBottom: SPACING.sm },
  row: { flexDirection: 'row', gap: SPACING.sm },
  shortInput: { flex: 1, color: COLORS.text, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, textAlign: 'center', fontSize: FONT.lg },
  yearInput: { flex: 1.5, color: COLORS.text, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md, textAlign: 'center', fontSize: FONT.lg },
  privacy: { color: COLORS.textFaint, fontSize: FONT.sm - 1, marginTop: SPACING.sm, lineHeight: 17 },
  message: { color: COLORS.gold, textAlign: 'center', marginTop: SPACING.md, fontWeight: '700' },
  blocked: { color: COLORS.danger },
  button: { marginTop: SPACING.lg, backgroundColor: COLORS.accent, borderRadius: RADIUS.pill, paddingVertical: SPACING.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  buttonText: { color: '#06251c', fontSize: FONT.md, fontWeight: '900' },
  link: { color: COLORS.accent, textAlign: 'center', fontWeight: '800', marginTop: SPACING.lg, textDecorationLine: 'underline' },
  footer: { color: COLORS.textFaint, fontSize: FONT.sm - 1, textAlign: 'center', lineHeight: 17, marginTop: SPACING.md },
});
