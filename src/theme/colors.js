// Centralized theme for PARISPROMAX — Dark / Emerald Green
// Optimized for readability on low-cost Android devices.

export const COLORS = {
  primary: '#064e3b', // Emerald 900 — headers, primary surfaces
  background: '#0f172a', // Slate 900 — app background
  accent: '#10b981', // Emerald 500 — AI / highlights / CTAs

  // Supporting palette derived from the two base tones
  surface: '#111c33', // Slightly lighter than background — cards
  surfaceAlt: '#15213d',
  border: '#1e293b',

  text: '#f8fafc', // Near-white
  textMuted: '#94a3b8', // Slate 400
  textFaint: '#64748b',

  // Semantic
  gold: '#fbbf24', // Value bets / VIP
  danger: '#ef4444',
  success: '#22c55e',
  info: '#38bdf8',

  // Track conditions
  trackHeavy: '#b45309', // Lourd
  trackSoft: '#0ea5e9', // Souple
  trackDry: '#84cc16', // Sec / Bon

  white: '#ffffff',
  black: '#000000',
  overlay: 'rgba(15, 23, 42, 0.85)',
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
