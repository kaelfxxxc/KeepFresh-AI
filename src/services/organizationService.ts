// Food Establishment organisations and staff.
//
// The three roles the spec fixes — owner, manager, staff — map to a small
// permission matrix. The client copy below drives what the UI offers; the
// database is the actual boundary (RLS plus `can_manage_org` inside every
// SECURITY DEFINER routine), so a hand-crafted request from a staff device
// cannot promote itself.
//
// Adding a member goes through `add_org_member_by_email` rather than a direct
// insert, because the `profiles` RLS policy deliberately hides other people's
// rows — a client-side email lookup would silently return nothing.

import { supabase } from '../lib/supabase';
import type { OrgMemberStatus, OrgRole, Organization, OrganizationMember } from '../types';

/** A member row with the teammate's profile joined on, for the staff list. */
export interface OrganizationMemberWithProfile extends OrganizationMember {
  profile: {
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
}

export interface OrganizationWithMembership extends Organization {
  /** The signed-in user's own role in this organisation. */
  myRole: OrgRole;
}

/** What each role may do. Kept in one place so UI and copy never drift apart. */
export const ROLE_PERMISSIONS: Record<OrgRole, {
  label: string;
  description: string;
  manageStaff: boolean;
  deleteInventory: boolean;
  editInventory: boolean;
  viewReports: boolean;
}> = {
  owner: {
    label: 'Owner',
    description: 'Full control, including billing and staff.',
    manageStaff: true,
    deleteInventory: true,
    editInventory: true,
    viewReports: true,
  },
  manager: {
    label: 'Manager',
    description: 'Runs inventory and the team day to day.',
    manageStaff: true,
    deleteInventory: true,
    editInventory: true,
    viewReports: true,
  },
  staff: {
    label: 'Staff',
    description: 'Updates stock levels and adds items.',
    manageStaff: false,
    deleteInventory: false,
    editInventory: true,
    viewReports: false,
  },
};

export function roleLabel(role: OrgRole | null | undefined): string {
  return role ? ROLE_PERMISSIONS[role]?.label ?? 'Staff' : 'Staff';
}

export const organizationService = {
  /** Every organisation the signed-in user belongs to, with their role. */
  async listMine(userId: string): Promise<OrganizationWithMembership[]> {
    const { data, error } = await supabase
      .from('organization_members')
      .select('role, status, organizations(*)')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;

    return (data ?? [])
      .map((row: { role: OrgRole; organizations: Organization | Organization[] | null }) => {
        const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
        return org ? { ...org, myRole: row.role } : null;
      })
      .filter((org): org is OrganizationWithMembership => org !== null);
  },

  /** The user's primary organisation — the one the inventory screens scope to. */
  async getPrimary(userId: string): Promise<OrganizationWithMembership | null> {
    const orgs = await this.listMine(userId);
    // Owner first, then any other membership, oldest organisation winning ties.
    const sorted = [...orgs].sort((a, b) => {
      if (a.myRole !== b.myRole) return a.myRole === 'owner' ? -1 : 1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    return sorted[0] ?? null;
  },

  async getRole(organizationId: string, userId: string): Promise<OrgRole | null> {
    const { data, error } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    return (data?.role as OrgRole) ?? null;
  },

  /**
   * Create an organisation. Goes through the RPC because the membership row
   * that grants management rights cannot be inserted under RLS until it exists.
   */
  async create(name: string): Promise<Organization> {
    const { data, error } = await supabase.rpc('create_organization', { p_name: name.trim() });
    if (error) throw error;
    return data as Organization;
  },

  async rename(organizationId: string, name: string): Promise<Organization> {
    const { data, error } = await supabase
      .from('organizations')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', organizationId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * The team list, earliest members first, with names joined on for display.
   *
   * Profiles are fetched in a second query rather than embedded: the FK hint
   * would have to name the exact constraint, which is brittle, and the widened
   * `profiles` policy already lets teammates read each other's rows.
   */
  async listMembers(organizationId: string): Promise<OrganizationMemberWithProfile[]> {
    const { data, error } = await supabase
      .from('organization_members')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const members = (data ?? []) as OrganizationMember[];
    if (members.length === 0) return [];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .in('id', members.map((m) => m.user_id));

    const byId = new Map(
      (profiles ?? []).map((p: { id: string; full_name: string | null; email: string | null; avatar_url: string | null }) => [
        p.id,
        { full_name: p.full_name, email: p.email, avatar_url: p.avatar_url },
      ])
    );

    return members.map((member) => ({ ...member, profile: byId.get(member.user_id) ?? null }));
  },

  async addMemberByEmail(
    organizationId: string,
    email: string,
    role: Exclude<OrgRole, 'owner'> = 'staff'
  ): Promise<OrganizationMember> {
    const { data, error } = await supabase.rpc('add_org_member_by_email', {
      p_org: organizationId,
      p_email: email.trim(),
      p_role: role,
    });
    if (error) throw error;
    return data as OrganizationMember;
  },

  async updateMemberRole(memberId: string, role: Exclude<OrgRole, 'owner'>): Promise<void> {
    const { error } = await supabase
      .from('organization_members')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', memberId);
    if (error) throw error;
  },

  async setMemberStatus(memberId: string, status: OrgMemberStatus): Promise<void> {
    const { error } = await supabase
      .from('organization_members')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', memberId);
    if (error) throw error;
  },

  /** Remove someone from the team. The owner cannot be removed — RLS enforces it. */
  async removeMember(memberId: string): Promise<void> {
    const { error } = await supabase.from('organization_members').delete().eq('id', memberId);
    if (error) throw error;
  },

  /** Leave an organisation voluntarily. Refused for the owner by RLS. */
  async leave(organizationId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('organization_members')
      .delete()
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .neq('role', 'owner');
    if (error) throw error;
  },
};
