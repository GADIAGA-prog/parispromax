import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

const SLIDES = [
  {
    icon: 'sparkles',
    title: 'Pronostics IA',
    text: "Notre intelligence artificielle analyse forme, cotes et chronos pour vous livrer les TOP PRONOS, Value Bets et Records Chrono de chaque course PMU.",
  },
  {
    icon: 'cloud-offline',
    title: 'Conçu pour vos connexions',
    text: "Optimisé pour les réseaux lents : les courses se chargent vite et restent disponibles hors-ligne grâce au cache intégré.",
  },
  {
    icon: 'pricetags',
    title: 'Des formules pour tous',
    text: "Abonnez-vous à partir de 200 XOF/jour. Payez facilement par carte bancaire ou Mobile Money (Orange, MTN, Wave, Moov).",
  },
];

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const { completeOnboarding } = useSettings();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef(null);

  const goTo = (i) => {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  const onScroll = (e) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
      >
        {SLIDES.map((s) => (
          <View key={s.title} style={[styles.slide, { width }]}>
            <View style={styles.iconWrap}>
              <Ionicons name={s.icon} size={56} color={COLORS.accent} />
            </View>
            <Text style={styles.title}>{s.title}</Text>
            <Text style={styles.text}>{s.text}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        <Pressable onPress={completeOnboarding} hitSlop={10}>
          <Text style={styles.skip}>Passer</Text>
        </Pressable>
        <Pressable style={styles.next} onPress={() => (isLast ? completeOnboarding() : goTo(index + 1))}>
          <Text style={styles.nextText}>{isLast ? 'Commencer' : 'Suivant'}</Text>
          <Ionicons name="arrow-forward" size={18} color="#06251c" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl },
  iconWrap: {
    width: 110, height: 110, borderRadius: 55, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xl,
  },
  title: { color: COLORS.text, fontSize: FONT.xxl, fontWeight: '900', textAlign: 'center' },
  text: { color: COLORS.textMuted, fontSize: FONT.md, textAlign: 'center', marginTop: SPACING.md, lineHeight: 22 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: SPACING.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.accent, width: 22 },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg,
  },
  skip: { color: COLORS.textMuted, fontSize: FONT.md, fontWeight: '600' },
  next: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.accent,
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.pill,
  },
  nextText: { color: '#06251c', fontWeight: '900', fontSize: FONT.md },
});
