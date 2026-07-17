import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput, Alert,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../services/api';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

const BET_TYPES = ['Simple', 'Couplé', 'Trio', 'Tiercé', 'Quarté', 'Quinté', 'Autre'];
const emptyTotals = { stake: 0, winnings: 0, profit: 0, count: 0 };
const today = () => new Date().toISOString().slice(0, 10);
const xof = (value) => `${Number(value || 0).toLocaleString('fr-FR')} XOF`;

export default function WalletScreen() {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(emptyTotals);
  const [month, setMonth] = useState(emptyTotals);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [label, setLabel] = useState('');
  const [betType, setBetType] = useState('Quinté');
  const [stake, setStake] = useState('');
  const [winnings, setWinnings] = useState('0');
  const [date, setDate] = useState(today());

  const load = useCallback(async (notifyOnError = false) => {
    try {
      const data = await api.wallet();
      setEntries(data.entries || []);
      setSummary(data.summary || emptyTotals);
      setMonth(data.month || emptyTotals);
    } catch (error) {
      if (notifyOnError) Alert.alert('Portefeuille', 'Impossible d’actualiser le suivi pour le moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const resetForm = () => {
    setEditingId(null); setLabel(''); setStake(''); setWinnings('0'); setDate(today());
  };

  const edit = (entry) => {
    setEditingId(entry.id);
    setLabel(entry.label);
    setBetType(entry.betType || 'Autre');
    setStake(String(entry.stake));
    setWinnings(String(entry.winnings));
    setDate(new Date(entry.playedAt).toISOString().slice(0, 10));
    setShowForm(true);
  };

  const save = async () => {
    if (!label.trim()) return Alert.alert('Information manquante', 'Indiquez la course ou le jeu effectué.');
    if (!(Number(stake) > 0)) return Alert.alert('Mise invalide', 'La dépense doit être supérieure à zéro.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Alert.alert('Date invalide', 'Utilisez le format AAAA-MM-JJ.');
    setSaving(true);
    try {
      const payload = {
        label: label.trim(), betType, date,
        stake: Math.round(Number(stake)), winnings: Math.round(Number(winnings) || 0),
      };
      if (editingId) await api.updateWalletEntry(editingId, payload);
      else await api.addWalletEntry(payload);
      resetForm();
      setShowForm(false);
      await load();
    } catch (error) {
      Alert.alert('Enregistrement impossible', error.message || 'Vérifiez les montants saisis.');
    } finally {
      setSaving(false);
    }
  };

  const remove = (entry) => Alert.alert(
    'Supprimer ce jeu ?',
    `${entry.label}\nMise : ${xof(entry.stake)} · Gain : ${xof(entry.winnings)}`,
    [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          try { await api.deleteWalletEntry(entry.id); await load(); }
          catch { Alert.alert('Erreur', 'Suppression impossible.'); }
        },
      },
    ]
  );

  const header = (
    <View>
      <View style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Portefeuille de jeu</Text>
          <Text style={styles.subtitle}>Suivez vos mises, gains et résultats réels.</Text>
        </View>
        <Ionicons name="wallet" size={30} color={COLORS.accent} />
      </View>

      <View style={[styles.balance, summary.profit >= 0 ? styles.balancePositive : styles.balanceNegative]}>
        <Text style={styles.balanceLabel}>Bilan global</Text>
        <Text style={[styles.balanceValue, { color: summary.profit >= 0 ? COLORS.success : COLORS.danger }]}>
          {summary.profit > 0 ? '+' : ''}{xof(summary.profit)}
        </Text>
        <Text style={styles.balanceMeta}>{summary.count} jeu(x) enregistré(s)</Text>
      </View>

      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Dépenses</Text><Text style={[styles.metricValue, { color: COLORS.danger }]}>{xof(summary.stake)}</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Gains</Text><Text style={[styles.metricValue, { color: COLORS.success }]}>{xof(summary.winnings)}</Text></View>
      </View>

      <View style={styles.monthCard}>
        <Text style={styles.monthTitle}>Ce mois-ci</Text>
        <Text style={[styles.monthValue, { color: month.profit >= 0 ? COLORS.success : COLORS.danger }]}>
          {month.profit > 0 ? '+' : ''}{xof(month.profit)}
        </Text>
        <Text style={styles.monthMeta}>{xof(month.stake)} misés · {xof(month.winnings)} gagnés</Text>
      </View>

      <Pressable style={styles.addButton} onPress={() => {
        if (showForm) resetForm();
        setShowForm((value) => !value);
      }}>
        <Ionicons name={showForm ? 'close' : 'add-circle'} size={20} color="#06251c" />
        <Text style={styles.addButtonText}>{showForm ? 'Fermer' : 'Enregistrer un jeu'}</Text>
      </Pressable>

      {showForm && (
        <View style={styles.form}>
          <Text style={styles.formTitle}>{editingId ? 'Modifier le jeu' : 'Nouveau jeu'}</Text>
          <Text style={styles.label}>Course ou description</Text>
          <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="Ex. R1C4 Prix de Paris" placeholderTextColor={COLORS.textFaint} maxLength={80} />
          <Text style={styles.label}>Type de pari</Text>
          <View style={styles.chips}>
            {BET_TYPES.map((type) => (
              <Pressable key={type} onPress={() => setBetType(type)} style={[styles.chip, betType === type && styles.chipActive]}>
                <Text style={[styles.chipText, betType === type && styles.chipTextActive]}>{type}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.formRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Dépense (XOF)</Text><TextInput style={styles.input} value={stake} onChangeText={(v) => setStake(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="1000" placeholderTextColor={COLORS.textFaint} /></View>
            <View style={{ flex: 1 }}><Text style={styles.label}>Gain (XOF)</Text><TextInput style={styles.input} value={winnings} onChangeText={(v) => setWinnings(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="0" placeholderTextColor={COLORS.textFaint} /></View>
          </View>
          <Text style={styles.label}>Date (AAAA-MM-JJ)</Text>
          <TextInput style={styles.input} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" maxLength={10} placeholder="2026-07-17" placeholderTextColor={COLORS.textFaint} />
          <Pressable style={[styles.saveButton, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
            {saving ? <ActivityIndicator color="#06251c" /> : <><Ionicons name="checkmark" size={19} color="#06251c" /><Text style={styles.saveText}>{editingId ? 'Mettre à jour' : 'Enregistrer'}</Text></>}
          </Pressable>
        </View>
      )}

      <View style={styles.notice}>
        <Ionicons name="information-circle" size={17} color={COLORS.info} />
        <Text style={styles.noticeText}>Outil de suivi uniquement : ParisPromax ne détient ni ne transfère votre argent.</Text>
      </View>
      <Text style={styles.historyTitle}>Historique des jeux</Text>
    </View>
  );

  if (loading) return <SafeAreaView style={[styles.safe, styles.center]}><ActivityIndicator size="large" color={COLORS.accent} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.accent} />}
          ListEmptyComponent={<Text style={styles.empty}>Aucun jeu enregistré. Ajoutez votre première mise pour commencer le suivi.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.entry} onLongPress={() => remove(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.entryTitle}>{item.label}</Text>
                <Text style={styles.entryMeta}>{item.betType || 'Jeu'} · {new Date(item.playedAt).toLocaleDateString('fr-FR')}</Text>
                <Text style={styles.entryAmounts}>{xof(item.stake)} misés · {xof(item.winnings)} gagnés</Text>
              </View>
              <View style={[styles.profitPill, { backgroundColor: item.profit >= 0 ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)' }]}>
                <Text style={[styles.profitText, { color: item.profit >= 0 ? COLORS.success : COLORS.danger }]}>{item.profit > 0 ? '+' : ''}{xof(item.profit)}</Text>
              </View>
              <Pressable hitSlop={8} onPress={() => edit(item)}><Ionicons name="pencil" size={18} color={COLORS.info} /></Pressable>
              <Pressable hitSlop={8} onPress={() => remove(item)}><Ionicons name="trash-outline" size={18} color={COLORS.textFaint} /></Pressable>
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  hero: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.sm, marginBottom: SPACING.md },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900' },
  subtitle: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 3 },
  balance: { borderRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, alignItems: 'center' },
  balancePositive: { backgroundColor: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.45)' },
  balanceNegative: { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.45)' },
  balanceLabel: { color: COLORS.textMuted, fontWeight: '700' },
  balanceValue: { fontSize: 30, fontWeight: '900', marginTop: 3 },
  balanceMeta: { color: COLORS.textFaint, fontSize: FONT.sm, marginTop: 3 },
  metrics: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  metric: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  metricLabel: { color: COLORS.textMuted, fontSize: FONT.sm },
  metricValue: { fontWeight: '900', fontSize: FONT.md, marginTop: 4 },
  monthCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.sm },
  monthTitle: { color: COLORS.textMuted, fontSize: FONT.sm, fontWeight: '700' },
  monthValue: { fontWeight: '900', fontSize: FONT.xl, marginTop: 2 },
  monthMeta: { color: COLORS.textFaint, fontSize: FONT.sm, marginTop: 2 },
  addButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: SPACING.md, marginTop: SPACING.md },
  addButtonText: { color: '#06251c', fontWeight: '900', fontSize: FONT.md },
  form: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.accent },
  formTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginBottom: SPACING.sm },
  label: { color: COLORS.textMuted, fontSize: FONT.sm, fontWeight: '700', marginTop: SPACING.sm, marginBottom: 5 },
  input: { color: COLORS.text, backgroundColor: COLORS.background, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, fontSize: FONT.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm, paddingVertical: 6 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.textMuted, fontSize: FONT.sm, fontWeight: '700' },
  chipTextActive: { color: '#06251c' },
  formRow: { flexDirection: 'row', gap: SPACING.sm },
  saveButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: COLORS.gold, borderRadius: RADIUS.md, paddingVertical: SPACING.md, marginTop: SPACING.md },
  saveText: { color: '#06251c', fontWeight: '900' },
  notice: { flexDirection: 'row', gap: 7, backgroundColor: 'rgba(56,189,248,0.09)', borderRadius: RADIUS.md, padding: SPACING.sm, marginTop: SPACING.sm },
  noticeText: { flex: 1, color: COLORS.textMuted, fontSize: FONT.sm, lineHeight: 17 },
  historyTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginTop: SPACING.lg, marginBottom: SPACING.sm },
  empty: { color: COLORS.textMuted, textAlign: 'center', padding: SPACING.xl, lineHeight: 20 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border },
  entryTitle: { color: COLORS.text, fontWeight: '800', fontSize: FONT.md },
  entryMeta: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 2 },
  entryAmounts: { color: COLORS.textFaint, fontSize: FONT.sm - 1, marginTop: 3 },
  profitPill: { borderRadius: RADIUS.pill, paddingHorizontal: SPACING.sm, paddingVertical: 5 },
  profitText: { fontWeight: '900', fontSize: FONT.sm },
});
