// POST { deviceId, subscription } to register this device for push.
// POST { deviceId, unsubscribe: true } to remove it.
// No login system exists — deviceId is a random UUID the browser generates once and
// keeps in localStorage, so only someone who already has that exact ID could target
// it. Fine for a personal/family app with no public sign-up; not a real auth system.
import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 100) : '';
  if (!deviceId) return new Response('Missing deviceId', { status: 400 });

  const store = getStore('push-subscriptions');

  if (body?.unsubscribe) {
    await store.delete(deviceId);
    return new Response(JSON.stringify({ ok: true, unsubscribed: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const subscription = body?.subscription;
  if (!subscription || typeof subscription.endpoint !== 'string') {
    return new Response('Missing subscription', { status: 400 });
  }

  await store.setJSON(deviceId, subscription);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
