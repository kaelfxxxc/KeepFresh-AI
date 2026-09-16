import { useWindowDimensions } from 'react-native';
import { SPACING } from '../theme';

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
  const baseGutter = compact ? SPACING.md : SPACING.lg;
  const contentWidth = Math.min(width - baseGutter * 2, CONTENT_MAX_WIDTH);

  // Slack split in two rather than one fixed margin — this is what centres the
  // column once it has hit its cap.
  const gutter = (width - contentWidth) / 2;

  return { width, compact, contentWidth, gutter };
}
