import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';

// A Pressable that gently scales down while pressed — adds tactile feedback
// to cards. Uses the native driver so it stays smooth on low-end devices.
export default function PressableScale({
  children,
  onPress,
  style,
  scaleTo = 0.97,
  disabled = false,
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (to) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => animate(scaleTo)}
      onPressOut={() => animate(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
