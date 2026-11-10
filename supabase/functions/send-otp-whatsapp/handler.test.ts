import { describe, expect, it, vi } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { createHandler, templateRequest, waNumber } from './handler';

const secretB64 = Buffer.from('b'.repeat(32)).toString('base64'); // what follows "v1,whsec_"
const wh = new Webhook(secretB64);

function signedRequest(body: unknown, secret = wh) {
  const payload = JSON.stringify(body);
  const id = 'msg_1';
  const ts = new Date();
  const signature = secret.sign(id, ts, payload);
  return new Request('https://x/functions/v1/send-otp-whatsapp', {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)), 'webhook-signature': signature, 'content-type': 'application/json' },
    body: payload,
  });
}

const event = { user: { id: 'u1', phone: '919876543210' }, sms: { otp: '561166' } };
const config = { token: 'TOKEN', phoneNumberId: '1234567890', template: 'signin_code' };
const ok = () => new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
const handlerWith = (fetch: unknown, cfg = config) => createHandler({ verify: (p, h) => wh.verify(p, h), fetch: fetch as typeof globalThis.fetch, config: cfg });

describe('WhatsApp send-code hook', () => {
  it('normalises Indian numbers', () => {
    expect(waNumber('+91 98765 43210')).toBe('919876543210');
    expect(waNumber('9876543210')).toBe('919876543210');
    expect(waNumber('919876543210')).toBe('919876543210');
  });

  it('builds the Cloud API template request with the code in the body and the copy button', () => {
    const { url, init } = templateRequest(config, '+919876543210', '123456');
    expect(url).toBe('https://graph.facebook.com/v23.0/1234567890/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bearer TOKEN' });
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'template',
      template: {
        name: 'signin_code',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
        ],
      },
    });
  });

  it('verifies Supabase’s signature and sends the code', async () => {
    const fetch = vi.fn(async () => ok());
    const res = await handlerWith(fetch)(signedRequest(event));
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a wrong signature without sending', async () => {
    const fetch = vi.fn(async () => ok());
    const other = new Webhook(Buffer.from('c'.repeat(32)).toString('base64'));
    const res = await handlerWith(fetch)(signedRequest(event, other));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so when it is not set up', async () => {
    const res = await handlerWith(vi.fn(), { token: '', phoneNumberId: '', template: '' })(signedRequest(event));
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toMatch(/not set up/);
  });

  it('suggests e-mail when the number is not on WhatsApp', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 131026, message: 'Message undeliverable' } }), { status: 400 }));
    const res = await handlerWith(fetch)(signedRequest(event));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/not on WhatsApp.*e-mail/);
  });

  it('reports other Meta errors as a failed send', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: 'Invalid token' } }), { status: 401 }));
    const res = await handlerWith(fetch)(signedRequest(event));
    expect(res.status).toBe(502);
  });

  it('rejects a missing phone or code', async () => {
    const res = await handlerWith(vi.fn(async () => ok()))(signedRequest({ user: { phone: '' }, sms: { otp: '' } }));
    expect(res.status).toBe(400);
  });
});
