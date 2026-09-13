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
import { COLORS, RADII, SPACING } from '../src/theme';
import {
  NavHeader,
  Card,
  PillButton,
  Field,
  EmptyState,
  StatusBadge,
  FeatureLock,
  AvatarCircle,
  SectionLabel,
} from '../src/components/ui';
import {
  organizationService,
  ROLE_PERMISSIONS,
  roleLabel,
  type OrganizationMemberWithProfile,
  type OrganizationWithMembership,
} from '../src/services/organizationService';
import type { OrgRole } from '../src/types';

const ROLE_ICON: Record<OrgRole, typeof Shield> = {
  owner: ShieldCheck,
  manager: Shield,
  staff: UserCog,
};

/** Roles that can be granted from the UI — ownership is not transferable here. */
const ASSIGNABLE: Exclude<OrgRole, 'owner'>[] = ['manager', 'staff'];

export default function StaffScreen() {
  const { profile } = useAuth();
  const { gates } = useSubscription();

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

  if (!canManage && !loading) {
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
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={COLORS.primary} /></View>
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
            <View style={{ gap: SPACING.sm }}>
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
                      <StatusBadge
                        label={roleLabel(member.role)}
                        tone={member.role === 'owner' ? 'success' : member.role === 'manager' ? 'warning' : 'neutral'}
                        icon={RoleIcon}
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
                          <Trash2 size={15} color={COLORS.danger} strokeWidth={2.2} />
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
                style={{ marginTop: SPACING.lg }}
              />
            )}

            {/* What each role may do — the permission matrix, visible. */}
            <View style={{ marginTop: SPACING.xl }}>
              <SectionLabel>What each role can do</SectionLabel>
              <Card style={styles.matrixCard}>
                <View style={styles.matrixHead}>
                  <Text style={[styles.matrixCell, styles.matrixRoleCol]}> </Text>
                  <Text style={styles.matrixCol}>Staff</Text>
                  <Text style={styles.matrixCol}>Reports</Text>
                  <Text style={styles.matrixCol}>Edit</Text>
                  <Text style={styles.matrixCol}>Delete</Text>
                </View>
                {(['owner', 'manager', 'staff'] as OrgRole[]).map((role, index) => {
                  const permissions = ROLE_PERMISSIONS[role];
                  const flags = [
                    permissions.manageStaff,
                    permissions.viewReports,
                    permissions.editInventory,
                    permissions.deleteInventory,
                  ];
                  return (
                    <View
                      key={role}
                      style={[styles.matrixRow, index === 2 && { borderBottomWidth: 0 }]}
                    >
                      <Text style={[styles.matrixCell, styles.matrixRoleCol, styles.matrixRoleName]}>
                        {permissions.label}
                      </Text>
                      {flags.map((allowed, flagIndex) => (
                        <View key={flagIndex} style={styles.matrixCol}>
                          {allowed ? (
                            <Check size={15} color={COLORS.primary} strokeWidth={3} />
                          ) : (
                            <X size={15} color={COLORS.secondaryText} strokeWidth={2.4} />
                          )}
                        </View>
                      ))}
                    </View>
                  );
                })}
              </Card>
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
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingBox: { paddingVertical: SPACING.xxl, alignItems: 'center' },
  count: { fontSize: 13, fontWeight: '700', color: COLORS.secondaryText },

  noticeCard: { padding: SPACING.md, backgroundColor: COLORS.warningBg, borderColor: COLORS.warningBg },
  noticeText: { fontSize: 12.5, color: COLORS.warningText, lineHeight: 17 },

  memberCard: { padding: SPACING.md },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  memberEmail: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  pendingNote: { fontSize: 11.5, color: COLORS.warningText, marginTop: SPACING.sm },
  memberActions: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginTop: SPACING.sm, paddingTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  roleBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADII.pill,
    backgroundColor: COLORS.mutedBg,
  },
  roleBtnActive: { backgroundColor: COLORS.primaryLight },
  roleBtnText: { fontSize: 12.5, fontWeight: '700', color: COLORS.secondaryText },
  roleBtnTextActive: { color: COLORS.primary },
  removeBtn: { marginLeft: 'auto', padding: 6 },

  matrixCard: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  matrixHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider,
  },
  matrixRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider,
  },
  matrixCell: { fontSize: 11, fontWeight: '700', color: COLORS.secondaryText, textTransform: 'uppercase' },
  matrixRoleCol: { flex: 1.3, textTransform: 'none' },
  matrixRoleName: { fontSize: 13.5, fontWeight: '700', color: COLORS.text },
  matrixCol: { flex: 1, textAlign: 'center', alignItems: 'center' },

  footnote: { fontSize: 11.5, color: COLORS.secondaryText, lineHeight: 16, marginTop: SPACING.sm, paddingHorizontal: 2 },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
  },
  sheet: { width: '100%', maxWidth: 440, backgroundColor: COLORS.white, borderRadius: RADII.card, padding: SPACING.lg },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  sheetHint: { fontSize: 12.5, color: COLORS.secondaryText, marginTop: 4, marginBottom: SPACING.md, lineHeight: 17 },
  sheetLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  roleOptions: { gap: SPACING.sm },
  roleOption: {
    borderWidth: 1, borderColor: COLORS.divider, borderRadius: RADII.input,
    padding: SPACING.md,
  },
  roleOptionActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  roleOptionTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  roleOptionTitleActive: { color: COLORS.primary },
  roleOptionDesc: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2, lineHeight: 16 },
  roleOptionDescActive: { color: COLORS.primaryDark },
  sheetError: { fontSize: 12, color: COLORS.dangerText, marginTop: SPACING.sm },
  sheetActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
});
