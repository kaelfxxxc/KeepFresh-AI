import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, ChevronRight } from 'lucide-react-native';
import { PillButton } from './ui';
import { DatePickerModal } from './DatePicker';
import { formatDateKey } from '../utils/dateKey';
import { formatRangeLabel } from '../utils/wasteTrend';
import { colors, radii, spacing, shadow, overlay } from '../../theme';

type Bound = 'start' | 'end';

/**
 * Pick a start and an end date for a report.
 *
 * Two bounds rather than a drag-select calendar: the existing month grid
 * (`DatePickerModal`) already speaks the app's visual language and needs no new
 * gesture, so the range is assembled from two ordinary picks and the chosen span
 * is shown back as one line — which is the thing the user is actually deciding.
 *
 * Only one modal is ever presented at a time. The bound being edited hides this
 * sheet and shows the calendar instead of stacking a second modal over it, which
 * is fragile on both platforms and leaves the back gesture ambiguous.
 */
export function DateRangePickerModal({
  visible,
  start,
  end,
  minDate = null,
  maxDate = null,
  title = 'Select range',
  onCancel,
  onConfirm,
  onReset,
}: {
  visible: boolean;
  /** Current range as `YYYY-MM-DD` keys. */
  start: string;
  end: string;
  /** Earliest day the start may be set to, or null for no limit. */
  minDate?: string | null;
  /** Latest day the end may be set to, or null for no limit. */
  maxDate?: string | null;
  title?: string;
  onCancel: () => void;
  onConfirm: (start: string, end: string) => void;
  /** Offered when the caller has a range worth returning to. */
  onReset?: () => void;
}) {
  const [draft, setDraft] = useState({ start, end });
  const [editing, setEditing] = useState<Bound | null>(null);

  // Re-seed on open, so the sheet shows the range the report is actually on
  // rather than whichever bounds were left behind by a cancelled edit.
  useEffect(() => {
    if (!visible) return;
    setDraft({ start, end });
    setEditing(null);
  }, [visible, start, end]);

  const pick = (bound: Bound) => (key: string | null) => {
    // `showClear` is off for both bounds, so null is not a value either of them
    // offers; ignoring it keeps the range always a range.
    if (key) setDraft((current) => ({ ...current, [bound]: key }));
    setEditing(null);
  };

  // Each bound is constrained by the other, so a range cannot be assembled that
  // the report would have to draw backwards.
  const editingStart = editing === 'start';

  return (
    <>
      <Modal
        visible={visible && editing === null}
        transparent
        animationType="fade"
        onRequestClose={onCancel}
      >
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>{title}</Text>

            <Pressable
              style={styles.row}
              onPress={() => setEditing('start')}
              accessibilityRole="button"
              accessibilityLabel={`From ${formatDateKey(draft.start)}. Change the start date`}
            >
              <Text style={styles.rowLabel}>From</Text>
              <View style={styles.rowValue}>
                <Text style={styles.rowDate}>{formatDateKey(draft.start)}</Text>
                <ChevronRight size={17} strokeWidth={2.2} color={colors.textSecondary} />
              </View>
            </Pressable>

            <Pressable
              style={[styles.row, styles.rowDivided]}
              onPress={() => setEditing('end')}
              accessibilityRole="button"
              accessibilityLabel={`To ${formatDateKey(draft.end)}. Change the end date`}
            >
              <Text style={styles.rowLabel}>To</Text>
              <View style={styles.rowValue}>
                <Text style={styles.rowDate}>{formatDateKey(draft.end)}</Text>
                <ChevronRight size={17} strokeWidth={2.2} color={colors.textSecondary} />
              </View>
            </Pressable>

            {/* What the two picks add up to, in the same shape the chart's own
                chip uses — so the span being confirmed is the span that shows. */}
            <View style={styles.summary}>
              <CalendarDays size={14} strokeWidth={2.2} color={colors.primary} />
              <Text style={styles.summaryText}>{formatRangeLabel(draft.start, draft.end)}</Text>
            </View>

            <View style={styles.actions}>
              {onReset && (
                <Pressable
                  onPress={onReset}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Reset the range"
                  style={styles.resetBtn}
                >
                  <Text style={styles.resetText}>Reset</Text>
                </Pressable>
              )}
              <PillButton title="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
              <PillButton
                title="Apply"
                onPress={() => onConfirm(draft.start, draft.end)}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <DatePickerModal
        visible={visible && editing !== null}
        value={editingStart ? draft.start : draft.end}
        minDate={editingStart ? minDate : draft.start}
        maxDate={editingStart ? draft.end : maxDate}
        title={editingStart ? 'From' : 'To'}
        confirmLabel={editingStart ? 'Set start' : 'Set end'}
        showClear={false}
        onCancel={() => setEditing(null)}
        onConfirm={pick(editingStart ? 'start' : 'end')}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: overlay,
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  card: {
    width: '100%', maxWidth: 400,
    backgroundColor: colors.surface, borderRadius: radii.lg,
    padding: spacing.lg, ...shadow.card,
  },
  title: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { fontSize: 13.5, fontWeight: '700', color: colors.textSecondary },
  rowValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowDate: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.mintBg, borderRadius: radii.pill,
    paddingVertical: 8, paddingHorizontal: spacing.md, marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  summaryText: { fontSize: 12.5, fontWeight: '700', color: colors.primaryDark },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  resetBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  resetText: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
