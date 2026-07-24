import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Image,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import TrialBanner from '../components/TrialBanner';
import TrackCard from '../components/TrackCard';
import TrackCardSkeleton from '../components/Skeleton';
import { loadRaces } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { countryFlags } from '../services/countries';
import { COLORS, SPACING, FONT, RADIUS } from '../theme/colors';

const FLAGS = countryFlags();

export default function HomeScreen({ navigation }) {
  const { country, hasPaid } = useAuth();
  const [tracks, setTracks] = useState([]);
  const [source, setSource] = useState(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Course PMU du jour du pays de l'abonné (Quarté LONAB au Burkina…).
  const [national, setNational] = useState(null);

  const fetchData = useCallback(async () => {
    const { data, source: src, offline: off } = await loadRaces();
    setTracks(data.racetracks || []);
    setSource(src);
    setOffline(off);
    try {
      const n = country ? await api.nationalRace(country) : null;
      setNational(n?.pick || null);
    } catch (e) {
      setNational(null); // hors-ligne : pas de bannière
    }
  }, [country]);

  useEffect(() => {
    (async () => {
      await fetchData();
      setLoading(false);
    })();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const onRacePress = (track, race) => {
    navigation.navigate('RaceDetail', {
      trackName: track.name,
      condition: track.condition,
      race,
    });
  };

  // Ouvre la course nationale (retrouvée dans le programme chargé).
  const openNationalRace = () => {
    const target = national?.race;
    if (!target) return;
    for (const t of tracks) {
      const race = (t.races || []).find((r) => r.id === target.id);
      if (race) return onRacePress(t, { ...race, betType: national.betType || target.betType || null });
    }
  };

  const fcfa = (eur) => `${Math.round((eur * 655.957) / 1000) * 1000}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Programme du jour</Text>
            <Text style={styles.subtitle}>Hippodromes · Courses PMU</Text>
          </View>
          <Image
            source={require('../../assets/logo-emblem-app.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
        </View>
        <View style={styles.list}>
          <TrackCardSkeleton />
          <TrackCardSkeleton />
          <TrackCardSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Programme du jour</Text>
          <Text style={styles.subtitle}>Hippodromes · Courses PMU</Text>
        </View>
        <Pressable
          style={styles.subscribeBtn}
          onPress={() => navigation.navigate('Paywall')}
          accessibilityRole="button"
          accessibilityLabel={hasPaid ? 'Prolonger mon abonnement' : "S'abonner"}
        >
          <Ionicons name="diamond" size={16} color="#06251c" />
          <Text style={styles.subscribeText}>{hasPaid ? 'Prolonger' : "S'abonner"}</Text>
        </Pressable>
      </View>

      <TrialBanner />

      {/* Course PMU du jour du pays (ex. Quarté LONAB -> Enghien C8) */}
      {national?.race && (
        <Pressable style={styles.national} onPress={openNationalRace}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nationalTitle}>
              {FLAGS[country] || '🏇'} {national.betType || 'Course du jour'} — {national.race.track}{' '}
              {national.race.number}
            </Text>
            <Text style={styles.nationalSub} numberOfLines={1}>
              {national.race.name}
              {national.race.time ? ` · ${national.race.time}` : ''}
              {national.race.prize ? ` · ${fcfa(national.race.prize)} F CFA` : ''}
            </Text>
          </View>
          {national.journalUrl ? (
            <Pressable
              style={styles.journalBtn}
              onPress={() => WebBrowser.openBrowserAsync(national.journalUrl)}
              hitSlop={8}
            >
              <Ionicons name="newspaper" size={14} color="#06251c" />
              <Text style={styles.journalText}>Journal</Text>
            </Pressable>
          ) : (
            <Ionicons name="chevron-forward" size={18} color={COLORS.gold} />
          )}
        </Pressable>
      )}

      {offline && (
        <View style={styles.offline}>
          <Ionicons name="cloud-offline" size={14} color={COLORS.gold} />
          <Text style={styles.offlineText}>
            {source === 'cache'
              ? 'Mode hors-ligne — dernières données vérifiées en cache'
              : 'Mode hors-ligne — aucune donnée de course vérifiée disponible'}
          </Text>
        </View>
      )}

      <FlatList
        data={tracks}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TrackCard track={item} onRacePress={onRacePress} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={40} color={COLORS.textFaint} />
            <Text style={styles.emptyText}>
              Aucune course disponible pour le moment. Tirez pour actualiser.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: COLORS.textMuted, marginTop: SPACING.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900' },
  subtitle: { color: COLORS.textMuted, fontSize: FONT.sm, marginTop: 2 },
  headerLogo: { width: 40, height: 40 },
  subscribeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  subscribeText: { color: '#06251c', fontSize: FONT.sm, fontWeight: '900' },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(251,191,36,0.12)',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    paddingVertical: 6,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.sm,
  },
  offlineText: { color: COLORS.gold, fontSize: FONT.sm - 1, fontWeight: '600' },
  national: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.45)',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
  },
  nationalTitle: { color: COLORS.gold, fontWeight: '900', fontSize: FONT.md },
  nationalSub: { color: COLORS.textMuted, fontSize: FONT.sm - 1, marginTop: 2 },
  journalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
  },
  journalText: { color: '#06251c', fontWeight: '900', fontSize: FONT.sm - 1 },
  list: { padding: SPACING.md, paddingBottom: SPACING.xxl, flexGrow: 1 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACING.xxl,
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', fontSize: FONT.sm, lineHeight: 20 },
});
