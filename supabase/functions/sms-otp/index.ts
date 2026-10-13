import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin, userIdFromRequest } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';

const normalizePhone = (value: unknown) => {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0063/, '').replace(/^63/, '').replace(/^0/, '');
  return /^9\d{9}$/.test(digits) ? `+63${digits}` : null;
};
const randomOtp = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((b) => b.toString(16).padStart(2, '0')).join('');

serve(async (req) => {
  const preflight = handleOptions(req); if (preflight) return preflight;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, corsHeaders);
  try {
    const body = await req.json();
    const action = body.action;
    const purpose = body.purpose === 'account_security' ? 'account_security' : 'verify_phone';
    const userId = await userIdFromRequest(req);
    if (!userId) return json({ error: 'unauthorized' }, 401, corsHeaders);
    const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('phone_number,phone_verified_at').eq('id', userId).maybeSingle();
    if (profileError) throw profileError;
    const phone = normalizePhone(body.phone ?? profile?.phone_number);
    if (!phone || (purpose === 'account_security' && profile?.phone_number !== phone)) return json({ error: 'invalid_or_unverified_phone' }, 400, corsHeaders);

    if (action === 'send') {
      const { data: recent, error } = await supabaseAdmin.from('sms_otp_challenges').select('created_at,attempts').eq('phone_number', phone).gte('created_at', new Date(Date.now() - 60 * 60_000).toISOString()).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      if ((recent ?? []).length >= 5) return json({ error: 'rate_limited' }, 429, corsHeaders);
      if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 60_000) return json({ error: 'resend_cooldown', retry_after_seconds: 60 - Math.floor((Date.now() - new Date(recent[0].created_at).getTime()) / 1000) }, 429, corsHeaders);
      const code = randomOtp();
      const { data: challenge, error: insertError } = await supabaseAdmin.from('sms_otp_challenges').insert({ user_id: userId, phone_number: phone, purpose, code_hash: await sha256(`${userId}:${phone}:${code}:${Deno.env.get('OTP_PEPPER')}`), expires_at: new Date(Date.now() + 5 * 60_000).toISOString() }).select('id').single();
      if (insertError) throw insertError;
      const { error: queueError } = await supabaseAdmin.from('sms_messages').insert({ user_id: userId, phone_number: phone, message_type: 'otp', message_text: `KeepFresh AI verification code: ${code}. Expires in 5 minutes. Do not share this code.`, dedupe_key: `otp:${challenge.id}` });
      if (queueError) throw queueError;
      return json({ ok: true, expires_in_seconds: 300, resend_after_seconds: 60 }, 200, corsHeaders);
    }

    if (action === 'verify') {
      const code = String(body.code ?? '');
      if (!/^\d{6}$/.test(code)) return json({ error: 'invalid_code' }, 400, corsHeaders);
      const { data: challenges, error } = await supabaseAdmin.from('sms_otp_challenges').select('id,code_hash,expires_at,attempts').eq('user_id', userId).eq('phone_number', phone).eq('purpose', purpose).is('verified_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      const challenge = challenges?.[0];
      if (!challenge || challenge.attempts >= 5) return json({ error: 'code_expired_or_attempts_exceeded' }, 400, corsHeaders);
      const { error: attemptError } = await supabaseAdmin.from('sms_otp_challenges').update({ attempts: challenge.attempts + 1 }).eq('id', challenge.id);
      if (attemptError) throw attemptError;
      const expected = await sha256(`${userId}:${phone}:${code}:${Deno.env.get('OTP_PEPPER')}`);
      if (expected !== challenge.code_hash) return json({ error: 'invalid_code' }, 400, corsHeaders);
      const now = new Date().toISOString();
      const { error: verifiedError } = await supabaseAdmin.from('sms_otp_challenges').update({ verified_at: now }).eq('id', challenge.id);
      if (verifiedError) throw verifiedError;
      const { error: phoneError } = await supabaseAdmin.from('profiles').update({ phone_number: phone, phone_verified_at: now }).eq('id', userId);
      if (phoneError) throw phoneError;
      return json({ ok: true, phone_verified: true }, 200, corsHeaders);
    }
    return json({ error: 'invalid_action' }, 400, corsHeaders);
  } catch (error) {
    console.error('sms-otp failed', error);
    return json({ error: 'internal_error' }, 500, corsHeaders);
  }
});
