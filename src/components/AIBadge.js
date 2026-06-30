import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { RADIUS, FONT } from '../theme/colors';

// Renders a single AI badge ({ label, color }) produced by aiEngine.
// The flagship "TOP" badge gently pulses to draw the eye.
export default function AIBadge({ badge }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const animated = badge && badge.key === 'TOP';

  useEffect(() => {
    if (!animated) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [animated, pulse]);

  if (!badge) return null;
  return (
    <Animated.View
      style={[
        styles.badge,
        { borderColor: badge.color },
        animated && { transform: [{ scale: pulse }] },
      ]}
    >
      <Text style={[styles.text, { color: badge.color }]} numberOfLines={1}>
        {badge.label}
      </Text>
    </Animated.View>
  );
}

// Renders a horizontal row of badges.
export function AIBadgeRow({ badges }) {
  if (!badges || badges.length === 0) return null;
  return (
    <View style={styles.row}>
      {badges.map((b) => (
        <AIBadge key={b.key} badge={b} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  badge: {
    borderWidth: 1.5,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  text: {
    fontSize: FONT.sm - 1,
    fontWeight: '800',
  },
});
