/* ============================================================
   Examia — notifications.js  v1
   Web Push Notification module — kept fully separate from core
   app logic. script.js calls ExamiaNotifications.init() on load
   and ExamiaNotifications.onPomoDone() when a focus session ends.

   Notification types
   ──────────────────
   1. Exam countdown reminders   (7 d · 3 d · 1 d before)
   2. Pomodoro session complete   (replaces in-app toast when bg)
   3. Study streak reminder       (evening, if no session today)
   4. Exam day alert              (7 AM on exam date)
   5. Weekly progress summary     (Saturday 22:00)
   6. Quote of the day            (daily 05:00)
   ============================================================ */

'use strict';

/* ── Public API (imported by script.js) ──────────────────── */
const ExamiaNotifications = (() => {

  /* ── Constants ──────────────────────────────────────────── */
  const VAPID_PUBLIC_KEY = 'BJhc38zNWbEWBnQh7OwMkLfHdp_qnQjXpXnMQb8bNBSmEpVuVYc01RrDsbJxo8sYJ092n782TeDLsoB9sl30-K0';
  // Replace with your real VAPID public key.
  // Generate a key pair with: npx web-push generate-vapid-keys
  // Then paste the public key above and store the private key on your server.
  // Reference: https://web.dev/push-notifications-server

  /* Evening hour for streak reminder (24-h). Default: 20 = 8 PM */
  const STREAK_REMINDER_HOUR = 20;

  /* Local-storage keys used by this module only */
  const LS = {
    permission:     'examia_notif_permission',  // 'granted' | 'denied' | 'default'
    scheduledExams: 'examia_notif_sched',       // JSON: { [examId]: { d7,d3,d1,day } timestamps sent }
    lastStreakCheck: 'examia_notif_streak_ts',  // ISO date of last streak-check tick
    lastWeeklySent:  'examia_notif_weekly_ts',  // ISO date of last weekly summary
    lastQuoteSent:   'examia_notif_quote_ts',   // ISO date of last quote push
  };

  /* ── Motivational quotes (mirrored from script.js QUOTES) ── */
  const QUOTES = [
    { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { text: "It always seems impossible until it's done.", author: 'Nelson Mandela' },
    { text: "Don't watch the clock; do what it does. Keep going.", author: 'Sam Levenson' },
    { text: 'Success is the sum of small efforts, repeated day in and day out.', author: 'Robert Collier' },
    { text: 'Education is the passport to the future.', author: 'Malcolm X' },
    { text: 'The expert in anything was once a beginner.', author: 'Helen Hayes' },
    { text: "Believe you can and you're halfway there.", author: 'Theodore Roosevelt' },
    { text: 'Your future is created by what you do today, not tomorrow.', author: 'Robert Kiyosaki' },
    { text: "Push yourself, because no one else is going to do it for you.", author: 'Unknown' },
    { text: 'Great things never come from comfort zones.', author: 'Unknown' },
    { text: 'An investment in knowledge pays the best interest.', author: 'Benjamin Franklin' },
    { text: 'The more that you read, the more things you will know.', author: 'Dr. Seuss' },
    { text: 'Today a reader, tomorrow a leader.', author: 'Margaret Fuller' },
    { text: "Don't stop when you're tired. Stop when you're done.", author: 'Unknown' },
    { text: 'Strive for progress, not perfection.', author: 'Unknown' },
  ];

  /* ── Helpers ─────────────────────────────────────────────── */

  /** Convert a URL-safe base64 string to a Uint8Array for VAPID */
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  /** Today's date as YYYY-MM-DD */
  function todayStr() { return new Date().toISOString().split('T')[0]; }

  /** Days between now (midnight) and a YYYY-MM-DD date string */
  function daysUntil(dateStr) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d     = new Date(dateStr + 'T00:00:00'); d.setHours(0, 0, 0, 0);
    return Math.ceil((d - today) / 86400000);
  }

  /** Read exams from localStorage (same format as Store.getExams) */
  function getExams() {
    return JSON.parse(localStorage.getItem('examia_exams') || '[]');
  }

  /** Read Pomodoro settings from localStorage */
  function getPomoSettings() {
    return JSON.parse(localStorage.getItem('examia_pomo') ||
      '{"focus":25,"short":5,"long":15,"sessions":0,"sessionDate":""}');
  }

  /** Pick a pseudo-random quote different from the previous one */
  let _lastQuoteIdx = -1;
  function pickQuote() {
    let idx;
    do { idx = Math.floor(Math.random() * QUOTES.length); } while (idx === _lastQuoteIdx);
    _lastQuoteIdx = idx;
    return QUOTES[idx];
  }

  /* ── Core: request permission & register push ────────────── */

  /** Ask the user for notification permission.
   *  Returns true if granted, false otherwise. */
  async function requestPermission() {
    if (!('Notification' in window)) {
      console.warn('[Notif] Notifications API not supported');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;

    const result = await Notification.requestPermission();
    localStorage.setItem(LS.permission, result);
    return result === 'granted';
  }

  /** Get (or create) a PushSubscription for this browser.
   *  Requires a service worker registration.
   *  Returns the subscription object, or null on failure. */
  async function getOrCreatePushSubscription(swReg) {
    if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY === 'BJhc38zNWbEWBnQh7OwMkLfHdp_qnQjXpXnMQb8bNBSmEpVuVYc01RrDsbJxo8sYJ092n782TeDLsoB9sl30-K0') {
      console.info('[Notif] VAPID key not set — using local-only (ServiceWorker) notifications.');
      return null; // fall back to local SW notifications
    }
    try {
      let sub = await swReg.pushManager.getSubscription();
      if (!sub) {
        sub = await swReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      return sub;
    } catch (err) {
      console.warn('[Notif] Push subscription failed:', err);
      return null;
    }
  }

  /* ── Local notification delivery via Service Worker ─────── */
  /*
   * Because Web Push requires a server-side component to sign & deliver
   * push payloads, we use TWO complementary delivery strategies:
   *
   * A) Server-sent push (when VAPID_PUBLIC_KEY is configured and you have
   *    a /api/send-notification endpoint).  The subscription object is POSTed
   *    to your server, which then pushes payloads via the Web Push Protocol.
   *
   * B) Local SW notification (no server needed).  We post a message to the
   *    active service worker with { type: 'LOCAL_NOTIFY', payload }.  The SW
   *    calls self.registration.showNotification(...).  This works offline and
   *    when the tab is in the background, but NOT when the app is fully closed.
   *    It is the default mode when VAPID key is absent.
   *
   * For full push-when-closed support, configure Strategy A.
   */

  /** Send a notification via the registered service worker (Strategy B). */
  async function localNotify(title, options = {}) {
    if (Notification.permission !== 'granted') return;

    const reg = await navigator.serviceWorker.ready;
    reg.active.postMessage({
      type:    'LOCAL_NOTIFY',
      title,
      options: {
        icon:   './icon-192.png',
        badge:  './icon-512.png',
        vibrate: [200, 100, 200],
        ...options,
      },
    });
  }

  /** (Optional) Send subscription + payload to your own backend so the
   *  server can push the notification via Web Push Protocol.
   *  Implement your /api/send-notification endpoint to use this path. */
  async function serverPush(subscription, title, body, data = {}) {
    if (!subscription) return;
    try {
      await fetch('/api/send-notification', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, title, body, data }),
      });
    } catch (err) {
      console.warn('[Notif] Server push failed, falling back to local:', err);
      await localNotify(title, { body, data });
    }
  }

  /* ── Notification 2: Pomodoro session complete ───────────── */
  /*
   * Called directly from script.js inside the pomoDone handler.
   * Replaces the in-app toast when the document is hidden (tab in bg).
   */
  async function onPomoDone(isBreakEnd = false) {
    if (Notification.permission !== 'granted') return;
    if (isBreakEnd) {
      await localNotify('Break over — back to focus! ⚡', {
        body:    'Your break is done. Start your next Pomodoro session.',
        tag:     'pomo-break-end',
        renotify: true,
        data:    { url: '/index.html#pomodoro' },
      });
    } else {
      await localNotify('Focus session done! 🎉', {
        body:    'Great work! Take a well-deserved 5-minute break.',
        tag:     'pomo-done',
        renotify: true,
        data:    { url: '/index.html#pomodoro' },
      });
    }
  }

  /* ── Notification 1: Exam countdown reminders ────────────── */
  /*
   * Checks all exams and fires a notification if today is exactly
   * 7, 3, or 1 days before the exam — once per exam per milestone.
   */
  function checkExamCountdowns() {
    const exams   = getExams();
    const sent    = JSON.parse(localStorage.getItem(LS.scheduledExams) || '{}');

    exams.forEach(async ex => {
      const days   = daysUntil(ex.date);
      const record = sent[ex.id] || {};

      const milestones = [
        { days: 7, key: 'd7', label: '7 days'  },
        { days: 3, key: 'd3', label: '3 days'  },
        { days: 1, key: 'd1', label: 'tomorrow' },
      ];

      for (const m of milestones) {
        if (days === m.days && !record[m.key]) {
          await localNotify(`📅 ${ex.subject} is in ${m.label}`, {
            body:    `Time to review! Your ${ex.subject} exam is coming up in ${m.label}.`,
            tag:     `exam-countdown-${ex.id}-${m.key}`,
            data:    { url: '/index.html#planner' },
          });
          record[m.key] = todayStr();
        }
      }

      sent[ex.id] = record;
    });

    localStorage.setItem(LS.scheduledExams, JSON.stringify(sent));
  }

  /* ── Notification 4: Exam day alert ─────────────────────── */
  /*
   * Fires at (approximately) 7 AM on the morning of each exam.
   * We can't schedule future native timers in JS, so on each
   * periodic tick we check if today is exam day and if the
   * 7 AM window has passed.
   */
  function checkExamDayAlerts() {
    const exams = getExams();
    const sent  = JSON.parse(localStorage.getItem(LS.scheduledExams) || '{}');
    const now   = new Date();
    const today = todayStr();

    exams.forEach(async ex => {
      if (ex.date !== today) return;              // only on exam day
      if (now.getHours() < 7) return;             // wait until at least 7 AM
      const record = sent[ex.id] || {};
      if (record.dayAlert === today) return;       // already sent today

      await localNotify(`🍀 Today is your ${ex.subject} exam!`, {
        body:    "Good luck! You've prepared for this — go show what you know.",
        tag:     `exam-day-${ex.id}`,
        data:    { url: '/index.html#planner' },
        requireInteraction: true,
      });

      record.dayAlert = today;
      sent[ex.id] = record;
    });

    localStorage.setItem(LS.scheduledExams, JSON.stringify(sent));
  }

  /* ── Notification 3: Study streak reminder ───────────────── */
  /*
   * Fires in the evening (default 8 PM) if no Pomodoro session
   * was logged today.
   */
  function checkStreakReminder() {
    const now   = new Date();
    const today = todayStr();

    if (now.getHours() < STREAK_REMINDER_HOUR) return;            // too early
    if (localStorage.getItem(LS.lastStreakCheck) === today) return; // already ran today

    const pomo = getPomoSettings();
    const hadSessionToday = pomo.sessionDate === today && pomo.sessions > 0;

    if (!hadSessionToday) {
      localNotify("Don't break your streak! 🔥", {
        body:    "You haven't studied today yet. Even one Pomodoro session keeps the streak alive!",
        tag:     'streak-reminder',
        data:    { url: '/index.html#pomodoro' },
      });
    }

    localStorage.setItem(LS.lastStreakCheck, today);
  }

  /* ── Notification 5: Weekly progress summary ─────────────── */
  /*
   * Fires every Saturday at/after 22:00.
   */
  function checkWeeklySummary() {
    const now   = new Date();
    const today = todayStr();

    const isSaturday    = now.getDay() === 6;
    const isAfter10PM   = now.getHours() >= 22;
    const alreadySent   = localStorage.getItem(LS.lastWeeklySent) === today;

    if (!isSaturday || !isAfter10PM || alreadySent) return;

    /* Tally this week's sessions — we store per-day sessions if they
       exist, otherwise use the total in pomoSettings (best effort). */
    const pomo     = getPomoSettings();
    const sessions = pomo.sessions || 0;
    const exams    = getExams();

    localNotify('📊 Your weekly study summary', {
      body:    `This week: ${sessions} Pomodoro session${sessions !== 1 ? 's' : ''}, ` +
               `${exams.length} exam${exams.length !== 1 ? 's' : ''} tracked. Keep it up! 💪`,
      tag:     'weekly-summary',
      data:    { url: '/index.html#dashboard' },
    });

    localStorage.setItem(LS.lastWeeklySent, today);
  }

  /* ── Notification 6: Quote of the day ───────────────────── */
  /*
   * Fires once per day at/after 05:00.
   * NOTE: This notification fires daily and can feel frequent.
   * Consider making it opt-in via a settings toggle in your UI.
   */
  function checkDailyQuote() {
    const now   = new Date();
    const today = todayStr();

    if (now.getHours() < 5) return;
    if (localStorage.getItem(LS.lastQuoteSent) === today) return;

    const q = pickQuote();
    localNotify(`💡 Quote of the day`, {
      body:    `"${q.text}" — ${q.author}`,
      tag:     'daily-quote',
      data:    { url: '/index.html#motivation' },
    });

    localStorage.setItem(LS.lastQuoteSent, today);
  }

  /* ── Periodic check: runs every 30 minutes while tab is open ── */
  let _tickInterval = null;

  function runAllChecks() {
    if (Notification.permission !== 'granted') return;
    checkExamCountdowns();
    checkExamDayAlerts();
    checkStreakReminder();
    checkWeeklySummary();
    checkDailyQuote();
  }

  /* ── init ────────────────────────────────────────────────── */
  /*
   * Called once from script.js after the service worker is registered.
   * Shows a permission prompt if not yet decided, then starts the
   * periodic scheduler.
   */
  async function init(swRegistration) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      console.warn('[Notif] Push notifications not supported in this browser.');
      return;
    }

    /* Attempt permission (only prompts if status is 'default') */
    const granted = await requestPermission();
    if (!granted) {
      console.info('[Notif] Notification permission not granted — skipping setup.');
      return;
    }

    /* Optionally set up a real push subscription (requires VAPID key + server) */
    if (swRegistration) {
      const sub = await getOrCreatePushSubscription(swRegistration);
      if (sub) {
        console.info('[Notif] Push subscription active:', sub.endpoint);
        /* TODO: send `sub` to your server so it can push notifications.
           Example:
             await fetch('/api/subscribe', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(sub),
             });
        */
      }
    }

    /* Run immediately, then every 30 minutes */
    runAllChecks();
    clearInterval(_tickInterval);
    _tickInterval = setInterval(runAllChecks, 30 * 60 * 1000);

    console.info('[Notif] Notification scheduler started.');
  }

  /* ── Expose public surface ───────────────────────────────── */
  return { init, onPomoDone };

})();

/*
  ╔══════════════════════════════════════════════════════════════╗
  ║  HOW TO WIRE THIS INTO YOUR EXISTING FILES                  ║
  ╠══════════════════════════════════════════════════════════════╣
  ║                                                              ║
  ║  1. index.html                                               ║
  ║     Add this <script> tag BEFORE script.js:                  ║
  ║       <script src="./notifications.js" defer></script>       ║
  ║                                                              ║
  ║  2. script.js  — two small edits:                            ║
  ║                                                              ║
  ║     A) In the service worker registration block (bottom of   ║
  ║        script.js), pass the SW registration to the module:   ║
  ║                                                              ║
  ║       navigator.serviceWorker.register('./service-worker.js')║
  ║         .then(reg => {                                       ║
  ║           console.log('[SW] Registered:', reg.scope);        ║
  ║           ExamiaNotifications.init(reg); // ← add this line  ║
  ║         });                                                  ║
  ║                                                              ║
  ║     B) In the pomoDone() function, after the toast, add:     ║
  ║                                                              ║
  ║       // inside the `if (pomoState.mode === 'focus')` branch:║
  ║       if (document.hidden)                                   ║
  ║         ExamiaNotifications.onPomoDone(false);               ║
  ║                                                              ║
  ║       // inside the `else` (break-end) branch:               ║
  ║       if (document.hidden)                                   ║
  ║         ExamiaNotifications.onPomoDone(true);                ║
  ║                                                              ║
  ║  3. service-worker.js  — add the LOCAL_NOTIFY handler:       ║
  ║     (paste the block shown at the bottom of this file        ║
  ║      into your service-worker.js)                            ║
  ║                                                              ║
  ║  4. VAPID keys (for server-pushed notifications):            ║
  ║     Run: npx web-push generate-vapid-keys                    ║
  ║     Paste the PUBLIC key into VAPID_PUBLIC_KEY above.        ║
  ║     Use the PRIVATE key on your server to sign push msgs.    ║
  ║     Reference: https://web.dev/articles/push-notifications   ║
  ╚══════════════════════════════════════════════════════════════╝
*/

/* ────────────────────────────────────────────────────────────
   SERVICE WORKER SNIPPET
   Paste the block below into service-worker.js to enable local
   (in-browser) notifications without a push server.
   ────────────────────────────────────────────────────────────

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'LOCAL_NOTIFY') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title, options || {})
    );
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

   ──────────────────────────────────────────────────────────── */