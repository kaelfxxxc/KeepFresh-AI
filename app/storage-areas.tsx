// Storage areas — refrigerator, freezer, pantry, cabinet, or your own.
//
// The plan decides how many you get, and that is enforced in a database trigger
// as well as here. The UI checks first so the user sees an upgrade prompt rather
// than a rejected write; deleting an area never deletes the food inside it,
// which the copy says out loud because it is the obvious fear.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Pressable,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Boxes, Pencil, Trash2, Plus, Home } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { colors, radii, spacing, shadow, overlay } from '../theme';
import { NavHeader, Card, PillButton, Field, EmptyState, UpgradeNotice, StatusPill, ProgressBar, IconBadge } from '../src/components/ui';
import { storageAreaService, STORAGE_KINDS, storageEmoji } from '../src/services/storageAreaService';
import { gateUseMultipleStorage, describeEntitlementError } from '../src/services/entitlementService';
import type { StorageArea, StorageKind } from '../src/types';
import { usePageGutter } from '../src/hooks/useContentLayout';

export default function StorageAreasScreen() {
  // The page gutter: the usual margin on a phone, and the slack that centres
  // the column once the screen is wider than `CONTENT_MAX_WIDTH`.
  const { gutter } = usePageGutter();
  const { profile } = useAuth();
  const { entitlements, refresh } = useSubscription();

  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unassigned, setUnassigned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<StorageArea | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const [list, itemCounts, unassignedCount] = await Promise.all([
        storageAreaService.list(profile.id),
        storageAreaService.itemCounts(profile.id),
        storageAreaService.unassignedCount(profile.id),
      ]);
      setAreas(list);
      setCounts(itemCounts);
      setUnassigned(unassignedCount);
    } catch (e) {
      Alert.alert('Could not load storage areas', (e as Error)?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  // Count-aware: the plan's cap applies to how many areas exist, so the gate
  // needs the current number, not just the feature flag.
  const addGate = gateUseMultipleStorage(entitlements, areas.length);
  const limit = entitlements?.features?.multiple_storage?.limit ?? null;

  const removeArea = (area: StorageArea) => {
    Alert.alert(
      `Delete "${area.name}"?`,
      `The ${counts[area.id] ?? 0} item${(counts[area.id] ?? 0) === 1 ? '' : 's'} inside will not be deleted — they become unassigned and stay in your inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await storageAreaService.remove(area.id);
              await load();
            } catch (e) {
              Alert.alert('Could not delete', (e as Error)?.message ?? 'Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <NavHeader title="Storage Areas" subtitle={subtitleFor(areas.length, limit)} onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); refresh(); }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {!addGate.allowed && areas.length > 0 && (
          <UpgradeNotice
            title={addGate.title}
            message={addGate.message}
            onPress={() => router.push('/subscription')}
            style={{ marginBottom: spacing.md }}
          />
        )}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : areas.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No storage areas yet"
            hint="Create a refrigerator, freezer or pantry so you can see what is where."
            actionLabel={addGate.allowed ? 'Add an area' : undefined}
            onAction={addGate.allowed ? () => setCreating(true) : undefined}
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            {areas.map((area) => {
              const count = counts[area.id] ?? 0;
              const estCapacity = 25;
              const pct = Math.min(100, Math.round((count / estCapacity) * 100));
              const statusPillType = area.is_default
                ? 'active'
                : count > 20
                  ? 'expired'
                  : count > 10
                    ? 'expiringSoon'
                    : 'fresh';

              return (
                <Card key={area.id} style={styles.areaCard}>
                  <View style={styles.areaRow}>
                    <View style={styles.areaIcon}>
                      <Text style={styles.areaEmoji}>{storageEmoji(area)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <Text style={styles.areaName} numberOfLines={1}>{area.name}</Text>
                        <StatusPill
                          status={statusPillType}
                          label={area.is_default ? 'DEFAULT' : count > 20 ? 'NEAR FULL' : `${count} ITEMS`}
                        />
                      </View>
                      <Text style={styles.areaMeta} numberOfLines={1}>
                        {labelForKind(area.kind)} · {count} item{count === 1 ? '' : 's'} stored
                      </Text>
                    </View>
                  </View>

                  <View style={{ marginTop: spacing.sm }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={styles.capacityLabel}>Storage load</Text>
                      <Text style={styles.capacityPercent}>{pct}% capacity</Text>
                    </View>
                    <ProgressBar
                      value={count}
                      max={estCapacity}
                      colorRamp={true}
                      height={6}
                    />
                  </View>

                  <View style={styles.areaActions}>
                    <Pressable style={styles.areaAction} onPress={() => setEditing(area)}>
                      <IconBadge color={colors.primary} size={28}>
                        <Pencil size={14} color={colors.primary} strokeWidth={2.4} />
                      </IconBadge>
                      <Text style={styles.areaActionText}>Rename</Text>
                    </Pressable>
                    <Pressable style={styles.areaAction} onPress={() => removeArea(area)}>
                      <IconBadge color={colors.danger} size={28}>
                        <Trash2 size={14} color={colors.danger} strokeWidth={2.4} />
                      </IconBadge>
                      <Text style={[styles.areaActionText, { color: colors.danger }]}>Delete</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {areas.length > 0 && (
          <PillButton
            title={addGate.allowed ? 'Add storage area' : 'Upgrade for more areas'}
            icon={addGate.allowed ? Plus : Boxes}
            variant={addGate.allowed ? 'primary' : 'outline'}
            onPress={() => (addGate.allowed ? setCreating(true) : router.push('/subscription'))}
            style={{ marginTop: spacing.lg }}
          />
        )}

        {unassigned > 0 && (
          <Text style={styles.footnote}>
            {unassigned} item{unassigned === 1 ? '' : 's'} not in any area. Open an item to move it —
            nothing is ever hidden.
          </Text>
        )}
      </ScrollView>

      <AreaEditor
        visible={creating || !!editing}
        area={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={async () => { setCreating(false); setEditing(null); await load(); }}
      />
    </View>
  );
}

/* --------------------------------------------------------------- editor modal */

/**
 * Create/rename dialog.
 *
 * A modal rather than `Alert.prompt`, which is iOS-only and throws on Android —
 * the same reason the shared `QuantityPrompt` exists.
 */
function AreaEditor({
  visible,
  area,
  onClose,
  onSaved,
}: {
  visible: boolean;
  area: StorageArea | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StorageKind>('refrigerator');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open so a previous edit never leaks into the next one.
  useEffect(() => {
    if (!visible) return;
    setName(area?.name ?? '');
    setKind(area?.kind ?? 'refrigerator');
    setError(null);
  }, [visible, area]);

  const save = async () => {
    if (!profile) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give this area a name.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (area) {
        await storageAreaService.update(area.id, { name: trimmed, kind });
      } else {
        await storageAreaService.create(profile.id, { name: trimmed, kind });
      }
      await onSaved();
    } catch (e) {
      // A plan cap comes back as an error code — say what it means.
      const gate = describeEntitlementError(e);
      if (gate) {
        onClose();
        router.push('/subscription');
      } else {
        setError((e as Error)?.message ?? 'Could not save this area.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{area ? 'Rename area' : 'New storage area'}</Text>

            <Field
              label="Name"
              value={name}
              onChangeText={(t) => { setName(t); if (error) setError(null); }}
              placeholder="e.g. Kitchen Fridge"
              autoFocus
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={save}
            />

            <Text style={styles.sheetLabel}>Type</Text>
            <View style={styles.kindWrap}>
              {STORAGE_KINDS.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setKind(option.value)}
                  style={[styles.kindChip, kind === option.value && styles.kindChipActive]}
                >
                  <Text
                    style={[styles.kindChipText, kind === option.value && styles.kindChipTextActive]}
                  >
                    {option.emoji} {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {!!error && <Text style={styles.sheetError}>{error}</Text>}

            <View style={styles.sheetActions}>
              <PillButton title="Cancel" variant="outline" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
              <PillButton title={area ? 'Save' : 'Create'} onPress={save} loading={busy} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ------------------------------------------------------------------- helpers */

function labelForKind(kind: StorageKind): string {
  return STORAGE_KINDS.find((k) => k.value === kind)?.label ?? 'Custom';
}

/** "2 of 3 areas used" when the plan caps them, otherwise just the count. */
function subtitleFor(count: number, limit: number | null): string {
  if (limit == null) return `${count} area${count === 1 ? '' : 's'}`;
  return `${count} of ${limit} area${limit === 1 ? '' : 's'} used`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  loadingBox: { paddingVertical: spacing.xl, alignItems: 'center' },

  areaCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  areaIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.mintBg, alignItems: 'center', justifyContent: 'center',
  },
  areaEmoji: { fontSize: 20 },
  areaName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  areaMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  capacityLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  capacityPercent: { fontSize: 11, fontWeight: '700', color: colors.primary },
  areaActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg,
    marginTop: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  areaAction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  areaActionText: { fontSize: 13, fontWeight: '700', color: colors.primary },

  footnote: {
    fontSize: 12, color: colors.textSecondary, lineHeight: 17,
    marginTop: spacing.lg, paddingHorizontal: 2,
  },

  backdrop: {
    flex: 1, backgroundColor: overlay,
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  sheet: {
    width: '100%', maxWidth: 420,
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
    ...shadow.card,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.md },
  sheetLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 6 },
  kindWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  kindChipActive: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  kindChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  kindChipTextActive: { color: colors.surface },
  sheetError: { fontSize: 12, color: colors.danger, marginTop: spacing.sm },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
});
