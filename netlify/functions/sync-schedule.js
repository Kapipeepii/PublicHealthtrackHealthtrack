// POST { deviceId, meds, appts, takenToday } whenever the client's med/appointment
// schedule or today's taken-checkmarks change. Only the minimum needed to decide
// *when* to push and what the notification text says is sent — lab results,
// exercise data, notes, etc. never leave the device. See index.html's
// buildPushSyncPayload() for the exact shape. takenToday holds only TODAY's "กินแล้ว"
// checkmarks (never a history) so check-reminders.js can skip a dose already marked
// taken before its scheduled push time.
import { getStore } from '@netlify/blobs';

const MAX_ITEMS = 200; // generous for a personal/family app; guards against a bad payload

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.slice(0, 100) : '';
  if (!deviceId) return new Response('Missing deviceId', { status: 400 });

  const meds = Array.isArray(body?.meds) ? body.meds.slice(0, MAX_ITEMS) : [];
  const appts = Array.isArray(body?.appts) ? body.appts.slice(0, MAX_ITEMS) : [];
  const takenToday = (body?.takenToday && typeof body.takenToday === 'object' && !Array.isArray(body.takenToday))
    ? Object.fromEntries(Object.entries(body.takenToday).slice(0, MAX_ITEMS).filter(([, v]) => v === true))
    : {};

  // takenDay = the (device-local) date takenToday belongs to; check-reminders ignores
  // takenToday unless it is for the current day, so stale ticks can't block today's pushes.
  const takenDay = (typeof body?.takenDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.takenDay)) ? body.takenDay : '';

  const store = getStore('schedules');
  await store.setJSON(deviceId, { meds, appts, takenToday, takenDay, updatedAt: new Date().toISOString() });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
