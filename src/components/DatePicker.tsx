import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { COLORS, RADII, SHADOW, SPACING } from '../theme';
import { PillButton } from './ui';
import { dateKey, parseDateKey, todayKey } from '../utils/dateKey';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The month on screen. The day is not part of it — the grid supplies that. */
interface Month {
  y: number;
  m: number;
}

/** The month a key falls in, optionally shifted by whole months. */
function monthOf(key: string, deltaMonths = 0): Month {
  const parts = parseDateKey(key) ?? parseDateKey(todayKey())!;
  if (deltaMonths === 0) return { y: parts.y, m: parts.m };
  // A local Date handles the rollover — December + 1 has to become January of
  // the next year, and February + 1 has to know about leap years.
  const moved = new Date(parts.y, parts.m + deltaMonths, 1);
  return { y: moved.getFullYear(), m: moved.getMonth() };
}

/**
 * A month calendar, built here rather than pulled from a native picker.
 *
 * Two reasons. It keeps the flow inside the app's own visual language — the
 * chips, cards and sheets this app already uses — instead of dropping the user
 * into a platform wheel. And it needs no native module, so it works in the same
 * build everything else does, with no rebuild to pick up a dependency.
 *
 * Dates are `YYYY-MM-DD` keys throughout. The grid is computed from calendar
 * numbers, never from a Date instant, so nothing can shift by a day in transit.
 */
export function DatePickerModal({
  visible,
  value,
  minDate = todayKey(),
  title = 'Expiration date',
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  /** Current value as `YYYY-MM-DD`, or null when unset. */
  value: string | null;
  /** Earliest selectable day. `null` removes the floor entirely. */
  minDate?: string | null;
  title?: string;
  onCancel: () => void;
  /** Called with the chosen `YYYY-MM-DD`, or null when cleared. */
  onConfirm: (value: string | null) => void;
}) {
  const [cursor, setCursor] = useState<Month>(() => monthOf(todayKey()));
  const [selected, setSelected] = useState<string | null>(value);

  // Re-seed every time it opens, so it comes up on the month holding the current
  // value — or on today when there is none — rather than wherever it was left.
  useEffect(() => {
    if (!visible) return;
    setCursor(monthOf(value ?? todayKey()));
    setSelected(value);
  }, [visible, value]);

  const today = todayKey();
  const floor = minDate ? parseDateKey(minDate) : null;

  // Leading blanks put the 1st under its weekday. The trailing pad keeps every
  // row a full seven, which matters because each cell flexes to an equal share —
  // a short final row would stretch its days wider and break the columns.
  const cells = useMemo<(string | null)[]>(() => {
    const lead = new Date(cursor.y, cursor.m, 1).getDay();
    const length = new Date(cursor.y, cursor.m + 1, 0).getDate();

    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= length; d += 1) out.push(dateKey({ y: cursor.y, m: cursor.m, d }));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  // Chunked into explicit rows rather than left to flexWrap: seven cells at
  // `100/7`% sum to a hair under 100% and can still round over it, which wraps
  // the last column onto its own line. A row of `flex: 1` cells cannot.
  const weeks = useMemo(() => {
    const rows: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [cells]);

  // Compared as strings: for zero-padded keys, lexicographic order is date order.
  const atFloor =
    floor != null && dateKey({ y: floor.y, m: floor.m, d: 1 }) <= dateKey({ y: cursor.y, m: cursor.m, d: 1 });

  const shiftMonth = (delta: number) => {
    setCursor((current) => monthOf(`${current.y}-${String(current.m + 1).padStart(2, '0')}-01`, delta));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Pressable
              onPress={() => shiftMonth(-1)}
              disabled={atFloor}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              style={[styles.navBtn, atFloor && styles.navBtnOff]}
            >
              <ChevronLeft size={19} strokeWidth={2.4} color={atFloor ? COLORS.divider : COLORS.text} />
            </Pressable>

            <Text style={styles.monthLabel}>{MONTHS[cursor.m]} {cursor.y}</Text>

            <Pressable
              onPress={() => shiftMonth(1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              style={styles.navBtn}
            >
              <ChevronRight size={19} strokeWidth={2.4} color={COLORS.text} />
            </Pressable>
          </View>

          <Text style={styles.title}>{title}</Text>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((day, i) => (
              <Text key={`${day}-${i}`} style={styles.weekday}>{day}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {weeks.map((week, weekIndex) => (
              <View key={`week-${weekIndex}`} style={styles.week}>
                {week.map((key, index) => {
                  if (!key) return <View key={`blank-${index}`} style={styles.cell} />;

                  const disabled = floor != null && key < minDate!;
                  const isSelected = key === selected;
                  const isToday = key === today;
                  const dayNumber = Number(key.slice(8));

                  return (
                    <Pressable
                      key={key}
                      style={styles.cell}
                      disabled={disabled}
                      onPress={() => setSelected(key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected, disabled }}
                      accessibilityLabel={`${dayNumber} ${MONTHS[cursor.m]} ${cursor.y}`}
                    >
                      <View
                        style={[
                          styles.day,
                          isToday && !isSelected && styles.dayToday,
                          isSelected && styles.daySelected,
                        ]}
                      >
                        {/* `dayTextSelected` last so it wins: a value that was
                            already in the past stays legible as the selection
                            even though the day itself is now out of reach. */}
                        <Text
                          style={[
                            styles.dayText,
                            isToday && !isSelected && styles.dayTextToday,
                            disabled && styles.dayTextDisabled,
                            isSelected && styles.dayTextSelected,
                          ]}
                        >
                          {dayNumber}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={() => onConfirm(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear the expiration date"
              style={styles.clearBtn}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
            <PillButton title="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
            <PillButton
              title="Set date"
              onPress={() => onConfirm(selected)}
              disabled={!selected}
              style={{ flex: 1 }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
  },
  card: {
    width: '100%', maxWidth: 400,
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.lg, ...SHADOW.card,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: {
    width: 36, height: 36, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.mutedBg,
  },
  navBtnOff: { backgroundColor: 'transparent' },
  monthLabel: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  title: { fontSize: 12.5, color: COLORS.secondaryText, textAlign: 'center', marginTop: 6 },
  weekRow: { flexDirection: 'row', marginTop: SPACING.md },
  weekday: {
    flex: 1, textAlign: 'center',
    fontSize: 11, fontWeight: '700', color: COLORS.secondaryText,
  },
  grid: { marginTop: 4 },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  day: {
    width: 36, height: 36, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  dayToday: { borderWidth: 1.5, borderColor: COLORS.primary },
  daySelected: { backgroundColor: COLORS.primary },
  dayText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  dayTextToday: { color: COLORS.primary, fontWeight: '800' },
  dayTextSelected: { color: COLORS.white, fontWeight: '800' },
  dayTextDisabled: { color: COLORS.divider },
  actions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.lg },
  clearBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  clearText: { fontSize: 13, fontWeight: '700', color: COLORS.danger },
});
