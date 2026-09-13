// Bulk inventory — Food Establishment Pro.
//
// Everything here goes through the `bulk_*` RPCs rather than a client-side loop:
// a batch either lands completely or not at all, capacity is validated for the
// whole set before anything is written, and the entitlement check cannot be
// skipped from a modified client.
//
// The paste parser is pure, so the preview below the box updates as you type
// without a single network call.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Pressable,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import {
  Layers,
  ClipboardPaste,
  Check,
  AlertTriangle,
  PackagePlus,
  Trash2,
  ArrowUpDown,
  Eraser,
} from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { COLORS, RADII, SPACING } from '../src/theme';
import {
  NavHeader,
  Card,
  PillButton,
  Segmented,
  EmptyState,
  StatusBadge,
  FeatureLock,
  QuantityStepper,
  SectionLabel,
} from '../src/components/ui';
import { inventoryService } from '../src/services/inventoryService';
import { storageAreaService, storageEmoji } from '../src/services/storageAreaService';
import { describeEntitlementError } from '../src/services/entitlementService';
import {
  bulkInventoryService,
  parseBulkText,
  BULK_COLUMNS,
  type ParsedBulkRow,
} from '../src/services/bulkInventoryService';
import { EXPIRATION_ALERT_OPTIONS, type InventoryItem, type StorageArea } from '../src/types';

type Tab = 'add' | 'edit';

/** Mirrors the cap `bulk_add_inventory` enforces, so the refusal is explained
 *  before the round-trip rather than arriving as a raw database message. */
const BULK_MAX_ROWS = 500;

const SAMPLE = `${BULK_COLUMNS.join(',')}
Pork Belly,5,kg,meat,2026-10-01,420
Rice 25kg,2,sack,grains,2027-01-15,1450`;

export default function BulkInventoryScreen() {
  const { profile } = useAuth();
  const { gates } = useSubscription();

  const [tab, setTab] = useState<Tab>('add');
  const canUse = gates.bulkInventory.allowed;

  if (!canUse) {
    // Bulk operations come with Food Establishment plans only, so a household
    // account is told why rather than sent to a plan list without them.
    const forEstablishment = profile?.account_type !== 'establishment';
    return (
      <View style={styles.container}>
        <NavHeader title="Bulk Inventory" subtitle="Many items at once" onBack={() => router.back()} />
        <FeatureLock
          icon={Layers}
          title={
            forEstablishment
              ? 'Bulk inventory is for Food Establishment accounts'
              : 'Bulk inventory is a Pro feature'
          }
          message={
            forEstablishment
              ? 'Pasting a delivery list and re-stocking a whole shelf at once is built for a working kitchen. It comes with Food Establishment plans.'
              : 'Built for a working kitchen: add a delivery in one paste, re-stock a whole shelf, and clear out a season’s stock without opening each item.'
          }
          bullets={[
            'Paste a delivery list or spreadsheet in one go',
            'Change category, unit, area or expiry across a selection',
            'Add or subtract the same quantity from many items',
            'Delete a whole selection at once',
          ]}
          ctaLabel={forEstablishment ? 'Back to profile' : 'See plans'}
          onPress={() => router.push(forEstablishment ? '/profile' : '/subscription')}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NavHeader title="Bulk Inventory" subtitle="Many items at once" onBack={() => router.back()} />

      <View style={{ paddingHorizontal: SPACING.lg, marginBottom: SPACING.md }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { label: 'Add many', value: 'add' },
            { label: 'Edit many', value: 'edit' },
          ]}
        />
      </View>

      {tab === 'add' ? <BulkAdd /> : <BulkEdit />}
    </View>
  );
}

/* ---------------------------------------------------------------- add many */

function BulkAdd() {
  const { profile } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [areaId, setAreaId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    storageAreaService
      .list(profile.id)
      .then((list) => {
        setAreas(list);
        setAreaId(list.find((a) => a.is_default)?.id ?? list[0]?.id ?? null);
      })
      .catch(() => {});
  }, [profile]);

  // Pure parse, re-run as the user types — no network, so the preview is instant.
  const rows: ParsedBulkRow[] = useMemo(() => parseBulkText(text), [text]);
  const valid = rows.filter((row) => row.draft);
  const problems = rows.filter((row) => row.problem);

  const submit = async () => {
    if (!profile || valid.length === 0) return;

    if (valid.length > BULK_MAX_ROWS) {
      Alert.alert(
        'That is a big delivery',
        `Add up to ${BULK_MAX_ROWS} rows at a time — split this into ${Math.ceil(
          valid.length / BULK_MAX_ROWS
        )} batches.`
      );
      return;
    }

    setBusy(true);
    try {
      const drafts = valid.map((row) => ({ ...row.draft!, storage_area_id: areaId }));
      const created = await bulkInventoryService.bulkAdd(drafts);
      Alert.alert(
        'Added',
        `${created.length} item${created.length === 1 ? '' : 's'} added to your inventory.`,
        [{ text: 'OK', onPress: () => setText('') }]
      );
    } catch (e) {
      // A capacity limit rejects the whole batch — say so, and offer the plan.
      const gate = describeEntitlementError(e);
      if (gate) {
        Alert.alert(gate.title, gate.message, [
          { text: 'Not now', style: 'cancel' },
          { text: 'See plans', onPress: () => router.push('/subscription') },
        ]);
      } else {
        Alert.alert('Nothing was added', (e as Error)?.message ?? 'Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <SectionLabel right={<ClipboardPaste size={15} color={COLORS.secondaryText} strokeWidth={2} />}>
        Paste your list
      </SectionLabel>
      <Card style={styles.pasteCard}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder={SAMPLE}
          placeholderTextColor={COLORS.secondaryText}
          style={styles.pasteInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Card>

      <Text style={styles.hint}>
        One product per line, comma or tab separated. Columns: {BULK_COLUMNS.join(', ')}. A header
        row is optional; lines starting with # are ignored.
      </Text>

      <View style={styles.pasteActions}>
        <PillButton
          title="Use sample"
          variant="subtle"
          onPress={() => setText(SAMPLE)}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <PillButton
          title="Clear"
          variant="outline"
          icon={Eraser}
          onPress={() => setText('')}
          disabled={busy || text.length === 0}
          style={{ flex: 1 }}
        />
      </View>

      {/* Live preview */}
      {rows.length > 0 && (
        <>
          <SectionLabel
            right={
              <View style={styles.previewCounts}>
                <StatusBadge label={`${valid.length} ready`} tone="success" />
                {problems.length > 0 && (
                  <StatusBadge label={`${problems.length} to fix`} tone="warning" />
                )}
              </View>
            }
          >
            Preview
          </SectionLabel>
          <Card style={styles.previewCard}>
            {rows.map((row) => (
              <View key={row.lineNumber} style={styles.previewRow}>
                {row.draft ? (
                  <Check size={14} color={COLORS.primary} strokeWidth={3} />
                ) : (
                  <AlertTriangle size={14} color={COLORS.warningText} strokeWidth={2.4} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.previewName} numberOfLines={1}>
                    {row.draft?.product_name ?? row.raw}
                  </Text>
                  <Text
                    style={[styles.previewMeta, !!row.problem && { color: COLORS.warningText }]}
                    numberOfLines={1}
                  >
                    {row.problem ??
                      `${row.draft?.quantity ?? 1} ${row.draft?.unit ?? 'pcs'}${
                        row.draft?.price != null ? ` · ₱${row.draft.price}` : ''
                      }${row.draft?.expiration_date ? ` · ${row.draft.expiration_date}` : ''}`}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {areas.length > 0 && (
        <>
          <SectionLabel>Put these in</SectionLabel>
          <View style={styles.chipWrap}>
            {areas.map((area) => (
              <Pressable
                key={area.id}
                onPress={() => setAreaId(area.id)}
                style={[styles.chip, areaId === area.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, areaId === area.id && styles.chipTextActive]}>
                  {storageEmoji(area)} {area.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <PillButton
        title={
          valid.length === 0
            ? 'Add to inventory'
            : `Add ${valid.length} item${valid.length === 1 ? '' : 's'}`
        }
        icon={PackagePlus}
        onPress={submit}
        loading={busy}
        disabled={valid.length === 0}
        style={{ marginTop: SPACING.lg }}
      />
      {problems.length > 0 && (
        <Text style={styles.warnNote}>
          {problems.length} line{problems.length === 1 ? '' : 's'} will be skipped. Fix them above to
          include them.
        </Text>
      )}
    </ScrollView>
  );
}

/* --------------------------------------------------------------- edit many */

type EditMode = 'fields' | 'quantity' | 'delete';

function BulkEdit() {
  const { profile } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<EditMode>('fields');
  const [delta, setDelta] = useState(1);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const [list, areaList] = await Promise.all([
        inventoryService.getInventory(profile.id),
        storageAreaService.list(profile.id),
      ]);
      // Only live stock is editable in bulk; consumed and wasted rows are a
      // historical record and must not be rewritten in a sweep.
      setItems(list.filter((item) => item.status === 'available'));
      setAreas(areaList);
    } catch (e) {
      Alert.alert('Could not load inventory', (e as Error)?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ids = [...selected];
  const allSelected = items.length > 0 && selected.size === items.length;

  const run = async (action: () => Promise<unknown>, describe: string) => {
    setBusy(true);
    try {
      await action();
      setSelected(new Set());
      await load();
      Alert.alert('Done', describe);
    } catch (e) {
      const gate = describeEntitlementError(e);
      if (gate) {
        Alert.alert(gate.title, gate.message, [
          { text: 'Not now', style: 'cancel' },
          { text: 'See plans', onPress: () => router.push('/subscription') },
        ]);
      } else {
        Alert.alert('Nothing was changed', (e as Error)?.message ?? 'Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const applyFields = (updates: Parameters<typeof bulkInventoryService.bulkUpdate>[1], describe: string) => {
    run(
      () => bulkInventoryService.bulkUpdate(ids, updates),
      `${describe} for ${ids.length} item${ids.length === 1 ? '' : 's'}.`
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`,
      'They are removed from inventory permanently. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => run(
            () => bulkInventoryService.bulkDelete(ids),
            `${ids.length} item${ids.length === 1 ? '' : 's'} deleted.`
          ),
        },
      ]
    );
  };

  if (loading) {
    return <View style={styles.loadingBox}><ActivityIndicator color={COLORS.primary} /></View>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="Nothing to edit yet"
        hint="Add products first, then come back to change them in bulk."
        actionLabel="Add items"
        onAction={() => router.push('/inventory/add')}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 180 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          colors={[COLORS.primary]}
          tintColor={COLORS.primary}
        />
      }
    >
      <SectionLabel
        right={
          <Pressable
            onPress={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
            hitSlop={8}
          >
            <Text style={styles.selectAll}>{allSelected ? 'Clear all' : 'Select all'}</Text>
          </Pressable>
        }
      >
        {selected.size > 0 ? `${selected.size} selected` : 'Select items'}
      </SectionLabel>

      <View style={{ gap: SPACING.sm }}>
        {items.map((item) => {
          const isSelected = selected.has(item.id);
          const area = areas.find((a) => a.id === item.storage_area_id);
          return (
            <Pressable
              key={item.id}
              onPress={() => toggle(item.id)}
              style={[styles.selectRow, isSelected && styles.selectRowActive]}
            >
              <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                {isSelected && <Check size={13} color={COLORS.white} strokeWidth={3.2} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.selectName} numberOfLines={1}>{item.product_name}</Text>
                <Text style={styles.selectMeta} numberOfLines={1}>
                  {item.quantity} {item.unit}
                  {item.category ? ` · ${item.category}` : ''}
                  {area ? ` · ${area.name}` : ''}
                  {item.expiration_date ? ` · ${item.expiration_date}` : ''}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {selected.size > 0 && (
        <Card style={styles.actionCard}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { label: 'Fields', value: 'fields' },
              { label: 'Quantity', value: 'quantity' },
              { label: 'Delete', value: 'delete' },
            ]}
          />

          {mode === 'fields' && (
            <View style={styles.actionBody}>
              <Text style={styles.actionLabel}>Set category</Text>
              <View style={styles.chipWrap}>
                {['produce', 'dairy', 'meat', 'seafood', 'grains', 'frozen', 'beverages', 'snacks', 'condiments', 'other'].map((category) => (
                  <Pressable
                    key={category}
                    onPress={() => applyFields({ category }, `Category set to ${category}`)}
                    disabled={busy}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {areas.length > 0 && (
                <>
                  <Text style={styles.actionLabel}>Move to area</Text>
                  <View style={styles.chipWrap}>
                    {areas.map((area) => (
                      <Pressable
                        key={area.id}
                        onPress={() => applyFields({ storage_area_id: area.id }, `Moved to ${area.name}`)}
                        disabled={busy}
                        style={styles.chip}
                      >
                        <Text style={styles.chipText}>{storageEmoji(area)} {area.name}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() => applyFields({ storage_area_id: null }, 'Cleared the storage area')}
                      disabled={busy}
                      style={styles.chip}
                    >
                      <Text style={styles.chipText}>Unassign</Text>
                    </Pressable>
                  </View>
                </>
              )}

              <Text style={styles.actionLabel}>Alert lead time</Text>
              <View style={styles.chipWrap}>
                {EXPIRATION_ALERT_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() =>
                      applyFields({ expiration_alert_days: option.value }, `Alerts set to ${option.label.toLowerCase()}`)
                    }
                    disabled={busy}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.actionLabel}>Set expiry (days from today)</Text>
              <View style={styles.chipWrap}>
                {[3, 7, 14, 30, 90].map((days) => (
                  <Pressable
                    key={days}
                    onPress={() => {
                      const date = new Date();
                      date.setDate(date.getDate() + days);
                      applyFields(
                        { expiration_date: date.toISOString().split('T')[0] },
                        `Expiry set to ${days} days from today`
                      );
                    }}
                    disabled={busy}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>+{days} days</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {mode === 'quantity' && (
            <View style={styles.actionBody}>
              <Text style={styles.actionLabel}>
                Add or subtract the same amount across the selection
              </Text>
              <View style={styles.quantityRow}>
                <QuantityStepper value={delta} onStep={(d) => setDelta((v) => Math.max(v + d, 1))} />
                <Text style={styles.quantityHint}>
                  {delta} {delta === 1 ? 'unit' : 'units'}
                </Text>
              </View>
              <View style={styles.quantityActions}>
                <PillButton
                  title={`Add ${delta}`}
                  variant="outline"
                  onPress={() => run(
                    () => bulkInventoryService.bulkAdjustQuantity(ids, delta),
                    `Added ${delta} to ${ids.length} item${ids.length === 1 ? '' : 's'}.`
                  )}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <PillButton
                  title={`Remove ${delta}`}
                  variant="outline"
                  onPress={() => run(
                    () => bulkInventoryService.bulkAdjustQuantity(ids, -delta),
                    `Removed ${delta} from ${ids.length} item${ids.length === 1 ? '' : 's'}. Quantities stop at zero.`
                  )}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </View>
              <View style={styles.quantityIconRow}>
                <ArrowUpDown size={13} color={COLORS.secondaryText} strokeWidth={2} />
                <Text style={styles.quantityNote}>
                  Quantities never go below zero — an item with less than the amount removed simply
                  empties.
                </Text>
              </View>
            </View>
          )}

          {mode === 'delete' && (
            <View style={styles.actionBody}>
              <Text style={styles.actionLabel}>
                Remove {ids.length} item{ids.length === 1 ? '' : 's'} from inventory
              </Text>
              <Text style={styles.quantityNote}>
                Deletion is permanent, and is recorded in each item's history before it goes.
              </Text>
              <PillButton
                title={`Delete ${ids.length} item${ids.length === 1 ? '' : 's'}`}
                variant="danger"
                icon={Trash2}
                onPress={confirmDelete}
                loading={busy}
                style={{ marginTop: SPACING.md }}
              />
            </View>
          )}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingBox: { paddingVertical: SPACING.xxl, alignItems: 'center' },

  pasteCard: { padding: SPACING.md },
  pasteInput: {
    minHeight: 120, fontSize: 13, color: COLORS.text,
    textAlignVertical: 'top', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hint: { fontSize: 11.5, color: COLORS.secondaryText, lineHeight: 16, marginTop: SPACING.sm },
  pasteActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },

  previewCounts: { flexDirection: 'row', gap: 6 },
  previewCard: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  previewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider,
  },
  previewName: { fontSize: 13.5, fontWeight: '600', color: COLORS.text },
  previewMeta: { fontSize: 11.5, color: COLORS.secondaryText, marginTop: 1 },
  warnNote: { fontSize: 11.5, color: COLORS.warningText, marginTop: SPACING.sm, lineHeight: 16 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADII.pill,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12.5, fontWeight: '600', color: COLORS.secondaryText },
  chipTextActive: { color: COLORS.white },

  selectAll: { fontSize: 12.5, fontWeight: '700', color: COLORS.primary },
  selectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.white, borderRadius: RADII.card, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.divider,
  },
  selectRowActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: COLORS.divider,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white,
  },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  selectName: { fontSize: 14.5, fontWeight: '700', color: COLORS.text },
  selectMeta: { fontSize: 11.5, color: COLORS.secondaryText, marginTop: 2 },

  actionCard: { marginTop: SPACING.lg, padding: SPACING.md },
  actionBody: { marginTop: SPACING.md },
  actionLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginTop: SPACING.md },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginTop: SPACING.sm },
  quantityHint: { fontSize: 13, color: COLORS.secondaryText, fontWeight: '600' },
  quantityActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  quantityIconRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SPACING.md },
  quantityNote: { flex: 1, fontSize: 11.5, color: COLORS.secondaryText, lineHeight: 16 },
});
