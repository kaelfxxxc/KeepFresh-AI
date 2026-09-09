// KeepFresh AI - design tokens (v2). Matches the "deep forest / vibrant green"
// UI reference: clean flat, subtle shadows, 12px cards, 8px inputs, pill CTAs.
export const COLORS = {
  // Brand
  primary: '#1B7B43', // deep forest green
  primaryDark: '#146038',
  primaryLight: '#E8F5EE', // soft green chip / banner tint
  secondary: '#2ECC71', // vibrant green
  accentLight: '#BFE6CF',

  // Neutrals
  background: '#F8F9FA', // off-white app background
  white: '#FFFFFF',
  text: '#1A1A1A', // dark charcoal
  secondaryText: '#6C757D', // slate gray / muted
  surface: '#FFFFFF',
  divider: '#ECEEF1',
  disabled: '#E9ECEF',
  mutedBg: '#F1F3F5',

  // Solid accent colors (icons, small elements)
  warning: '#E8A000',
  danger: '#D64545',
  success: '#2ECC71',
  star: '#F5B50A',

  // Status badge pairs (background / foreground) - from the reference
  successBg: '#D4EDDA',
  successText: '#155724',
  warningBg: '#FFF3CD',
  warningText: '#856404',
  dangerBg: '#F8D7DA',
  dangerText: '#721C24',
  neutralBg: '#E9ECEF',
  neutralText: '#495057',

  // Misc
  overlay: 'rgba(0, 0, 0, 0.35)',
  scanCorner: '#FFFFFF',
  greenGradientTop: '#DCF2E6',
  greenGradientBottom: '#C3E7D3',
};

export const RADII = {
  card: 12,
  input: 8,
  pill: 24,
  image: 12,
  icon: 10,
  avatar: 999,
};

export const SHADOW = {
  // Subtle, soft card shadow
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  } as const,
  // Very light for inputs / chips
  faint: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  } as const,
};
