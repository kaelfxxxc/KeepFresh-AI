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
import { COLORS, RADII, SPACING } from '../src/theme';
import {
  NavHeader,
  Card,
  PillButton,
  Field,
  EmptyState,
  UpgradeNotice,
  StatusBadge,
} from '../src/components/ui';
import { storageAreaService, STORAGE_KINDS, storageEmoji } from '../src/services/storageAreaService';
import { gateUseMultipleStorage, describeEntitlementError } from '../src/services/entitlementService';
import type { StorageArea, StorageKind } from '../src/types';

export default function StorageAreasScreen() {
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
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); refresh(); }}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        {!addGate.allowed && areas.length > 0 && (
          <UpgradeNotice
            title={addGate.title}
            message={addGate.message}
            onPress={() => router.push('/subscription')}
            style={{ marginBottom: SPACING.md }}
          />
        )}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={COLORS.primary} />
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
          <View style={{ gap: SPACING.sm }}>
            {areas.map((area) => (
              <Card key={area.id} style={styles.areaCard}>
                <View style={styles.areaRow}>
                  <View style={styles.areaIcon}>
                    <Text style={styles.areaEmoji}>{storageEmoji(area)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.areaName} numberOfLines={1}>{area.name}</Text>
                    <Text style={styles.areaMeta} numberOfLines={1}>
                      {labelForKind(area.kind)} · {counts[area.id] ?? 0} item{(counts[area.id] ?? 0) === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {area.is_default && <StatusBadge label="Default" tone="success" icon={Home} />}
                </View>

                <View style={styles.areaActions}>
                  <Pressable style={styles.areaAction} onPress={() => setEditing(area)}>
                    <Pencil size={15} color={COLORS.primary} strokeWidth={2.2} />
                    <Text style={styles.areaActionText}>Rename</Text>
                  </Pressable>
                  <Pressable style={styles.areaAction} onPress={() => removeArea(area)}>
                    <Trash2 size={15} color={COLORS.danger} strokeWidth={2.2} />
                    <Text style={[styles.areaActionText, { color: COLORS.danger }]}>Delete</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        )}

        {areas.length > 0 && (
          <PillButton
            title={addGate.allowed ? 'Add storage area' : 'Upgrade for more areas'}
            icon={addGate.allowed ? Plus : Boxes}
            variant={addGate.allowed ? 'primary' : 'outline'}
            onPress={() => (addGate.allowed ? setCreating(true) : router.push('/subscription'))}
            style={{ marginTop: SPACING.lg }}
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
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingBox: { paddingVertical: SPACING.xl, alignItems: 'center' },

  areaCard: { padding: SPACING.md },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  areaIcon: {
    width: 44, height: 44, borderRadius: RADII.icon,
    backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  areaEmoji: { fontSize: 20 },
  areaName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  areaMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  areaActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.lg,
    marginTop: SPACING.sm, paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  areaAction: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  areaActionText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },

  footnote: {
    fontSize: 12, color: COLORS.secondaryText, lineHeight: 17,
    marginTop: SPACING.lg, paddingHorizontal: 2,
  },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
  },
  sheet: {
    width: '100%', maxWidth: 420,
    backgroundColor: COLORS.white, borderRadius: RADII.card, padding: SPACING.lg,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.md },
  sheetLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  kindWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  kindChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADII.pill,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
  },
  kindChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  kindChipText: { fontSize: 13, fontWeight: '600', color: COLORS.secondaryText },
  kindChipTextActive: { color: COLORS.white },
  sheetError: { fontSize: 12, color: COLORS.dangerText, marginTop: SPACING.sm },
  sheetActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
});
