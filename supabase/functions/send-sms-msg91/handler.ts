// Supabase Auth "Send SMS" hook → MSG91. Supabase makes and checks the 6-digit code; this only delivers it.
// Plain TypeScript (no Deno APIs) so it is unit-tested with vitest; index.ts wires it up for Supabase Edge Functions.

export interface Msg91Config {
  /** MSG91 auth key (secret). */
  authKey: string;
  /** Approved MSG91 SMS template (DLT-registered in India) containing the OTP variable, e.g. "Your BoxBook code is ##otp##". */
  templateId: string;
  /** Name of the OTP variable in that template (default "otp"). */
  otpVar?: string;
  /** API base (tests). */
  baseUrl?: string;
}

/** "+91 98765 43210" / "919876543210" / "9876543210" → "919876543210" (MSG91 wants country code, no +). */
export function msg91Mobile(phone: string, defaultCountry = '91'): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return defaultCountry + digits;
  return digits;
}

export function flowRequest(cfg: Msg91Config, phone: string, otp: string): { url: string; init: RequestInit } {
  return {
    url: `${cfg.baseUrl || 'https://control.msg91.com'}/api/v5/flow`,
    init: {
      method: 'POST',
      headers: { authkey: cfg.authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: cfg.templateId,
        short_url: '0',
        recipients: [{ mobiles: msg91Mobile(phone), [cfg.otpVar || 'otp']: otp }],
      }),
    },
  };
}

export interface HookDeps {
  /** standardwebhooks Webhook.verify for the hook secret: throws when the signature is wrong. */
  verify(payload: string, headers: Record<string, string>): unknown;
  fetch: typeof fetch;
  config: Msg91Config;
  log?: (msg: string) => void;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** Error shape Supabase Auth shows to the app. */
const hookError = (status: number, message: string) => json(status, { error: { http_code: status, message } });

export function createHandler(deps: HookDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return hookError(405, 'Method not allowed');
    if (!deps.config.authKey || !deps.config.templateId) return hookError(500, 'SMS is not set up (MSG91_AUTH_KEY / MSG91_TEMPLATE_ID missing)');

    const payload = await req.text();
    let event: { user?: { phone?: string }; sms?: { otp?: string } };
    try {
      event = deps.verify(payload, Object.fromEntries(req.headers)) as typeof event;
    } catch {
      return hookError(401, 'Invalid signature');
    }
    const phone = event.user?.phone || '';
    const otp = event.sms?.otp || '';
    if (msg91Mobile(phone).length < 11 || !/^\d{4,8}$/.test(otp)) return hookError(400, 'Missing phone number or code');

    const { url, init } = flowRequest(deps.config, phone, otp);
    let res: Response;
    try {
      res = await deps.fetch(url, init);
    } catch (e) {
      deps.log?.(`MSG91 unreachable: ${e}`);
      return hookError(502, 'Could not reach the SMS service. Please try again.');
    }
    const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    if (!res.ok || body.type === 'error') {
      deps.log?.(`MSG91 error ${res.status}: ${body.message}`);
      return hookError(502, `SMS could not be sent: ${body.message || res.status}`);
    }
    return json(200, {});
  };
}
