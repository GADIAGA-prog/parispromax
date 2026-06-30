import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../theme/colors';

// A single shimmering placeholder block.
export function SkeletonBlock({ width = '100%', height = 16, radius = RADIUS.sm, style }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: COLORS.surfaceAlt, opacity },
        style,
      ]}
    />
  );
}

// A track-card-shaped skeleton, used on the Home screen while loading.
export default function TrackCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SkeletonBlock width={140} height={20} />
        <SkeletonBlock width={70} height={20} radius={RADIUS.pill} />
      </View>
      <SkeletonBlock width={160} height={12} style={{ marginTop: SPACING.md }} />
      <SkeletonBlock width="100%" height={44} style={{ marginTop: SPACING.md }} />
      <SkeletonBlock width="100%" height={44} style={{ marginTop: SPACING.sm }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
