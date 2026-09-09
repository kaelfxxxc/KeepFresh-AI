import { COLORS, RADII, SHADOW } from './colors';
import { SPACING } from './spacing';

export { COLORS, RADII, SHADOW, SPACING };

export const SIZES = {
  base: 8,
  font: 14,
  radius: RADII.card,
  padding: SPACING.md,
  margin: SPACING.sm,
  header: 24,
  icon: 20,
  borderWidth: 1,
};

// System fonts render as SF Pro on iOS and Roboto on Android; both are the
// rounded, modern sans-serifs the design calls for without bundling font files.
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

export default { COLORS, RADII, SHADOW, SIZES, FONTS, SPACING };
