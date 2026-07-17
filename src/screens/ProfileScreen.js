import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { sendTestNotification } from '../services/NotificationService';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

const STATUS_LABEL = {
  success: 'Réussi',
  pending: 'En attente',
  failed: 'Échoué',
  cancelled: 'Annulé',
};

export default function ProfileScreen({ navigation }) {
  const { phone, hasPaid, plan, paidUntil, referral, logout, refreshAccess } = useAuth();

  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPayments = useCallback(async () => {
    try {
      const data = await api.myPayments();
      setPayments(data.payments || []);
    } catch (e) {
      // offline / not critical
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshAccess(), loadPayments()]);
    setRefreshing(false);
  };

  const statusLabel = hasPaid ? 'Abonné VIP' : 'Non abonné';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Mon profil</Text>
          <Pressable onPress={onRefresh} hitSlop={10}>
            <Ionicons name={refreshing ? 'sync' : 'refresh'} size={22} color={COLORS.textMuted} />
          </Pressable>
        </View>

        <View style={styles.referralCard}>
          <Ionicons name="gift" size={26} color={COLORS.gold} />
          <Text style={styles.referralTitle}>Parrainez vos proches</Text>
          <Text style={styles.referralText}>Ils économisent {referral?.discountPercent || 10}% sur leur premier paiement et vous gagnez 7 jours d'abonnement.</Text>
          <Text style={styles.referralCode} selectable>{referral?.code || 'Chargement…'}</Text>
          <Pressable
            style={styles.shareButton}
            disabled={!referral?.code}
            onPress={() => Share.share({ message: `Rejoins ParisPromax avec mon code ${referral.code} et profite de ${referral.discountPercent}% de réduction sur ton premier paiement.` })}
          >
            <Ionicons name="share-social" size={18} color="#06251c" />
            <Text style={styles.shareText}>Partager mon code</Text>
          </Pressable>
          {!!referral?.successfulReferrals && (
            <Text style={styles.referralCount}>{referral.successfulReferrals} parrainage(s) récompensé(s)</Text>
          )}
        </View>

        {/* Account card */}
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={28} color={COLORS.accent} />
          </View>
          <Text style={styles.phone}>
            {phone ? (phone.startsWith('+') ? phone : `+${phone}`) : 'Invité'}
          </Text>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: hasPaid ? COLORS.gold : COLORS.danger },
            ]}
          >
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
          {hasPaid && paidUntil && (
            <Text style={styles.paidUntil}>
              Valable jusqu'au {new Date(paidUntil).toLocaleDateString('fr-FR')}
            </Text>
          )}
        </View>

        {/* Actions */}
        <Pressable style={styles.action} onPress={() => navigation.navigate('Paywall')}>
          <Ionicons name="diamond" size={20} color={COLORS.gold} />
          <Text style={styles.actionText}>{hasPaid ? 'Changer / prolonger mon abonnement' : 'Voir les abonnements'}</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </Pressable>

        <Pressable
          style={styles.action}
          onPress={() =>
            Alert.alert(
              'Code de récupération',
              "Un NOUVEAU code va être généré (l'ancien ne marchera plus). Notez-le : c'est le seul moyen de récupérer votre compte en cas d'oubli du mot de passe. Continuer ?",
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Générer',
                  onPress: async () => {
                    try {
                      const r = await api.newRecoveryCode();
                      Alert.alert('🔑 Votre nouveau code', `${r.recoveryCode}\n\nNotez-le précieusement (photo, papier…).`);
                    } catch (e) {
                      Alert.alert('Erreur', 'Impossible de générer le code. Réessayez.');
                    }
                  },
                },
              ]
            )
          }
        >
          <Ionicons name="key" size={20} color={COLORS.gold} />
          <Text style={styles.actionText}>Voir mon code de récupération</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </Pressable>

        <Pressable
          style={styles.action}
          onPress={async () => {
            const ok = await sendTestNotification();
            if (!ok) {
              Alert.alert('Notifications', "Disponibles dans l'app installée (APK). Indisponibles dans Expo Go.");
            }
          }}
        >
          <Ionicons name="notifications" size={20} color={COLORS.accent} />
          <Text style={styles.actionText}>Tester une notification</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </Pressable>

        {/* Payment history */}
        <Text style={styles.sectionLabel}>Historique des paiements</Text>
        {loadingPayments ? (
          <ActivityIndicator color={COLORS.accent} style={{ marginVertical: SPACING.md }} />
        ) : payments.length === 0 ? (
          <Text style={styles.empty}>Aucun paiement pour le moment.</Text>
        ) : (
          payments.map((p) => (
            <View key={p.transactionId} style={styles.payRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.payAmount}>
                  {p.amount.toLocaleString('fr-FR')} {p.currency}
                </Text>
                <Text style={styles.payMeta}>
                  {new Date(p.createdAt).toLocaleDateString('fr-FR')} · {p.method || '—'}
                </Text>
              </View>
              <View style={[styles.payBadge, styles[`pay_${p.status}`]]}>
                <Text style={styles.payBadgeText}>{STATUS_LABEL[p.status] || p.status}</Text>
              </View>
            </View>
          ))
        )}

        <Pressable style={[styles.action, { marginTop: SPACING.lg }]} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
          <Text style={[styles.actionText, { color: COLORS.danger }]}>Se déconnecter</Text>
        </Pressable>

        {/* Suppression de compte — exigence Google Play (apps avec compte). */}
        <Pressable
          style={styles.action}
          onPress={() =>
            Alert.alert(
              'Supprimer mon compte',
              'Cette action est définitive : votre compte, votre abonnement et vos données seront supprimés. Continuer ?',
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Supprimer définitivement',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await api.deleteAccount();
                      await logout();
                    } catch (e) {
                      Alert.alert('Erreur', "Suppression impossible pour le moment. Réessayez ou écrivez-nous.");
                    }
                  },
                },
              ]
            )
          }
        >
          <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
          <Text style={[styles.actionText, { color: COLORS.danger }]}>Supprimer mon compte</Text>
        </Pressable>

        <Text style={styles.version}>ParisPromax v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.lg },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900' },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.xl,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg,
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
  },
  phone: { color: COLORS.text, fontSize: FONT.xl, fontWeight: '900' },
  statusPill: { marginTop: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.pill },
  statusText: { color: '#06251c', fontWeight: '800', fontSize: FONT.sm },
  paidUntil: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: SPACING.sm },
  referralCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.gold, marginBottom: SPACING.lg,
  },
  referralTitle: { color: COLORS.text, fontSize: FONT.lg, fontWeight: '900', marginTop: SPACING.sm },
  referralText: { color: COLORS.textMuted, fontSize: FONT.sm, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  referralCode: { color: COLORS.gold, fontSize: FONT.xl, fontWeight: '900', letterSpacing: 2, marginTop: SPACING.md },
  shareButton: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, marginTop: SPACING.md },
  shareText: { color: '#06251c', fontWeight: '900' },
  referralCount: { color: COLORS.accent, fontSize: FONT.sm, fontWeight: '700', marginTop: SPACING.sm },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  actionText: { color: COLORS.text, fontSize: FONT.md, fontWeight: '700', flex: 1 },
  sectionLabel: { color: COLORS.textMuted, fontSize: FONT.sm, fontWeight: '700', marginTop: SPACING.md, marginBottom: SPACING.sm },
  currencyRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm, flexWrap: 'wrap' },
  currencyChip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, minWidth: 56, alignItems: 'center',
  },
  currencyChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  currencyChipText: { color: COLORS.text, fontWeight: '800', fontSize: FONT.sm },
  empty: { color: COLORS.textFaint, fontSize: FONT.sm, fontStyle: 'italic', marginBottom: SPACING.sm },
  payRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  payAmount: { color: COLORS.text, fontWeight: '800', fontSize: FONT.md },
  payMeta: { color: COLORS.textFaint, fontSize: FONT.sm - 1, marginTop: 2 },
  payBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.sm },
  payBadgeText: { fontWeight: '800', fontSize: FONT.sm - 2, color: COLORS.text },
  pay_success: { backgroundColor: 'rgba(34,197,94,0.15)' },
  pay_pending: { backgroundColor: 'rgba(251,191,36,0.15)' },
  pay_failed: { backgroundColor: 'rgba(239,68,68,0.15)' },
  pay_cancelled: { backgroundColor: 'rgba(148,163,184,0.15)' },
  version: { color: COLORS.textFaint, textAlign: 'center', marginTop: SPACING.xl, fontSize: FONT.sm },
});
