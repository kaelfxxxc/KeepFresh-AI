import { useWindowDimensions } from 'react-native';
import { spacing } from '../../theme';

/**
 * How wide a screen's content is allowed to get, and the margin that centres it.
 *
 * A phone in portrait is narrower than the cap, so the margin is just the usual
 * page gutter and nothing changes. A tablet, or a phone in landscape, is wider —
 * and rather than stretching a form across the whole display, which leaves a
 * text field 900pt wide with its label marooned at one end, the content stops
 * growing and the leftover space is split evenly down both sides.
 *
 * Shared by the Inventory tab and the Add Item form so the two cannot disagree
 * about where the content column starts. They are one tap apart, and a half-inch
 * difference in the left margin between them reads as a bug.
 */
export const CONTENT_MAX_WIDTH = 720;

/** Below this the page margin tightens, to keep the content column usable. */
const COMPACT_WIDTH = 420;

export function useContentLayout() {
  const { width } = useWindowDimensions();

  const compact = width < COMPACT_WIDTH;
  const baseGutter = compact ? spacing.md : spacing.lg;
  const contentWidth = Math.min(width - baseGutter * 2, CONTENT_MAX_WIDTH);

  // Slack split in two rather than one fixed margin — this is what centres the
  // column once it has hit its cap.
  const gutter = (width - contentWidth) / 2;

  return { width, compact, contentWidth, gutter };
}

/**
 * The page gutter for screens that pad each block individually. It scales down
 * on narrow phones, stays at the design gutter on regular phones, and centres a
 * capped content column on wider screens.
 */
export function usePageGutter(base: number = spacing.xl) {
  const { width } = useWindowDimensions();
  const responsiveBase = width < 360
    ? spacing.md
    : width < COMPACT_WIDTH
      ? spacing.lg
      : base;
  const gutter = Math.max(responsiveBase, (width - CONTENT_MAX_WIDTH) / 2);

  return { width, gutter, contentWidth: width - gutter * 2 };
}
