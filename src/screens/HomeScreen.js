import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import TrialBanner from '../components/TrialBanner';
import TrackCard from '../components/TrackCard';
import TrackCardSkeleton from '../components/Skeleton';
import { loadRaces } from '../services/dataService';
import { analyzeRace } from '../services/aiEngine';
import { COLORS, SPACING, FONT, RADIUS } from '../theme/colors';

export default function HomeScreen({ navigation }) {
  const [tracks, setTracks] = useState([]);
  const [source, setSource] = useState(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    const { data, source: src, offline: off } = await loadRaces();
    // Pre-analyze every race so AI scores/badges are ready for the cards.
    const analyzed = (data.racetracks || []).map((t) => ({
      ...t,
      races: t.races.map((r) => analyzeRace(r)),
    }));
    setTracks(analyzed);
    setSource(src);
    setOffline(off);
  }, []);

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

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Programme du jour</Text>
            <Text style={styles.subtitle}>Hippodromes · Courses PMU</Text>
          </View>
          <Ionicons name="sparkles" size={26} color={COLORS.accent} />
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
        <Ionicons name="sparkles" size={26} color={COLORS.accent} />
      </View>

      <TrialBanner />

      {offline && (
        <View style={styles.offline}>
          <Ionicons name="cloud-offline" size={14} color={COLORS.gold} />
          <Text style={styles.offlineText}>
            Mode hors-ligne — données {source === 'cache' ? 'en cache' : 'locales'}
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
