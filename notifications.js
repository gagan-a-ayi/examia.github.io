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
    onboarded:        'examia_notif_onboarded', // First exam added — onboarding nudge
    allCompleteSent:  'examia_notif_all_complete_ts', //  Fires once all exams are marked 'completed' AND the end time has passed — congratulatory message on dashboard
    lastTakeCareNudge: 'examia_tc_nudge_ts',  // Timestamp of last "take care of yourself" nudge (used for both sleep and screen time nudges, which share the same cooldown)
    lastTcSleepAlert:  'examia_tc_sleep_ts',  // Timestamp of last "take care of your sleep" alert
    lastTcScreenAlert: 'examia_tc_screen_ts',  // Timestamp of last "take care of your screen time" alert
    tcStreakSent:      'examia_tc_streak_ts',  // Timestamp of last "keep up the good work" streak nudge (fires after 3+ day break)
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

  function getTakeCareLog(dateStr) {
    const all = JSON.parse(localStorage.getItem('examia_takecare') || '{}');
    return all[dateStr] || null;
  }

  /** Pick a pseudo-random quote different from the previous one */
  let _lastQuoteIdx = -1;
  function pickQuote() {
    let idx;
    do { idx = Math.floor(Math.random() * QUOTES.length); } while (idx === _lastQuoteIdx);
    _lastQuoteIdx = idx;
    return QUOTES[idx];
  }

  /* ── Notification 7: Birthday wish at midnight ───────────── */
  function checkBirthdayWish() {
    const profile = JSON.parse(localStorage.getItem('examia_profile') || 'null');
    if (!profile || !profile.dob) return;

    const now   = new Date();
    const today = now.toISOString().split('T')[0];

    /* Don't send twice in the same day */
    if (localStorage.getItem('examia_notif_bday_ts') === today) return;

    const dob    = new Date(profile.dob + 'T00:00:00');
    const isBday = dob.getMonth() === now.getMonth() && dob.getDate() === now.getDate();
    if (!isBday) return;

    /* Wait until midnight — but don't block testing:
      fire any time on the birthday, the daily-key prevents repeats */
    const age  = now.getFullYear() - dob.getFullYear();
    const name = profile.displayName || (profile.fullName ? profile.fullName.split(' ')[0] : '');
    const title = profile.title || 'Mr';
    const pronoun = title === 'Ms' ? 'her' : 'his';

    localNotify(`🎂 Happy Birthday, ${name}!`, {
      body:    `Wishing you a wonderful ${age}${ordinal(age)} birthday! May all ${pronoun} dreams come true. 🎉✨`,
      tag:     'birthday-wish',
      requireInteraction: true,
      data:    { url: '/index.html#profile' },
    });

    localStorage.setItem('examia_notif_bday_ts', today);
  }

  /* Returns ordinal suffix: 1st, 2nd, 3rd, 4th … */
  function ordinal(n) {
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
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

  /* ── Notification 8: First exam added — onboarding nudge ─── */
  /*
   * Fires once, the first time getExams() returns at least one exam.
   * Guarded by LS.onboarded flag (value: '1').
   * NOTE: Called from runAllChecks(), so it fires on the next
   * scheduler tick after the first exam is saved.
   * For an instant fire on save, also call from script.js — see below.
   */
  async function checkOnboarding() {
    if (localStorage.getItem(LS.onboarded) === '1') return;
    if (getExams().length === 0) return;

    await localNotify('📚 Exam added! Ready to study?', {
      body: "Don't forget to set up your Study Tracker to log topics and track your progress.",
      tag:  'onboarding-nudge',
      requireInteraction: true,
      data: { url: '/index.html#tracker' },
    });

    localStorage.setItem(LS.onboarded, '1');
  }

  /* ── Notification 9: All exams completed ────────────────────── */
  /*
   * Fires once all exams are marked 'completed' AND the end time
   * of every exam has already passed (i.e. they're genuinely done,
   * not just pre-marked).
   * Guarded by LS.allCompleteSent (value: date string of the day it fired).
   * Resets if new exams are added later (guard key deleted — see script.js).
   */
  async function checkAllExamsCompleted() {
    const exams = getExams();
    if (exams.length === 0) return;
    if (localStorage.getItem(LS.allCompleteSent)) return;  // already sent

    const now = new Date();

    const allDone = exams.every(ex => {
      /* Must be marked completed in the tracker */
      const tracker = JSON.parse(localStorage.getItem('examia_tracker') || '{}');
      const status  = (tracker[ex.id] || {}).status;
      if (status !== 'completed') return false;

      /* End time must have passed */
      if (!ex.endTime) return false;
      const endDt = new Date(`${ex.date}T${ex.endTime}:00`);
      return now >= endDt;
    });

    if (!allDone) return;

    await localNotify('🎉 All exams done — congratulations!', {
      body:    "You've completed every exam. Time to relax and celebrate your hard work! 🏆",
      tag:     'all-exams-complete',
      requireInteraction: true,
      data:    { url: '/index.html#dashboard' },
    });

    localStorage.setItem(LS.allCompleteSent, todayStr());
  }


  async function checkTakeCareNudges() {
    const today = todayStr();
    const now   = new Date();
    const log   = getTakeCareLog(today);

    /* 1. No log by 10 PM */
    if (!log && now.getHours() >= 22 &&
        localStorage.getItem(LS.lastTakeCareNudge) !== today) {
      await localNotify('bestie did you forget to check in 👀 takes 2 mins', {
        body: 'Log your TakeCare vibe before the day ends 🌿',
        tag:  'tc-nudge',
        data: { url: '/index.html#takecare' },
      });
      localStorage.setItem(LS.lastTakeCareNudge, today);
    }

    /* 2. Sleep < 5h */
    if (log && log.sleep && log.sleep.bedtime && log.sleep.wake &&
        localStorage.getItem(LS.lastTcSleepAlert) !== today) {
      let [bh,bm] = log.sleep.bedtime.split(':').map(Number);
      let [wh,wm] = log.sleep.wake.split(':').map(Number);
      let mins = (wh*60+wm)-(bh*60+bm); if(mins<0) mins+=1440;
      const hours = +(mins/60).toFixed(1);
      if (hours < 5) {
        await localNotify(`you logged only ${hours}h of sleep. your brain needs fuel 💀`, {
          body: 'Try to rest more tonight — even an hour helps 💤',
          tag:  'tc-sleep',
          data: { url: '/index.html#takecare' },
        });
        localStorage.setItem(LS.lastTcSleepAlert, today);
      }
    }

    /* 3. Screen > 4h + exam within 3 days */
    if (log && log.screen && log.screen.total > 4 &&
        localStorage.getItem(LS.lastTcScreenAlert) !== today) {
      const hasNearExam = getExams().some(e => { const d = daysUntil(e.date); return d >= 0 && d <= 3; });
      if (hasNearExam) {
        await localNotify(`${log.screen.total}h of rot time with exams coming up... okay bestie 😭`, {
          body: 'Maybe close the app and open the books? just a thought 📚',
          tag:  'tc-screen',
          data: { url: '/index.html#takecare' },
        });
        localStorage.setItem(LS.lastTcScreenAlert, today);
      }
    }

    /* 4. 7-day consecutive logging streak */
    if (localStorage.getItem(LS.tcStreakSent) !== today) {
      const all = JSON.parse(localStorage.getItem('examia_takecare') || '{}');
      let streak = 0;
      for (let i = 1; i <= 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        if (all[d.toISOString().split('T')[0]]) streak++;
        else break;
      }
      if (streak >= 7) {
        await localNotify('7 days logged in a row 🔥 you\'re actually built different', {
          body: 'Consistency is a superpower. keep going 🌿',
          tag:  'tc-streak',
        });
        localStorage.setItem(LS.tcStreakSent, today);
      }
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
   * Timeline on exam day (all times approximate ±30 min due to polling):
   *
   *   07:00              → "Today is your exam" morning alert
   *   startTime − 60 min → "All the best" pre-exam wish  (replaces morning alert window)
   *   startTime          → silence begins (exam in progress)
   *   endTime            → silence ends
   *
   * Guards (all stored in LS.scheduledExams[ex.id]):
   *   record.dayAlert   — morning alert sent (today's date string)
   *   record.wishAlert  — pre-exam wish sent (today's date string)
   */
  function checkExamDayAlerts() {
    const exams = getExams();
    const sent  = JSON.parse(localStorage.getItem(LS.scheduledExams) || '{}');
    const now   = new Date();
    const today = todayStr();

    exams.forEach(async ex => {
      if (ex.date !== today) return;

      const record = sent[ex.id] || {};

      /* Parse startTime / endTime ("HH:MM") into today's Date objects */
      const startDt = ex.startTime ? new Date(`${today}T${ex.startTime}:00`) : null;
      const endDt   = ex.endTime   ? new Date(`${today}T${ex.endTime}:00`)   : null;

      /* ── Silence window: between exam start and exam end ── */
      if (startDt && endDt && now >= startDt && now < endDt) return;

      /* ── Pre-exam window: within 60 min before startTime ── */
      const oneHourBefore = startDt ? new Date(startDt.getTime() - 60 * 60 * 1000) : null;
      const inPreExamWindow = oneHourBefore && now >= oneHourBefore && now < startDt;

      if (inPreExamWindow) {
        /* Send "All the best" wish once per exam per day */
        if (record.wishAlert !== today) {
          const timeLabel = ex.startTime
            ? new Date(`${today}T${ex.startTime}:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : 'soon';

          await localNotify(`🌟 All the best for ${ex.subject}!`, {
            body:    `Your exam starts at ${timeLabel}. You've got this — stay calm and do your best! 💪`,
            tag:     `exam-wish-${ex.id}`,
            renotify: true,
            requireInteraction: true,
            data:    { url: '/index.html#planner' },
          });

          record.wishAlert = today;
        }
        /* Morning alert is intentionally skipped in this window */
        sent[ex.id] = record;
        localStorage.setItem(LS.scheduledExams, JSON.stringify(sent));
        return;
      }

      /* ── Morning alert: after 7 AM, and before the pre-exam window ── */
      if (now.getHours() >= 7 && record.dayAlert !== today) {
        await localNotify(`🍀 Today is your ${ex.subject} exam!`, {
          body:    "Good luck! You've prepared for this — go show what you know.",
          tag:     `exam-day-${ex.id}`,
          requireInteraction: true,
          data:    { url: '/index.html#planner' },
        });

        record.dayAlert = today;
      }

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
    checkBirthdayWish();
    checkOnboarding();
    checkAllExamsCompleted();
    checkTakeCareNudges();
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
  return { init, onPomoDone, checkOnboarding, checkAllExamsCompleted, checkTakeCareNudges };

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