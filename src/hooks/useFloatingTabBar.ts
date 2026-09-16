import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPACING } from '../theme';

/**
 * Geometry for the floating bottom navigation.
 *
 * The bar is positioned absolutely — that is what makes it float over the
 * screen — and absolute positioning also takes it out of the layout flow, so
 * nothing reserves the space it covers. Every scrolling tab has to leave
 * `contentInset` clear at the bottom instead, and that number has to come from
 * one place: two copies of it would drift apart the first time either the bar
 * or a screen is touched, and the failure mode is a list whose last row is
 * trapped under the bar with no way to scroll to it.
 */

/**
 * Drawn height of the bar itself, safe-area padding excluded.
 *
 * Passed to the navigator as an explicit `height`, which is also what stops
 * react-navigation from adding the home-indicator inset to it — the bar sits
 * above that inset rather than inside it, so the inset is spent as
 * `bottomOffset` below the bar instead.
 */
export const TAB_BAR_HEIGHT = 64;

/**
 * The bar stops widening here and centres instead.
 *
 * Five items spread across a 10" tablet would put the Inventory icon an arm's
 * length from the Profile one, and a navigation bar is the one control that has
 * to stay inside a thumb's reach. Past this width it becomes a centred pill
 * rather than a strip spanning the screen.
 */
export const TAB_BAR_MAX_WIDTH = 520;

/** Below this the labels need a smaller size to avoid colliding. */
const COMPACT_WIDTH = 360;

export function useFloatingTabBar() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const compact = width < COMPACT_WIDTH;
  const sideInset = compact ? SPACING.sm + 4 : SPACING.md;
  // On a device with no home indicator `insets.bottom` is 0, and a bar sitting
  // flush against the bottom edge stops reading as floating at all — hence the
  // floor. It is the gap under the bar that does the work, not the rounding.
  const bottomOffset = Math.max(insets.bottom, SPACING.sm + 2);
  const barWidth = Math.min(width - sideInset * 2, TAB_BAR_MAX_WIDTH);

  return {
    compact,
    height: TAB_BAR_HEIGHT,
    barWidth,
    // Centred: `left` is computed rather than left to `alignSelf`, because an
    // absolutely positioned box with both `left` and `right` set ignores the
    // width we capped it to and stretches back to the screen edges.
    barLeft: (width - barWidth) / 2,
    bottomOffset,
    /**
     * What a tab screen must leave clear at the bottom of its scroll content:
     * the bar, the gap beneath it, and a little air so the last row does not end
     * flush against the bar's top edge.
     */
    contentInset: TAB_BAR_HEIGHT + bottomOffset + SPACING.md,
  };
}
