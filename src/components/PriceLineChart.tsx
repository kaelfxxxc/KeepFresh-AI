// The price-tracking trend line.
//
// This is a stat tile's trend, not a dashboard chart: it exists to show the
// *shape* of the last six months beside a headline figure that already states
// this month's number. That is why nothing on it is labelled with a value by
// default — a label on the endpoint would only repeat the number directly
// above it. Tapping a month is how you ask for a figure the tile is not
// already showing.
//
// Drawn with react-native-svg rather than assembled from Views, because a
// month-over-month line has to slope and a stack of rotated Views cannot do it
// without inventing a transform per segment.

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { colors, spacing } from '../../theme';

/**
 * The plot's height, derived from its measured width.
 *
 * A fixed height would make the line a flat ribbon on a tablet and a tall box
 * on a 320pt phone — the same six points, drawn at wildly different
 * proportions. Scaling with the width keeps the shape comparable across
 * devices, and the clamps stop either extreme: below 96 the area fill has no
 * room to read as one, and past 132 the card starts to look like a dashboard
 * panel rather than a summary.
 */
const MIN_PLOT_HEIGHT = 96;
const MAX_PLOT_HEIGHT = 132;

/**
 * The end marker's radius — 10px across, which is the smallest dot that still
 * reads as a point rather than as a thickening of the line.
 */
const DOT_RADIUS = 5;

/** White ring around a dot, so it stays legible where it crosses the line. */
const RING = 2;

/**
 * Breathing room above and below the plotted band, so a dot at either extreme
 * still fits inside the svg's own bounds.
 *
 * Without it a month with nothing spent maps to the very bottom edge and the
 * end marker is sliced in half by the view — which is not a rare case: it is
 * every month on its first day.
 */
const PAD_Y = DOT_RADIUS + RING;

export function PriceLineChart({
  data,
  color = colors.primary,
  formatValue = (n: number) => String(n),
}: {
  data: { label: string; value: number }[];
  color?: string;
  formatValue?: (n: number) => string;
}) {
  const [width, setWidth] = useState(0);
  /**
   * Which month the user has asked about, or null for none.
   *
   * Null by default rather than the latest month: preselecting the last point
   * would print this month's value under a tile that already prints it above.
   */
  const [selected, setSelected] = useState<number | null>(null);

  const count = data.length;
  // `selected` is clamped rather than reset in an effect: a refetch that
  // returns a shorter window must not leave the index pointing past the end,
  // and clamping gets there without a render pass showing a stale month.
  const active = selected != null && selected < count ? selected : null;

  if (count < 2) return null;

  const values = data.map((d) => d.value);
  const max = Math.max(...values);
  const min = Math.min(...values);

  /**
   * The vertical range, padded.
   *
   * Deliberately not anchored at zero. These are six months of the same
   * recurring shop, so they sit in a narrow band — pinned to zero the line
   * would flatten into a straight rule across the top of the box and show
   * nothing, which is the one thing the chart is here to show. The axis is
   * unlabelled and the exact figures are a tap away, so the padding cannot be
   * mistaken for a zero baseline.
   */
  const span = max - min;
  const pad = span > 0 ? span * 0.3 : Math.max(max * 0.15, 1);
  const top = max + pad;
  const bottom = Math.max(min - pad, 0);
  const range = top - bottom || 1;

  const plotHeight = Math.round(
    Math.min(Math.max(width * 0.28, MIN_PLOT_HEIGHT), MAX_PLOT_HEIGHT)
  );
  /** The floor of the scale — where a value of zero, and the area's base, sit. */
  const baseY = plotHeight - PAD_Y;

  const x = (i: number) => ((i + 0.5) * width) / count;
  const y = (v: number) => baseY - ((v - bottom) / range) * (baseY - PAD_Y);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.value)}`).join(' ');
  const area = `${line} L ${x(count - 1)} ${baseY} L ${x(0)} ${baseY} Z`;

  const last = data[count - 1];
  const caption = active != null ? `${data[active].label} · ${formatValue(data[active].value)}` : '';

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <>
          <View style={[styles.plot, { height: plotHeight }]}>
            <Svg width={width} height={plotHeight}>
              {/* A wash, not a block of colour: the fill says "these months
                  are one series", the line does the work. */}
              <Path d={area} fill={color} fillOpacity={0.1} />
              <Line
                x1={0}
                y1={baseY}
                x2={width}
                y2={baseY}
                stroke={colors.border}
                strokeWidth={1}
              />
              <Path
                d={line}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />

              {/* The guide is drawn under the dots and the baseline, so it
                  reads as a ruler behind the data rather than as a bar. */}
              {active != null && (
                <Line
                  x1={x(active)}
                  y1={y(data[active].value)}
                  x2={x(active)}
                  y2={baseY}
                  stroke={colors.border}
                  strokeWidth={1}
                />
              )}

              {/* "Now". Unlabelled, because the headline above already states
                  it; its job is to mark where the line has arrived. */}
              <Circle
                cx={x(count - 1)}
                cy={y(last.value)}
                r={DOT_RADIUS}
                fill={color}
                stroke={colors.surface}
                strokeWidth={RING}
              />

              {active != null && active !== count - 1 && (
                <Circle
                  cx={x(active)}
                  cy={y(data[active].value)}
                  r={DOT_RADIUS}
                  fill={color}
                  stroke={colors.surface}
                  strokeWidth={RING}
                />
              )}
            </Svg>

            {/* Full-height columns rather than 10px dots: a dot is a fiddly
                target on a phone and the month it belongs to is the whole
                width of its slot anyway. */}
            <View style={styles.hitRow}>
              {data.map((d, i) => (
                <Pressable
                  key={`${d.label}-${i}`}
                  style={styles.hit}
                  onPress={() => setSelected((s) => (s === i ? null : i))}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.label}, ${formatValue(d.value)}`}
                />
              ))}
            </View>
          </View>

          <View style={styles.xRow}>
            {data.map((d, i) => (
              <Text
                key={`${d.label}-${i}`}
                style={[styles.xLabel, i === active && styles.xLabelActive]}
                numberOfLines={1}
              >
                {d.label}
              </Text>
            ))}
          </View>

          {/* Always rendered, empty when nothing is selected, and given a
              fixed minHeight — so selecting a month grows the text without
              pushing the rest of the card down the screen. */}
          <Text style={styles.caption} numberOfLines={1}>
            {caption}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Height comes from the measured width at render time, not from here.
  plot: { width: '100%' },
  hitRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  hit: { flex: 1, height: '100%' },
  xRow: { flexDirection: 'row', marginTop: spacing.sm },
  xLabel: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textSecondary },
  xLabelActive: { color: colors.textPrimary, fontWeight: '700' },
  // Text tokens, never the series colour — a label wearing the line's green
  // would read as part of the mark.
  caption: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, marginTop: 2, minHeight: 16 },
});
