// KeepFresh AI - shared UI kit (v2 design language)
// Thin, presentational primitives only. All data & navigation logic lives in
// the screens. Colors/tokens come from src/theme; icons from lucide-react-native.
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Image,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Crown, Check, X, ArrowRight } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { COLORS, RADII, SHADOW, SPACING, FONTS } from '../theme';
import { categoryIcon } from '../utils/categoryIcons';

type IconComp = React.ComponentType<LucideProps>;
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary';

const toneMap: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: COLORS.successBg, fg: COLORS.successText },
  warning: { bg: COLORS.warningBg, fg: COLORS.warningText },
  danger: { bg: COLORS.dangerBg, fg: COLORS.dangerText },
  neutral: { bg: COLORS.neutralBg, fg: COLORS.neutralText },
  // Brand green, for a badge that states something the user asked for rather
  // than something the app is warning them about — "To Buy" on a flagged item.
  primary: { bg: COLORS.primaryLight, fg: COLORS.primary },
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
export function StatusBadge({ label, tone = 'neutral', icon: Icon, style }: {
  label: string;
  tone?: Tone;
  icon?: IconComp;
  style?: any;
}) {
  const { bg, fg } = toneMap[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
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
/**
 * The number on a bell.
 *
 * Clamped at 99+ rather than 9+: this now carries the dashboard's whole
 * notification count — expiring items *and* items running low — which for an
 * establishment-sized inventory is routinely into double figures, and "9+" would
 * stop answering the only question the bubble exists to answer. The clamp stays
 * because the badge has no room to grow without limit.
 */
export function CountBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View style={styles.countBadge}>
      <Text style={styles.countBadgeText}>{count > 99 ? '99+' : count}</Text>
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

/* ------------------------------------------------- Quantity prompt dialog */
// Cross-platform stand-in for Alert.prompt, which is iOS-only and throws
// "Alert.prompt is not a function" on Android. Collects a quantity (of an item
// to consume, waste, …) and validates it against `max` before handing the
// parsed number to onConfirm, so callers never see an invalid value.
export function QuantityPrompt({
  visible,
  title,
  message,
  unit = '',
  max,
  confirmLabel = 'Confirm',
  busy,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message?: string;
  unit?: string;
  max?: number;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (quantity: number) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Start each prompt fresh — a previous value or error must not leak into the
  // next one. Prefilling with `max` makes "use it all" a single tap.
  useEffect(() => {
    if (visible) {
      setValue(max != null ? String(max) : '');
      setError(null);
    }
  }, [visible, max]);

  const suffix = unit ? ` ${unit}` : '';

  const confirm = () => {
    const qty = parseFloat(value.replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      setError('Enter a number greater than 0.');
      return;
    }
    if (max != null && qty > max) {
      setError(`You only have ${max}${suffix} left.`);
      return;
    }
    setError(null);
    onConfirm(qty);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      // autoFocus on a TextInput inside a Modal is unreliable on Android, so
      // focus explicitly once the modal is actually on screen.
      onShow={() => inputRef.current?.focus()}
    >
      {/* Keeps the centred card above the keyboard on both platforms. */}
      <KeyboardAvoidingView
        style={styles.promptKAV}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.promptBackdrop} onPress={busy ? undefined : onCancel}>
          <Pressable style={styles.promptCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.promptTitle}>{title}</Text>
            {!!message && <Text style={styles.promptMessage}>{message}</Text>}

            <View style={[styles.promptInputBox, !!error && styles.promptInputBoxError]}>
              <TextInput
                ref={inputRef}
                value={value}
                onChangeText={(t) => { setValue(t); if (error) setError(null); }}
                keyboardType="decimal-pad"
                selectTextOnFocus
                editable={!busy}
                returnKeyType="done"
                onSubmitEditing={confirm}
                placeholder="0"
                placeholderTextColor={COLORS.secondaryText}
                style={styles.promptInput}
              />
              {!!unit && <Text style={styles.promptUnit}>{unit}</Text>}
            </View>

            {!!error && <Text style={styles.promptError}>{error}</Text>}

            {max != null && (
              <Pressable
                onPress={() => { setValue(String(max)); setError(null); }}
                disabled={busy}
                style={({ pressed }) => [styles.promptChip, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.promptChipText}>Use all ({max}{suffix})</Text>
              </Pressable>
            )}

            <View style={styles.promptActions}>
              <PillButton title="Cancel" variant="outline" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
              <PillButton title={confirmLabel} onPress={confirm} loading={busy} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
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
/**
 * Shows the product photo when one is stored (image_url) and falls back to the
 * category's icon otherwise. Used for inventory rows and detail heroes.
 *
 * The fallback is a stroked icon rather than an emoji so it matches the stroke
 * weight and colour of every other icon in the app, and so it stays legible
 * inside the 24px empty-state circle as well as the 108px detail hero. The
 * category is resolved through `resolveCategory`, which tolerates the several
 * spellings that exist in stored data — see src/utils/categoryIcons.ts.
 */
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
  const Icon = categoryIcon(category);
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
      <Icon size={Math.round(size * 0.46)} color={COLORS.primary} strokeWidth={1.8} />
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
/**
 * The "nothing here yet" block.
 *
 * `compact` is for screens that have already said something above it. The
 * grocery list stacks this directly under a summary card that has just reported
 * the list as empty, so the full-size circle lands as a second and larger
 * announcement of the same fact.
 */
export function EmptyState({ icon: Icon, title, hint, actionLabel, onAction, compact }: {
  icon?: IconComp;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      {Icon && (
        <View style={[styles.emptyIconWrap, compact && styles.emptyIconWrapCompact]}>
          <Icon
            size={compact ? 24 : 34}
            color={COLORS.primary}
            strokeWidth={compact ? 1.8 : 1.6}
          />
        </View>
      )}
      <Text style={[styles.emptyTitle, compact && styles.emptyTitleCompact]}>{title}</Text>
      {!!hint && <Text style={[styles.emptyHint, compact && styles.emptyHintCompact]}>{hint}</Text>}
      {actionLabel && onAction && (
        <PillButton
          title={actionLabel}
          onPress={onAction}
          style={{ marginTop: compact ? SPACING.sm : SPACING.md }}
        />
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

/* ------------------------------------------------------ Quantity ± */
/**
 * The − / quantity / + control.
 *
 * Purely presentational: it reports a delta and lets the caller decide how to
 * apply it. That keeps the "never below zero" rule in one place — the database
 * clamps with GREATEST(…, 0) — instead of being re-implemented per screen. The
 * minus button is disabled at zero so the dead end is visible before the tap.
 */
export function QuantityStepper({
  value,
  onStep,
  busy,
  unit,
  min = 0,
  compact,
}: {
  value: number;
  onStep: (delta: number) => void;
  busy?: boolean;
  unit?: string;
  min?: number;
  compact?: boolean;
}) {
  const atFloor = value <= min;
  const size = compact ? 30 : 36;

  return (
    <View style={[styles.stepper, compact && styles.stepperCompact]}>
      <Pressable
        onPress={() => onStep(-1)}
        disabled={busy || atFloor}
        hitSlop={6}
        accessibilityLabel="Decrease quantity"
        style={({ pressed }) => [
          styles.stepperBtn,
          { width: size, height: size, borderRadius: size / 2 },
          (busy || atFloor) && styles.stepperBtnDisabled,
          pressed && { opacity: 0.7 },
        ]}
      >
        {/* A text glyph rather than an icon: the minus stays optically centred
            at every size and needs no asset. */}
        <Text style={[styles.stepperGlyph, compact && { fontSize: 17 }]}>−</Text>
      </Pressable>

      <View style={styles.stepperValueWrap}>
        {busy ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Text style={[styles.stepperValue, compact && { fontSize: 15 }]} numberOfLines={1}>
            {value}
          </Text>
        )}
        {!!unit && !compact && <Text style={styles.stepperUnit}>{unit}</Text>}
      </View>

      <Pressable
        onPress={() => onStep(1)}
        disabled={busy}
        hitSlop={6}
        accessibilityLabel="Increase quantity"
        style={({ pressed }) => [
          styles.stepperBtn,
          styles.stepperBtnPlus,
          { width: size, height: size, borderRadius: size / 2 },
          busy && styles.stepperBtnDisabled,
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={[styles.stepperGlyph, styles.stepperGlyphPlus, compact && { fontSize: 17 }]}>
          +
        </Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------ Usage meter */
/**
 * "75 / 100 products" with a fill bar.
 *
 * Used wherever a plan limit is shown, so the number and the bar can never
 * disagree. An unlimited allowance renders the count without a denominator.
 */
export function UsageMeter({
  label,
  used,
  limit,
  unit,
  style,
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
  style?: any;
}) {
  const unlimited = limit <= 0;
  const fraction = unlimited ? 0 : Math.min(used / limit, 1);
  const tone =
    unlimited || fraction < 0.8 ? COLORS.primary : fraction < 1 ? COLORS.warning : COLORS.danger;

  return (
    <View style={[{ gap: 8 }, style]}>
      <View style={styles.meterRow}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={[styles.meterValue, { color: tone }]}>
          {unlimited ? `${used}${unit ? ` ${unit}` : ''}` : `${used} / ${limit}${unit ? ` ${unit}` : ''}`}
        </Text>
      </View>
      {!unlimited && <Bar fraction={fraction} color={tone} />}
    </View>
  );
}

/* ------------------------------------------------------ Plan pill */
/** The plan name as a small badge, with a crown when it is a paid tier. */
export function PlanPill({
  name,
  tier,
  tone = 'neutral',
  style,
}: {
  name: string;
  tier?: string;
  tone?: Tone;
  style?: any;
}) {
  const { bg, fg } = toneMap[tone];
  const paid = tier === 'premium' || tier === 'pro';
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      {paid && <Crown size={11} color={fg} strokeWidth={2.6} />}
      <Text style={[styles.badgeText, { color: fg }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

/* -------------------------------------------------- Upgrade notice */
/**
 * The message shown when a plan limit blocks an action.
 *
 * The spec is explicit that a reached limit must offer an upgrade rather than
 * fail silently, so this is deliberately a first-class component: every gate in
 * the app renders the same shape, driven by the `GateResult` the entitlement
 * service returns.
 */
export function UpgradeNotice({
  title,
  message,
  ctaLabel = 'View plans',
  onPress,
  onDismiss,
  style,
}: {
  title: string;
  message: string;
  ctaLabel?: string;
  onPress: () => void;
  onDismiss?: () => void;
  style?: any;
}) {
  return (
    <View style={[styles.upgradeNotice, style]}>
      <View style={styles.upgradeIcon}>
        <Crown size={18} color={COLORS.primary} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.upgradeTitle}>{title}</Text>
        <Text style={styles.upgradeMessage}>{message}</Text>
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [styles.upgradeCta, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.upgradeCtaText}>{ctaLabel}</Text>
          <ArrowRight size={14} color={COLORS.white} strokeWidth={2.4} />
        </Pressable>
      </View>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8} style={styles.upgradeClose}>
          <X size={16} color={COLORS.secondaryText} />
        </Pressable>
      )}
    </View>
  );
}

/* --------------------------------------------------- Feature lock */
/**
 * A whole screen standing in for a feature the current plan does not include.
 *
 * Shows what the feature is for, so the upsell is informative rather than a
 * wall, and never hides the user's own data behind it — locked inventory stays
 * readable, only the premium report or control is replaced.
 */
export function FeatureLock({
  icon: Icon,
  title,
  message,
  ctaLabel = 'See plans',
  onPress,
  bullets,
}: {
  icon?: IconComp;
  title: string;
  message: string;
  ctaLabel?: string;
  onPress: () => void;
  bullets?: string[];
}) {
  return (
    <View style={styles.lock}>
      <View style={styles.lockIconWrap}>
        {Icon ? (
          <Icon size={32} color={COLORS.primary} strokeWidth={1.7} />
        ) : (
          <Crown size={32} color={COLORS.primary} strokeWidth={1.7} />
        )}
      </View>
      <Text style={styles.lockTitle}>{title}</Text>
      <Text style={styles.lockMessage}>{message}</Text>

      {bullets && bullets.length > 0 && (
        <View style={styles.lockBullets}>
          {bullets.map((bullet) => (
            <View key={bullet} style={styles.lockBulletRow}>
              <Check size={15} color={COLORS.primary} strokeWidth={2.6} />
              <Text style={styles.lockBulletText}>{bullet}</Text>
            </View>
          ))}
        </View>
      )}

      <PillButton
        title={ctaLabel}
        icon={Crown}
        onPress={onPress}
        style={{ alignSelf: 'stretch', marginTop: SPACING.lg }}
      />
    </View>
  );
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
  promptKAV: { flex: 1 },
  promptBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
  },
  promptCard: {
    width: '100%', maxWidth: 400,
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.lg,
  },
  promptTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  promptMessage: { fontSize: 13, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  promptInputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
    borderRadius: RADII.input, paddingHorizontal: 14, minHeight: 52,
    marginTop: SPACING.md,
  },
  promptInputBoxError: { borderColor: COLORS.danger },
  promptInput: { flex: 1, paddingVertical: 14, fontSize: 18, fontWeight: '700', color: COLORS.text },
  promptUnit: { fontSize: 14, fontWeight: '600', color: COLORS.secondaryText },
  promptError: { fontSize: 12, color: COLORS.dangerText, marginTop: 6 },
  promptChip: {
    alignSelf: 'flex-start', marginTop: SPACING.md,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADII.pill,
    backgroundColor: COLORS.primaryLight,
  },
  promptChipText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  promptActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
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
  emptyCompact: { padding: SPACING.md, gap: 5 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIconWrapCompact: { width: 48, height: 48, borderRadius: 24, marginBottom: 2 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  emptyTitleCompact: { fontSize: 14 },
  emptyHint: { fontSize: 13, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 18 },
  emptyHintCompact: { fontSize: 12, lineHeight: 16 },
  segRow: { flexDirection: 'row', gap: SPACING.sm },
  seg: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADII.pill },
  segActive: { backgroundColor: COLORS.primary },
  segInactive: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider },
  segText: { fontSize: 13, fontWeight: '600' },
  segTextActive: { color: COLORS.white },
  segTextInactive: { color: COLORS.secondaryText },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.divider, marginVertical: SPACING.sm },

  /* Quantity ± */
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: RADII.pill,
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 2,
  },
  stepperCompact: { paddingHorizontal: 2, paddingVertical: 2 },
  stepperBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.mutedBg,
  },
  stepperBtnPlus: { backgroundColor: COLORS.primaryLight },
  stepperBtnDisabled: { opacity: 0.4 },
  stepperGlyph: { fontSize: 20, fontWeight: '800', color: COLORS.text, lineHeight: 24 },
  stepperGlyphPlus: { color: COLORS.primary },
  stepperValueWrap: { minWidth: 46, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  stepperUnit: { fontSize: 10, color: COLORS.secondaryText, marginTop: -2 },

  /* Usage meter */
  meterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meterLabel: { fontSize: 13, fontWeight: '600', color: COLORS.secondaryText },
  meterValue: { fontSize: 13, fontWeight: '800' },

  /* Upgrade notice */
  upgradeNotice: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADII.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.accentLight,
    padding: SPACING.md,
  },
  upgradeIcon: {
    width: 36,
    height: 36,
    borderRadius: RADII.icon,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  upgradeMessage: { fontSize: 12.5, color: COLORS.secondaryText, lineHeight: 17 },
  upgradeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADII.pill,
    marginTop: 8,
  },
  upgradeCtaText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  upgradeClose: { padding: 2 },

  /* Feature lock */
  lock: { alignItems: 'center', padding: SPACING.xl, gap: 8 },
  lockIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  lockTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  lockMessage: {
    fontSize: 13.5,
    color: COLORS.secondaryText,
    textAlign: 'center',
    lineHeight: 19,
  },
  lockBullets: { alignSelf: 'stretch', marginTop: SPACING.md, gap: 10 },
  lockBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lockBulletText: { flex: 1, fontSize: 13.5, color: COLORS.text },
});

// NOTE: NavHeader's default onBack currently no-ops by design when omitted —
// screens that need back navigation pass an explicit onBack (usually router.back).
