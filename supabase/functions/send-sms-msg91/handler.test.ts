import { describe, expect, it, vi } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { createHandler, flowRequest, msg91Mobile } from './handler';

const secretB64 = Buffer.from('a'.repeat(32)).toString('base64'); // what follows "v1,whsec_"
const wh = new Webhook(secretB64);

function signedRequest(body: unknown, secret = wh) {
  const payload = JSON.stringify(body);
  const id = 'msg_1';
  const ts = new Date();
  const signature = secret.sign(id, ts, payload);
  return new Request('https://x/functions/v1/send-sms-msg91', {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)), 'webhook-signature': signature, 'content-type': 'application/json' },
    body: payload,
  });
}

const event = { user: { id: 'u1', phone: '919876543210' }, sms: { otp: '561166' } };
const config = { authKey: 'AUTH', templateId: 'TPL', otpVar: 'otp' };

describe('MSG91 send-SMS hook', () => {
  it('normalises Indian numbers', () => {
    expect(msg91Mobile('+91 98765 43210')).toBe('919876543210');
    expect(msg91Mobile('9876543210')).toBe('919876543210');
    expect(msg91Mobile('919876543210')).toBe('919876543210');
  });

  it('builds the MSG91 flow request', () => {
    const { url, init } = flowRequest(config, '+919876543210', '123456');
    expect(url).toBe('https://control.msg91.com/api/v5/flow');
    expect(init.headers).toMatchObject({ authkey: 'AUTH' });
    expect(JSON.parse(String(init.body))).toEqual({ template_id: 'TPL', short_url: '0', recipients: [{ mobiles: '919876543210', otp: '123456' }] });
  });

  it('verifies Supabase’s signature and sends the code', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ type: 'success', message: 'ok' }), { status: 200 }));
    const handler = createHandler({ verify: (p, h) => wh.verify(p, h), fetch: fetch as unknown as typeof globalThis.fetch, config });
    const res = await handler(signedRequest(event));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.recipients).toEqual([{ mobiles: '919876543210', otp: '561166' }]);
  });

  it('refuses requests not signed with the hook secret', async () => {
    const fetch = vi.fn();
    const handler = createHandler({ verify: (p, h) => wh.verify(p, h), fetch: fetch as unknown as typeof globalThis.fetch, config });
    const other = new Webhook(Buffer.from('b'.repeat(32)).toString('base64'));
    const res = await handler(signedRequest(event, other));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes MSG91 errors back so the app can show them', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ type: 'error', message: 'Template not approved' }), { status: 200 }));
    const handler = createHandler({ verify: (p, h) => wh.verify(p, h), fetch: fetch as unknown as typeof globalThis.fetch, config });
    const res = await handler(signedRequest(event));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { http_code: 502, message: 'SMS could not be sent: Template not approved' } });
  });

  it('says clearly when MSG91 is not configured', async () => {
    const handler = createHandler({ verify: (p, h) => wh.verify(p, h), fetch: vi.fn() as unknown as typeof globalThis.fetch, config: { authKey: '', templateId: '' } });
    expect((await handler(signedRequest(event))).status).toBe(500);
  });
});
