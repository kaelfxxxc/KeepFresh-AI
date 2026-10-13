import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';

type SmsRow = { id: string; user_id: string | null; phone_number: string; message_type: string; message_text: string; attempts: number; dedupe_key: string | null };
const basicAuth = () => `Basic ${btoa(`${Deno.env.get('SMSGATE_USERNAME')}:${Deno.env.get('SMSGATE_PASSWORD')}`)}`;

serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  const secret = Deno.env.get('SMS_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'unauthorized' }, 401, corsHeaders);
  const gateUser = Deno.env.get('SMSGATE_USERNAME'); const gatePass = Deno.env.get('SMSGATE_PASSWORD');
  if (!gateUser || !gatePass) return json({ error: 'sms_gateway_not_configured' }, 503, corsHeaders);
  try {
    const { data: queue, error } = await supabaseAdmin.from('sms_messages').select('id,user_id,phone_number,message_type,message_text,attempts,dedupe_key').eq('status','pending').lte('next_attempt_at',new Date().toISOString()).order('created_at').limit(50);
    if (error) throw error;
    let accepted = 0; let deferred = 0;
    for (const row of (queue ?? []) as SmsRow[]) {
      const { data: claim, error: claimError } = await supabaseAdmin.from('sms_messages').update({ attempts: row.attempts + 1 }).eq('id', row.id).eq('status','pending').select('id').maybeSingle();
      if (claimError) throw claimError;
      if (!claim) continue;
      try {
        const response = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', { method: 'POST', headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ textMessage: { text: row.message_text }, phoneNumbers: [row.phone_number] }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`SMSGate HTTP ${response.status}: ${JSON.stringify(payload).slice(0,300)}`);
        const providerId = payload.id ?? payload.messageId ?? payload.message_id ?? null;
        const { error: updateError } = await supabaseAdmin.from('sms_messages').update({ status: 'sent', provider_message_id: providerId, sent_at: new Date().toISOString(), last_error: null }).eq('id', row.id);
        if (updateError) throw updateError;
        accepted += 1;
      } catch (sendError) {
        const tries = row.attempts + 1;
        const { error: updateError } = await supabaseAdmin.from('sms_messages').update({ status: tries >= 5 ? 'failed' : 'pending', next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** tries) * 60_000).toISOString(), last_error: (sendError as Error).message.slice(0,500) }).eq('id', row.id);
        if (updateError) throw updateError;
        deferred += 1;
      }
    }
    return json({ ok: true, accepted, deferred }, 200, corsHeaders);
  } catch (error) {
    console.error('sms-dispatch failed', error);
    return json({ error: 'dispatch_failed' }, 500, corsHeaders);
  }
});
