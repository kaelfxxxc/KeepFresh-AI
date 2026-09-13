// Thin wrapper over Supabase Realtime.
//
// One channel per logical group of tables keeps us inside Supabase's
// per-connection channel budget, and every subscriber receives one normalized
// payload shape so screens don't each re-implement the unwrapping.
//
// Realtime is a freshness optimization, never a correctness requirement: if the
// socket drops (offline, backgrounded, flaky network) the screens still work —
// they just fall back to fetching on focus and on pull-to-refresh.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeEvent<T = any> {
  table: string;
  eventType: RealtimeEventType;
  new: T;
  old: Partial<T>;
}

/** 'SUBSCRIBED' means live; anything else means we are running on fetch-only. */
export type RealtimeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

export interface SubscribeOptions {
  /** Restrict to one user's rows, e.g. `user_id=eq.<uuid>`. */
  userId?: string;
  /** Called on every connection transition, so UI can show an offline hint. */
  onStatus?: (status: RealtimeStatus) => void;
}

/**
 * Subscribe to INSERT/UPDATE/DELETE across a set of public tables.
 *
 * Returns an unsubscribe function — call it on unmount. Safe to call when
 * `tables` is empty (returns a no-op unsubscribe).
 */
export function subscribeToTables<T = any>(
  topic: string,
  tables: string[],
  onChange: (event: RealtimeEvent<T>) => void,
  options: SubscribeOptions = {}
): () => void {
  if (tables.length === 0) return () => {};

  const { userId, onStatus } = options;
  let channel: RealtimeChannel = supabase.channel(topic);

  tables.forEach((table) => {
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
      },
      (payload: any) => {
        onChange({
          table,
          eventType: payload.eventType,
          new: payload.new ?? {},
          old: payload.old ?? {},
        });
      }
    );
  });

  if (onStatus) {
    channel.subscribe((status) => onStatus(status as RealtimeStatus));
  } else {
    channel.subscribe();
  }

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Apply a realtime event to a local list.
 *
 * Kept pure and separate so screens can reuse it and so the merge rules are
 * testable: DELETE removes by id, INSERT/UPDATE upserts. A partially-filled
 * realtime UPDATE payload (which Supabase can send) is merged onto the existing
 * row rather than replacing it, so we never blank out fields we already have.
 */
export function applyRealtimeEvent<T extends { id: string }>(
  list: T[],
  event: RealtimeEvent<T>
): T[] {
  const row = event.new as T;

  if (event.eventType === 'DELETE') {
    const id = (event.old as { id?: string })?.id;
    return id ? list.filter((item) => item.id !== id) : list;
  }

  if (!row?.id) return list;

  const index = list.findIndex((item) => item.id === row.id);
  if (index === -1) return [row, ...list];

  const merged = { ...list[index], ...row } as T;
  const next = [...list];
  next[index] = merged;
  return next;
}
