/* ============================================================
   EXAMIA — script.js  v3  (Complete)
   All features: Dashboard · Planner · Tracker · Pomodoro · Quotes
   Primary palette: Calm teal/sage (replaces red)
   ============================================================ */
'use strict';

/* ============================================================
   § 1  DATA STORE  — all persistence via localStorage
   ============================================================ */
const Store = {
  getExams()            { return JSON.parse(localStorage.getItem('examia_exams')   || '[]'); },
  saveExams(v)          { localStorage.setItem('examia_exams',   JSON.stringify(v)); },

  getTracker(id) {
    const all = JSON.parse(localStorage.getItem('examia_tracker') || '{}');
    return all[id] || { status: 'not-started', topics: [], notes: '', manualProgress: 0 };
  },
  saveTracker(id, data) {
    const all = JSON.parse(localStorage.getItem('examia_tracker') || '{}');
    all[id] = data;
    localStorage.setItem('examia_tracker', JSON.stringify(all));
  },
  deleteTracker(id) {
    const all = JSON.parse(localStorage.getItem('examia_tracker') || '{}');
    delete all[id];
    localStorage.setItem('examia_tracker', JSON.stringify(all));
  },

  getPomoSettings() {
    return JSON.parse(localStorage.getItem('examia_pomo') ||
      '{"focus":25,"short":5,"long":15,"sessions":0,"sessionDate":""}');
  },
  savePomoSettings(v)  { localStorage.setItem('examia_pomo',   JSON.stringify(v)); },

  getStreak()           { return JSON.parse(localStorage.getItem('examia_streak') || '{"count":0,"lastDate":""}'); },
  saveStreak(v)         { localStorage.setItem('examia_streak', JSON.stringify(v)); },

  getTheme()            { return localStorage.getItem('examia_theme') || 'light'; },
  saveTheme(v)          { localStorage.setItem('examia_theme', v); },
};


/* ============================================================
   § 2  UTILITIES
   ============================================================ */
function formatDate(s) {
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('en-US',
    { weekday:'short', year:'numeric', month:'short', day:'numeric' });
}

function daysUntil(s) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d     = new Date(s + 'T00:00:00'); d.setHours(0,0,0,0);
  return Math.ceil((d - today) / 86400000);
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function composeDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(dateStr, timeStr) {
  const dt = composeDateTime(dateStr, timeStr);
  if (!dt) return formatDate(dateStr);
  return dt.toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function formatTimeRange(startTime, endTime) {
  if (!startTime || !endTime) return '';
  const toLabel = t => {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    const dt = new Date();
    dt.setHours(h, m || 0, 0, 0);
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };
  return `${toLabel(startTime)} - ${toLabel(endTime)}`;
}

/* status helpers */
const STATUS_ICONS  = { 'not-started':'<i class="fa-regular fa-circle"></i>', 'in-progress':'<i class="fa-solid fa-rotate"></i>', 'completed':'<i class="fa-solid fa-circle-check"></i>' };
const STATUS_LABELS = { 'not-started':'Not Started', 'in-progress':'In Progress', 'completed':'Completed' };
const STATUS_CLASS  = { 'not-started':'status-not-started', 'in-progress':'status-in-progress', 'completed':'status-completed' };
const STATUS_CYCLE  = ['not-started','in-progress','completed'];

function nextStatus(cur) { return STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur)+1) % 3]; }

/* days-class for exam urgency colouring */
function daysClass(n) {
  if (n < 0)   return 'exam-overdue';
  if (n <= 3)  return 'exam-soon';
  if (n <= 14) return 'exam-upcoming';
  return 'exam-future';
}

function getExamWindow(ex) {
  const start = composeDateTime(ex.date, ex.startTime);
  const end   = composeDateTime(ex.date, ex.endTime);
  return { start, end };
}

function getExamPhase(ex, now = new Date()) {
  const { start, end } = getExamWindow(ex);
  if (!start || !end) return { mode: 'date', target: composeDateTime(ex.date, ex.startTime) || new Date(ex.date + 'T00:00:00'), label: 'starts in' };
  if (now < start) return { mode: 'before', target: start, label: 'starts in' };
  if (now >= start && now < end) return { mode: 'during', target: end, label: 'ends in' };
  return { mode: 'after', target: end, label: 'ended' };
}

function formatCountdown(target, now = new Date()) {
  const diff = Math.max(0, target - now);
  const totalMinutes = Math.ceil(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/* toast */
function showToast(msg, type = '', dur = 3000) {
  const el = document.getElementById('toast');
  el.innerHTML = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, dur);
}

/* audio notifications */
const AudioFX = {
  ctx: null,
  enabled: false,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.enabled = true;
    return this.ctx;
  },
  beep(freq, dur = 0.14, type = 'sine', gain = 0.05) {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = 0;
    osc.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  },
  sequence(notes, gap = 0.11) {
    const ctx = this.ensure();
    if (!ctx) return;
    let start = ctx.currentTime;
    for (const note of notes) {
      const [freq, dur = 0.14, type = 'sine', gain = 0.05] = note;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.start(start);
      osc.stop(start + dur + 0.03);
      start += dur + gap;
    }
  }
};
function playSound(kind) {
  AudioFX.ensure();
  const bank = {
    examAdded:   () => AudioFX.sequence([[523.25,0.12,'sine',0.05],[659.25,0.14,'sine',0.05],[783.99,0.16,'sine',0.05]]),
    examDeleted: () => AudioFX.sequence([[392,0.14,'triangle',0.05],[311.13,0.14,'triangle',0.05],[261.63,0.18,'triangle',0.05]]),
    topicDone:   () => AudioFX.sequence([[659.25,0.08,'sine',0.04],[783.99,0.08,'sine',0.05],[987.77,0.12,'sine',0.05]]),
    examComplete:() => AudioFX.sequence([[440,0.11,'sine',0.05],[554.37,0.11,'sine',0.05],[659.25,0.18,'sine',0.06]]),
    pomoStart:   () => AudioFX.beep(523.25,0.08,'sine',0.035),
    pomoPause:   () => AudioFX.beep(330,0.1,'triangle',0.04),
    pomoReset:   () => AudioFX.sequence([[392,0.07,'square',0.03],[329.63,0.07,'square',0.03]]),
    pomoSkip:    () => AudioFX.sequence([[659.25,0.07,'sine',0.04],[493.88,0.07,'sine',0.04]]),
    pomoDone:    () => AudioFX.sequence([[587.33,0.10,'sine',0.05],[739.99,0.10,'sine',0.05],[880,0.14,'sine',0.06]])
  };
  if (bank[kind]) bank[kind]();
}

/* compute blended progress = 50% manual + 50% topics-done ratio */
function computeProgress(tracker) {
  const manual    = tracker.manualProgress || 0;
  const topics    = tracker.topics || [];
  if (topics.length === 0) return manual;
  const topicPct  = Math.round((topics.filter(t => t.done).length / topics.length) * 100);
  return Math.round((manual + topicPct) / 2);
}


/* ============================================================
   § 3  NAVIGATION
   ============================================================ */
let currentSection = 'dashboard';

function navigate(sec) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(sec);
  if (el) el.classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-section="${sec}"]`);
  if (btn) btn.classList.add('active');
  currentSection = sec;
  if (sec === 'dashboard') renderDashboard();
  if (sec === 'planner')   renderExamList();
  if (sec === 'tracker')   renderTracker();
  if (sec === 'pomodoro')  populateContextExams();
  if (sec === 'motivation')    renderQuotes();
  closeSidebar();
}

document.querySelectorAll('.nav-btn').forEach(b =>
  b.addEventListener('click', () => navigate(b.dataset.section)));


/* ============================================================
   § 4  MOBILE SIDEBAR
   ============================================================ */
function openSidebar()  {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('active');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}
document.getElementById('hamburger').addEventListener('click', openSidebar);
document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);


/* ============================================================
   § 5  THEME
   ============================================================ */
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  Store.saveTheme(theme);
  const isDark = theme === 'dark';
  document.getElementById('themeIcon').className      = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  document.getElementById('themeIconMobile').className= isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}
function toggleTheme() { setTheme(Store.getTheme() === 'dark' ? 'light' : 'dark'); }

document.getElementById('themeToggle').addEventListener('click', toggleTheme);
document.getElementById('themeToggleMobile').addEventListener('click', toggleTheme);


/* ============================================================
   § 6  STREAK
   ============================================================ */
function updateStreak() {
  const today = new Date().toISOString().split('T')[0];
  const s = Store.getStreak();
  if (s.lastDate === today) { applyStreakUI(s.count); return s.count; }

  const yest = new Date(); yest.setDate(yest.getDate()-1);
  const yesterdayStr = yest.toISOString().split('T')[0];

  if (s.lastDate === yesterdayStr) s.count++;
  else s.count = 1;
  s.lastDate = today;
  Store.saveStreak(s);
  applyStreakUI(s.count);
  return s.count;
}
function applyStreakUI(n) {
  document.getElementById('streakCount').textContent = n;
  if (document.getElementById('statStreak')) document.getElementById('statStreak').textContent = n;
}

/* ============================================================
   § 7  DASHBOARD
   ============================================================ */
function renderDashboard() {
  syncExamStatuses(false);
  const exams = Store.getExams();

  /* stat counts */
  const upcoming  = exams.filter(e => {
    const phase = getExamPhase(e);
    return phase.mode !== 'after' && Store.getTracker(e.id).status !== 'completed';
  }).length;
  const completed = exams.filter(e => Store.getTracker(e.id).status === 'completed').length;
  document.getElementById('statTotal').textContent     = exams.length;
  document.getElementById('statUpcoming').textContent  = upcoming;
  document.getElementById('statCompleted').textContent = completed;

  /* greeting */
  const h = new Date().getHours();
  document.getElementById('dashGreeting').textContent =
    h < 12 ? 'Good morning! Ready to study? 🌅'
    : h < 17 ? 'Good afternoon! Keep grinding 💪'
    : 'Good evening! One more session? 🌙';

  /* next exam countdown */
  const future = exams
    .map(e => ({ ex: e, phase: getExamPhase(e), tracker: Store.getTracker(e.id) }))
    .filter(item => item.tracker.status !== 'completed' && item.phase.mode !== 'after')
    .sort((a,b) => a.phase.target - b.phase.target);

  if (future.length) {
    const nx  = future[0].ex;
    const ph  = future[0].phase;
    document.getElementById('countdownSubject').textContent = nx.subject;
    const rangeText = formatTimeRange(nx.startTime, nx.endTime);
    document.getElementById('countdownDate').textContent    = rangeText ? `${formatDate(nx.date)} · ${rangeText}` : formatDate(nx.date);
    document.getElementById('countdownDays').textContent    = formatCountdown(ph.target);
    document.getElementById('countdownUnit').textContent    = ph.label;
  } else {
    document.getElementById('countdownSubject').textContent = '—';
    document.getElementById('countdownDate').textContent    = 'No upcoming exams';
    document.getElementById('countdownDays').textContent    = '—';
    const unit = document.getElementById('countdownUnit');
    if (unit) unit.textContent = 'days left';
  }

  /* progress bars */
  const pb = document.getElementById('progressBars');
  const scrollBtns = document.getElementById('progressScrollBtns');

  if (!exams.length) {
    pb.innerHTML = '<p class="empty-msg">Add exams and track progress to see it here.</p>';
    if (scrollBtns) scrollBtns.style.display = 'none';
    return;
  }

  /* Read tracker data fresh from localStorage in one go AFTER syncExamStatuses */
  const allTracker = JSON.parse(localStorage.getItem('examia_tracker') || '{}');

  /* Filter: only exams whose status is not-started or in-progress AND exam window not over */
  const active = exams
    .map(e => {
      const tr = allTracker[e.id] || { status: 'not-started', topics: [], notes: '', manualProgress: 0 };
      const ph = getExamPhase(e);
      return { ex: e, tracker: tr, phase: ph };
    })
    .filter(item => item.tracker.status !== 'completed' && item.phase.mode !== 'after')
    .sort((a, b) => a.phase.target - b.phase.target);

  if (!active.length) {
    pb.innerHTML = '<p class="empty-msg">No active exams. All done!</p>';
    if (scrollBtns) scrollBtns.style.display = 'none';
    return;
  }

  const COLORS = ['#5BA4CF','#6BBFB5','#84B89A','#A89FD6','#F0A87E','#E8B86D'];
  pb.innerHTML = active.map((item, i) => {
    const pct = computeProgress(item.tracker);
    const clr = COLORS[i % COLORS.length];
    return `<div class="progress-item">
      <div class="progress-top">
        <span class="progress-name">${esc(item.ex.subject)}</span>
        <span class="progress-pct" style="color:${clr}">${pct}%</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${pct}%;background:${clr}"></div>
      </div>
    </div>`;
  }).join('');

  if (scrollBtns) scrollBtns.style.display = active.length > 6 ? 'flex' : 'none';
}


function scrollProgress(dir) {
  const pb = document.getElementById('progressBars');
  const item = pb.querySelector('.progress-item');
  const step = item ? item.offsetHeight + 14 : 60;
  pb.scrollBy({ top: dir * step, behavior: 'smooth' });
}

/* ============================================================
   § 8  EXAM PLANNER
   ============================================================ */
let selectedColor = '#5BA4CF';
let currentView   = 'list';
let calendarDate  = new Date();

/* ---- modal ---- */
function openExamModal(id = null) {
  const modal   = document.getElementById('examModal');
  const overlay = document.getElementById('examModalOverlay');
  document.getElementById('examId').value        = id || '';
  document.getElementById('examSubject').value   = '';
  document.getElementById('examDate').value      = '';
  document.getElementById('examStartTime').value = '';
  document.getElementById('examEndTime').value   = '';
  document.getElementById('examDetails').value   = '';
  selectedColor = '#5BA4CF';
  resetColorPicker(selectedColor);
  document.getElementById('modalTitle').innerHTML =
    id ? '<i class="fa-solid fa-pen-to-square"></i> Edit Exam'
       : '<i class="fa-solid fa-calendar-plus"></i> Add Exam';

  if (id) {
    const ex = Store.getExams().find(e => e.id === id);
    if (ex) {
      document.getElementById('examSubject').value   = ex.subject;
      document.getElementById('examDate').value      = ex.date;
      document.getElementById('examStartTime').value = ex.startTime || '';
      document.getElementById('examEndTime').value   = ex.endTime || '';
      document.getElementById('examDetails').value   = ex.details || '';
      selectedColor = ex.color || '#5BA4CF';
      resetColorPicker(selectedColor);
    }
  } else {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    document.getElementById('examStartTime').value = start.toTimeString().slice(0,5);
    document.getElementById('examEndTime').value = end.toTimeString().slice(0,5);
  }
  overlay.classList.add('active');
  modal.classList.add('active');
  setTimeout(() => document.getElementById('examSubject').focus(), 100);
}

function closeExamModal() {
  document.getElementById('examModal').classList.remove('active');
  document.getElementById('examModalOverlay').classList.remove('active');
}

function resetColorPicker(sel = '#5BA4CF') {
  document.querySelectorAll('#colorPicker .color-dot').forEach(d => {
    d.classList.toggle('selected', d.dataset.color === sel);
  });
}

document.getElementById('colorPicker').addEventListener('click', e => {
  const dot = e.target.closest('.color-dot');
  if (!dot) return;
  selectedColor = dot.dataset.color;
  document.querySelectorAll('#colorPicker .color-dot').forEach(d => d.classList.remove('selected'));
  dot.classList.add('selected');
});

function saveExam() {
  const subject   = document.getElementById('examSubject').value.trim();
  const date      = document.getElementById('examDate').value;
  const startTime = document.getElementById('examStartTime').value;
  const endTime   = document.getElementById('examEndTime').value;
  const details   = document.getElementById('examDetails').value.trim();
  const id        = document.getElementById('examId').value;

  if (!subject)   { showToast('<i class="fa-solid fa-triangle-exclamation"></i> Please enter a subject name', 'error'); return; }
  if (!date)      { showToast('<i class="fa-solid fa-triangle-exclamation"></i> Please select a date', 'error'); return; }
  if (!startTime) { showToast('<i class="fa-solid fa-triangle-exclamation"></i> Please select a start time', 'error'); return; }
  if (!endTime)   { showToast('<i class="fa-solid fa-triangle-exclamation"></i> Please select an end time', 'error'); return; }

  const start = composeDateTime(date, startTime);
  const end   = composeDateTime(date, endTime);
  if (!start || !end || end <= start) {
    showToast('<i class="fa-solid fa-triangle-exclamation"></i> End time must be after start time', 'error');
    return;
  }

  const exams = Store.getExams();
  let changed = false;
  if (id) {
    const idx = exams.findIndex(e => e.id === id);
    if (idx > -1) {
      exams[idx] = { ...exams[idx], subject, date, startTime, endTime, details, color: selectedColor };
      changed = true;
    }
    showToast(changed ? '<i class="fa-solid fa-check"></i> Exam updated!' : '<i class="fa-solid fa-triangle-exclamation"></i> Exam not found', changed ? 'success' : 'error');
  } else {
    const newExam = { id: uid(), subject, date, startTime, endTime, details, color: selectedColor, createdAt: Date.now() };
    exams.push(newExam);
    showToast('<i class="fa-solid fa-check"></i> Exam added!', 'success');
    playSound('examAdded');
  }
  Store.saveExams(exams);
  closeExamModal();
  renderExamList();
  if (currentSection === 'dashboard') renderDashboard();
  populateContextExams();
  syncExamStatuses(true);
}

function deleteExam(id) {
  if (!confirm('Delete this exam and its tracker data?')) return;
  Store.saveExams(Store.getExams().filter(e => e.id !== id));
  Store.deleteTracker(id);
  renderExamList();
  renderTracker();
  if (currentSection === 'dashboard') renderDashboard();
  populateContextExams();
  showToast('Exam deleted');
  playSound('examDeleted');
}

function syncExamStatuses(showToastMsg = false) {
  const now = new Date();
  const exams = Store.getExams();
  let changed = false;
  exams.forEach(ex => {
    const { end } = getExamWindow(ex);
    if (!end || now < end) return;
    const t = Store.getTracker(ex.id);
    if (t.status !== 'completed') {
      t.status = 'completed';
      Store.saveTracker(ex.id, t);
      changed = true;
      if (showToastMsg) showToast(`<i class="fa-solid fa-circle-check"></i> ${esc(ex.subject)} marked completed`, 'success', 4000);
      playSound('examComplete');
      populateContextExams();
    }
  });
  if (changed) {
    if (currentSection === 'tracker') renderTracker();
    if (currentSection === 'dashboard') renderDashboard();
    renderExamList();
  }
}

/* ---- list view ---- */
function renderExamList() {
  const exams = Store.getExams().sort((a,b) => new Date(a.date)-new Date(b.date));
  const el    = document.getElementById('examList');

  if (!exams.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-emoji"><i class="fa-solid fa-inbox fa-2x"></i></div>
      <p>No exams yet. Start planning!</p>
      <button class="btn-primary btn-sm" onclick="openExamModal()"><i class="fa-solid fa-plus"></i> Add First Exam</button>
    </div>`;
    return;
  }

  el.innerHTML = exams.map(ex => {
    const phase  = getExamPhase(ex);
    const d      = daysUntil(ex.date);
    const dc     = daysClass(d);
    const t      = Store.getTracker(ex.id);
    const color  = ex.color || '#5BA4CF';
    const pct    = computeProgress(t);
    const range  = formatTimeRange(ex.startTime, ex.endTime);
    const count  = formatCountdown(phase.target);
    return `<div class="exam-card ${dc}" style="border-left-color:${color}">
      <div class="exam-card-info">
        <div class="exam-card-subject">${esc(ex.subject)}</div>
        <div class="exam-card-date"><i class="fa-regular fa-calendar"></i> ${formatDate(ex.date)}${range ? ` · ${esc(range)}` : ''}</div>
        ${ex.details ? `<div class="exam-card-details"><i class="fa-regular fa-note-sticky"></i> ${esc(ex.details)}</div>` : ''}
        <div class="exam-card-progress-bar" style="margin-top:0.5rem">
          <div class="progress-bar-wrap" style="height:4px">
            <div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </div>
      <div class="exam-card-countdown">
        <div class="exam-days">${count}</div>
        <div class="exam-days-label">${phase.label}</div>
        <div class="exam-card-status" style="margin-top:0.35rem;font-size:0.75rem">${STATUS_ICONS[t.status]}</div>
      </div>
      <div class="exam-card-actions">
        <button class="btn-icon" onclick="openExamModal('${ex.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon danger" onclick="deleteExam('${ex.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

/* ---- view toggle ---- */
function setView(view) {
  currentView = view;
  document.getElementById('listView').style.display     = view === 'list' ? 'block' : 'none';
  document.getElementById('calendarView').style.display = view === 'calendar' ? 'block' : 'none';
  document.getElementById('listViewBtn').classList.toggle('active', view === 'list');
  document.getElementById('calViewBtn').classList.toggle('active',  view === 'calendar');
  if (view === 'calendar') renderCalendar();
}

/* ---- calendar ---- */
function changeMonth(d) { calendarDate.setMonth(calendarDate.getMonth()+d); renderCalendar(); }

function renderCalendar() {
  const exams = Store.getExams();
  const yr = calendarDate.getFullYear(), mo = calendarDate.getMonth();
  document.getElementById('calMonthLabel').textContent =
    calendarDate.toLocaleDateString('en-US', { month:'long', year:'numeric' });

  const firstDay    = new Date(yr, mo, 1).getDay();
  const daysInMonth = new Date(yr, mo+1, 0).getDate();
  const todayStr    = new Date().toISOString().split('T')[0];

  const examMap = {};
  exams.forEach(ex => {
    const d = new Date(ex.date + 'T00:00:00');
    if (d.getFullYear() === yr && d.getMonth() === mo) {
      const k = ex.date; (examMap[k] = examMap[k]||[]).push(ex);
    }
  });

  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = days.map(d => `<div class="cal-day-header">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday  = ds === todayStr;
    const examList = examMap[ds] || [];
    const tip      = examList.map(e => e.subject).join(', ');
    html += `<div class="cal-day ${isToday?'today':''} ${examList.length?'has-exam':''}" title="${tip}">
      ${d}
      ${examList.length ? `<span class="cal-exam-dot" style="background:${examList[0].color||'#5BA4CF'}"></span>` : ''}
    </div>`;
  }
  document.getElementById('calendarGrid').innerHTML = html;
}


/* ============================================================
   § 9  STUDY TRACKER  ★ Enhanced with topic-aware progress ★
   ============================================================ */
function renderTracker() {
  const exams = Store.getExams().sort((a,b) => new Date(a.date)-new Date(b.date));
  const container = document.getElementById('trackerList');

  if (!exams.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-emoji"><i class="fa-solid fa-folder-open fa-2x"></i></div>
      <p>No exams to track.<br>Add exams in the Planner first.</p>
    </div>`;
    return;
  }

  container.innerHTML = exams.map(ex => buildTrackerCard(ex)).join('');
}

function buildTrackerCard(ex) {
  const t     = Store.getTracker(ex.id);
  const d     = daysUntil(ex.date);
  const color = ex.color || '#5BA4CF';
  const total = computeProgress(t);
  const range = formatTimeRange(ex.startTime, ex.endTime);
  const topics = t.topics || [];
  const doneCnt = topics.filter(tp => tp.done).length;

  /* days badge */
  let daysBadgeClass = 'ok';
  if (d < 0)  daysBadgeClass = 'overdue';
  else if (d <= 3)  daysBadgeClass = 'soon';
  else if (d > 14)  daysBadgeClass = 'ok';
  const daysLabel = d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'Today!' : `${d} days left`;

  /* Donut SVG: r=28, circumference ≈ 175.9 */
  const C   = 175.9;
  const off = C * (1 - total/100);

  const topicsHTML = topics.length
    ? topics.map((tp, i) => `
        <span class="topic-chip ${tp.done?'done':''}"
              onclick="toggleTopic('${ex.id}',${i})"
              title="${tp.done?'Mark undone':'Mark done'}">
          <span class="topic-check"><i class="fa-solid ${tp.done?'fa-check':'fa-circle-dot'}"></i></span>
          <span class="topic-name">${esc(tp.name)}</span>
          <span class="remove-topic" onclick="removeTopic(event,'${ex.id}',${i})" title="Remove">
            <i class="fa-solid fa-xmark"></i>
          </span>
        </span>`).join('')
    : `<span class="empty-topics-hint"><i class="fa-regular fa-lightbulb"></i> Add topics to track below</span>`;

  return `<div class="tracker-card" id="tracker-${ex.id}">
    <!-- Top color strip -->
    <div class="tracker-card-strip" style="background:${color}"></div>

    <div class="tracker-card-body">
      <!-- Header -->
      <div class="tracker-card-header">
        <div class="tracker-header-left">
          <div class="tracker-subject">${esc(ex.subject)}</div>
          <div class="tracker-meta">
            <span class="tracker-date-badge"><i class="fa-regular fa-calendar"></i> ${formatDate(ex.date)}${range ? ` · ${esc(range)}` : ''}</span>
            <span class="tracker-days-badge ${daysBadgeClass}"><i class="fa-solid fa-clock"></i> ${daysLabel}</span>
          </div>
        </div>
        <span class="status-badge ${STATUS_CLASS[t.status]}"
              onclick="cycleStatus('${ex.id}')"
              title="Click to change status">
          ${STATUS_ICONS[t.status]} ${STATUS_LABELS[t.status]}
        </span>
      </div>

      <!-- PROGRESS SECTION -->
      <div class="tracker-progress-section">
        <div class="tracker-section-title"><i class="fa-solid fa-chart-pie"></i> Overall Progress</div>

        <div class="tracker-progress-row">
          <!-- Mini donut -->
          <div class="mini-donut">
            <svg width="72" height="72" viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="28" fill="none" stroke="var(--surface2)" stroke-width="10"/>
              <circle cx="36" cy="36" r="28" fill="none"
                stroke="${color}" stroke-width="10"
                stroke-linecap="round"
                stroke-dasharray="${C}" stroke-dashoffset="${off}"
                transform="rotate(-90 36 36)"
                style="transition:stroke-dashoffset 0.7s ease"/>
            </svg>
            <div class="mini-donut-text" style="color:${color}">${total}%</div>
          </div>

          <div style="flex:1">
            <!-- Contribution chips -->
            <div class="progress-stats-row">
              <span class="progress-stat-chip chip-manual">
                <i class="fa-solid fa-sliders"></i> Manual: ${t.manualProgress||0}%
              </span>
              <span class="progress-stat-chip chip-topics">
                <i class="fa-solid fa-list-check"></i> Topics: ${doneCnt}/${topics.length}
              </span>
            </div>
            <!-- Blended bar -->
            <div class="progress-bar-wrap" style="margin-bottom:0.5rem">
              <div class="progress-bar-fill" id="pbar-${ex.id}"
                style="width:${total}%;background:linear-gradient(90deg,${color},${color}aa)"></div>
            </div>
            <!-- Slider -->
            <div class="tracker-slider-row">
              <input type="range" min="0" max="100"
                value="${t.manualProgress||0}"
                style="accent-color:${color}"
                id="slider-${ex.id}"
                oninput="updateManualProgress('${ex.id}', this.value)"/>
              <span class="slider-pct-label" id="sliderLabel-${ex.id}">${t.manualProgress||0}%</span>
            </div>
            <div class="autosave-hint"><i class="fa-solid fa-info-circle"></i> Drag slider for manual progress · topics auto-contribute</div>
          </div>
        </div>
      </div>

      <!-- TOPICS SECTION -->
      <div class="tracker-topics-section">
        <div class="tracker-section-title"><i class="fa-solid fa-list-check"></i> Topics
          <span class="topics-summary" id="topicsSummary-${ex.id}">
            ${doneCnt}/${topics.length} done
          </span>
        </div>
        <div class="tracker-topics" id="topics-${ex.id}">${topicsHTML}</div>
        <div class="add-topic-row">
          <input type="text" id="topicInput-${ex.id}"
            placeholder="Add a topic or chapter..."
            onkeydown="if(event.key==='Enter'){event.preventDefault();addTopic('${ex.id}')}"/>
          <button class="btn-primary btn-sm" onclick="addTopic('${ex.id}')">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      </div>

      <!-- NOTES SECTION -->
      <div class="tracker-notes-section">
        <div class="tracker-section-title"><i class="fa-solid fa-pen-nib"></i> Study Notes</div>
        <textarea class="tracker-notes-area"
          id="notes-${ex.id}"
          placeholder="Key points, formulas, revision notes..."
          rows="3"
          onkeyup="saveNotes('${ex.id}', this.value)">${esc(t.notes||'')}</textarea>
        <div class="autosave-hint"><i class="fa-solid fa-floppy-disk"></i> Auto-saved as you type</div>
      </div>
    </div>
  </div>`;
}

/* status cycle */
function cycleStatus(id) {
  const t = Store.getTracker(id);
  t.status = nextStatus(t.status);
  Store.saveTracker(id, t);
  populateContextExams();
  /* re-render just that card */
  const ex = Store.getExams().find(e => e.id === id);
  if (ex) {
    const card = document.getElementById('tracker-' + id);
    if (card) card.outerHTML = buildTrackerCard(ex);
  }
  updateStreak();
  if (t.status === 'completed') playSound('examComplete');
  showToast(`<i class="fa-solid fa-check"></i> Status: ${STATUS_LABELS[t.status]}`, 'success');
}

/* manual progress slider */
function updateManualProgress(id, val) {
  const t = Store.getTracker(id);
  t.manualProgress = parseInt(val);
  Store.saveTracker(id, t);

  const total = computeProgress(t);
  /* update bar */
  const bar = document.getElementById('pbar-' + id);
  if (bar) bar.style.width = total + '%';
  /* update slider label */
  const lbl = document.getElementById('sliderLabel-' + id);
  if (lbl) lbl.textContent = val + '%';
  /* update donut */
  const C   = 175.9;
  const svg = document.querySelector(`#tracker-${id} .mini-donut circle:last-child`);
  if (svg) {
    svg.setAttribute('stroke-dashoffset', C * (1 - total/100));
  }
  const dotText = document.querySelector(`#tracker-${id} .mini-donut-text`);
  if (dotText) dotText.textContent = total + '%';
  /* update manual chip */
  const chip = document.querySelector(`#tracker-${id} .chip-manual`);
  if (chip) chip.innerHTML = `<i class="fa-solid fa-sliders"></i> Manual: ${val}%`;
  updateStreak();
}

/* add topic */
function addTopic(id) {
  const inp  = document.getElementById('topicInput-' + id);
  const name = inp?.value.trim();
  if (!name) return;
  const t = Store.getTracker(id);
  t.topics.push({ name, done: false });
  Store.saveTracker(id, t);
  inp.value = '';
  refreshTopics(id);
}

/* toggle topic done */
function toggleTopic(id, idx) {
  const t = Store.getTracker(id);
  const before = !!t.topics[idx].done;
  t.topics[idx].done = !t.topics[idx].done;
  Store.saveTracker(id, t);
  refreshTopics(id);
  updateManualProgress(id, t.manualProgress || 0); /* refresh donut/bar */
  if (!before && t.topics[idx].done) playSound('topicDone');
}

/* remove topic */
function removeTopic(ev, id, idx) {
  ev.stopPropagation();
  const t = Store.getTracker(id);
  t.topics.splice(idx, 1);
  Store.saveTracker(id, t);
  refreshTopics(id);
  updateManualProgress(id, t.manualProgress || 0);
}

/* refresh only topics area inside a card (no full re-render) */
function refreshTopics(id) {
  const t      = Store.getTracker(id);
  const topics = t.topics || [];
  const doneCnt= topics.filter(tp => tp.done).length;
  const color  = (Store.getExams().find(e => e.id === id)||{}).color || '#5BA4CF';
  const wrap   = document.getElementById('topics-' + id);
  const sumEl  = document.getElementById('topicsSummary-' + id);
  const chip   = document.querySelector(`#tracker-${id} .chip-topics`);

  if (sumEl) sumEl.textContent = `${doneCnt}/${topics.length} done`;
  if (chip)  chip.innerHTML    = `<i class="fa-solid fa-list-check"></i> Topics: ${doneCnt}/${topics.length}`;

  if (!wrap) return;
  if (!topics.length) {
    wrap.innerHTML = `<span class="empty-topics-hint"><i class="fa-regular fa-lightbulb"></i> Add topics to track below</span>`;
    return;
  }
  wrap.innerHTML = topics.map((tp, i) => `
    <span class="topic-chip ${tp.done?'done':''}"
          onclick="toggleTopic('${id}',${i})" title="${tp.done?'Mark undone':'Mark done'}">
      <span class="topic-check"><i class="fa-solid ${tp.done?'fa-check':'fa-circle-dot'}"></i></span>
      <span class="topic-name">${esc(tp.name)}</span>
      <span class="remove-topic" onclick="removeTopic(event,'${id}',${i})" title="Remove">
        <i class="fa-solid fa-xmark"></i>
      </span>
    </span>`).join('');
}

/* debounced notes save */
let _noteTimer = null;
function saveNotes(id, val) {
  clearTimeout(_noteTimer);
  _noteTimer = setTimeout(() => {
    const t = Store.getTracker(id);
    t.notes = val;
    Store.saveTracker(id, t);
  }, 400);
}

/* tracker modal helpers */
function closeTrackerModal() {
  document.getElementById('trackerModal').classList.remove('active');
  document.getElementById('trackerModalOverlay').classList.remove('active');
}


/* ============================================================
   § 10  POMODORO  ★ Improved session tracker + context ★
   ============================================================ */
let pomoState = {
  mode: 'focus', isRunning: false,
  timeLeft: 1500, totalTime: 1500,
  interval: null, sessions: 0, sessionDate: ''
};

/* populate context dropdown with saved exams */
function populateContextExams() {
  const exams = Store.getExams();

  const sel = document.getElementById('pomoContext');
  const menu = document.getElementById('contextDropdownMenu');

  if (!sel || !menu) return;

  const now = new Date();

  const activeExams = exams.filter(ex => {

    const tracker = Store.getTracker(ex.id);

    /* remove completed exams */
    if (tracker.status === 'completed') return false;

    /* if no end time, keep visible */
    if (!ex.endTime) return true;

    const endDateTime = new Date(`${ex.date}T${ex.endTime}:00`);

    /* remove expired exams */
    if (now > endDateTime) return false;

    return true;
  });

  /* hidden select */
  sel.innerHTML = `
    <option value="general">General / Free Study</option>

    ${activeExams.map(ex => `
      <option value="${ex.id}">
        ${esc(ex.subject)}
      </option>
    `).join('')}
  `;

  /* visible custom dropdown */
  menu.innerHTML = `

    <button
      class="context-option active"
      type="button"
      data-value="general"
      data-label="General / Free Study"
      data-detail="No linked exam">

      <span>
        General / Free Study
        <small>No linked exam</small>
      </span>

      <i class="fa-solid fa-check"></i>
    </button>

    ${activeExams.map(ex => `

      <button
        class="context-option"
        type="button"
        data-value="${ex.id}"
        data-label="${esc(ex.subject)}"
        data-detail="${esc(
          formatTimeRange(ex.startTime, ex.endTime)
          || formatDate(ex.date)
        )}">

        <span>
          ${esc(ex.subject)}

          <small>
            ${esc(
              formatTimeRange(ex.startTime, ex.endTime)
              || formatDate(ex.date)
            )}
          </small>
        </span>

      </button>

    `).join('')}
  `;

  updateContextLabel();
}


function updateContextLabel() {
  const hidden = document.getElementById('pomoContext');
  const label  = document.getElementById('contextDropdownLabel');
  const selVal = hidden.value;
  const active = document.querySelector(`#contextDropdownMenu .context-option[data-value="${selVal}"]`);
  if (!active) {
    label.textContent = 'General / Free Study';
    return;
  }
  label.textContent = active.dataset.value === 'general'
    ? 'General / Free Study'
    : `${active.dataset.label} — ${active.dataset.detail}`;
}

function setContextSelection(value) {
  const hidden = document.getElementById('pomoContext');
  hidden.value = value;
  document.querySelectorAll('#contextDropdownMenu .context-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
    btn.innerHTML = `
      <span>
        ${esc(btn.dataset.label || '')}
        <small>${esc(btn.dataset.detail || '')}</small>
      </span>
      ${btn.dataset.value === value ? '<i class="fa-solid fa-check"></i>' : ''}`;
  });
  const picked = document.querySelector(`#contextDropdownMenu .context-option[data-value="${value}"]`);
  const labelEl = document.getElementById('contextDropdownLabel');
  labelEl.textContent = !picked || value === 'general' ? 'General / Free Study' : `${picked.dataset.label} — ${picked.dataset.detail}`;
  closeContextDropdown();
}

function toggleContextDropdown(force) {
  const wrap = document.getElementById('contextDropdown');
  const open = typeof force === 'boolean' ? force : !wrap.classList.contains('open');
  wrap.classList.toggle('open', open);
  document.getElementById('contextDropdownBtn').setAttribute('aria-expanded', String(open));
}

function closeContextDropdown() {
  const wrap = document.getElementById('contextDropdown');
  if (wrap) wrap.classList.remove('open');
  const btn = document.getElementById('contextDropdownBtn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

/* load saved durations + today's sessions */
function loadPomoDurations() {
  const s = Store.getPomoSettings();
  document.getElementById('focusDur').value = s.focus;
  document.getElementById('shortDur').value = s.short;
  document.getElementById('longDur').value  = s.long;

  const today = new Date().toISOString().split('T')[0];
  pomoState.sessions = (s.sessionDate === today) ? s.sessions : 0;

  const dur = getModeSeconds();
  pomoState.timeLeft = pomoState.totalTime = dur;
  updateTimerDisplay();
  updateRing();
  renderSessionSlots();
}

function getModeSeconds() {
  const s = Store.getPomoSettings();
  return { focus: s.focus, short: s.short, long: s.long }[pomoState.mode] * 60;
}

function updateDurations() {
  const f = parseInt(document.getElementById('focusDur').value) || 25;
  const sh= parseInt(document.getElementById('shortDur').value) || 5;
  const l = parseInt(document.getElementById('longDur').value)  || 15;
  const s = Store.getPomoSettings();
  Store.savePomoSettings({ ...s, focus:f, short:sh, long:l });
  if (!pomoState.isRunning) {
    pomoState.timeLeft = pomoState.totalTime = getModeSeconds();
    updateTimerDisplay(); updateRing();
  }
}

function changeNum(id, delta) {
  const inp = document.getElementById(id);
  inp.value = Math.max(parseInt(inp.min||1), Math.min(parseInt(inp.max||60), parseInt(inp.value||0) + delta));
  updateDurations();
}

document.addEventListener('click', e => {
  if (!e.target.closest('#contextDropdown')) closeContextDropdown();
});
document.getElementById('contextDropdownMenu').addEventListener('click', e => {
  const btn = e.target.closest('.context-option');
  if (!btn) return;
  const hidden = document.getElementById('pomoContext');
  hidden.value = btn.dataset.value;
  setContextSelection(btn.dataset.value);
});

/* mode switch */
function setPomoMode(mode) {
  if (pomoState.isRunning) pauseTimer(true);
  pomoState.mode = mode;
  document.querySelectorAll('.pomo-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));

  /* ring colour per mode */
  const GRADS   = { focus:'ringGradFocus', short:'ringGradShort', long:'ringGradLong' };
  const DOTS    = { focus:'#5BA4CF', short:'#6BBFB5', long:'#84B89A' };
  const ICONS   = { focus:'fa-bullseye', short:'fa-mug-hot', long:'fa-couch' };
  const STATUSM = { focus:'Ready to focus', short:'Short break ☕', long:'Long break 🌿' };

  document.getElementById('ringProgress').setAttribute('stroke', `url(#${GRADS[mode]})`);
  const dot = document.getElementById('ringDot');
  if (dot) dot.setAttribute('fill', DOTS[mode]);
  document.getElementById('pomoModeIcon').innerHTML = `<i class="fa-solid ${ICONS[mode]}"></i>`;
  document.getElementById('pomoModeIcon').style.color = DOTS[mode];
  document.getElementById('pomoStatus').textContent = STATUSM[mode];
  document.getElementById('pomoBtnLabel').textContent = 'Start';
  document.getElementById('pomoPlayIcon').className = 'fa-solid fa-play';

  const dur = getModeSeconds();
  pomoState.timeLeft = pomoState.totalTime = dur;
  updateTimerDisplay(); updateRing();
}

function toggleTimer() { pomoState.isRunning ? pauseTimer() : startTimer(); }

function startTimer() {
  pomoState.isRunning = true;
  document.getElementById('pomoBtnLabel').textContent = 'Pause';
  document.getElementById('pomoPlayIcon').className   = 'fa-solid fa-pause';
  const statusText = { focus:'🎯 Focusing…', short:'☕ Short break…', long:'🌿 Long break…' };
  document.getElementById('pomoStatus').textContent = statusText[pomoState.mode];
  playSound('pomoStart');

  pomoState.interval = setInterval(() => {
    pomoState.timeLeft--;
    updateTimerDisplay();
    updateRing();
    if (pomoState.timeLeft <= 0) timerComplete();
  }, 1000);
  updateStreak();
}

function pauseTimer(silent = false) {
  pomoState.isRunning = false;
  clearInterval(pomoState.interval);
  document.getElementById('pomoBtnLabel').textContent = 'Resume';
  document.getElementById('pomoPlayIcon').className   = 'fa-solid fa-play';
  document.getElementById('pomoStatus').textContent   = 'Paused';
  if (!silent) playSound('pomoPause');
}

function resetTimer() {
  pauseTimer(true);
  pomoState.timeLeft = pomoState.totalTime = getModeSeconds();
  document.getElementById('pomoBtnLabel').textContent = 'Start';
  document.getElementById('pomoPlayIcon').className   = 'fa-solid fa-play';
  document.getElementById('pomoStatus').textContent   = 'Ready';
  updateTimerDisplay(); updateRing();
  playSound('pomoReset');
}

function skipTimer() { playSound('pomoSkip'); timerComplete(); }

function timerComplete() {
  pauseTimer(true);
  document.getElementById('pomoBtnLabel').textContent = 'Start';
  document.getElementById('pomoPlayIcon').className   = 'fa-solid fa-play';

  /* flash */
  document.body.style.transition = 'background 0.2s';
  document.body.style.background = 'rgba(91,164,207,0.12)';
  setTimeout(() => { document.body.style.background = ''; }, 600);

  if (pomoState.mode === 'focus') {
    pomoState.sessions++;
    saveSessions();
    renderSessionSlots();
    playSound('pomoDone');
 
    /* link session to exam context if selected */
    const ctx = document.getElementById('pomoContext').value;
    if (ctx !== 'general') {
      const t = Store.getTracker(ctx);
      t.manualProgress = Math.min(95, (t.manualProgress || 0) + 5);
      Store.saveTracker(ctx, t);
    }
 
    showToast('<i class="fa-solid fa-trophy"></i> Focus session done! Take a break.', 'success', 5000);
    document.getElementById('pomoStatus').textContent = '✓ Session complete!';
 
    /* ── notifications.js: push OS notification when tab is in background ── */
    if (document.hidden && typeof ExamiaNotifications !== 'undefined') {
      ExamiaNotifications.onPomoDone(false);
    }
 
    setTimeout(() => setPomoMode(pomoState.sessions % 4 === 0 ? 'long' : 'short'), 900);
  } else {
    playSound('pomoDone');
    showToast('<i class="fa-solid fa-bolt"></i> Break over — back to focus!', 'info', 4000);
 
    /* ── notifications.js: push OS notification when tab is in background ── */
    if (document.hidden && typeof ExamiaNotifications !== 'undefined') {
      ExamiaNotifications.onPomoDone(true);
    }
 
    setTimeout(() => setPomoMode('focus'), 900);
  }
}

function saveSessions() {
  const today = new Date().toISOString().split('T')[0];
  const s = Store.getPomoSettings();
  Store.savePomoSettings({ ...s, sessions: pomoState.sessions, sessionDate: today });
}

function updateTimerDisplay() {
  const m = String(Math.floor(pomoState.timeLeft/60)).padStart(2,'0');
  const s = String(pomoState.timeLeft % 60).padStart(2,'0');
  document.getElementById('pomoTime').textContent = `${m}:${s}`;
  document.title = `${m}:${s} — Examia`;
}

function updateRing() {
  const C   = 678.6; /* 2π×108 */
  const pct = pomoState.timeLeft / pomoState.totalTime;
  document.getElementById('ringProgress').style.strokeDashoffset = C * (1 - pct);

  /* rotate dot around the ring */
  const angle = (1 - pct) * 360 - 90; /* starts at top */
  const rad   = angle * Math.PI / 180;
  const cx    = 130, cy = 130, r = 108;
  const dotX  = cx + r * Math.cos(rad);
  const dotY  = cy + r * Math.sin(rad);
  const dot   = document.getElementById('ringDot');
  if (dot) { dot.setAttribute('cx', dotX); dot.setAttribute('cy', dotY); }
}

/* ---- Session Slots: 4 pills that fill → reset + count sets ---- */
function renderSessionSlots() {
  const total    = pomoState.sessions;          /* total sessions today */
  const sets     = Math.floor(total / 4);       /* completed sets */
  const inSlot   = total % 4;                   /* how many of current 4 are filled */
  const slotsEl  = document.getElementById('sessionSlots');
  const setsRow  = document.getElementById('sessionSetsRow');
  const setsLbl  = document.getElementById('sessionSetsLabel');
  const badge    = document.getElementById('sessionTotalBadge');

  /* 4 slot pills */
  slotsEl.innerHTML = [0,1,2,3].map(i => `
    <div class="session-slot ${i < inSlot ? 'filled' : ''}"></div>`).join('');

  /* sets counter */
  if (sets > 0) {
    setsRow.style.display = 'flex';
    setsLbl.textContent   = `${sets} set${sets>1?'s':''} completed (+${sets*4} sessions)`;
  } else {
    setsRow.style.display = 'none';
  }

  badge.textContent = `${total} total`;
}


/* ============================================================
   § 11  MOTIVATION QUOTES
   ============================================================ */
const QUOTES = [
  { text:"The secret of getting ahead is getting started.", author:"Mark Twain" },
  { text:"It always seems impossible until it's done.", author:"Nelson Mandela" },
  { text:"Don't watch the clock; do what it does. Keep going.", author:"Sam Levenson" },
  { text:"Success is the sum of small efforts, repeated day in and day out.", author:"Robert Collier" },
  { text:"Education is the passport to the future.", author:"Malcolm X" },
  { text:"The expert in anything was once a beginner.", author:"Helen Hayes" },
  { text:"Believe you can and you're halfway there.", author:"Theodore Roosevelt" },
  { text:"Your future is created by what you do today, not tomorrow.", author:"Robert Kiyosaki" },
  { text:"Push yourself, because no one else is going to do it for you.", author:"Unknown" },
  { text:"Great things never come from comfort zones.", author:"Unknown" },
  { text:"An investment in knowledge pays the best interest.", author:"Benjamin Franklin" },
  { text:"The more that you read, the more things you will know.", author:"Dr. Seuss" },
  { text:"Today a reader, tomorrow a leader.", author:"Margaret Fuller" },
  { text:"Don't stop when you're tired. Stop when you're done.", author:"Unknown" },
  { text:"Wake up with determination. Go to bed with satisfaction.", author:"Unknown" },
  { text:"Strive for progress, not perfection.", author:"Unknown" },
  { text:"You don't have to be great to start, but you have to start to be great.", author:"Zig Ziglar" },
  { text:"Hard work beats talent when talent doesn't work hard.", author:"Tim Notke" },
  { text:"The pain of studying is temporary; the reward of knowledge is permanent.", author:"Unknown" },
  { text:"Study not to memorise, but to understand.", author:"Unknown" },
];

let lastQIdx = -1;
function newQuote() {
  let idx;
  do { idx = Math.floor(Math.random() * QUOTES.length); } while (idx === lastQIdx);
  lastQIdx = idx;
  const q    = QUOTES[idx];
  const txtEl= document.getElementById('quoteText');
  const autEl= document.getElementById('quoteAuthor');
  txtEl.style.opacity = autEl.style.opacity = '0';
  setTimeout(() => {
    txtEl.textContent = q.text;
    autEl.textContent = '— ' + q.author;
    txtEl.style.transition = autEl.style.transition = 'opacity 0.4s';
    txtEl.style.opacity = autEl.style.opacity = '1';
  }, 200);
}

function renderQuotes() {
  newQuote();
  const shuffled = [...QUOTES].sort(() => Math.random()-0.5).slice(0,6);
  document.getElementById('quoteGrid').innerHTML = shuffled.map(q => `
    <div class="mini-quote">
      <i class="fa-solid fa-quote-left" style="font-size:1rem;opacity:0.4;margin-bottom:0.4rem;display:block"></i>
      ${esc(q.text)}
      <cite>${esc(q.author)}</cite>
    </div>`).join('');
}


/* ============================================================
   § 12  INIT
   ============================================================ */
function tickClock() {
  const now  = new Date();
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const day  = DAYS[now.getDay()];
  const dd   = String(now.getDate()).padStart(2,'0');
  const mm   = String(now.getMonth()+1).padStart(2,'0');
  const yyyy = now.getFullYear();
  const date = `${dd}-${mm}-${yyyy}`;
  let h = now.getHours(), ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${String(h).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} ${ampm}`;
  ['sidebar','mobile'].forEach(pfx => {
    const tEl = document.getElementById(pfx+'Time');
    const dEl = document.getElementById(pfx+'Day');
    const dtEl= document.getElementById(pfx+'Date');
    if (tEl) tEl.textContent = time;
    if (dEl) dEl.textContent = day;
    if (dtEl) dtEl.textContent = date;
  });
}

function init() {
  setTheme(Store.getTheme());
  updateStreak();
  loadPomoDurations();
  populateContextExams();
  navigate('dashboard');
  /* set min date for exam input to today*/
  /*
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('examDate').setAttribute('min', today);
  */
  /* render initial session slots */
  renderSessionSlots();
  syncExamStatuses(false);
  setInterval(() => syncExamStatuses(false), 60000);
  tickClock();
  setInterval(tickClock, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  const hash = window.location.hash.replace('#', '');
  const valid = ['dashboard', 'planner', 'tracker', 'pomodoro', 'motivation'];
  if (valid.includes(hash)) navigate(hash);
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  const valid = ['dashboard', 'planner', 'tracker', 'pomodoro', 'motivation'];
  if (valid.includes(hash)) navigate(hash);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeExamModal(); closeTrackerModal(); closeSidebar(); }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !pomoState.isRunning) { document.title = 'Examia — Ace Your Exams'; syncExamStatuses(false); }
});


if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => {
        console.log('[SW] Registered:', reg.scope);
        /* ── notifications.js integration ── */
        if (typeof ExamiaNotifications !== 'undefined') {
          ExamiaNotifications.init(reg);
        }
      })
      .catch(err => console.error('[SW] Registration failed:', err));
  });
}