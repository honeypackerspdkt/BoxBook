// Supabase Edge Function for the Auth "Send SMS" hook (Authentication → Hooks → Send SMS → HTTPS): sends the
// sign-in code on WhatsApp through Meta's Cloud API instead of SMS.
// Deploy: npx supabase functions deploy send-otp-whatsapp --no-verify-jwt   (or paste both files in Dashboard → Edge Functions)
// Secrets: WHATSAPP_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=… WHATSAPP_TEMPLATE=signin_code WHATSAPP_LANG=en SEND_SMS_HOOK_SECRET='v1,whsec_…'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { createHandler } from './handler.ts';

const secret = (Deno.env.get('SEND_SMS_HOOK_SECRET') || '').replace('v1,whsec_', '');
const wh = new Webhook(secret);

Deno.serve(
  createHandler({
    verify: (payload, headers) => wh.verify(payload, headers),
    fetch,
    config: {
      token: Deno.env.get('WHATSAPP_TOKEN') || '',
      phoneNumberId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '',
      template: Deno.env.get('WHATSAPP_TEMPLATE') || '',
      language: Deno.env.get('WHATSAPP_LANG') || 'en',
      apiVersion: Deno.env.get('WHATSAPP_API_VERSION') || 'v23.0',
    },
    log: (m) => console.error(m),
  }),
);
