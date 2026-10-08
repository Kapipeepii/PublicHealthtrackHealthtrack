// Runs every hour (see `config` below). For each device that has synced a schedule
// AND has a push subscription, checks whether any med time or 3-day/1-day
// appointment mark is due "as of now" and hasn't already been pushed today, sends
// a Web Push notification for it, and records it as sent so it won't repeat.
//
// This mirrors checkMedReminders()/checkApptReminders() in index.html, but keeps a
// SEPARATE fired-tracking store ("push-fired") rather than touching the client's own
// `fired`/`reminded` state — the client only ever checks those while the app is open,
// so reusing them here would mean a reminder never gets marked sent server-side if
// the person never opens the app, and we'd push the same thing every hour forever.
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

// VAPID_SUBJECT should be a contact for whoever runs this site (their own real email).
// Accepts "you@host.com", "mailto:you@host.com" or an https:// URL; a bare email gets
// the mailto: prefix added. If it is missing or still the placeholder we log a warning and
// fall back to the old placeholder so existing sites keep working — the setup guide makes
// setting it a required step.
function normalizeSubject(raw) {
  const v = (raw || '').trim();
  if (/^(mailto:|https:\/\/)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'mailto:' + v;
  return null;
}
const SUBJECT_FALLBACK = 'mailto:admin@example.com';
const VAPID_SUBJECT = normalizeSubject(process.env.VAPID_SUBJECT) || SUBJECT_FALLBACK;
const SUBJECT_IS_PLACEHOLDER = VAPID_SUBJECT === SUBJECT_FALLBACK || /@example\.(com|org)$/i.test(VAPID_SUBJECT);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

// The app is used in Thailand; the server's clock is UTC, so convert explicitly
// rather than relying on an Intl timezone database that may not be present in every
// function runtime.
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
function bkkNow() { return new Date(Date.now() + BKK_OFFSET_MS); }
function todayStr() { return bkkNow().toISOString().slice(0, 10); }
function nowHHMM() { return bkkNow().toISOString().slice(11, 16); }

export default async () => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('check-reminders: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars not set — skipping run');
    return new Response('VAPID keys not configured', { status: 500 });
  }
  if (SUBJECT_IS_PLACEHOLDER) console.warn('check-reminders: VAPID_SUBJECT is not set to a real email — set it in Netlify env vars (e.g. mailto:you@yourmail.com)');
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const schedules = getStore('schedules');
  const subs = getStore('push-subscriptions');
  const firedStore = getStore('push-fired');

  const today = todayStr();
  const hhmm = nowHHMM();

  const { blobs } = await schedules.list();
  let sent = 0, deviceErrors = 0, failed = 0;

  for (const { key: deviceId } of blobs) {
    try {
      const [schedule, subscription] = await Promise.all([
        schedules.get(deviceId, { type: 'json' }),
        subs.get(deviceId, { type: 'json' })
      ]);
      if (!schedule || !subscription) continue; // synced schedule but never enabled push, or vice versa

      let fired = await firedStore.get(deviceId, { type: 'json' });
      if (!fired || fired.day !== today) fired = { day: today, meds: {}, appts: {} };
      let changed = false;
      // Bug fixed here: `fired` used to be marked true BEFORE the push send was even
      // attempted, so a single failed/transient send (e.g. right after enabling push,
      // or any other temporary webpush error) permanently "used up" that reminder —
      // every later hourly run would see it as already-sent and never retry, even
      // though nothing was ever actually delivered. `key`/`scope` are only queued
      // here; `fired` is now set only after `sendNotification` genuinely succeeds
      // below, so a failed attempt is retried on the next run instead of silently
      // disappearing for the rest of the day.
      const notifications = [];

      // v24: only trust the ticks if they were synced for TODAY. The stored schedule is not
      // rewritten until the app next syncs, so after midnight takenToday may still hold
      // yesterday's ticks, which would wrongly suppress this morning's reminders.
      const takenToday = (schedule.takenDay === today) ? (schedule.takenToday || {}) : {};
      let dueCount = 0, skippedTaken = 0, skippedFired = 0;
      for (const m of (schedule.meds || [])) {
        for (const t of (m.times || [])) {
          if (typeof t !== 'string' || t > hhmm) continue; // not due yet today
          const key = `${m.id}_${t}`;
          dueCount++;
          if (fired.meds[key]) { skippedFired++; continue; }
          // Already ticked "กินแล้ว" in the app before this run — no need to remind.
          // Checked fresh every run (not written into `fired`), so un-checking it
          // later the same day makes it eligible for a push again on the next run.
          if (takenToday[key]) { skippedTaken++; continue; }
          notifications.push({
            scope: 'meds', key,
            // v25: medicine name first so the lock screen (which truncates the title) shows it.
            title: `💊 ${m.label || 'ยา'}`,
            body: `ถึงเวลาทานยา ${t} น.${m.detail ? ' · ' + m.detail : ''}`
          });
        }
      }

      for (const a of (schedule.appts || [])) {
        if (!a.date) continue;
        const daysUntil = Math.ceil((new Date(a.date) - new Date(today)) / 86400000);
        for (const mark of [3, 1]) {
          if (daysUntil !== mark) continue;
          const key = `${a.id}_${mark}`;
          if (fired.appts[key]) continue;
          notifications.push({
            scope: 'appts', key,
            title: `🏥 อีก ${mark} วันถึงวันนัด`,
            body: `${a.label || ''} ${a.date} ${a.time || ''}`.trim()
          });
        }
      }

      let devSent = 0, devFailed = 0, devExpired = 0;
      for (const n of notifications) {
        try {
          await webpush.sendNotification(subscription, JSON.stringify({ title: n.title, body: n.body }));
          sent++; devSent++;
          fired[n.scope][n.key] = true; changed = true; // only recorded once actually delivered
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            // Browser revoked/expired this subscription — stop trying for this device.
            // (Not marked fired: if a fresh subscription appears later, it's still due.)
            await subs.delete(deviceId);
            devExpired++; failed++;
          } else {
            devFailed++; failed++;
            console.error('check-reminders: push send failed', deviceId, err.statusCode, err.body);
          }
        }
      }

      // One short line per device per run so a "no push arrived" can be diagnosed from the
      // Netlify function log (Logs → Functions → check-reminders).
      console.log(JSON.stringify({ run: 'check-reminders', day: today, now: hhmm, device: deviceId.slice(0, 6),
        meds: (schedule.meds || []).length, dueMeds: dueCount, skippedTaken, skippedFired,
        queued: notifications.length, sent: devSent, failed: devFailed, expired: devExpired, takenDayMatches: schedule.takenDay === today, scheduleUpdated: schedule.updatedAt }));
      if (changed) await firedStore.setJSON(deviceId, fired);
    } catch (err) {
      deviceErrors++;
      console.error('check-reminders: device failed', deviceId, err);
    }
  }

  return new Response(JSON.stringify({ ok: true, devices: blobs.length, sent, failed, deviceErrors }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = { schedule: '@hourly' };
