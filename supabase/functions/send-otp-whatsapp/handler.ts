// Supabase Auth "Send SMS" hook → WhatsApp (Meta Cloud API). Supabase makes and checks the 6-digit code; this only
// delivers it, as an approved WhatsApp "Authentication" template with a copy-code button. No DLT/SMS needed in India.
// Plain TypeScript (no Deno APIs) so it is unit-tested with vitest; index.ts wires it up for Supabase Edge Functions.

export interface WhatsAppConfig {
  /** Meta access token (secret): a System User token with whatsapp_business_messaging permission. */
  token: string;
  /** WhatsApp phone number ID from WhatsApp Manager / the app's API Setup page (not the phone number itself). */
  phoneNumberId: string;
  /** Approved Authentication template name, e.g. "signin_code". */
  template: string;
  /** Template language code (default "en"). */
  language?: string;
  /** Graph API version (default v23.0). */
  apiVersion?: string;
  /** API base (tests). */
  baseUrl?: string;
}

/** "+91 98765 43210" / "919876543210" / "9876543210" → "919876543210" (country code, no +). */
export function waNumber(phone: string, defaultCountry = '91'): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return defaultCountry + digits;
  return digits;
}

/** Message request for an Authentication template: the code goes in the body and in the copy-code button. */
export function templateRequest(cfg: WhatsAppConfig, phone: string, otp: string): { url: string; init: RequestInit } {
  return {
    url: `${cfg.baseUrl || 'https://graph.facebook.com'}/${cfg.apiVersion || 'v23.0'}/${encodeURIComponent(cfg.phoneNumberId)}/messages`,
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: waNumber(phone),
        type: 'template',
        template: {
          name: cfg.template,
          language: { code: cfg.language || 'en' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: otp }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] },
          ],
        },
      }),
    },
  };
}

export interface HookDeps {
  /** standardwebhooks Webhook.verify for the hook secret: throws when the signature is wrong. */
  verify(payload: string, headers: Record<string, string>): unknown;
  fetch: typeof fetch;
  config: WhatsAppConfig;
  log?: (msg: string) => void;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** Error shape Supabase Auth shows to the app. */
const hookError = (status: number, message: string) => json(status, { error: { http_code: status, message } });

/** Meta error codes that mean "this number cannot get WhatsApp messages". */
const NOT_ON_WHATSAPP = new Set([131026, 131030]);

export function createHandler(deps: HookDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return hookError(405, 'Method not allowed');
    const c = deps.config;
    if (!c.token || !c.phoneNumberId || !c.template) return hookError(500, 'WhatsApp codes are not set up (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TEMPLATE missing)');

    const payload = await req.text();
    let event: { user?: { phone?: string }; sms?: { otp?: string } };
    try {
      event = deps.verify(payload, Object.fromEntries(req.headers)) as typeof event;
    } catch {
      return hookError(401, 'Invalid signature');
    }
    const phone = event.user?.phone || '';
    const otp = event.sms?.otp || '';
    if (waNumber(phone).length < 11 || !/^\d{4,8}$/.test(otp)) return hookError(400, 'Missing phone number or code');

    const { url, init } = templateRequest(c, phone, otp);
    let res: Response;
    try {
      res = await deps.fetch(url, init);
    } catch (e) {
      deps.log?.(`WhatsApp API unreachable: ${e}`);
      return hookError(502, 'Could not reach WhatsApp. Please try again, or sign in with e-mail.');
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
    if (!res.ok || body.error) {
      const code = body.error?.code;
      deps.log?.(`WhatsApp error ${res.status} ${code}: ${body.error?.message}`);
      if (code && NOT_ON_WHATSAPP.has(code)) return hookError(400, 'This number is not on WhatsApp. Please sign in with e-mail instead.');
      return hookError(502, 'The WhatsApp code could not be sent. Please try again, or sign in with e-mail.');
    }
    return json(200, {});
  };
}
