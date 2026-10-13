import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';

const equal = (a: string, b: string) => { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };
serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' },405,corsHeaders);
  const secret = Deno.env.get('SMSGATE_WEBHOOK_SECRET');
  const provided = req.headers.get('x-keepfresh-webhook-secret') ?? '';
  if (!secret || !equal(provided, secret)) return json({ error: 'unauthorized' },401,corsHeaders);
  try {
    const body = await req.json();
    const message = body.message ?? body;
    const id = String(message.id ?? message.messageId ?? message.message_id ?? '');
    const rawStatus = String(message.status ?? '').toLowerCase();
    if (!id) return json({ error:'missing_message_id' },400,corsHeaders);
    const status = ['delivered','success','sent'].includes(rawStatus) ? (rawStatus === 'delivered' ? 'delivered' : 'sent')
      : ['failed','error','undelivered'].includes(rawStatus) ? 'failed' : null;
    if (!status) return json({ ok:true, ignored:true },200,corsHeaders);
    const updates: Record<string,string> = { status };
    if (status === 'delivered') updates.delivered_at = new Date().toISOString();
    if (status === 'failed') updates.last_error = String(message.error ?? message.errorMessage ?? 'Gateway delivery failed').slice(0,500);
    const { error } = await supabaseAdmin.from('sms_messages').update(updates).eq('provider_message_id',id);
    if (error) throw error;
    return json({ ok:true },200,corsHeaders);
  } catch (error) {
    console.error('sms-status-webhook failed',error);
    return json({ error:'webhook_failed' },500,corsHeaders);
  }
});
