// Staff & roles — Food Establishment Pro.
//
// Owner / Manager / Staff, with the permission matrix shown on screen so the
// consequence of a role is visible before it is granted. The database is the
// real boundary: RLS plus `can_manage_org` inside every routine, so a staff
// device cannot promote itself no matter what the client sends.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  UserCog,
  Trash2,
  Check,
  X,
  Building2,
} from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { colors, radii, spacing, shadow, statusSurface, overlay } from '../theme';
import { NavHeader, Card, PillButton, Field, EmptyState, FeatureLock, PlanCheckLock, AvatarCircle, SectionLabel, PermissionsTable, StatusPill, SectionHeader } from '../src/components/ui';
import {
  organizationService,
  ROLE_PERMISSIONS,
  roleLabel,
  type OrganizationMemberWithProfile,
  type OrganizationWithMembership,
} from '../src/services/organizationService';
import type { OrgRole } from '../src/types';
import { usePageGutter } from '../src/hooks/useContentLayout';

const ROLE_ICON: Record<OrgRole, typeof Shield> = {
  owner: ShieldCheck,
  manager: Shield,
  staff: UserCog,
};

/** Roles that can be granted from the UI — ownership is not transferable here. */
const ASSIGNABLE: Exclude<OrgRole, 'owner'>[] = ['manager', 'staff'];

export default function StaffScreen() {
  // The page gutter: the usual margin on a phone, and the slack that centres
  // the column once the screen is wider than `CONTENT_MAX_WIDTH`.
  const { gutter } = usePageGutter();
  const { profile } = useAuth();
  const { gates, entitlements, loading: planLoading, error: planError, refresh: refreshPlan } = useSubscription();

  const [org, setOrg] = useState<OrganizationWithMembership | null>(null);
  const [members, setMembers] = useState<OrganizationMemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [creatingOrg, setCreatingOrg] = useState(false);

  const canManage = gates.staffManagement.allowed;

  const load = useCallback(async () => {
    if (!profile || !canManage) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const primary = await organizationService.getPrimary(profile.id);
      setOrg(primary);
      setMembers(primary ? await organizationService.listMembers(primary.id) : []);
    } catch (e) {
      Alert.alert('Could not load your team', (e as Error)?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, canManage]);

  useEffect(() => { load(); }, [load]);

  /** Only owners and managers may change the team, per the matrix. */
  const myRole = org?.myRole ?? null;
  const canEditTeam = !!myRole && ROLE_PERMISSIONS[myRole].manageStaff;

  const changeRole = (member: OrganizationMemberWithProfile, role: Exclude<OrgRole, 'owner'>) => {
    Alert.alert(
      `Make ${displayName(member)} a ${roleLabel(role)}?`,
      ROLE_PERMISSIONS[role].description,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change role',
          onPress: async () => {
            try {
              await organizationService.updateMemberRole(member.id, role);
              await load();
            } catch (e) {
              Alert.alert('Could not change the role', (e as Error)?.message ?? 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const removeMember = (member: OrganizationMemberWithProfile) => {
    Alert.alert(
      `Remove ${displayName(member)}?`,
      'They lose access to this inventory immediately. Items they added stay, and their history is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await organizationService.removeMember(member.id);
              await load();
            } catch (e) {
              Alert.alert('Could not remove them', (e as Error)?.message ?? 'Please try again.');
            }
          },
        },
      ]
    );
  };

  // With no entitlements every gate answers "allowed", so without this the team
  // list would render for an account whose plan does not include it. Neither
  // allowing nor denying is honest yet — say the plan is unknown.
  if (!entitlements) {
    return (
      <View style={styles.container}>
        <NavHeader title="Staff & Roles" subtitle="Your team" />
        <PlanCheckLock loading={planLoading} error={planError} onRetry={refreshPlan} />
      </View>
    );
  }

  if (!canManage) {
    // Staff accounts only exist on Food Establishment plans. A household
    // account cannot buy its way in, so it gets the reason rather than an
    // invitation to a plan list that does not contain this feature.
    const forEstablishment = profile?.account_type !== 'establishment';
    return (
      <View style={styles.container}>
        <NavHeader title="Staff & Roles" subtitle="Your team" />
        <FeatureLock
          icon={Users}
          title={
            forEstablishment
              ? 'Staff accounts are for Food Establishment accounts'
              : 'Staff accounts are a Pro feature'
          }
          message={
            forEstablishment
              ? 'Team logins, roles and bulk stock operations are built for food establishments — a shop or kitchen where more than one person handles the same inventory.'
              : 'Give owners, managers and staff their own logins to the same inventory, each with only the access they need.'
          }
          bullets={[
            'Three roles: Owner, Manager, Staff',
            'Managers run the team; staff update stock',
            'Every change is attributed to the person who made it',
            'Remove access instantly, without losing history',
          ]}
          // No household plan contains this feature, so a household account is
          // given the change it actually has to make. Telling it to subscribe
          // would point at a price list that cannot sell it the page.
          requirement={
            forEstablishment
              ? 'Switch to a Food Establishment account to use this page.'
              : undefined
          }
          ctaLabel={forEstablishment ? 'Back to profile' : 'See plans'}
          onPress={() => router.push(forEstablishment ? '/profile' : '/subscription')}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NavHeader
        title="Staff & Roles"
        subtitle={org ? org.name : 'Your team'}
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={colors.primary} /></View>
        ) : !org ? (
          <EmptyState
            icon={Building2}
            title="No team yet"
            hint="Create a team for your establishment, then invite the people who handle stock."
            actionLabel="Create team"
            onAction={() => setCreatingOrg(true)}
          />
        ) : (
          <>
            {!canEditTeam && (
              <Card style={styles.noticeCard}>
                <Text style={styles.noticeText}>
                  You are a {roleLabel(myRole)} here, so you can see the team but not change it.
                </Text>
              </Card>
            )}

            {/* The people */}
            <SectionLabel right={<Text style={styles.count}>{members.length}</Text>}>
              Team
            </SectionLabel>
            <View style={{ gap: spacing.sm }}>
              {members.map((member) => {
                const RoleIcon = ROLE_ICON[member.role];
                const isMe = member.user_id === profile?.id;
                return (
                  <Card key={member.id} style={styles.memberCard}>
                    <View style={styles.memberRow}>
                      <AvatarCircle
                        uri={member.profile?.avatar_url}
                        initials={member.profile?.full_name ?? member.invited_email}
                        size={44}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {displayName(member)}
                          {isMe ? ' (you)' : ''}
                        </Text>
                        <Text style={styles.memberEmail} numberOfLines={1}>
                          {member.profile?.email ?? member.invited_email ?? '—'}
                        </Text>
                      </View>
                      <StatusPill
                        status={
                          member.status !== 'active'
                            ? 'expiringSoon'
                            : member.role === 'owner'
                              ? 'active'
                              : member.role === 'manager'
                                ? 'fresh'
                                : 'active'
                        }
                        label={
                          member.status !== 'active'
                            ? 'INVITED'
                            : roleLabel(member.role).toUpperCase()
                        }
                      />
                    </View>

                    {member.status !== 'active' && (
                      <Text style={styles.pendingNote}>
                        Invitation sent — they join once they sign up with this email.
                      </Text>
                    )}

                    {/* The owner row is deliberately actionless: ownership is
                        not transferable from here, and removing the owner would
                        orphan the team. */}
                    {canEditTeam && member.role !== 'owner' && (
                      <View style={styles.memberActions}>
                        {ASSIGNABLE.map((role) => (
                          <Pressable
                            key={role}
                            onPress={() => changeRole(member, role)}
                            disabled={member.role === role}
                            style={[styles.roleBtn, member.role === role && styles.roleBtnActive]}
                          >
                            <Text
                              style={[
                                styles.roleBtnText,
                                member.role === role && styles.roleBtnTextActive,
                              ]}
                            >
                              {roleLabel(role)}
                            </Text>
                          </Pressable>
                        ))}
                        <Pressable style={styles.removeBtn} onPress={() => removeMember(member)}>
                          <Trash2 size={15} color={colors.danger} strokeWidth={2.2} />
                        </Pressable>
                      </View>
                    )}
                  </Card>
                );
              })}
            </View>

            {canEditTeam && (
              <PillButton
                title="Invite by email"
                icon={UserPlus}
                onPress={() => setInviting(true)}
                style={{ marginTop: spacing.lg }}
              />
            )}

            {/* What each role may do — PermissionsTable */}
            <View style={{ marginTop: spacing.xl }}>
              <SectionHeader title="What each role can do" />
              <PermissionsTable
                columns={['Staff', 'Reports', 'Edit', 'Delete']}
                roles={[
                  {
                    name: 'Owner',
                    dotColor: colors.primary,
                    permissions: [
                      ROLE_PERMISSIONS.owner.manageStaff,
                      ROLE_PERMISSIONS.owner.viewReports,
                      ROLE_PERMISSIONS.owner.editInventory,
                      ROLE_PERMISSIONS.owner.deleteInventory,
                    ],
                  },
                  {
                    name: 'Manager',
                    dotColor: colors.warning,
                    permissions: [
                      ROLE_PERMISSIONS.manager.manageStaff,
                      ROLE_PERMISSIONS.manager.viewReports,
                      ROLE_PERMISSIONS.manager.editInventory,
                      ROLE_PERMISSIONS.manager.deleteInventory,
                    ],
                  },
                  {
                    name: 'Staff',
                    dotColor: colors.textSecondary,
                    permissions: [
                      ROLE_PERMISSIONS.staff.manageStaff,
                      ROLE_PERMISSIONS.staff.viewReports,
                      ROLE_PERMISSIONS.staff.editInventory,
                      ROLE_PERMISSIONS.staff.deleteInventory,
                    ],
                  },
                ]}
              />
              <Text style={styles.footnote}>
                These are enforced in the database, not just here — a staff device cannot promote
                itself or delete stock.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <InviteModal
        visible={inviting}
        organizationId={org?.id ?? null}
        onClose={() => setInviting(false)}
        onSaved={async () => { setInviting(false); await load(); }}
      />

      <NameModal
        visible={creatingOrg}
        title="Create your team"
        hint="Usually your establishment's name. Everyone you invite joins this team."
        label="Team name"
        placeholder="e.g. Beldad Kitchen"
        confirmLabel="Create"
        onClose={() => setCreatingOrg(false)}
        onSubmit={async (name) => {
          await organizationService.create(name);
          await load();
        }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------- helpers */

function displayName(member: OrganizationMemberWithProfile): string {
  return member.profile?.full_name?.trim() || member.profile?.email || member.invited_email || 'Pending member';
}

/* -------------------------------------------------------------- invite modal */

function InviteModal({
  visible,
  organizationId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  organizationId: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<OrgRole, 'owner'>>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setEmail('');
    setRole('staff');
    setError(null);
  }, [visible]);

  const invite = async () => {
    if (!organizationId) return;
    const trimmed = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      await organizationService.addMemberByEmail(organizationId, trimmed, role);
      await onSaved();
    } catch (e) {
      // The RPC is explicit when the address has no account yet — surface that
      // rather than a generic failure.
      setError((e as Error)?.message ?? 'Could not send that invitation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Invite a teammate</Text>
            <Text style={styles.sheetHint}>
              They need a KeepFresh AI account with this email — ask them to sign up first if they
              haven't.
            </Text>

            <Field
              label="Email"
              value={email}
              onChangeText={(t) => { setEmail(t); if (error) setError(null); }}
              placeholder="name@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
              editable={!busy}
            />

            <Text style={styles.sheetLabel}>Role</Text>
            <View style={styles.roleOptions}>
              {ASSIGNABLE.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setRole(option)}
                  style={[styles.roleOption, role === option && styles.roleOptionActive]}
                >
                  <Text style={[styles.roleOptionTitle, role === option && styles.roleOptionTitleActive]}>
                    {roleLabel(option)}
                  </Text>
                  <Text style={[styles.roleOptionDesc, role === option && styles.roleOptionDescActive]}>
                    {ROLE_PERMISSIONS[option].description}
                  </Text>
                </Pressable>
              ))}
            </View>

            {!!error && <Text style={styles.sheetError}>{error}</Text>}

            <View style={styles.sheetActions}>
              <PillButton title="Cancel" variant="outline" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
              <PillButton title="Send invite" onPress={invite} loading={busy} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------------------------------------------------------------- name modal */

function NameModal({
  visible,
  title,
  hint,
  label,
  placeholder,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  hint: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setValue('');
    setError(null);
  }, [visible]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('This needs a name.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Text style={styles.sheetHint}>{hint}</Text>
            <Field
              label={label}
              value={value}
              onChangeText={(t) => { setValue(t); if (error) setError(null); }}
              placeholder={placeholder}
              autoFocus
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={submit}
            />
            {!!error && <Text style={styles.sheetError}>{error}</Text>}
            <View style={styles.sheetActions}>
              <PillButton title="Cancel" variant="outline" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
              <PillButton title={confirmLabel} onPress={submit} loading={busy} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  loadingBox: { paddingVertical: spacing.xxl, alignItems: 'center' },
  count: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },

  noticeCard: {
    padding: spacing.md,
    backgroundColor: statusSurface.warning.bg,
    borderColor: statusSurface.warning.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    ...shadow.card,
  },
  noticeText: { fontSize: 12.5, color: statusSurface.warning.text, lineHeight: 17 },

  memberCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  memberEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  pendingNote: { fontSize: 11.5, color: colors.warning, marginTop: spacing.sm },
  memberActions: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  roleBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill,
    backgroundColor: colors.screenBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleBtnActive: { backgroundColor: colors.mintBg, borderColor: colors.primary },
  roleBtnText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
  roleBtnTextActive: { color: colors.primary },
  removeBtn: { marginLeft: 'auto', padding: 6 },

  // Keep matrix styles (fallback, won't be used now since PermissionsTable replaced it)
  matrixCard: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  matrixHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  matrixRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  matrixCell: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  matrixRoleCol: { flex: 1.3 },
  matrixRoleName: { fontSize: 13.5, fontWeight: '700', color: colors.textPrimary },
  matrixCol: { flex: 1, textAlign: 'center', alignItems: 'center' },

  footnote: { fontSize: 11.5, color: colors.textSecondary, lineHeight: 16, marginTop: spacing.sm, paddingHorizontal: 2 },

  backdrop: {
    flex: 1, backgroundColor: overlay,
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  sheet: {
    width: '100%', maxWidth: 440,
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
    ...shadow.card,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  sheetHint: { fontSize: 12.5, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.md, lineHeight: 17 },
  sheetLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 6 },
  roleOptions: { gap: spacing.sm },
  roleOption: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    padding: spacing.md,
  },
  roleOptionActive: { borderColor: colors.primary, backgroundColor: colors.mintBg },
  roleOptionTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  roleOptionTitleActive: { color: colors.primary },
  roleOptionDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  roleOptionDescActive: { color: colors.primaryDark },
  sheetError: { fontSize: 12, color: colors.danger, marginTop: spacing.sm },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
});
