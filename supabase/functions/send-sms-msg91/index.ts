// Supabase Edge Function for the Auth "Send SMS" hook (Authentication → Hooks → Send SMS → HTTPS).
// Deploy: npx supabase functions deploy send-sms-msg91 --no-verify-jwt
// Secrets: npx supabase secrets set MSG91_AUTH_KEY=… MSG91_TEMPLATE_ID=… MSG91_OTP_VAR=otp SEND_SMS_HOOK_SECRET='v1,whsec_…'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { createHandler } from './handler.ts';

const secret = (Deno.env.get('SEND_SMS_HOOK_SECRET') || '').replace('v1,whsec_', '');
const wh = new Webhook(secret);

Deno.serve(
  createHandler({
    verify: (payload, headers) => wh.verify(payload, headers),
    fetch,
    config: {
      authKey: Deno.env.get('MSG91_AUTH_KEY') || '',
      templateId: Deno.env.get('MSG91_TEMPLATE_ID') || '',
      otpVar: Deno.env.get('MSG91_OTP_VAR') || 'otp',
    },
    log: (m) => console.error(m),
  }),
);
