import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONT } from '../theme/colors';

export const DISCLAIMER_TEXT =
  "Les pronostics sont générés par une intelligence artificielle à titre informatif et ne garantissent aucun gain. Les paris comportent des risques — jouez avec modération.";

// Small legal disclaimer shown near AI predictions.
export default function Disclaimer({ compact = false }) {
  return (
    <View style={[styles.box, compact && styles.compact]}>
      <Ionicons name="information-circle-outline" size={compact ? 13 : 15} color={COLORS.textMuted} />
      <Text style={[styles.text, compact && styles.textCompact]}>{DISCLAIMER_TEXT}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  compact: { marginTop: SPACING.sm, padding: 6 },
  text: { color: COLORS.textMuted, fontSize: FONT.sm - 1, flex: 1, lineHeight: 16 },
  textCompact: { fontSize: FONT.sm - 2 },
});
