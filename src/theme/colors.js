// Neutral light theme: one strong brand color, one action color, and generous
// contrast. This keeps dense race information readable on low-cost devices.

export const COLORS = {
  primary: '#102f3d',
  background: '#f4f6f8',
  accent: '#087554',

  // Brand blue (from the logo) — logo backdrops, brand accents.
  brand: '#166d8f',
  brandDark: '#102f3d',

  // Supporting palette derived from the two base tones
  surface: '#ffffff',
  surfaceAlt: '#eef2f4',
  border: '#dbe3e8',

  text: '#18242c',
  textMuted: '#5f6f79',
  textFaint: '#7d8a92',

  // Semantic
  gold: '#b47a13',
  danger: '#c83d3d',
  success: '#16845f',
  info: '#166d8f',

  // Track conditions
  trackHeavy: '#b45309', // Lourd
  trackSoft: '#0ea5e9', // Souple
  trackDry: '#84cc16', // Sec / Bon

  white: '#ffffff',
  black: '#000000',
  overlay: 'rgba(16, 47, 61, 0.72)',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const FONT = {
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  xxl: 26,
};

// Map a track-condition key to a label + color.
export const TRACK_CONDITIONS = {
  heavy: { label: 'Lourd', color: COLORS.trackHeavy, icon: 'rainy' },
  soft: { label: 'Souple', color: COLORS.trackSoft, icon: 'water' },
  dry: { label: 'Bon / Sec', color: COLORS.trackDry, icon: 'sunny' },
};

export default COLORS;
