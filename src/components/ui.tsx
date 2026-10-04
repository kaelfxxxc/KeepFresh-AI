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
  ImageStyle,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Rect, G, Path } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedProps, withTiming, withSpring, FadeInDown,
} from 'react-native-reanimated';
import {
  ChevronLeft, ChevronRight, Eye, EyeOff, Crown, Check, X, ArrowRight, RefreshCw, WifiOff,
  CheckCircle2, XCircle, Sparkles, Lightbulb, MoreVertical, Plus, Minus, Info,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { COLORS, colors, radii, spacing, shadow, statusSurface, overlay } from '../theme';
import { categoryIcon } from '../utils/categoryIcons';
import { directImageUri, resolveItemImageUri } from '../services/inventoryImageService';
import { resolveAvatarUri } from '../services/avatarService';
import { colorWithOpacity } from '../utils/color';

export { colorWithOpacity } from '../utils/color';

type IconComp = React.ComponentType<LucideProps>;
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary' | 'wasted';

// One status palette for the whole app.
//
// These four used to be Bootstrap's badge pairs (#D4EDDA/#155724 and friends) —
// a second green, a second amber and a second red sitting beside the ones the
// palette defines, so a "To Buy" badge and a "Fresh" pill a row apart read as
// two different greens. Amber and red now come from `statusSurface`, the same
// object `statusStyles` below uses for the freshness pills, so a badge and a
// pill a row apart are the same tint by construction rather than by two values
// happening to match.
const toneMap: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: colorWithOpacity(colors.primary, 0.15), fg: colors.primary },
  warning: { bg: statusSurface.warning.bg, fg: colors.warning },
  danger: { bg: statusSurface.danger.bg, fg: colors.danger },
  neutral: { bg: colorWithOpacity(colors.textSecondary, 0.12), fg: colors.textSecondary },
  // Brand green, for a badge that states something the user asked for rather
  // than something the app is warning them about — "To Buy" on a flagged item.
  primary: { bg: colors.mintBg, fg: colors.primary },
  // Thrown away. Deliberately not `danger`: red is reserved for the two states
  // that still want something from the user today. The palette has no fourth
  // hue to hand it, so this is the one tone still outside it — kept because a
  // glance at History has to separate "act on this" from "this is over", and
  // grey would fold it into Consumed.
  wasted: { bg: COLORS.wastedBg, fg: COLORS.wastedText },
};

/* ------------------------------------------------------------ Appear */
/**
 * Staggered card entrance: fade + a slight rise on mount.
 *
 * Every card-level component below runs through this so the whole app shares
 * one entrance rhythm. `index` staggers siblings — a grid or list animates as a
 * cascade rather than all at once — and is capped so a long list never leaves
 * the last row waiting.
 */
export function appearEntering(animate: boolean, index = 0) {
  if (!animate) return undefined;
  return FadeInDown.duration(320).delay(Math.min(index, 6) * 45);
}

/** Wraps arbitrary content in the shared entrance animation. */
export function Appear({
  children,
  index = 0,
  animate = true,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View entering={appearEntering(animate, index)} style={style}>
      {children}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ Card */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Card({ children, style, onPress, index = 0, animate = true }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Position among siblings, for the staggered entrance. */
  index?: number;
  /** Set false for rows inside a recycled list, where a mount animation would replay on scroll. */
  animate?: boolean;
}) {
  const entering = appearEntering(animate, index);

  if (onPress) {
    return (
      <AnimatedPressable
        entering={entering}
        onPress={onPress}
        style={({ pressed }: { pressed: boolean }) => [
          styles.card,
          shadow.card,
          style,
          pressed && styles.cardPressed,
        ]}
      >
        {children}
      </AnimatedPressable>
    );
  }
  return (
    <Animated.View entering={entering} style={[styles.card, shadow.card, style]}>
      {children}
    </Animated.View>
  );
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
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const bg = variant === 'primary' ? colors.primary
    : variant === 'danger' ? colors.danger
    : 'transparent';
  const border = variant === 'outline' || variant === 'dangerOutline' ? (variant === 'dangerOutline' ? colors.danger : colors.primary) : 'transparent';
  const fg = variant === 'primary' || variant === 'danger'
    ? colors.surface
    : variant === 'dangerOutline' ? colors.danger
    : variant === 'subtle' ? colors.primary
    : colors.primary;

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
  style?: StyleProp<ViewStyle>;
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
 * Clamped at 99+ rather than 9+: this carries the notification bell's real
 * unread count, which for an establishment-sized inventory is routinely into
 * double figures, and "9+" would stop answering the only question the bubble
 * exists to answer. The clamp stays because the badge has no room to grow
 * without limit.
 *
 * Renders nothing at zero, which is what makes "hide the badge when there is
 * nothing unread" the caller's default rather than a condition it has to
 * remember.
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
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [hidden, setHidden] = useState(!!secure);
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      {!!label && <Text style={styles.fieldLabel}>{label}</Text>}
      <View style={styles.fieldBox}>
        {Icon && <Icon size={18} color={colors.textSecondary} strokeWidth={2} style={styles.fieldIcon} />}
        <TextInput
          placeholderTextColor={colors.textSecondary}
          {...inputProps}
          secureTextEntry={secure ? hidden : false}
          multiline={multiline}
          style={[styles.fieldInput, multiline && { minHeight: 80, textAlignVertical: 'top' }, Icon && { paddingLeft: 0 }]}
        />
        {secure && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} style={styles.eye}>
            {hidden ? (
              <EyeOff size={18} color={colors.textSecondary} />
            ) : (
              <Eye size={18} color={colors.textSecondary} />
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
  initialValue,
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
  initialValue?: number;
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
      setValue(initialValue != null ? String(initialValue) : max != null ? String(max) : '');
      setError(null);
    }
  }, [visible, max, initialValue]);

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
                placeholderTextColor={colors.textSecondary}
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

/* ------------------------------------------------------- Action menu */
/**
 * The overflow menu behind a row's ⋯ button.
 *
 * Exists so a list row can carry its less frequent and destructive actions
 * without putting them on the card face, where a scrolling thumb could reach
 * them by accident. One modal serves the whole list — the caller holds the row
 * it belongs to and passes `null`/`visible: false` to close — so a screen with
 * two hundred rows still mounts a single menu.
 *
 * Selecting an action closes the menu first, and defers the handler by a tick,
 * because the actions themselves open confirmation dialogs: raising an Alert in
 * the same commit that hides the Modal can leave it presented behind a menu that
 * is still animating out on iOS.
 */
export function ActionMenu({ visible, title, actions, onClose }: {
  visible: boolean;
  title?: string;
  actions: { label: string; icon?: IconComp; onPress: () => void; danger?: boolean }[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose}>
        <Pressable style={styles.menuCard} onPress={(e) => e.stopPropagation()}>
          {!!title && (
            <Text style={styles.menuTitle} numberOfLines={1}>{title}</Text>
          )}
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Pressable
                key={action.label}
                onPress={() => {
                  onClose();
                  setTimeout(action.onPress, 0);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colorWithOpacity(colors.textSecondary, 0.12) }]}
              >
                {Icon && (
                  <Icon
                    size={19}
                    color={action.danger ? colors.danger : colors.textPrimary}
                    strokeWidth={2}
                  />
                )}
                <Text style={[styles.menuRowText, action.danger && { color: colors.danger }]}>
                  {action.label}
                </Text>
              </Pressable>
            );
          })}
          <PillButton
            title="Cancel"
            variant="outline"
            onPress={onClose}
            style={{ marginTop: spacing.sm }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------------------------------------- Icons */
export function IconButton({ icon: Icon, onPress, size = 20, color = colors.textPrimary, bg, style, badge }: {
  icon: IconComp;
  onPress?: () => void;
  size?: number;
  color?: string;
  bg?: string;
  style?: StyleProp<ViewStyle>;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        bg ? { backgroundColor: bg } : undefined,
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
  // An avatar is stored as a path inside the private `avatars` bucket and has to
  // be signed before <Image> can fetch it; a photo the user just picked is still
  // a local file and renders as it stands. Same shape as ItemImage below, and for
  // the same reason — resolving without a promise where we can is what keeps the
  // fallback from flashing over a photo that is about to load.
  const [signed, setSigned] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const immediate = directImageUri(uri);

  useEffect(() => {
    setBroken(false);
    setSigned(null);
    if (!uri || immediate) return undefined;
    let live = true;
    resolveAvatarUri(uri).then((next) => {
      if (live) setSigned(next);
    });
    // A row recycled onto another member must not take the previous avatar.
    return () => { live = false; };
  }, [uri, immediate]);

  const source = immediate ?? signed;

  // Initials rather than a blank circle when there is nothing to show. A photo
  // that will not load — deleted object, or an unreadable URL from an older
  // build — should still leave the user identified instead of anonymous, which
  // is exactly what a bare <Image> left behind.
  const node = source && !broken ? (
    <Image
      source={{ uri: source }}
      onError={() => setBroken(true)}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
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
export function ItemImage({ uri, category, size = 52, radius = radii.md, style }: {
  uri?: string | null;
  category?: string | null;
  size?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [broken, setBroken] = useState(false);
  // A stored photo is a path inside a private bucket and has to be signed before
  // <Image> can fetch it. A remote URL or a just-picked local file is renderable
  // as it stands, and is answered without a promise so it never flashes the
  // fallback icon while one resolves.
  const [signed, setSigned] = useState<string | null>(null);
  const immediate = directImageUri(uri);

  useEffect(() => {
    setBroken(false);
    setSigned(null);
    if (!uri || immediate) return;
    let live = true;
    resolveItemImageUri(uri).then((next) => {
      if (live) setSigned(next);
    });
    // A row recycled onto another item must not take the previous item's photo.
    return () => { live = false; };
  }, [uri, immediate]);

  const source = immediate ?? signed;
  if (source && !broken) {
    return (
      <Image
        source={{ uri: source }}
        // `style` belongs here as much as on the fallback below: callers use it
        // for margins, and until stored photos resolved this branch was rarely
        // reached, so a hero that shifted when its photo finished loading went
        // unnoticed.
        style={[{ width: size, height: size, borderRadius: radius }, style as ImageStyle]}
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
          backgroundColor: colors.mintBg, alignItems: 'center', justifyContent: 'center',
        },
        style,
      ]}
    >
      <Icon size={Math.round(size * 0.46)} color={colors.primary} strokeWidth={1.8} />
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
export function NavHeader({ title, subtitle, onBack, right, tint = colors.textPrimary }: {
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
  const color = danger ? colors.danger : colors.textPrimary;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colorWithOpacity(colors.textSecondary, 0.12) }]}>
      <View style={[styles.rowIcon, { backgroundColor: danger ? colorWithOpacity(colors.danger, 0.14) : colors.mintBg }]}>
        <Icon size={19} color={danger ? colors.danger : colors.primary} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color }]}>{label}</Text>
        {!!hint && <Text style={styles.rowHint}>{hint}</Text>}
      </View>
      {right}
      {chevron && <ChevronRight size={18} color={colors.textSecondary} />}
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
            color={colors.primary}
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
          style={{ marginTop: compact ? spacing.sm : spacing.md }}
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
export function Bar({ fraction, color = colors.primary, bg = colors.mintBg, height = 8, style }: {
  fraction: number;
  color?: string;
  bg?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ height, borderRadius: height / 2, backgroundColor: bg, overflow: 'hidden' }, style]}>
      <View style={{ width: `${Math.min(Math.max(fraction, 0), 1) * 100}%`, height: '100%', backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

/* ---------------------------------------------------------- Divider */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
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
  // Both sizes clear the 44×44 touch minimum, by different means: the roomy
  // variant draws it, the compact one draws 36 and claims the last 8px with
  // hitSlop. Compact rows are already the tightest thing on the inventory card,
  // so growing the drawn circle there would cost a line of product information
  // to buy a few pixels nobody can see.
  const size = compact ? 36 : 44;
  const slop = compact ? 4 : 0;

  return (
    <View style={[styles.stepper, compact && styles.stepperCompact]}>
      <Pressable
        onPress={() => onStep(-1)}
        disabled={busy || atFloor}
        hitSlop={slop}
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

      <View style={[styles.stepperValueWrap, compact && styles.stepperValueWrapCompact]}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text
            style={[styles.stepperValue, compact && { fontSize: 15 }]}
            numberOfLines={1}
            // The count is the whole point of the control, and it changes under
            // the user's finger — so it is labelled rather than left as bare
            // text a screen reader would read as an unlabelled number.
            accessibilityLabel={`${value}${unit ? ` ${unit}` : ''}`}
            accessibilityLiveRegion="polite"
          >
            {value}
          </Text>
        )}
        {!!unit && !compact && <Text style={styles.stepperUnit}>{unit}</Text>}
      </View>

      <Pressable
        onPress={() => onStep(1)}
        disabled={busy}
        hitSlop={slop}
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
  style?: StyleProp<ViewStyle>;
}) {
  const unlimited = limit <= 0;
  const fraction = unlimited ? 0 : Math.min(used / limit, 1);
  const tone =
    unlimited || fraction < 0.8 ? colors.primary : fraction < 1 ? colors.warning : colors.danger;

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
  style?: StyleProp<ViewStyle>;
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
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.upgradeNotice, style]}>
      <View style={styles.upgradeIcon}>
        <Crown size={18} color={colors.primary} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.upgradeTitle}>{title}</Text>
        <Text style={styles.upgradeMessage}>{message}</Text>
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [styles.upgradeCta, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.upgradeCtaText}>{ctaLabel}</Text>
          <ArrowRight size={14} color={colors.surface} strokeWidth={2.4} />
        </Pressable>
      </View>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8} style={styles.upgradeClose}>
          <X size={16} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

/* --------------------------------------------------- Feature lock */
/**
 * What a locked page says when the caller has nothing more specific to add.
 *
 * Phrased as a requirement rather than a description. The lock above it already
 * explains what the feature is; a user whose plan just lapsed needs to be told
 * they cannot keep using the page, which is a different sentence.
 */
const LOCK_REQUIREMENT = 'Subscribe to continue using this page.';

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
  requirement,
  ctaLabel = 'See plans',
  ctaIcon: CtaIcon = Crown,
  busy,
  onPress,
  bullets,
}: {
  icon?: IconComp;
  title: string;
  message: string;
  /**
   * The condition the user has to meet, stated as a condition.
   *
   * Omitted, it renders the default "subscribe to continue" line — the shape
   * almost every lock wants. `null` suppresses it for a lock that is not about
   * paying at all (a feature the account type cannot buy, or a plan we could not
   * read yet); a string states something more specific. `null` is deliberately
   * distinct from omitting the prop, so a caller can switch the line off without
   * having to pass an empty string that would still take up a line of the layout.
   */
  requirement?: string | null;
  ctaLabel?: string;
  ctaIcon?: IconComp;
  /** Shows the CTA as unavailable without changing what it says. */
  busy?: boolean;
  onPress: () => void;
  bullets?: string[];
}) {
  return (
    <View style={styles.lock}>
      <View style={styles.lockIconWrap}>
        {Icon ? (
          <Icon size={32} color={colors.primary} strokeWidth={1.7} />
        ) : (
          <Crown size={32} color={colors.primary} strokeWidth={1.7} />
        )}
      </View>
      <Text style={styles.lockTitle}>{title}</Text>
      <Text style={styles.lockMessage}>{message}</Text>

      {bullets && bullets.length > 0 && (
        <View style={styles.lockBullets}>
          {bullets.map((bullet) => (
            <View key={bullet} style={styles.lockBulletRow}>
              <Check size={15} color={colors.primary} strokeWidth={2.6} />
              <Text style={styles.lockBulletText}>{bullet}</Text>
            </View>
          ))}
        </View>
      )}

      {requirement !== null && (
        <Text style={styles.lockRequirement}>{requirement ?? LOCK_REQUIREMENT}</Text>
      )}

      <PillButton
        title={ctaLabel}
        icon={CtaIcon}
        disabled={busy}
        onPress={onPress}
        style={{ alignSelf: 'stretch', marginTop: spacing.lg }}
      />
    </View>
  );
}

/**
 * The lock for a page whose plan we do not know yet — still reading it, or
 * unable to read it at all.
 *
 * This exists because every gate helper reports *allowed* when there are no
 * entitlements: `if (!e) return allowed()`. Rendered without this, a gated page
 * would show its content to a lapsed account for as long as the read takes, and
 * would keep showing it after a failed read — the fail-open is deliberate for
 * counting caps, which the database re-checks on write, but it is wrong for
 * whole-page access, where nothing else stands behind the check.
 *
 * Neither allowing nor denying would be honest here, so the page says which of
 * the two it is: still checking, or could not check.
 */
export function PlanCheckLock({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <FeatureLock
      icon={loading ? RefreshCw : WifiOff}
      requirement={null}
      title={loading ? 'Checking your plan…' : "We couldn't check your plan"}
      message={
        loading
          ? 'This page shows what your subscription includes, so we check it first.'
          : error ?? 'You appear to be offline. Your plan decides what this page shows.'
      }
      ctaLabel={loading ? 'Checking…' : 'Try again'}
      ctaIcon={RefreshCw}
      busy={loading}
      onPress={onRetry}
    />
  );
}

/* ------------------------------------------------- Status pill */
export type Status = 'fresh' | 'expiringSoon' | 'expired' | 'active';

const statusStyles: Record<Status, { bg: string; fg: string; defaultLabel: string }> = {
  fresh: { bg: colors.mintBg, fg: colors.primary, defaultLabel: 'Fresh' },
  expiringSoon: { bg: statusSurface.warning.bg, fg: colors.warning, defaultLabel: 'Expires Soon' },
  expired: { bg: statusSurface.danger.bg, fg: colors.danger, defaultLabel: 'Expired' },
  active: { bg: colors.primaryDark, fg: colors.surface, defaultLabel: 'Active' },
};

export function StatusPill({
  status,
  label,
  style,
}: {
  status: Status;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const conf = statusStyles[status] || statusStyles.fresh;
  const text = label ?? conf.defaultLabel;
  return (
    <View style={[styles.statusPill, { backgroundColor: conf.bg }, style]}>
      <Text style={[styles.statusPillText, { color: conf.fg }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/* ------------------------------------------------- Icon badge */
export function IconBadge({
  color = colors.primary,
  size = 40,
  children,
  style,
}: {
  color?: string;
  size?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.iconBadge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colorWithOpacity(color, 0.15),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ------------------------------------------------- Stat card */
export function StatCard({
  icon: Icon,
  iconElement,
  title,
  value,
  caption,
  iconBg = colors.primary,
  style,
  onPress,
  index = 0,
  animate = true,
}: {
  icon?: IconComp;
  iconElement?: React.ReactNode;
  title: string;
  value: string | number;
  caption?: string;
  iconBg?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  index?: number;
  animate?: boolean;
}) {
  const content = (
    <Animated.View entering={appearEntering(animate, index)} style={[styles.statCard, style]}>
      <View style={styles.statCardRow}>
        <IconBadge color={iconBg} size={40}>
          {iconElement ?? (Icon ? <Icon size={20} color={iconBg} strokeWidth={2.2} /> : null)}
        </IconBadge>
        <View style={styles.statCardText}>
          <Text style={styles.statCardTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text
            style={[styles.statCardValue, typeof value === 'string' && styles.statCardValueText]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {value}
          </Text>
          {!!caption && (
            <Text style={styles.statCardCaption} numberOfLines={1}>
              {caption}
            </Text>
          )}
        </View>
      </View>
    </Animated.View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.statCardPressable, pressed && styles.cardPressed]}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

/* ------------------------------------------------- Highlight card */
export function HighlightCard({
  label,
  value,
  caption,
  actionLabel,
  onActionPress,
  secondaryIcon: SecondaryIcon,
  secondaryText,
  secondaryBadge,
  style,
  index = 0,
  animate = true,
}: {
  label: string;
  value: string | number;
  caption?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  secondaryIcon?: IconComp;
  secondaryText?: string;
  secondaryBadge?: string;
  style?: StyleProp<ViewStyle>;
  index?: number;
  animate?: boolean;
}) {
  return (
    <Animated.View entering={appearEntering(animate, index)} style={[styles.highlightCard, style]}>
      {/* Header row: small dot + label + right-aligned action link */}
      <View style={styles.highlightHeader}>
        <View style={styles.highlightLabelRow}>
          <View style={styles.highlightDot} />
          <Text style={styles.highlightLabel}>{label}</Text>
        </View>
        {!!actionLabel && !!onActionPress && (
          <Pressable onPress={onActionPress} hitSlop={8}>
            <Text style={styles.highlightAction}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>

      {/* Large statNumber */}
      <Text style={styles.highlightValue}>{value}</Text>
      {!!caption && <Text style={styles.highlightCaption}>{caption}</Text>}

      {/* Divider (colors.border 1px) & secondary row with icon + text + trailing badge */}
      {(SecondaryIcon || secondaryText || secondaryBadge) && (
        <>
          <View style={styles.highlightDivider} />
          <View style={styles.highlightSecondaryRow}>
            <View style={styles.highlightSecondaryLeft}>
              {SecondaryIcon && (
                <IconBadge color={colors.primary} size={28}>
                  <SecondaryIcon size={16} color={colors.primary} strokeWidth={2.4} />
                </IconBadge>
              )}
              {!!secondaryText && (
                <Text style={styles.highlightSecondaryText} numberOfLines={1}>
                  {secondaryText}
                </Text>
              )}
            </View>
            {!!secondaryBadge && (
              <StatusPill status="fresh" label={secondaryBadge} />
            )}
          </View>
        </>
      )}
    </Animated.View>
  );
}

/* ------------------------------------------------- Progress bar */
export function ProgressBar({
  value,
  max = 100,
  colorRamp = true,
  color,
  height = 7,
  style,
}: {
  value: number;
  max?: number;
  colorRamp?: boolean;
  color?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const clampedRatio = Math.min(1, Math.max(0, max > 0 ? value / max : 0));
  const progressAnim = useSharedValue(0);

  useEffect(() => {
    progressAnim.value = withTiming(clampedRatio, { duration: 600 });
  }, [clampedRatio]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progressAnim.value * 100}%`,
  }));

  let barColor = color;
  if (!barColor) {
    if (colorRamp) {
      if (clampedRatio > 0.6) {
        barColor = colors.primary;
      } else if (clampedRatio > 0.25) {
        barColor = colors.warning;
      } else {
        barColor = colors.danger;
      }
    } else {
      barColor = colors.primary;
    }
  }

  return (
    <View style={[styles.progressTrack, { height, borderRadius: radii.pill }, style]}>
      <Animated.View
        style={[
          styles.progressFill,
          { height, borderRadius: radii.pill, backgroundColor: barColor },
          animatedStyle,
        ]}
      />
    </View>
  );
}

/* ------------------------------------------------- Inventory list item */
export function InventoryListItem({
  name,
  quantity,
  unit = 'pcs',
  location,
  expiryDate,
  expiryLabel,
  status = 'fresh',
  progressRatio = 1,
  imageUri,
  category,
  onIncrement,
  onDecrement,
  onAction,
  actionLabel = 'Consume',
  variant: variantProp,
  onMenu,
  onPress,
  style,
}: {
  name: string;
  quantity: number;
  unit?: string;
  location?: string;
  expiryDate?: string;
  expiryLabel?: string;
  status?: Status;
  progressRatio?: number;
  imageUri?: string | null;
  category?: string | null;
  onIncrement?: () => void;
  onDecrement?: () => void;
  onAction?: () => void;
  actionLabel?: string;
  variant?: 'default' | 'household';
  onMenu?: () => void;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const variant = (variantProp ?? 'default') as 'default' | 'household';
  const statusColor =
    status === 'fresh' ? colors.secondary
    : status === 'expiringSoon' ? colors.warning
    : status === 'expired' ? colors.danger
    : colors.primaryDark;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={variant === 'household' ? onMenu : undefined}
      accessibilityHint={variant === 'household' && onMenu ? 'Long press for item options' : undefined}
      accessibilityActions={variant === 'household' && onMenu ? [{ name: 'more', label: 'More options' }] : undefined}
      onAccessibilityAction={variant === 'household' && onMenu
        ? (event) => { if (event.nativeEvent.actionName === 'more') onMenu(); }
        : undefined}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.inventoryItemCard,
        variant === 'household' ? styles.inventoryItemCardHousehold : { borderLeftColor: statusColor },
        variant === 'household' && { borderTopColor: statusColor },
        style,
        pressed && onPress && styles.cardPressed,
      ]}
    >
      {variant === 'household' ? (
        <>
          <View style={styles.inventoryHouseholdTop}>
            <View style={[styles.inventoryAvatarWrap, styles.inventoryAvatarWrapHousehold]}>
              <ItemImage uri={imageUri} category={category} size={50} radius={13} />
            </View>
            <StatusPill
              status={status}
              label={expiryLabel}
              style={[styles.inventoryHouseholdExpiry, { borderWidth: 1, borderColor: statusColor }]}
            />
          </View>
          <Text style={[styles.inventoryItemName, styles.inventoryItemNameHousehold]} numberOfLines={2}>
            {name}
          </Text>
        </>
      ) : (
        <View style={styles.inventoryRow1}>
          <View style={styles.inventoryAvatarWrap}>
            <ItemImage uri={imageUri} category={category} size={42} />
          </View>
          <Text style={styles.inventoryItemName}>{name}</Text>
          <StatusPill status={status} />
        </View>
      )}

      <View style={styles.inventoryRow2}>
        {variant === 'household' ? (
          <View style={styles.inventoryMetaRow}>
            <Text style={styles.inventoryMetaText} numberOfLines={1}>{quantity} {unit}</Text>
            {!!location && <Text style={styles.inventoryMetaDot}>•</Text>}
            {!!location && (
              <Text
                style={[
                  styles.inventoryLocationText,
                  /pantry/i.test(location) && styles.inventoryLocationPantry,
                ]}
                numberOfLines={1}
              >
                {location}
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.inventoryMetaText} numberOfLines={2}>
            {quantity} {unit}
            {location ? ` • ${location}` : ''}
            {expiryDate ? ` • ${expiryDate}` : ''}
          </Text>
        )}
      </View>

      {/* ProgressBar below meta */}
      <ProgressBar
        value={progressRatio}
        max={1}
        color={variant === 'household' ? statusColor : undefined}
        colorRamp={variant !== 'household'}
        height={variant === 'household' ? 5 : 7}
        style={{ marginVertical: spacing.sm }}
      />

      <View style={styles.inventoryDivider} />

      {/* Quantity stepper and item action sit together at the bottom of the card. */}
      <View style={[styles.inventoryRow3, variant === 'household' && styles.inventoryRow3Household]}>
        {variant === 'household' ? (
          onAction ? (
            <Pressable
              onPress={onAction}
              style={({ pressed }) => [
                styles.inventoryActionBtn,
                styles.inventoryActionBtnHousehold,
                { flex: 1 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.inventoryActionBtnText}>{actionLabel}</Text>
            </Pressable>
          ) : <View style={{ flex: 1 }} />
        ) : (
        <>
        <View style={styles.inventoryStepper}>
          <Pressable
            onPress={onDecrement}
            hitSlop={8}
            style={styles.inventoryStepperBtn}
            accessibilityLabel="Decrease quantity"
          >
            <Minus size={14} color={colors.textPrimary} strokeWidth={2.5} />
          </Pressable>
          <Text style={styles.inventoryStepperVal}>{`${quantity} ${unit}`}</Text>
          <Pressable
            onPress={onIncrement}
            hitSlop={8}
            style={styles.inventoryStepperBtn}
            accessibilityLabel="Increase quantity"
          >
            <Plus size={14} color={colors.primary} strokeWidth={2.5} />
          </Pressable>
        </View>
        <View style={styles.inventoryRow3Right}>
          {onAction && (
            <Pressable
              onPress={onAction}
              style={({ pressed }) => [
                styles.inventoryActionBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.inventoryActionBtnText}>{actionLabel}</Text>
            </Pressable>
          )}
          {onMenu && (
            <Pressable
              onPress={onMenu}
              hitSlop={8}
              style={({ pressed }) => [
                styles.inventoryMenuBtn,
                pressed && { opacity: 0.6 },
              ]}
              accessibilityLabel="More options"
            >
              <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
        </>
        )}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------- Filter chip row */

/**
 * One chip. Springs slightly as it is pressed, so the row acknowledges the tap
 * before the filter changes underneath it.
 */
function FilterChip({
  label,
  count,
  active,
  onPress,
  variant,
  activeTone,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
  variant: 'pill' | 'card';
  activeTone: 'mint' | 'dark';
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: variant === 'card' ? 1 : scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        if (variant !== 'card') scale.value = withSpring(1.02, { damping: 14, stiffness: 260 });
      }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 14, stiffness: 260 }); }}
      style={[
        variant === 'card' ? styles.filterChipCard : styles.filterChip,
        active
          ? variant === 'card'
            ? activeTone === 'dark' ? styles.filterChipCardActiveDark : styles.filterChipCardActive
            : styles.filterChipActive
          : variant === 'card' ? styles.filterChipCardInactive : styles.filterChipInactive,
        animatedStyle,
      ]}
    >
      <Text
        style={[
          styles.filterChipText,
          variant === 'card' && styles.filterChipCardText,
          active
            ? variant === 'card'
              ? activeTone === 'dark' ? styles.filterChipCardTextActiveDark : styles.filterChipCardTextActive
              : styles.filterChipTextActive
            : styles.filterChipTextInactive,
        ]}
      >
        {label}
      </Text>
      {typeof count === 'number' && (
        <View
          style={[
            styles.filterChipCount,
            variant === 'card' && styles.filterChipCardCount,
            active && variant !== 'card' && { backgroundColor: colorWithOpacity(colors.surface, 0.25) },
            active && variant === 'card' && {
              backgroundColor: activeTone === 'dark' ? colors.mintBg : colors.mintBg,
            },
          ]}
        >
          <Text
            style={[
              styles.filterChipCountText,
              active && variant !== 'card' && { color: colors.surface },
              active && variant === 'card' && { color: activeTone === 'dark' ? colors.primaryDark : colors.primaryDark },
            ]}
          >
            {count}
          </Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

export function FilterChipRow({
  chips,
  activeChip,
  onSelect,
  style,
  contentStyle,
  variant = 'pill',
  activeTone = 'mint',
}: {
  chips: { label: string; count?: number; value?: string }[];
  activeChip: string;
  onSelect: (val: string) => void;
  style?: StyleProp<ViewStyle>;
  /**
   * Merged over the row's own content styles. The default gutter keeps the row
   * usable on its own; a screen whose other blocks sit at a wider margin passes
   * its gutter here so the chips line up with the header above them rather than
   * sitting eight points to the left of it.
   */
  contentStyle?: StyleProp<ViewStyle>;
  variant?: 'pill' | 'card';
  activeTone?: 'mint' | 'dark';
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.filterChipRow, contentStyle]}
      style={[styles.filterChipScroll, style]}
    >
      {chips.map((chip) => {
        const val = chip.value ?? chip.label;
        return (
          <FilterChip
            key={val}
            label={chip.label}
            count={chip.count}
            active={val === activeChip}
            variant={variant}
            activeTone={activeTone}
            onPress={() => onSelect(val)}
          />
        );
      })}
    </ScrollView>
  );
}

/* ------------------------------------------------- AIBanner */
export function AIBanner({
  icon = 'sparkle',
  title,
  body,
  ctaLabel,
  onPressCta,
  variant = 'mint',
  style,
  index = 0,
  animate = true,
}: {
  icon?: 'sparkle' | 'bulb';
  title: string;
  body: string;
  ctaLabel?: string;
  onPressCta?: () => void;
  variant?: 'mint' | 'dark';
  style?: StyleProp<ViewStyle>;
  index?: number;
  animate?: boolean;
}) {
  const isDark = variant === 'dark';
  const bg = isDark ? colors.primaryDark : colors.mintBg;
  const fg = isDark ? colors.surface : colors.textPrimary;
  const subFg = isDark ? 'rgba(255, 255, 255, 0.85)' : colors.textSecondary;
  const iconColor = isDark ? colors.surface : colors.primary;

  return (
    <Animated.View entering={appearEntering(animate, index)} style={[styles.aiBanner, { backgroundColor: bg }, style]}>
      <View style={styles.aiBannerHeader}>
        <IconBadge color={iconColor} size={36}>
          {icon === 'bulb' ? (
            <Lightbulb size={18} color={iconColor} strokeWidth={2.4} />
          ) : (
            <Sparkles size={18} color={iconColor} strokeWidth={2.4} />
          )}
        </IconBadge>
        <View style={styles.aiBannerTextWrap}>
          <Text style={[styles.aiBannerTitle, { color: fg }]}>{title}</Text>
          <Text style={[styles.aiBannerBody, { color: subFg }]}>{body}</Text>
        </View>
      </View>
      {!!ctaLabel && !!onPressCta && (
        <Pressable
          onPress={onPressCta}
          style={({ pressed }) => [
            styles.aiBannerCtaPill,
            { backgroundColor: isDark ? colors.surface : colors.primary },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text
            style={[
              styles.aiBannerCtaPillText,
              { color: isDark ? colors.primaryDark : colors.surface },
            ]}
          >
            {ctaLabel}
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

/* ------------------------------------------------- Trend bar chart */

/**
 * One bar. Grows from nothing to its value on mount, so the chart draws itself
 * when the card appears rather than being there fully formed.
 *
 * The track is bottom-aligned and a fixed height, so animating the bar's own
 * height rises it from the axis.
 */
function TrendBar({ height, active }: { height: number; active: boolean }) {
  const animatedHeight = useSharedValue(0);

  useEffect(() => {
    animatedHeight.value = withTiming(height, { duration: 600 });
  }, [height]);

  const animatedStyle = useAnimatedStyle(() => ({ height: animatedHeight.value }));

  return (
    <View style={styles.trendBarTrack}>
      <Animated.View
        style={[
          styles.trendBar,
          { backgroundColor: active ? colors.primary : colors.border },
          animatedStyle,
        ]}
      />
    </View>
  );
}

export function TrendBarChart({
  data,
  currentIndex,
  labels,
  maxValue,
  index = 0,
  animate = true,
  style,
}: {
  data: number[];
  currentIndex?: number;
  labels?: string[];
  maxValue?: number;
  /** Position among siblings, for the staggered entrance. */
  index?: number;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!data || data.length === 0) return null;
  const max = maxValue ?? Math.max(...data, 1);

  return (
    <Animated.View
      entering={appearEntering(animate, index)}
      style={[styles.trendChart, style]}
    >
      <View style={styles.trendBars}>
        {data.map((value, index) => {
          const active = index === currentIndex;
          const barHeight = Math.max(6, (value / max) * 76);
          return (
            <View key={index} style={styles.trendColumn}>
              {active ? (
                <View style={styles.trendBadge}>
                  <Text style={styles.trendBadgeText}>{value}</Text>
                </View>
              ) : (
                <View style={{ height: 20 }} />
              )}
              <TrendBar height={barHeight} active={active} />
              <Text
                style={[
                  styles.trendLabel,
                  active && styles.trendLabelActive,
                ]}
              >
                {labels?.[index] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

/* ------------------------------------------------- Donut progress */
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function DonutProgress({
  percentage,
  size = 140,
  strokeWidth = 12,
  style,
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = Math.max(0, Math.min(percentage, 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * progress) / 100;

  // Starts un-drawn (offset of a full circumference = nothing showing) and
  // sweeps to the target, so the ring fills in when the card appears.
  const animatedOffset = useSharedValue(circumference);

  useEffect(() => {
    animatedOffset.value = withTiming(strokeDashoffset, { duration: 900 });
  }, [strokeDashoffset, circumference]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: animatedOffset.value,
  }));

  return (
    <View style={[styles.donutContainer, { width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          {/* Remainder — a soft red, so what is left over reads as the risk half
              of the pair rather than as more of the same green. */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colorWithOpacity(colors.danger, 0.16)}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Utilized green stroke */}
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.primary}
            strokeWidth={strokeWidth}
            strokeDasharray={`${circumference} ${circumference}`}
            animatedProps={animatedProps}
            strokeLinecap="round"
            fill="none"
          />
        </G>
      </Svg>
      <View style={styles.donutCenterText}>
        <Text style={styles.donutPercentage}>{Math.round(progress)}%</Text>
        <Text style={styles.donutSub}>Utilized</Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------- Permissions table */
export function PermissionsTable({
  roles,
  columns,
  style,
}: {
  roles: {
    name: string;
    dotColor?: string;
    permissions: boolean[];
  }[];
  columns: string[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.permissionsCard, style]}>
      {/* Header */}
      <View style={styles.permissionsHead}>
        <Text style={[styles.permissionsColHeader, { flex: 1.4 }]}>Role</Text>
        {columns.map((col, idx) => (
          <Text key={idx} style={styles.permissionsColHeader} numberOfLines={1}>
            {col}
          </Text>
        ))}
      </View>
      {/* Rows */}
      {roles.map((role, rIdx) => (
        <View
          key={role.name}
          style={[
            styles.permissionsRow,
            rIdx === roles.length - 1 && { borderBottomWidth: 0 },
          ]}
        >
          <View style={[styles.permissionsRoleCell, { flex: 1.4 }]}>
            <View
              style={[
                styles.permissionsDot,
                { backgroundColor: role.dotColor ?? colors.primary },
              ]}
            />
            <Text style={styles.permissionsRoleName} numberOfLines={1}>
              {role.name}
            </Text>
          </View>
          {role.permissions.map((allowed, cIdx) => (
            <View key={cIdx} style={styles.permissionsIconCell}>
              {allowed ? (
                <CheckCircle2 size={18} color={colors.primary} strokeWidth={2.4} />
              ) : (
                <XCircle size={18} color={colors.textSecondary} opacity={0.35} strokeWidth={2} />
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------- Pricing card */
export function PricingCard({
  planName,
  price,
  period = 'month',
  description,
  features,
  recommended = false,
  ctaLabel = 'Select plan',
  onSelect,
  disabled = false,
  loading = false,
  style,
}: {
  planName: string;
  price: string;
  period?: string;
  description?: string;
  features: string[];
  recommended?: boolean;
  ctaLabel?: string;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.pricingCard,
        recommended && styles.pricingCardRecommended,
        style,
      ]}
    >
      {recommended && (
        <View style={styles.pricingBadge}>
          <Text style={styles.pricingBadgeText}>Best Value</Text>
        </View>
      )}

      <Text style={styles.pricingPlanName}>{planName}</Text>
      {!!description && <Text style={styles.pricingDescription}>{description}</Text>}

      <View style={styles.pricingPriceRow}>
        <Text style={styles.pricingPrice}>{price}</Text>
        {period ? <Text style={styles.pricingPeriod}>/{period}</Text> : null}
      </View>

      <View style={styles.pricingDivider} />

      <View style={styles.pricingFeatureList}>
        {features.map((feature, idx) => (
          <View key={idx} style={styles.pricingFeatureRow}>
            <CheckCircle2 size={17} color={colors.primary} strokeWidth={2.4} />
            <Text style={styles.pricingFeatureText}>{feature}</Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={onSelect}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.pricingCta,
          recommended ? styles.pricingCtaFilled : styles.pricingCtaOutline,
          (disabled || loading) && { opacity: 0.5 },
          pressed && { opacity: 0.85 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={recommended ? colors.surface : colors.primaryDark} />
        ) : (
          <Text
            style={[
              styles.pricingCtaText,
              recommended ? styles.pricingCtaTextFilled : styles.pricingCtaTextOutline,
            ]}
          >
            {ctaLabel}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------- Csv import box */
export function CsvImportBox({
  value,
  onChangeText,
  placeholder,
  onInfoPress,
  hint,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onInfoPress?: () => void;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.csvBoxContainer, style]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        style={styles.csvTextInput}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={styles.csvHelperRow}>
        <IconBadge color={colors.primary} size={24}>
          <Info size={14} color={colors.primary} strokeWidth={2.4} />
        </IconBadge>
        <Text style={styles.csvHelperText}>
          {hint ?? 'Columns: product_name, quantity, unit, category, expiration_date, price'}
        </Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------- Section header */
export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onActionPress,
  rightComponent,
  style,
}: {
  title: string;
  /** One line under the title, when the section needs a reason rather than just a name. */
  subtitle?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  rightComponent?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeaderRow, subtitle ? styles.sectionHeaderRowStacked : null, style]}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionHeaderTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionHeaderSubtitle}>{subtitle}</Text> : null}
      </View>
      {rightComponent ? (
        rightComponent
      ) : actionLabel && onActionPress ? (
        <Pressable onPress={onActionPress} hitSlop={8} style={styles.sectionHeaderActionWrap}>
          <Text style={styles.sectionHeaderAction}>{actionLabel}</Text>
          <ChevronRight size={14} color={colors.primary} strokeWidth={2.6} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------- Spacer */
export function Spacer({
  size = 'lg',
  horizontal = false,
}: {
  size?: keyof typeof spacing | number;
  horizontal?: boolean;
}) {
  const s = typeof size === 'number' ? size : spacing[size] ?? 16;
  return <View style={{ width: horizontal ? s : 0, height: horizontal ? 0 : s }} />;
}

/* ================================================================== */
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minWidth: 0,
  },
  cardPressed: { opacity: 0.94 },
  button: {
    height: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
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
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radii.pill,
  },
  chipActive: { backgroundColor: colors.primary },
  chipInactive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.surface },
  chipTextInactive: { color: colors.textSecondary },
  countBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { color: colors.surface, fontSize: 9, fontWeight: '800' },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 6 },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  fieldIcon: { marginRight: 10 },
  fieldInput: { flex: 1, paddingVertical: 14, fontSize: 15, color: colors.textPrimary, paddingLeft: 0 },
  eye: { paddingLeft: 10 },
  promptKAV: { flex: 1 },
  promptBackdrop: {
    flex: 1, backgroundColor: overlay,
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  promptCard: {
    width: '100%', maxWidth: 400,
    backgroundColor: colors.surface, borderRadius: radii.lg,
    padding: spacing.lg,
  },
  promptTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  promptMessage: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  promptInputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.sm, paddingHorizontal: 14, minHeight: 52,
    marginTop: spacing.md,
  },
  promptInputBoxError: { borderColor: colors.danger },
  promptInput: { flex: 1, paddingVertical: 14, fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  promptUnit: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  promptError: { fontSize: 12, color: colors.danger, marginTop: 6 },
  promptChip: {
    alignSelf: 'flex-start', marginTop: spacing.md,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.mintBg,
  },
  promptChipText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  promptActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  menuBackdrop: {
    flex: 1, backgroundColor: overlay,
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  menuCard: {
    width: '100%', maxWidth: 400,
    backgroundColor: colors.surface, borderRadius: radii.lg,
    padding: spacing.md,
  },
  menuTitle: {
    fontSize: 13, fontWeight: '700', color: colors.textSecondary,
    paddingHorizontal: spacing.sm, paddingBottom: spacing.sm,
  },
  // 48 rather than the 44 minimum: these rows are the destructive ones, so they
  // get a little more room than the rule requires.
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radii.sm,
  },
  menuRowText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarFallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { color: colors.surface, fontWeight: '800' },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  pageTitle: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
  pageSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  navTitle: { fontSize: 16, fontWeight: '700' },
  navSubtitle: { fontSize: 12, color: colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: radii.lg,
    gap: 14,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  sectionLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  empty: { alignItems: 'center', padding: spacing.xl, gap: 8 },
  emptyCompact: { padding: spacing.md, gap: 5 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.mintBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIconWrapCompact: { width: 48, height: 48, borderRadius: 24, marginBottom: 2 },
  // `textAlign` on the title as well as the hint: the block centres its children
  // with alignItems, which only centres a line that fits. A title long enough to
  // wrap would fill the box and then sit left inside it, under a hint that was
  // still centred — the one way this block could read as off-centre.
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  emptyTitleCompact: { fontSize: 14 },
  emptyHint: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  emptyHintCompact: { fontSize: 12, lineHeight: 16 },
  segRow: { flexDirection: 'row', gap: spacing.sm },
  seg: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill },
  segActive: { backgroundColor: colors.primary },
  segInactive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  segText: { fontSize: 13, fontWeight: '600' },
  segTextActive: { color: colors.surface },
  segTextInactive: { color: colors.textSecondary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },

  /* Quantity ± */
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 2,
  },
  stepperCompact: { paddingHorizontal: 2, paddingVertical: 2 },
  stepperBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorWithOpacity(colors.textSecondary, 0.12),
  },
  stepperBtnPlus: { backgroundColor: colors.mintBg },
  stepperBtnDisabled: { opacity: 0.4 },
  stepperGlyph: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, lineHeight: 24 },
  stepperGlyphPlus: { color: colors.primary },
  stepperValueWrap: { minWidth: 46, alignItems: 'center', justifyContent: 'center' },
  stepperValueWrapCompact: { minWidth: 34 },
  stepperValue: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  stepperUnit: { fontSize: 10, color: colors.textSecondary, marginTop: -2 },

  /* Usage meter */
  meterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meterLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  meterValue: { fontSize: 13, fontWeight: '800' },

  /* Upgrade notice */
  upgradeNotice: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.mintBg,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colorWithOpacity(colors.primary, 0.25),
    padding: spacing.md,
  },
  upgradeIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  upgradeMessage: { fontSize: 12.5, color: colors.textSecondary, lineHeight: 17 },
  upgradeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    marginTop: 8,
  },
  upgradeCtaText: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  upgradeClose: { padding: 2 },

  /* Feature lock */
  lock: { alignItems: 'center', padding: spacing.xl, gap: 8 },
  lockIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.mintBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  lockTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  lockMessage: {
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  lockBullets: { alignSelf: 'stretch', marginTop: spacing.md, gap: 10 },
  lockBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lockBulletText: { flex: 1, fontSize: 13.5, color: colors.textPrimary },
  // The requirement, set apart from the description above it: primary-coloured
  // and bold so it reads as the condition on the page rather than one more line
  // about what the feature would do.
  lockRequirement: {
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    lineHeight: 20,
  },

  /* Status pill */
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  /* Icon badge */
  iconBadge: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Stat card */
  statCardPressable: {
    flex: 1,
    minWidth: 0,
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  statCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  statCardText: { flex: 1, gap: 2 },
  statCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  statCardValue: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  statCardValueText: {
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0,
  },
  statCardCaption: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: 1,
  },

  /* Highlight card */
  highlightCard: {
    backgroundColor: colors.mintBg,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  highlightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  highlightLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  highlightDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  highlightLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  highlightAction: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  highlightValue: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  highlightCaption: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  highlightDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  highlightSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  highlightSecondaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  highlightSecondaryText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    flex: 1,
  },

  /* Progress bar */
  progressTrack: {
    width: '100%',
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },

  /* Inventory list item */
  inventoryItemCard: {
    width: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderLeftWidth: 4,
    ...shadow.card,
    gap: spacing.xs,
  },
  inventoryItemCardHousehold: {
    width: 'auto',
    flex: 1,
    borderLeftWidth: 0,
    borderTopWidth: 4,
    borderRadius: 18,
    padding: 12,
    minHeight: 205,
  },
  inventoryRow1: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minWidth: 0,
  },
  inventoryAvatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
  },
  inventoryAvatarWrapHousehold: { width: 50, height: 50, borderRadius: 13 },
  inventoryHouseholdTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 50, marginBottom: 2,
  },
  inventoryHouseholdExpiry: { maxWidth: '56%', paddingHorizontal: 8, paddingVertical: 4 },
  inventoryItemName: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  inventoryItemNameHousehold: { fontSize: 15, lineHeight: 19, marginTop: 2 },
  inventoryRow2: {
    marginTop: 2,
    minWidth: 0,
  },
  inventoryMetaText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  inventoryMetaRow: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 5 },
  inventoryMetaDot: { color: colors.textSecondary, fontSize: 12 },
  inventoryLocationText: { flexShrink: 1, color: '#0891B2', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  inventoryLocationPantry: { color: colors.warning },
  inventoryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: spacing.xs,
  },
  inventoryRow3: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    gap: spacing.sm,
    minWidth: 0,
  },
  inventoryStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: colors.surface,
    gap: 8,
    flexShrink: 1,
  },
  inventoryRow3Household: { flexWrap: 'nowrap', gap: 4 },
  inventoryStepperHousehold: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, gap: 4 },
  inventoryStepperBtn: {
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inventoryStepperVal: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 32,
    textAlign: 'center',
  },
  inventoryStepperValHousehold: { minWidth: 20 },
  inventoryRow3Right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    flexShrink: 1,
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  inventoryActionBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    flexShrink: 1,
  },
  inventoryActionBtnHousehold: { borderRadius: 10, minHeight: 34, justifyContent: 'center', paddingHorizontal: 10 },
  inventoryActionBtnText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '700',
  },
  inventoryMenuBtn: {
    padding: 6,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Filter chip row */
  filterChipScroll: {
    flexGrow: 0,
  },
  filterChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.lg,
    minHeight: 34,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterChipCard: {
    height: 30,
    flexShrink: 0,
    paddingVertical: 0,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  filterChipActive: {
    backgroundColor: colors.primaryDark,
  },
  filterChipInactive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipCardActive: {
    backgroundColor: colors.mintBg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  filterChipCardActiveDark: {
    backgroundColor: colors.primaryDark,
    borderWidth: 1,
    borderColor: colors.primaryDark,
  },
  filterChipCardInactive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipCardText: {
    color: colors.textPrimary,
    fontSize: 12,
  },
  filterChipTextActive: {
    color: colors.surface,
  },
  filterChipTextInactive: {
    color: colors.textSecondary,
  },
  filterChipCardTextActive: {
    color: colors.primaryDark,
    fontWeight: '800',
    fontSize: 12,
  },
  filterChipCardTextActiveDark: {
    color: colors.surface,
    fontWeight: '800',
    fontSize: 12,
  },
  filterChipCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colorWithOpacity(colors.textSecondary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterChipCardCount: {
    backgroundColor: colors.mintBg,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
  },
  filterChipCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  /* AI Banner */
  aiBanner: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  aiBannerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  aiBannerTextWrap: {
    flex: 1,
    gap: 3,
  },
  aiBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  aiBannerBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  aiBannerCtaPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
  },
  aiBannerCtaPillText: {
    fontSize: 13,
    fontWeight: '700',
  },

  /* Trend bar chart */
  trendChart: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  trendBars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 110,
    paddingHorizontal: spacing.sm,
  },
  trendColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  trendBadge: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 4,
  },
  trendBadgeText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: '800',
  },
  trendBarTrack: {
    height: 76,
    width: 22,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  trendBar: {
    width: 22,
    borderRadius: 11,
  },
  trendLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 6,
    fontWeight: '600',
  },
  trendLabelActive: {
    color: colors.primaryDark,
    fontWeight: '800',
  },

  /* Donut progress */
  donutContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  donutCenterText: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutPercentage: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  donutSub: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: -2,
  },

  /* Permissions table */
  permissionsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    ...shadow.card,
  },
  permissionsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  permissionsColHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  permissionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  permissionsRoleCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  permissionsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  permissionsRoleName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  permissionsIconCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Pricing card */
  pricingCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
    ...shadow.card,
    position: 'relative',
    marginVertical: spacing.sm,
  },
  pricingCardRecommended: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  pricingBadge: {
    position: 'absolute',
    top: -12,
    right: 16,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pricingBadgeText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  pricingPlanName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  pricingDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  pricingPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.md,
  },
  pricingPrice: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  pricingPeriod: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginLeft: 4,
  },
  pricingDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  pricingFeatureList: {
    gap: 12,
    marginBottom: spacing.xl,
  },
  pricingFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pricingFeatureText: {
    fontSize: 13.5,
    color: colors.textPrimary,
    flex: 1,
  },
  pricingCta: {
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pricingCtaFilled: {
    backgroundColor: colors.primaryDark,
  },
  pricingCtaOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.primaryDark,
  },
  pricingCtaText: {
    fontSize: 15,
    fontWeight: '700',
  },
  pricingCtaTextFilled: {
    color: colors.surface,
  },
  pricingCtaTextOutline: {
    color: colors.primaryDark,
  },

  /* Csv import box */
  csvBoxContainer: {
    gap: spacing.sm,
  },
  csvTextInput: {
    minHeight: 140,
    backgroundColor: colors.screenBg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  csvHelperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  csvHelperText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },

  /* Section header */
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  // With a subtitle the right-hand action centres on the pair, which reads off;
  // the row aligns to the top instead and lets the text block take the slack.
  sectionHeaderRowStacked: {
    alignItems: 'flex-start',
  },
  sectionHeaderText: {
    flex: 1,
  },
  sectionHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionHeaderSubtitle: {
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 3,
    lineHeight: 17,
  },
  sectionHeaderActionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  sectionHeaderAction: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
});

// NOTE: NavHeader's default onBack currently no-ops by design when omitted —
// screens that need back navigation pass an explicit onBack (usually router.back).
