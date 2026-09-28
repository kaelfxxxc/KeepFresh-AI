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
 * The page gutter for a screen that pads each of its blocks individually rather
 * than padding its scroll view — the shape most of this app's screens are built
 * in, where every card carries its own `marginHorizontal`.
 *
 * On a phone this is `base` and nothing moves. Past the content cap the slack
 * splits evenly and the column centres, which is the whole of the wide-screen
 * fix. It is deliberately a floor rather than a computed value: `useContentLayout`
 * tightens its gutter on small screens, and dropping a phone's 32pt margin to 16
 * would change the layout of every screen that adopted it, which reads as the
 * bug rather than the fix.
 */
export function usePageGutter(base: number = spacing.xl) {
  const { width } = useWindowDimensions();
  const gutter = Math.max(base, (width - CONTENT_MAX_WIDTH) / 2);

  return { width, gutter, contentWidth: width - gutter * 2 };
}
