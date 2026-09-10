// KeepFresh AI - shared UI kit (v2 design language)
// Thin, presentational primitives only. All data & navigation logic lives in
// the screens. Colors/tokens come from src/theme; icons from lucide-react-native.
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { COLORS, RADII, SHADOW, SPACING, FONTS } from '../theme';

type IconComp = React.ComponentType<LucideProps>;
type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const toneMap: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: COLORS.successBg, fg: COLORS.successText },
  warning: { bg: COLORS.warningBg, fg: COLORS.warningText },
  danger: { bg: COLORS.dangerBg, fg: COLORS.dangerText },
  neutral: { bg: COLORS.neutralBg, fg: COLORS.neutralText },
};

/* ------------------------------------------------------------------ Card */
export function Card({ children, style, onPress }: {
  children: React.ReactNode;
  style?: any;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, SHADOW.card, style, pressed && { opacity: 0.92 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, SHADOW.card, style]}>{children}</View>;
}

/* ------------------------------------------------------------- Buttons */
type PillVariant = 'primary' | 'outline' | 'subtle' | 'danger' | 'dangerOutline';

export function PillButton({
  title,
  onPress,
  variant = 'primary',
  icon: Icon,
  disabled,
  loading,
  style,
  textStyle,
}: {
  title: string;
  onPress?: () => void;
  variant?: PillVariant;
  icon?: IconComp;
  disabled?: boolean;
  loading?: boolean;
  style?: any;
  textStyle?: any;
}) {
  const bg = variant === 'primary' ? COLORS.primary
    : variant === 'danger' ? COLORS.danger
    : 'transparent';
  const border = variant === 'outline' || variant === 'dangerOutline' ? (variant === 'dangerOutline' ? COLORS.danger : COLORS.primary) : 'transparent';
  const fg = variant === 'primary' || variant === 'danger'
    ? COLORS.white
    : variant === 'dangerOutline' ? COLORS.danger
    : variant === 'subtle' ? COLORS.primary
    : COLORS.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: border },
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonContent}>
          {Icon && <Icon size={18} color={fg} strokeWidth={2.2} />}
          <Text style={[styles.buttonText, { color: fg }, textStyle]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

// Legacy alias kept so any pre-existing usage keeps compiling.
export const AppButton = PillButton;

/* --------------------------------------------------------- Status badge */
export function StatusBadge({ label, tone = 'neutral', icon: Icon }: {
  label: string;
  tone?: Tone;
  icon?: IconComp;
}) {
  const { bg, fg } = toneMap[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {Icon && <Icon size={11} color={fg} strokeWidth={2.6} />}
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/* --------------------------------------------------------- Filter chip */
export function Chip({ label, active, onPress, count }: {
  label: string;
  active?: boolean;
  onPress: () => void;
  count?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.chipActive : styles.chipInactive,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
        {label}
        {typeof count === 'number' ? ` (${count})` : ''}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------- Count bubble (bell) */
export function CountBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View style={styles.countBadge}>
      <Text style={styles.countBadgeText}>{count > 9 ? '9+' : count}</Text>
    </View>
  );
}

/* ------------------------------------------------------------ Text field */
export function Field({
  label,
  icon: Icon,
  secure,
  multiline,
  containerStyle,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & {
  label?: string;
  icon?: IconComp;
  secure?: boolean;
  multiline?: boolean;
  containerStyle?: any;
}) {
  const [hidden, setHidden] = useState(!!secure);
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      {!!label && <Text style={styles.fieldLabel}>{label}</Text>}
      <View style={styles.fieldBox}>
        {Icon && <Icon size={18} color={COLORS.secondaryText} strokeWidth={2} style={styles.fieldIcon} />}
        <TextInput
          placeholderTextColor={COLORS.secondaryText}
          {...inputProps}
          secureTextEntry={secure ? hidden : false}
          multiline={multiline}
          style={[styles.fieldInput, multiline && { minHeight: 80, textAlignVertical: 'top' }, Icon && { paddingLeft: 0 }]}
        />
        {secure && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} style={styles.eye}>
            {hidden ? (
              <EyeOff size={18} color={COLORS.secondaryText} />
            ) : (
              <Eye size={18} color={COLORS.secondaryText} />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------- Icons */
export function IconButton({ icon: Icon, onPress, size = 20, color = COLORS.text, bg, style, badge }: {
  icon: IconComp;
  onPress?: () => void;
  size?: number;
  color?: string;
  bg?: string;
  style?: any;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        bg && { backgroundColor: bg },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Icon size={size} color={color} strokeWidth={2} />
      <CountBadge count={badge ?? 0} />
    </Pressable>
  );
}

/* ------------------------------------------------------------ Avatar */
export function AvatarCircle({ uri, initials, size = 42, onPress }: {
  uri?: string | null;
  initials?: string | null;
  size?: number;
  onPress?: () => void;
}) {
  const node = uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarInitials, { fontSize: size * 0.4 }]}>
        {(initials || 'U').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} hitSlop={6}>
        {node}
      </Pressable>
    );
  }
  return node;
}

/* ------------------------------------------------- Product thumbnail */
export function categoryEmoji(category?: string | null): string {
  switch (category) {
    case 'dairy': return '🥛';
    case 'produce': return '🥬';
    case 'meat': return '🥩';
    case 'seafood': return '🍤';
    case 'beverages': return '🥤';
    case 'snacks': return '🍪';
    case 'frozen': return '🧊';
    default: return '📦';
  }
}

// Shows the product photo when one is stored (image_url) and falls back to the
// category emoji tile otherwise. Used for inventory rows and detail heroes.
export function ItemImage({ uri, category, size = 52, radius = RADII.image, style }: {
  uri?: string | null;
  category?: string | null;
  size?: number;
  radius?: number;
  style?: any;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [uri]);
  if (uri && !broken) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <View
      style={[
        {
          width: size, height: size, borderRadius: radius,
          backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text style={{ fontSize: Math.round(size * 0.42) }}>{categoryEmoji(category)}</Text>
    </View>
  );
}

/* ------------------------------------------------- Header for tab pages */
export function PageHeader({ title, subtitle, action, insetTop = 0 }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  insetTop?: number;
}) {
  return (
    <View style={[styles.pageHeader, { paddingTop: (insetTop || 8) + 8 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.pageTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.pageSubtitle}>{subtitle}</Text>}
      </View>
      {action}
    </View>
  );
}

/* ---------------------------------------------- Header for pushed screens */
export function NavHeader({ title, subtitle, onBack, right, tint = COLORS.text }: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  tint?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.navHeader, { paddingTop: insets.top + 4 }]}>
      <IconButton icon={ChevronLeft} onPress={onBack ?? (() => router.back())} color={tint} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={[styles.navTitle, { color: tint }]}>{title}</Text>
        {!!subtitle && <Text style={styles.navSubtitle}>{subtitle}</Text>}
      </View>
      {right ?? <View style={{ width: 32 }} />}
    </View>
  );
}

/* ---------------------------------------------------- List row (menu) */
export function ListRow({ icon: Icon, label, hint, onPress, danger, chevron = true, right }: {
  icon: IconComp;
  label: string;
  hint?: string;
  onPress?: () => void;
  danger?: boolean;
  chevron?: boolean;
  right?: React.ReactNode;
}) {
  const color = danger ? COLORS.danger : COLORS.text;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: COLORS.mutedBg }]}>
      <View style={[styles.rowIcon, { backgroundColor: danger ? COLORS.dangerBg : COLORS.primaryLight }]}>
        <Icon size={19} color={danger ? COLORS.dangerText : COLORS.primary} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color }]}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      {right}
      {chevron && <ChevronRight size={18} color={COLORS.secondaryText} />}
    </Pressable>
  );
}

/* ----------------------------------------------------- Section headers */
export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {right}
    </View>
  );
}

/* ------------------------------------------------------- Empty state */
export function EmptyState({ icon: Icon, title, hint, actionLabel, onAction }: {
  icon?: IconComp;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      {Icon && (
        <View style={styles.emptyIconWrap}>
          <Icon size={34} color={COLORS.primary} strokeWidth={1.6} />
        </View>
      )}
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!hint && <Text style={styles.emptyHint}>{hint}</Text>}
      {actionLabel && onAction && (
        <PillButton title={actionLabel} onPress={onAction} style={{ marginTop: SPACING.md }} />
      )}
    </View>
  );
}

/* -------------------------------------------------------- Segmented */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { label: string; value: T; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segRow}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [
              styles.seg,
              active ? styles.segActive : styles.segInactive,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={[styles.segText, active ? styles.segTextActive : styles.segTextInactive]}>
              {o.label}
              {typeof o.count === 'number' ? ` (${o.count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* --------------------------------------------------------- Progress */
export function Bar({ fraction, color = COLORS.primary, bg = COLORS.primaryLight, height = 8, style }: {
  fraction: number;
  color?: string;
  bg?: string;
  height?: number;
  style?: any;
}) {
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: bg, overflow: 'hidden' }, style]}>
      <View style={{ width: `${Math.min(Math.max(fraction, 0), 1) * 100}%`, height: '100%', backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

/* ---------------------------------------------------------- Divider */
export function Divider({ style }: { style?: any }) {
  return <View style={[styles.divider, style]} />;
}

/* ================================================================== */
const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADII.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
  },
  button: {
    height: 52,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    borderWidth: 1.5,
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: RADII.pill,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipInactive: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: COLORS.white },
  chipTextInactive: { color: COLORS.secondaryText },
  countBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { color: COLORS.white, fontSize: 9, fontWeight: '800' },
  fieldWrap: { marginBottom: SPACING.md },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: RADII.input,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  fieldIcon: { marginRight: 10 },
  fieldInput: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.text, paddingLeft: 0 },
  eye: { paddingLeft: 10 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: RADII.icon,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarFallback: {
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: COLORS.white, fontWeight: '800' },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  pageTitle: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  pageSubtitle: { fontSize: 13, color: COLORS.secondaryText, marginTop: 2 },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  navTitle: { fontSize: 16, fontWeight: '700' },
  navSubtitle: { fontSize: 12, color: COLORS.secondaryText },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: RADII.card,
    gap: 14,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: RADII.icon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
  sectionLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  empty: { alignItems: 'center', padding: SPACING.xl, gap: 8 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  emptyHint: { fontSize: 13, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 18 },
  segRow: { flexDirection: 'row', gap: SPACING.sm },
  seg: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADII.pill },
  segActive: { backgroundColor: COLORS.primary },
  segInactive: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider },
  segText: { fontSize: 13, fontWeight: '600' },
  segTextActive: { color: COLORS.white },
  segTextInactive: { color: COLORS.secondaryText },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.divider, marginVertical: SPACING.sm },
});

// NOTE: NavHeader's default onBack currently no-ops by design when omitted —
// screens that need back navigation pass an explicit onBack (usually router.back).
