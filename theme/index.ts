// KeepFresh AI — Design System. Single source of truth.
//
// Every component reads its colors, spacing and radii from this file; nothing
// hardcodes a hex value or a pixel measurement. `src/theme` re-exports this
// module, so `../theme` and `../src/theme` resolve to the same objects — the
// two import paths used across the app are interchangeable by construction
// rather than by two copies being kept in sync.

export const colors = {
  primaryDark: '#0F5132',   // headers, primary CTA, active nav, dark banners
  primary: '#0F5132',       // buttons, active icons, links
  secondary: '#10B981',     // affirmative actions, fresh states, active indicators
  mint: '#10B981',          // alias for the documented crisp mint accent
  mintBg: '#EBF3ED',        // grouped containers, highlight cards, AI banners
  screenBg: '#F6F8F5',      // page background
  surface: '#FFFFFF',       // card surfaces
  warning: '#F59E0B',       // expiring soon
  danger: '#EF4444',        // expired / delete / high price
  textPrimary: '#1E2922',
  textSecondary: '#6B7280',
  border: '#DCE8DF',
};

export const radii = {
  sm: 12,
  md: 20,
  lg: 24,
  pill: 999,
};

/**
 * The page rhythm.
 *
 * These are the values the app's screens were laid out against — every gutter,
 * gap and inset in `app/` and `src/` was authored to this scale, and the
 * component geometry that derives from it (`useFloatingTabBar`'s content inset,
 * `useContentLayout`'s page gutter) inherits it. Changing them here moves every
 * screen at once rather than one at a time.
 *
 * A tighter 4/8/12/16/20/24 scale was tried and reverted: it reads fine on a
 * blank screen, but applied to layouts already built at this one it shrank
 * every gutter by a quarter to a half, which crowded rows into each other and
 * pulled content out from under the floating tab bar.
 */
export const spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const typography = {
  h1: { fontSize: 26, fontWeight: '700' as const, color: colors.textPrimary },
  h2: { fontSize: 17, fontWeight: '600' as const, color: colors.textPrimary },
  statNumber: { fontSize: 34, fontWeight: '800' as const, color: colors.textPrimary },
  body: { fontSize: 14, fontWeight: '400' as const, color: colors.textPrimary },
  caption: { fontSize: 12, fontWeight: '400' as const, color: colors.textSecondary },
  badge: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3 },
};

export const shadow = {
  card: {
    shadowColor: '#0F5132',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  // A hairline lift for things that sit *on* a card rather than being one — a
  // dropdown panel, a badge. Card elevation on those read as a second card.
  faint: {
    shadowColor: '#0F5132',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
};

/**
 * Tinted panels for the two "something needs your attention" states.
 *
 * `colors.warning` and `colors.danger` are the accents — a dot, an icon, a
 * badge. They are too light to carry 12px body copy on their own tint, so a
 * notice panel pairs the tint with a darker shade of the same hue. The values
 * are held here rather than retyped per screen: this trio was spelled out in
 * four files and had already drifted into two different ambers.
 */
export const statusSurface = {
  success: { bg: '#E8F8F0', border: '#B5E6CC', text: '#107C41' },
  warning: { bg: '#FEF3C7', border: '#F5D48A', text: '#B45309' },
  danger: { bg: '#FEE2E2', border: '#F3B7B7', text: '#B91C1C' },
};

/**
 * The dim behind a modal, a bottom sheet or a date picker.
 *
 * Held here because seven of them spelled the same rgba out by hand. The legacy
 * `COLORS.overlay` alias defined a second, lighter value (0.35) that nothing in
 * the app referenced — two dim levels for one job is the drift this file exists
 * to prevent, so the alias now points at this.
 */
export const overlay = 'rgba(0, 0, 0, 0.45)';

/* --------------------------------------------------------------------------
 * Legacy aliases.
 *
 * The screens and shared components were originally written against these
 * names. They are kept pointing at the tokens above so every existing import
 * keeps resolving, but new code should reach for `colors` / `spacing` /
 * `radii` directly.
 * ------------------------------------------------------------------------ */

export const COLORS = {
  // Brand
  primary: colors.primary,
  primaryDark: colors.primaryDark,
  primaryLight: colors.mintBg,
  mintBg: colors.mintBg,
  secondary: colors.secondary,
  accentLight: '#34D399',

  // Neutrals
  background: colors.screenBg,
  screenBg: colors.screenBg,
  white: colors.surface,
  surface: colors.surface,
  text: colors.textPrimary,
  textPrimary: colors.textPrimary,
  secondaryText: colors.textSecondary,
  textSecondary: colors.textSecondary,
  divider: colors.border,
  border: colors.border,
  disabled: '#DCE8DF',
  mutedBg: '#EBF3ED',
  chartBar: '#9BB8A5',

  // Solid accent colors
  warning: colors.warning,
  danger: colors.danger,
  success: colors.secondary,
  star: colors.warning,

  // Status badge pairs
  successBg: statusSurface.success.bg,
  successText: statusSurface.success.text,
  warningBg: statusSurface.warning.bg,
  warningText: statusSurface.warning.text,
  dangerBg: statusSurface.danger.bg,
  dangerText: statusSurface.danger.text,
  neutralBg: colors.mintBg,
  neutralText: colors.textSecondary,
  wastedBg: statusSurface.danger.bg,
  wastedText: statusSurface.danger.text,

  // Misc
  overlay,
  scanCorner: '#FFFFFF',
  greenGradientTop: '#DCF2E6',
  greenGradientBottom: '#C3E7D3',
};

export const RADII = {
  // Every card is radii.lg per the design system, whichever import path a file
  // takes. This alias previously resolved to 20 through one path and 24 through
  // another, so card corners depended on where the component imported from.
  card: radii.lg,
  input: radii.sm,
  lg: radii.lg,
  pill: radii.pill,
  image: radii.md,
  icon: 12,
  avatar: radii.pill,
};

export const SHADOW = {
  card: shadow.card,
  faint: shadow.faint,
};

export const SPACING = {
  xs: spacing.xs,
  sm: spacing.sm,
  md: spacing.md,
  lg: spacing.lg,
  xl: spacing.xl,
  xxl: spacing.xxl,
};

export const SIZES = {
  base: 8,
  font: 14,
  radius: radii.md,
  padding: spacing.lg,
  margin: spacing.sm,
  header: 24,
  icon: 20,
  borderWidth: 1,
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
  display1: { fontFamily: 'System', fontSize: 32, fontWeight: '800' },
  display2: { fontFamily: 'System', fontSize: 26, fontWeight: '800' },
  display3: { fontFamily: 'System', fontSize: 21, fontWeight: '700' },
  headline1: { fontFamily: 'System', fontSize: 18, fontWeight: '700' },
  headline2: { fontFamily: 'System', fontSize: 16, fontWeight: '700' },
  title1: { fontFamily: 'System', fontSize: 16, fontWeight: '600' },
  title2: { fontFamily: 'System', fontSize: 15, fontWeight: '600' },
  body1: { fontFamily: 'System', fontSize: 14, fontWeight: '400' },
  body2: { fontFamily: 'System', fontSize: 13, fontWeight: '400' },
  caption: { fontFamily: 'System', fontSize: 12, fontWeight: '400' },
  button: { fontFamily: 'System', fontSize: 16, fontWeight: '600' },
};

export default {
  colors,
  radii,
  spacing,
  typography,
  shadow,
  COLORS,
  RADII,
  SHADOW,
  SPACING,
  SIZES,
  FONTS,
};
