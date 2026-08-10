import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Image,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import TrialBanner from '../components/TrialBanner';
import NationalGameCard from '../components/NationalGameCard';
import TrackCard from '../components/TrackCard';
import TrackCardSkeleton from '../components/Skeleton';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { countryFlags } from '../services/countries';
import { mergeRacePrograms } from '../services/raceProgram';
import { COLORS, SPACING, FONT, RADIUS } from '../theme/colors';

const FLAGS = countryFlags();
const { getNationalGame } = require('../../shared/nationalGameRules');
const { formatRaceReference } = require('../../shared/raceReference');

export default function HomeScreen({ navigation }) {
  const { country, hasPaid, hasAccess } = useAuth();
  const [tracks, setTracks] = useState([]);
  const [offline, setOffline] = useState(false);
  const [programError, setProgramError] = useState(null);
  const [ecdError, setEcdError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Course PMU du jour du pays de l'abonné (Quarté LONAB au Burkina…).
  const [national, setNational] = useState(null);
  const [nationalGame, setNationalGame] = useState(null);
  const [nationalError, setNationalError] = useState(null);
  const [ecdProfile, setEcdProfile] = useState(null);
  const [ecdSelectionMode, setEcdSelectionMode] = useState(null);

  const fetchData = useCallback(async () => {
    const [nationalState, ecdState, programState] = await Promise.allSettled([
      country ? api.nationalRace(country) : Promise.resolve(null),
      country ? api.ecdRaces(country) : Promise.resolve(null),
      api.races(),
    ]);
    const nationalResult = nationalState.status === 'fulfilled' ? nationalState.value : null;
    const ecdResult = ecdState.status === 'fulfilled' ? ecdState.value : null;
    const programResult = programState.status === 'fulfilled' ? programState.value : null;
    const failures = [nationalState, ecdState, programState]
      .filter((state) => state.status === 'rejected')
      .map((state) => state.reason);
    setOffline(failures.some((error) => error?.code === 'NETWORK_ERROR' || error?.code === 'TIMEOUT'));
    const today = new Date().toISOString().slice(0, 10);
    const fallbackGame = country === 'bf' ? getNationalGame(country, today) : null;
    if (nationalState.status === 'fulfilled') {
      setNational(nationalResult?.pick || null);
      setNationalGame(nationalResult?.game || fallbackGame);
      setNationalError(null);
    } else {
      setNational(null);
      setNationalGame(null);
      setNationalError(nationalState.reason || new Error('Course nationale indisponible.'));
    }
    const programDate = programResult?.meta?.date || null;
    const ecdDate = ecdResult?.date || null;
    const programmesShareDate = !programDate || !ecdDate || programDate === ecdDate;
    const ecdTracks = ecdState.status === 'fulfilled'
      && programmesShareDate
      && Array.isArray(ecdResult?.racetracks)
      ? ecdResult.racetracks
      : [];
    const programTracks = programState.status === 'fulfilled' && Array.isArray(programResult?.racetracks)
      ? programResult.racetracks
      : [];
    setTracks(mergeRacePrograms(programTracks, ecdTracks, { programDate, ecdDate }));
    setProgramError(
      programState.status === 'rejected'
        ? programState.reason || new Error('Programme complet indisponible.')
        : null
    );
    if (ecdState.status === 'fulfilled' && programmesShareDate) {
      setEcdProfile(ecdResult?.profile || null);
      setEcdSelectionMode(ecdResult?.selectionMode || null);
      setEcdError(null);
    } else {
      // The full programme remains useful, but its races are not relabelled as
      // ECD when the official country payload cannot be verified.
      setEcdProfile(null);
      setEcdSelectionMode(null);
      setEcdError(
        !programmesShareDate
          ? new Error('Le programme ECD est encore daté de la journée précédente.')
          : ecdState.reason || new Error('Programme ECD indisponible.')
      );
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

  const openRaceDetail = (track, race, predictionMode, game = null) => {
    navigation.navigate('RaceDetail', {
      trackName: track.name,
      condition: track.condition,
      race,
      nationalGame: game,
      predictionMode,
    });
  };
  const openProgramRace = (track, race) => {
    const isOfficialEcd = Boolean(race?.ecd && ecdProfile);
    return openRaceDetail(
      track,
      isOfficialEcd ? { ...race, ecdProfile } : race,
      isOfficialEcd ? 'ecd' : 'program'
    );
  };

  const programmeStats = useMemo(() => {
    const races = tracks.flatMap((track) => track.races || []);
    return {
      races: races.length,
      meetings: tracks.length,
      ecdRaces: races.filter((race) => race?.ecd).length,
    };
  }, [tracks]);

  // Ouvre la course nationale (retrouvée dans le programme chargé).
  const openNationalRace = () => {
    const target = national?.race;
    if (!target) return;
    for (const t of tracks) {
      const race = (t.races || []).find((r) => r.id === target.id);
      if (race) {
        return openRaceDetail(
          t,
          { ...race, betType: national.betType || target.betType || null },
          'national',
          nationalGame
        );
      }
    }
    return openRaceDetail(
      {
        name: target.track,
        condition: null,
      },
      {
        ...target,
        betType: national.betType || target.betType || null,
      },
      'national',
      nationalGame
    );
  };

  const fcfa = (eur) => `${Math.round((eur * 655.957) / 1000) * 1000}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Aujourd'hui</Text>
            <Text style={styles.subtitle}>Course nationale · Toutes les courses</Text>
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
          <Text style={styles.title}>Aujourd'hui</Text>
          <Text style={styles.subtitle}>Course nationale · Toutes les courses</Text>
        </View>
        <Pressable
          style={styles.subscribeBtn}
          onPress={() => navigation.navigate('Paywall')}
          accessibilityRole="button"
          accessibilityLabel={hasPaid ? 'Prolonger mon abonnement' : "S'abonner"}
        >
          <Ionicons name="diamond" size={16} color={COLORS.white} />
          <Text style={styles.subscribeText}>{hasPaid ? 'Prolonger' : "S'abonner"}</Text>
        </Pressable>
      </View>

      <TrialBanner />

      {offline && (
        <View style={styles.offline}>
          <Ionicons name="cloud-offline" size={14} color={COLORS.gold} />
          <Text style={styles.offlineText}>
            Connexion dégradée — certaines données officielles n’ont pas pu être actualisées.
          </Text>
        </View>
      )}

      <FlatList
        data={tracks}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <View style={styles.raceVisualRow}>
              <View style={styles.raceVisualCard}>
                <Image source={require('../../assets/race-flat.jpg')} style={styles.raceVisualImage} />
                <View style={styles.raceVisualShade}>
                  <Text style={styles.raceVisualLabel}>COURSES DE PLAT</Text>
                </View>
              </View>
              <View style={styles.raceVisualCard}>
                <Image source={require('../../assets/race-harness.jpg')} style={styles.raceVisualImage} />
                <View style={styles.raceVisualShade}>
                  <Text style={styles.raceVisualLabel}>TROT ATTELÉ</Text>
                </View>
              </View>
            </View>
            <View style={styles.sectionLabelRow}>
              <View>
                <Text style={styles.sectionKicker}>JEU NATIONAL DU JOUR</Text>
                <Text style={styles.sectionTitle}>Pronostic et mise</Text>
              </View>
              <Text style={styles.countryBadge}>
                {FLAGS[country] || '🏇'} {String(country || '').toUpperCase()}
              </Text>
            </View>
            <View style={styles.nationalBundle}>
              {nationalError ? (
                <View style={styles.nationalUnavailable}>
                  <Ionicons name="warning-outline" size={17} color={COLORS.gold} />
                  <Text style={styles.nationalUnavailableText}>
                    Course nationale momentanément indisponible. Aucun pronostic de remplacement n’est affiché.
                  </Text>
                </View>
              ) : null}
              {national?.race && (
                <Pressable style={styles.national} onPress={openNationalRace}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nationalTitle}>
                      {national.betType || 'Course du jour'} · {national.race.track}{' '}
                      {formatRaceReference(national.race)}
                    </Text>
                    <Text style={styles.nationalSub} numberOfLines={2}>
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
                      <Ionicons name="newspaper" size={14} color="#ffffff" />
                      <Text style={styles.journalText}>Journal</Text>
                    </Pressable>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={COLORS.accent} />
                  )}
                </Pressable>
              )}
              {hasAccess && nationalGame ? <NationalGameCard game={nationalGame} /> : null}
              {(national?.race || nationalGame) ? (
                <Pressable
                  style={styles.nationalSummaryButton}
                  onPress={() => navigation.navigate('Nationale')}
                  accessibilityRole="button"
                  accessibilityLabel="Ouvrir la synthèse de la course nationale"
                >
                  <Ionicons name="analytics-outline" size={16} color={COLORS.onAccent} />
                  <Text style={styles.nationalSummaryText}>Voir la synthèse nationale et son taux</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.ecdHeading}>
              <Text style={styles.sectionKicker}>PROGRAMME COMPLET · COURSES EN DIRECT</Text>
              <Text style={styles.sectionTitle}>Toutes les courses du jour</Text>
              <Text style={styles.ecdHelp}>
                {programmeStats.races
                  ? `${programmeStats.races} courses dans ${programmeStats.meetings} réunion${programmeStats.meetings > 1 ? 's' : ''}. `
                  : ''}
                {programError
                  ? 'Le programme complet est momentanément indisponible ; les courses ECD déjà publiées restent affichées.'
                  : ecdError
                    ? 'Les courses restent disponibles, mais le marquage ECD officiel est momentanément indisponible.'
                    : ecdSelectionMode === 'official-country-program'
                      ? `${programmeStats.ecdRaces} courses appartiennent au programme ECD officiel de votre opérateur.`
                      : ecdSelectionMode === 'country-validated'
                        ? `${programmeStats.ecdRaces} courses ECD sont validées pour votre pays.`
                        : 'Le programme ECD officiel du pays est en attente de publication.'}
                {ecdProfile?.unitStake
                  ? ` Mise de base ECD : ${ecdProfile.unitStake.toLocaleString('fr-FR')} FCFA.`
                  : ''}
              </Text>
              {ecdError ? (
                <View style={styles.ecdUnavailable}>
                  <Ionicons name="warning-outline" size={17} color={COLORS.gold} />
                  <Text style={styles.ecdUnavailableText}>
                    {ecdError.message || 'Le marquage ECD officiel ne peut pas être chargé pour le moment.'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <TrackCard track={item} meetingNumber={index + 1} onRacePress={openProgramRace} />
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
              {programError || ecdError
                ? 'Aucune course disponible pour le moment. Tirez pour réessayer.'
                : 'Aucune course publiée pour le moment. Tirez pour actualiser.'}
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
  subscribeText: { color: COLORS.white, fontSize: FONT.sm, fontWeight: '900' },
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
  offlineText: { flexShrink: 1, color: COLORS.gold, fontSize: FONT.sm - 1, fontWeight: '600' },
  national: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: '#F3F8F5',
    borderWidth: 1,
    borderColor: '#C9DED3',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
  },
  nationalTitle: { color: COLORS.primary, fontWeight: '900', fontSize: FONT.md },
  nationalSub: { color: COLORS.textMuted, fontSize: FONT.sm - 1, marginTop: 2 },
  journalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
  },
  journalText: { color: '#ffffff', fontWeight: '900', fontSize: FONT.sm - 1 },
  list: { padding: SPACING.md, paddingBottom: SPACING.xxl, flexGrow: 1 },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  sectionKicker: { color: COLORS.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  sectionTitle: { color: COLORS.text, fontSize: FONT.xl, fontWeight: '900', marginTop: 2 },
  countryBadge: {
    color: COLORS.primary,
    backgroundColor: '#E8F3EE',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    fontSize: 10,
    fontWeight: '900',
  },
  nationalBundle: {
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    marginBottom: SPACING.xl,
  },
  nationalUnavailable: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm,
    padding: SPACING.sm, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.45)',
    backgroundColor: 'rgba(251,191,36,0.10)',
  },
  nationalUnavailableText: { flex: 1, color: COLORS.text, fontSize: FONT.sm - 1, lineHeight: 17 },
  nationalSummaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.accent,
  },
  nationalSummaryText: {
    flexShrink: 1, color: COLORS.onAccent, fontSize: FONT.sm,
    fontWeight: '900', textAlign: 'center',
  },
  ecdHeading: {
    paddingHorizontal: 2,
    paddingBottom: SPACING.md,
  },
  ecdHelp: { color: COLORS.textMuted, fontSize: FONT.sm - 1, lineHeight: 17, marginTop: 4 },
  ecdUnavailable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.45)',
    borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(251,191,36,0.10)',
  },
  ecdUnavailableText: { flex: 1, color: COLORS.text, fontSize: FONT.sm - 1, lineHeight: 17 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACING.xxl,
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', fontSize: FONT.sm, lineHeight: 20 },
  raceVisualRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  raceVisualCard: {
    flex: 1,
    height: 126,
    overflow: 'hidden',
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.primary,
  },
  raceVisualImage: { width: '100%', height: '100%' },
  raceVisualShade: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 9,
    backgroundColor: 'rgba(6, 37, 28, 0.72)',
  },
  raceVisualLabel: { color: COLORS.white, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
});
