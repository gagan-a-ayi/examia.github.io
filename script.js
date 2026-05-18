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

  getDocuments()       { return JSON.parse(localStorage.getItem('examia_documents') || '[]'); },
  saveDocuments(v)     { localStorage.setItem('examia_documents', JSON.stringify(v)); },

  getTodos()       { return JSON.parse(localStorage.getItem('examia_todos') || '[]'); },
  saveTodos(v)     { localStorage.setItem('examia_todos', JSON.stringify(v)); },

  getTakeCare()    { return JSON.parse(localStorage.getItem('examia_takecare') || '{}'); },
  saveTakeCare(v)  { localStorage.setItem('examia_takecare', JSON.stringify(v)); },

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
    // Planner
    examAdded:   () => AudioFX.sequence([[523.25,0.12,'sine',0.05],[659.25,0.14,'sine',0.05],[783.99,0.16,'sine',0.05]]),
    examDeleted: () => AudioFX.sequence([[392,0.14,'triangle',0.05],[311.13,0.14,'triangle',0.05],[261.63,0.18,'triangle',0.05]]),
    examUpdated:    () => AudioFX.sequence([[523.25,0.09,'sine',0.04],[587.33,0.09,'sine',0.04],[659.25,0.13,'sine',0.05]]),

    // Tracker
    topicAdded:     () => AudioFX.beep(659.25,0.09,'sine',0.04),
    topicRemoved:   () => AudioFX.beep(392,0.09,'triangle',0.04),
    statusChanged:  () => AudioFX.sequence([[440,0.08,'square',0.03],[493.88,0.10,'square',0.03]]),
    topicDone:   () => AudioFX.sequence([[659.25,0.08,'sine',0.04],[783.99,0.08,'sine',0.05],[987.77,0.12,'sine',0.05]]),
    examComplete:() => AudioFX.sequence([[440,0.11,'sine',0.05],[554.37,0.11,'sine',0.05],[659.25,0.18,'sine',0.06]]),
    
    // Pomodoro
    pomoStart:   () => AudioFX.beep(523.25,0.08,'sine',0.035),
    pomoPause:   () => AudioFX.beep(330,0.1,'triangle',0.04),
    pomoReset:   () => AudioFX.sequence([[392,0.07,'square',0.03],[329.63,0.07,'square',0.03]]),
    pomoSkip:    () => AudioFX.sequence([[659.25,0.07,'sine',0.04],[493.88,0.07,'sine',0.04]]),
    pomoDone:    () => AudioFX.sequence([[587.33,0.10,'sine',0.05],[739.99,0.10,'sine',0.05],[880,0.14,'sine',0.06]]),
    
    // To-Do List
    todoAdded:   () => AudioFX.sequence([[523.25,0.10,'sine',0.04],[659.25,0.12,'sine',0.04],[783.99,0.14,'sine',0.05]]),
    todoDone:    () => AudioFX.sequence([[783.99,0.10,'sine',0.05],[987.77,0.12,'sine',0.05],[1174.66,0.16,'sine',0.06]]),
    todoDeleted: () => AudioFX.sequence([[392,0.12,'triangle',0.04],[311.13,0.12,'triangle',0.04],[261.63,0.16,'triangle',0.04]]),
    todoReminder:() => AudioFX.sequence([[440,0.10,'sine',0.04],[440,0.10,'sine',0.04],[554.37,0.18,'sine',0.05]]),
    todoAllDone: () => AudioFX.sequence([[523.25,0.10,'sine',0.05],[659.25,0.10,'sine',0.05],[783.99,0.10,'sine',0.05],[1046.50,0.20,'sine',0.06]]),

    // TakeCare
    tcVibeSaved:    () => AudioFX.sequence([[523.25,0.09,'sine',0.04],[659.25,0.09,'sine',0.04],[783.99,0.09,'sine',0.04],[1046.50,0.16,'sine',0.06]]),
    //tcCardOpen:     () => AudioFX.beep(493.88,0.06,'sine',0.03),
    tcCardClose:    () => AudioFX.beep(392,0.06,'triangle',0.025),
    tcPillSelect:   () => AudioFX.beep(587.33,0.05,'sine',0.025),
    tcEmojiSelect:  () => AudioFX.beep(659.25,0.07,'sine',0.03),
    tcMealToggleOn: () => AudioFX.beep(783.99,0.06,'sine',0.03),
    tcMealToggleOff:() => AudioFX.beep(493.88,0.06,'triangle',0.025),
    tcWaterFill:    () => AudioFX.beep(880,0.05,'sine',0.025),
    tcWaterEmpty:   () => AudioFX.beep(440,0.05,'triangle',0.025),
    tcSliderMove:   () => AudioFX.beep(523.25,0.04,'sine',0.02),
    tcDateNav:      () => AudioFX.beep(440,0.06,'triangle',0.03),
    tcActivitySelect: () => AudioFX.beep(698.46,0.07,'sine',0.03),
    
    // Documents
    docUploaded:    () => AudioFX.sequence([[587.33,0.09,'sine',0.04],[739.99,0.11,'sine',0.05]]),
    docDeleted:     () => AudioFX.sequence([[370,0.10,'triangle',0.04],[311.13,0.12,'triangle',0.04]]),
    docTypeSet:     () => AudioFX.beep(493.88,0.07,'sine',0.03),

    // Profile
    profileSaved:   () => AudioFX.sequence([[523.25,0.09,'sine',0.04],[659.25,0.13,'sine',0.05]]),
    profileCleared: () => AudioFX.sequence([[392,0.10,'triangle',0.04],[329.63,0.12,'triangle',0.04]]),
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
  if (sec === 'todo') renderTodo();
  if (sec === 'takecare')  renderTakeCare();
  if (sec === 'documents') renderDocuments();
  if (sec === 'profile')   renderProfile();
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
    if (changed) playSound('examUpdated');
  } else {
    const newExam = { id: uid(), subject, date, startTime, endTime, details, color: selectedColor, createdAt: Date.now() };
    exams.push(newExam);
    showToast('<i class="fa-solid fa-check"></i> Exam added!', 'success');
    playSound('examAdded');
    localStorage.removeItem('examia_notif_all_complete_ts');
  }
  Store.saveExams(exams);
  /* Onboarding nudge — fires instantly on first exam save */
  if (typeof ExamiaNotifications !== 'undefined')
    ExamiaNotifications.checkOnboarding()
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
  if (t.status === 'completed') {
    playSound('examComplete');
    if (typeof ExamiaNotifications !== 'undefined')
      ExamiaNotifications.checkAllExamsCompleted();         
  }
  if (t.status !== 'completed') playSound('statusChanged');
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
  playSound('topicRemoved');
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
  tcBuildTimeSelects();
  renderDocuments();
  renderTodo();
  scheduleTodoReminders();
  const hash = window.location.hash.replace('#', '');
  const valid = ['dashboard', 'planner', 'tracker', 'pomodoro', 'motivation', 'todo', 'takecare', 'documents', 'notepad', 'timetable', 'profile'];
  if (valid.includes(hash)) navigate(hash);
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  const valid = ['dashboard', 'planner', 'tracker', 'pomodoro', 'motivation', 'todo', 'takecare', 'documents', 'notepad', 'timetable', 'profile'];
  if (valid.includes(hash)) navigate(hash);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeExamModal(); closeTrackerModal(); closeSidebar(); closeTodoModal(); tcCloseAllCards(); closeDeleteDocModal(); closeDocPreview(); closeProfileClearModal(); }
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




/* ============================================================
   § 13  PROFILE
   ============================================================ */

const ProfileStore = {
  get() {
    return JSON.parse(localStorage.getItem('examia_profile') || 'null') || {
      title: 'Mr', fullName: '', displayName: '', dob: '', course: '', avatarDataUrl: ''
    };
  },
  save(v) { localStorage.setItem('examia_profile', JSON.stringify(v)); },
};

let _selectedTitle = 'Mr';

function genderFromTitle(t) { return t === 'Mr' ? 'Male' : 'Female'; }
function genderIcon(t) {
  return t === 'Mr'
    ? '<i class="fa-solid fa-mars"></i>'
    : '<i class="fa-solid fa-venus"></i>';
}

/* Auto-fill display name with first word of full name */
function syncDisplayName() {
  const full = document.getElementById('profileFullName').value.trim();
  const disp = document.getElementById('profileDisplayName');
  if (!disp.dataset.edited) disp.value = full.split(/\s+/)[0] || '';
  renderProfileHero();
}

document.addEventListener('DOMContentLoaded', () => {
  const d = document.getElementById('profileDisplayName');
  if (d) d.addEventListener('input', () => { d.dataset.edited = 'yes'; renderProfileHero(); });
  document.getElementById('profileCourse')?.addEventListener('input', renderProfileHero);
  updateSidebarDisplayName();
});

/* Title toggle */
function selectTitle(t) {
  _selectedTitle = t;
  document.querySelectorAll('.profile-title-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.title === t));
  renderProfileHero();
}

/* Age calculation */
function calcAge(dobStr) {
  if (!dobStr) return null;
  const dob = new Date(dobStr + 'T00:00:00');
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : null;
}

/* Birthday hint text */
function dobSubtext(dobStr) {
  if (!dobStr) return null;
  const dob   = new Date(dobStr + 'T00:00:00');
  const today = new Date();
  const bday  = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
  if (bday < today) bday.setFullYear(bday.getFullYear() + 1);
  const diff = Math.ceil((bday - today) / 86400000);
  const age  = calcAge(dobStr);
  if (diff === 0) return `🎂 Happy Birthday! You turn ${age + 1} today!`;
  if (diff <= 7)  return `🎉 Birthday in ${diff} day${diff > 1 ? 's' : ''}!`;
  return age !== null ? `${age} years old` : null;
}

/* Avatar upload */
function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('<i class="fa-solid fa-triangle-exclamation"></i> Image too large (max 2 MB)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    applyAvatar(e.target.result);
    const p = ProfileStore.get();
    p.avatarDataUrl = e.target.result;
    ProfileStore.save(p);
    showToast('<i class="fa-solid fa-check"></i> Photo updated!', 'success');
  };
  reader.readAsDataURL(file);
}

function applyAvatar(dataUrl) {
  const img  = document.getElementById('profileAvatarImg');
  const icon = document.getElementById('profileAvatarPlaceholder');
  if (dataUrl) {
    img.src = dataUrl;
    img.style.display = 'block';
    icon.style.display = 'none';
  } else {
    img.style.display = 'none';
    icon.style.display = 'block';
  }
}

/* Live hero preview */
function renderProfileHero() {
  const fullName    = (document.getElementById('profileFullName')?.value   || '').trim();
  const displayName = (document.getElementById('profileDisplayName')?.value || '').trim();
  const course      = (document.getElementById('profileCourse')?.value     || '').trim();
  const dob         = document.getElementById('profileDOB')?.value || '';

  document.getElementById('profileHeroName').textContent =
    fullName ? `${_selectedTitle}. ${fullName}` : '—';

  const badge = document.getElementById('profileGenderBadge');
  badge.innerHTML  = genderIcon(_selectedTitle) + ' ' + genderFromTitle(_selectedTitle);
  badge.style.display = 'inline-flex';

  document.getElementById('profileHeroCourse').textContent = course || '';

  /* DOB hint */
  const dobInfo = document.getElementById('profileDobInfo');
  const sub = dobSubtext(dob);
  if (sub) {
    document.getElementById('profileDobInfoText').textContent = sub;
    dobInfo.style.display = 'flex';
  } else {
    dobInfo.style.display = 'none';
  }

  /* Section sub-greeting */
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = displayName || fullName.split(' ')[0] || '';
  document.getElementById('profileGreeting').textContent =
    name ? `${greet}, ${name}! 👋` : 'Keep your details up to date.';
}

/* Update sidebar display name */
function updateSidebarDisplayName() {
  const p = ProfileStore.get();
  const el = document.getElementById('sidebarDisplayName');
  if (!el) return;
  const name = p.displayName || (p.fullName ? p.fullName.split(' ')[0] : '');
  if (name) {
    el.textContent    = `${p.title || 'Mr'}. ${name}`;
    el.style.display  = 'block';
  } else {
    el.style.display  = 'none';
  }

  /* ── Mobile header ── */
  const mel = document.getElementById('mobileDisplayName');
  if (!mel) return;
  if (name) {
    mel.textContent   = `${p.title || 'Mr'}. ${name}`;
    mel.style.display = 'inline';
  } else {
    mel.style.display = 'none';
  }
}

/* Render full Profile section (called on navigate) */
function renderProfile() {
  const p = ProfileStore.get();
  _selectedTitle = p.title || 'Mr';

  document.getElementById('profileFullName').value    = p.fullName    || '';
  document.getElementById('profileDisplayName').value = p.displayName || '';
  document.getElementById('profileDOB').value         = p.dob         || '';
  document.getElementById('profileCourse').value      = p.course      || '';

  document.querySelectorAll('.profile-title-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.title === _selectedTitle));

  applyAvatar(p.avatarDataUrl || '');
  renderProfileHero();

  /* Stats card */
  const age    = calcAge(p.dob);
  const exams  = Store.getExams();
  const done   = exams.filter(e => Store.getTracker(e.id).status === 'completed').length;
  const streak = Store.getStreak().count;
  const statsCard = document.getElementById('profileStatsCard');

  if (p.fullName || p.dob || p.course) {
    statsCard.style.display = 'block';
    document.getElementById('pStatAge').textContent    = age !== null ? age : '—';
    document.getElementById('pStatExams').textContent  = exams.length;
    document.getElementById('pStatStreak').textContent = streak;
    document.getElementById('pStatDone').textContent   = done;
  } else {
    statsCard.style.display = 'none';
  }
}

/* Save */
function saveProfile() {
  const fullName = document.getElementById('profileFullName').value.trim();
  if (!fullName) {
    showToast('<i class="fa-solid fa-triangle-exclamation"></i> Please enter your full name', 'error');
    document.getElementById('profileFullName').focus();
    return;
  }
  const p = ProfileStore.get();
  p.title       = _selectedTitle;
  p.fullName    = fullName;
  p.displayName = document.getElementById('profileDisplayName').value.trim() || fullName.split(' ')[0];
  p.dob         = document.getElementById('profileDOB').value;
  p.course      = document.getElementById('profileCourse').value.trim();
  ProfileStore.save(p);
  renderProfile();
  updateSidebarDisplayName();
  showToast('<i class="fa-solid fa-check"></i> Profile saved!', 'success');
  playSound('profileSaved');
}

/* Clear */
function clearProfile() {
  document.getElementById('profileClearOverlay').classList.add('active');
  document.getElementById('profileClearModal').classList.add('active');
}

function confirmClearProfile() {
  closeProfileClearModal();
  ProfileStore.save({ title: 'Mr', fullName: '', displayName: '', dob: '', course: '', avatarDataUrl: '' });
  document.getElementById('profileAvatarInput').value = '';
  delete document.getElementById('profileDisplayName').dataset.edited;
  renderProfile();
  updateSidebarDisplayName();
  showToast('Profile cleared', '');
  playSound('profileCleared');
}

function closeProfileClearModal() {
  document.getElementById('profileClearOverlay').classList.remove('active');
  document.getElementById('profileClearModal').classList.remove('active');
}

/* ============================================================
   § DOCUMENTS
   ============================================================ */

const MAX_DOCS = 5;
const DOC_FILE_MAX_MB = 25;

/* ------ Render / Init ------ */
function renderDocuments() {
  const docs = Store.getDocuments();
  const slots = document.getElementById('docSlots');
  const emptyState = document.getElementById('docEmptyState');
  const addBtn = document.getElementById('docAddBtn');
  const countEl = document.getElementById('docFileCount');

  if (!slots || !countEl) return;

  const filled = docs.filter(Boolean).length;
  countEl.textContent = `${filled} / ${MAX_DOCS} files`;

  /* Show/hide empty state */
  emptyState.style.display = filled === 0 ? 'flex' : 'none';

  /* Render each slot that exists */
  slots.innerHTML = '';
  const slotsToShow = Math.min(filled + 1, MAX_DOCS); // always show one empty slot after the last filled

  for (let i = 0; i < slotsToShow; i++) {
    slots.appendChild(buildDocSlot(i, docs[i] || null));
  }

  /* Show "Add New File" button only when all visible slots are filled and we're under the limit */
  const allFilled = docs.length >= slotsToShow && slotsToShow < MAX_DOCS;
  addBtn.style.display = (filled > 0 && filled < MAX_DOCS) ? 'flex' : 'none';
}

function buildDocSlot(index, doc) {
  const div = document.createElement('div');
  div.className = 'doc-slot';
  div.id = `docSlot${index}`;
  div.dataset.index = index;

  if (!doc) {
    /* Empty upload zone */
    div.innerHTML = `
      <div class="doc-upload-zone" id="docUploadZone${index}">
        <input type="file" id="docFileInput${index}" accept="image/*,.pdf" hidden>
        <label for="docFileInput${index}" class="doc-upload-label">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <span>Upload File</span>
          <small>Image or PDF · Max ${DOC_FILE_MAX_MB}MB</small>
        </label>
      </div>`;
    /* Bind change event */
    div.querySelector(`#docFileInput${index}`).addEventListener('change', e => handleDocUpload(e, index));
    /* Drag-and-drop */
    const zone = div.querySelector('.doc-upload-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); handleDocDrop(e, index); });
  } else {
    /* Filled slot */
    const isImg = doc.mimeType && doc.mimeType.startsWith('image/');
    const thumbHtml = isImg
      ? `<img class="doc-slot-thumb" src="${doc.dataUrl}" alt="thumb">`
      : `<div class="doc-slot-thumb doc-slot-thumb-pdf"><i class="fa-solid fa-file-pdf"></i></div>`;

    div.innerHTML = `
      <div class="doc-slot-filled">
        ${thumbHtml}
        <div class="doc-slot-meta">
          <div class="doc-custom-select" id="docTypeDropdown${index}">
            <button class="doc-select-btn" onclick="toggleDocDropdown(${index})">
              <i class="fa-solid fa-tag"></i>
              <span id="docTypeLabel${index}">${esc(doc.type || 'Notes')}</span>
              <i class="fa-solid fa-chevron-down doc-chevron"></i>
            </button>
            <ul class="doc-select-list" id="docTypeList${index}">
              <li onclick="selectDocType(${index},'Notes')"><i class="fa-solid fa-note-sticky"></i> Notes</li>
              <li onclick="selectDocType(${index},'Question Paper')"><i class="fa-solid fa-file-lines"></i> Question Paper</li>
              <li onclick="selectDocType(${index},'Assignment')"><i class="fa-solid fa-pen-to-square"></i> Assignment</li>
              <li onclick="selectDocType(${index},'Reference')"><i class="fa-solid fa-bookmark"></i> Reference</li>
              <li onclick="selectDocType(${index},'Other')"><i class="fa-solid fa-file"></i> Other</li>
            </ul>
          </div>
          <input type="text" class="doc-title-input" id="docTitleInput${index}"
            placeholder="File title…" maxlength="60"
            value="${esc(doc.title || doc.fileName || '')}"
            oninput="saveDocMeta(${index})"/>
        </div>
        <div class="doc-slot-actions">
          <button class="doc-btn doc-btn-view"     onclick="previewDoc(${index})" title="View">
            <i class="fa-solid fa-eye"></i><span>View</span>
          </button>
          <button class="doc-btn doc-btn-download" onclick="downloadDoc(${index})" title="Download">
            <i class="fa-solid fa-download"></i><span>Download</span>
          </button>
          <button class="doc-btn doc-btn-delete"   onclick="deleteDoc(${index})" title="Delete">
            <i class="fa-solid fa-trash"></i><span>Delete</span>
          </button>
        </div>
      </div>`;
  }
  return div;
}

/* ------ Upload Handling ------ */
function handleDocUpload(e, index) {
  const file = e.target.files[0];
  if (file) processDocFile(file, index);
}

function handleDocDrop(e, index) {
  const file = e.dataTransfer.files[0];
  if (file) processDocFile(file, index);
}

function processDocFile(file, index) {
  const allowed = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','application/pdf'];
  if (!allowed.includes(file.type)) {
    showToast('<i class="fa-solid fa-triangle-exclamation"></i> Only image or PDF files allowed', 'error');
    return;
  }
  if (file.size > DOC_FILE_MAX_MB * 1024 * 1024) {
    showToast(`<i class="fa-solid fa-triangle-exclamation"></i> File too large (max ${DOC_FILE_MAX_MB} MB)`, 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const docs = Store.getDocuments();
    docs[index] = {
      title: file.name.replace(/\.[^/.]+$/, ''), // default title = filename without extension
      type: 'Notes',
      dataUrl: e.target.result,
      mimeType: file.type,
      fileName: file.name
    };
    Store.saveDocuments(docs);
    renderDocuments();
    showToast('<i class="fa-solid fa-check"></i> File uploaded!', 'success');
    playSound('docUploaded');
  };
  reader.readAsDataURL(file);
}

/* ------ Dropdown ------ */
function toggleDocDropdown(index) {
  const list = document.getElementById(`docTypeList${index}`);
  const isOpen = list.classList.contains('open');
  /* Close all open dropdowns first */
  document.querySelectorAll('.doc-select-list.open').forEach(l => l.classList.remove('open'));
  if (!isOpen) list.classList.add('open');
}

function selectDocType(index, type) {
  document.getElementById(`docTypeLabel${index}`).textContent = type;
  document.getElementById(`docTypeList${index}`).classList.remove('open');
  saveDocMeta(index);
  playSound('docTypeSet');
}

/* Close dropdowns when clicking outside */
document.addEventListener('click', e => {
  if (!e.target.closest('.doc-custom-select')) {
    document.querySelectorAll('.doc-select-list.open').forEach(l => l.classList.remove('open'));
  }
});

/* ------ Meta Save ------ */
function saveDocMeta(index) {
  const docs = Store.getDocuments();
  if (!docs[index]) return;
  docs[index].title = document.getElementById(`docTitleInput${index}`)?.value || docs[index].title;
  docs[index].type  = document.getElementById(`docTypeLabel${index}`)?.textContent || docs[index].type;
  Store.saveDocuments(docs);
}

/* ------ Add Slot ------ */
function addDocSlot() {
  renderDocuments(); // renderDocuments already calculates correct slotsToShow
}

/* ------ Delete ------ */
function deleteDoc(index) {
  const docs = Store.getDocuments();
  const doc  = docs[index];
  if (!doc) return;

  /* Show custom modal */
  document.getElementById('docDeleteFileName').textContent =
    `"${doc.title || doc.fileName || 'this file'}"`;
  document.getElementById('docDeleteConfirmBtn').onclick = () => confirmDeleteDoc(index);
  document.getElementById('docDeleteOverlay').classList.add('active');
  document.getElementById('docDeleteModal').classList.add('active');
}

function confirmDeleteDoc(index) {
  const docs = Store.getDocuments();
  docs.splice(index, 1);
  Store.saveDocuments(docs);
  closeDeleteDocModal();
  renderDocuments();
  showToast('<i class="fa-solid fa-check"></i> File deleted', '');
  playSound('docDeleted');
}

function closeDeleteDocModal() {
  document.getElementById('docDeleteOverlay').classList.remove('active');
  document.getElementById('docDeleteModal').classList.remove('active');
}

/* ------ Download ------ */
function downloadDoc(index) {
  const doc = Store.getDocuments()[index];
  if (!doc) return;
  const a = document.createElement('a');
  a.href = doc.dataUrl;
  a.download = doc.fileName || doc.title || 'document';
  a.click();
}

/* ------ Preview ------ */
function previewDoc(index) {
  const doc = Store.getDocuments()[index];
  if (!doc) return;

  const overlay = document.getElementById('docPreviewOverlay');
  const modal   = document.getElementById('docPreviewModal');
  const title   = document.getElementById('docPreviewTitle');
  const body    = document.getElementById('docPreviewBody');

  title.innerHTML = `<i class="fa-solid fa-${doc.mimeType?.startsWith('image/') ? 'image' : 'file-pdf'}"></i> ${esc(doc.title || doc.fileName || 'Preview')}`;

  body.innerHTML = '';

  if (doc.mimeType && doc.mimeType.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = doc.dataUrl;
    img.className = 'doc-preview-img';
    img.alt = doc.title || 'Preview';
    body.appendChild(img);
  } else {
    /* PDF: render in-app using PDF.js onto canvas — no external browser/plugin */
    const wrap = document.createElement('div');
    wrap.className = 'doc-preview-pdfjs-wrap';

    const toolbar = document.createElement('div');
    toolbar.className = 'doc-pdfjs-toolbar';
    toolbar.innerHTML = `
      <button class="doc-pdfjs-btn" id="pdfPrevPage"><i class="fa-solid fa-chevron-left"></i></button>
      <span class="doc-pdfjs-pageinfo">
        Page <span id="pdfCurrentPage">1</span> of <span id="pdfTotalPages">—</span>
      </span>
      <button class="doc-pdfjs-btn" id="pdfNextPage"><i class="fa-solid fa-chevron-right"></i></button>
      <button class="doc-pdfjs-btn" id="pdfZoomOut"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
      <button class="doc-pdfjs-btn" id="pdfZoomIn"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
    `;

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'doc-pdfjs-canvas-wrap';

    const canvas = document.createElement('canvas');
    canvas.id = 'pdfCanvas';
    canvasWrap.appendChild(canvas);
    wrap.appendChild(toolbar);
    wrap.appendChild(canvasWrap);
    body.appendChild(wrap);

    /* State */
    let pdfDoc = null, currentPage = 1, currentScale = 1.2;

    function renderPage(num) {
      pdfDoc.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const ctx = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width  = viewport.width;
        page.render({ canvasContext: ctx, viewport });
        document.getElementById('pdfCurrentPage').textContent = num;
      });
    }

    /* Load PDF from base64 dataUrl */
    const base64 = doc.dataUrl.split(',')[1];
    const binary  = atob(base64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    pdfjsLib.getDocument({ data: bytes }).promise.then(pdf => {
      pdfDoc = pdf;
      document.getElementById('pdfTotalPages').textContent = pdf.numPages;
      renderPage(currentPage);
    });

    /* Controls */
    document.getElementById('pdfPrevPage').onclick = () => {
      if (currentPage <= 1) return;
      currentPage--;
      renderPage(currentPage);
    };
    document.getElementById('pdfNextPage').onclick = () => {
      if (currentPage >= pdfDoc.numPages) return;
      currentPage++;
      renderPage(currentPage);
    };
    document.getElementById('pdfZoomIn').onclick = () => {
      currentScale = Math.min(currentScale + 0.2, 3.0);
      renderPage(currentPage);
    };
    document.getElementById('pdfZoomOut').onclick = () => {
      currentScale = Math.max(currentScale - 0.2, 0.5);
      renderPage(currentPage);
    };
  }

  overlay.classList.add('active');
  modal.classList.add('active');
}

function closeDocPreview() {
  document.getElementById('docPreviewOverlay').classList.remove('active');
  document.getElementById('docPreviewModal').classList.remove('active');
  document.getElementById('docPreviewBody').innerHTML = ''; // free memory
}

/* ============================================================
   § TO-DO LIST
   ============================================================ */

/* Filter state */
let _todoCatFilter    = 'all';
let _todoPriFilter    = 'all';
let _todoStatusFilter = 'all';

/* Category icon map */
const TODO_CAT_ICONS = {
  'Exam Prep':      'fa-book-open',
  'Assignment':     'fa-pen-to-square',
  'Revision':       'fa-rotate-left',
  'Project':        'fa-diagram-project',
  'School Activity':'fa-school',
  'Personal Study': 'fa-user-graduate',
  'Other':          'fa-ellipsis'
};

/* Priority colours using existing CSS vars */
const TODO_PRI_CLASS = {
  'High':   'todo-pri-high',
  'Medium': 'todo-pri-medium',
  'Low':    'todo-pri-low'
};

/* ------ Render ------ */
function renderTodo() {
  const all     = Store.getTodos();
  const listEl  = document.getElementById('todoList');
  const emptyEl = document.getElementById('todoEmptyState');
  if (!listEl) return;

  /* Summary counts */
  const now     = new Date(); now.setHours(0,0,0,0);
  const done    = all.filter(t => t.done).length;
  const pending = all.filter(t => !t.done).length;
  const overdue = all.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00') < now).length;
  document.getElementById('todoDoneCount').textContent    = done;
  document.getElementById('todoPendingCount').textContent = pending;
  document.getElementById('todoOverdueCount').textContent = overdue;

  /* Sub greeting */
  document.getElementById('todoSub').textContent =
    all.length === 0 ? 'Stay on top of your tasks.'
    : done === all.length ? '🎉 All tasks done! Great work!'
    : `${pending} task${pending !== 1 ? 's' : ''} remaining.`;

  /* Apply filters */
  let filtered = all.filter((t, i) => {
    t._index = i; // carry original index for edit/delete
    if (_todoCatFilter    !== 'all' && t.category !== _todoCatFilter) return false;
    if (_todoPriFilter    !== 'all' && t.priority !== _todoPriFilter) return false;
    if (_todoStatusFilter === 'pending' && t.done)  return false;
    if (_todoStatusFilter === 'done'    && !t.done) return false;
    return true;
  });

  /* Sort: undone first, then by due date, then by priority weight */
  const priWeight = { 'High': 0, 'Medium': 1, 'Low': 2 };
  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return (priWeight[a.priority] || 1) - (priWeight[b.priority] || 1);
  });

  if (filtered.length === 0) {
    listEl.innerHTML  = '';
    emptyEl.style.display = all.length === 0 ? 'block' : 'none';
    if (all.length > 0) {
      listEl.innerHTML = `<p class="empty-msg" style="text-align:center;padding:2rem 0">No tasks match the current filter.</p>`;
    }
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = filtered.map(t => {
    const idx         = t._index;
    const catIcon     = TODO_CAT_ICONS[t.category] || 'fa-tag';
    const priClass    = TODO_PRI_CLASS[t.priority]  || 'todo-pri-medium';
    const dueTxt      = t.dueDate ? formatDate(t.dueDate) : '';
    const daysLeft    = t.dueDate ? daysUntil(t.dueDate) : null;
    const urgClass    = daysLeft !== null && !t.done ? daysClass(daysLeft) : '';
    const overdueTxt  = daysLeft !== null && daysLeft < 0 && !t.done
      ? `<span class="todo-overdue-tag"><i class="fa-solid fa-triangle-exclamation"></i> Overdue by ${Math.abs(daysLeft)}d</span>` : '';
    const dueSoonTxt  = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 && !t.done
      ? `<span class="todo-soon-tag"><i class="fa-solid fa-bell"></i> Due soon</span>` : '';

    return `
      <div class="todo-card ${t.done ? 'todo-done' : ''} ${urgClass}" data-id="${idx}">
        <button class="todo-check-btn ${t.done ? 'checked' : ''}" onclick="toggleTodoDone(${idx})" title="${t.done ? 'Mark undone' : 'Mark done'}">
          <i class="fa-${t.done ? 'solid' : 'regular'} fa-circle-check"></i>
        </button>
        <div class="todo-card-body">
          <div class="todo-card-top">
            <span class="todo-task-text">${esc(t.task)}</span>
            <span class="todo-pri-badge ${priClass}">${t.priority}</span>
          </div>
          <div class="todo-card-meta">
            <span class="todo-cat-tag"><i class="fa-solid ${catIcon}"></i> ${esc(t.category)}</span>
            ${dueTxt ? `<span class="todo-due-tag ${urgClass}"><i class="fa-solid fa-calendar-day"></i> ${dueTxt}</span>` : ''}
            ${overdueTxt}
            ${dueSoonTxt}
            ${t.notes ? `<span class="todo-notes-tag"><i class="fa-solid fa-note-sticky"></i> ${esc(t.notes)}</span>` : ''}
          </div>
        </div>
        <div class="todo-card-actions">
          <button class="btn-icon" onclick="openTodoModal(${idx})" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon todo-delete-btn" onclick="openTodoDeleteModal(${idx})" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
  }).join('');
}

/* ------ Filter chips wiring (called once after DOM ready) ------ */
function initTodoFilters() {
  document.querySelectorAll('#todoCategoryFilter .todo-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#todoCategoryFilter .todo-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _todoCatFilter = btn.dataset.cat;
      renderTodo();
    });
  });
  document.querySelectorAll('#todoPriorityFilter .todo-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#todoPriorityFilter .todo-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _todoPriFilter = btn.dataset.pri;
      renderTodo();
    });
  });
  document.querySelectorAll('#todoStatusFilter .todo-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#todoStatusFilter .todo-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _todoStatusFilter = btn.dataset.status;
      renderTodo();
    });
  });
}

/* ------ Modal open/close ------ */
let _todoEditIndex = -1;

function openTodoModal(index = -1) {
  _todoEditIndex = index;
  const isEdit   = index >= 0;
  document.getElementById('todoModalTitle').innerHTML =
    `<i class="fa-solid fa-list-check"></i> ${isEdit ? 'Edit Task' : 'Add Task'}`;

  /* Reset fields */
  document.getElementById('todoEditId').value    = index;
  document.getElementById('todoTaskInput').value = '';
  document.getElementById('todoDueDate').value   = '';
  document.getElementById('todoNotes').value     = '';

  /* Reset category picker */
  document.querySelectorAll('#todoCatPicker .todo-chip').forEach(b => b.classList.remove('active'));
  document.querySelector('#todoCatPicker .todo-chip[data-val="Exam Prep"]').classList.add('active');

  /* Reset priority picker */
  document.querySelectorAll('#todoPriPicker .todo-chip').forEach(b => b.classList.remove('active'));
  document.querySelector('#todoPriPicker .todo-chip[data-val="High"]').classList.add('active');

  if (isEdit) {
    const t = Store.getTodos()[index];
    if (!t) return;
    document.getElementById('todoTaskInput').value = t.task;
    document.getElementById('todoDueDate').value   = t.dueDate || '';
    document.getElementById('todoNotes').value     = t.notes   || '';

    document.querySelectorAll('#todoCatPicker .todo-chip').forEach(b =>
      b.classList.toggle('active', b.dataset.val === t.category));
    document.querySelectorAll('#todoPriPicker .todo-chip').forEach(b =>
      b.classList.toggle('active', b.dataset.val === t.priority));
  }

  document.getElementById('todoModalOverlay').classList.add('active');
  document.getElementById('todoModal').classList.add('active');
  setTimeout(() => document.getElementById('todoTaskInput').focus(), 100);
}

function closeTodoModal() {
  document.getElementById('todoModalOverlay').classList.remove('active');
  document.getElementById('todoModal').classList.remove('active');
}

/* ------ Chip selectors inside modal ------ */
function selectTodoCat(btn) {
  document.querySelectorAll('#todoCatPicker .todo-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function selectTodoPri(btn) {
  document.querySelectorAll('#todoPriPicker .todo-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

/* ------ Save ------ */
function saveTodo() {
  const task = document.getElementById('todoTaskInput').value.trim();
  if (!task) {
    showToast('<i class="fa-solid fa-triangle-exclamation"></i> Please enter a task', 'error');
    document.getElementById('todoTaskInput').focus();
    return;
  }
  const category = document.querySelector('#todoCatPicker .todo-chip.active')?.dataset.val || 'Other';
  const priority = document.querySelector('#todoPriPicker .todo-chip.active')?.dataset.val || 'Medium';
  const dueDate  = document.getElementById('todoDueDate').value  || '';
  const notes    = document.getElementById('todoNotes').value.trim() || '';

  const todos = Store.getTodos();
  if (_todoEditIndex >= 0 && todos[_todoEditIndex]) {
    /* Edit existing — preserve done state */
    todos[_todoEditIndex] = { ...todos[_todoEditIndex], task, category, priority, dueDate, notes };
    playSound('todoAdded');
    showToast('<i class="fa-solid fa-check"></i> Task updated!', 'success');
  } else {
    /* New task */
    todos.push({ task, category, priority, dueDate, notes, done: false, createdAt: Date.now() });
    playSound('todoAdded');
    showToast('<i class="fa-solid fa-check"></i> Task added!', 'success');
  }
  Store.saveTodos(todos);
  closeTodoModal();
  renderTodo();
}

/* ------ Toggle done ------ */
function toggleTodoDone(index) {
  const todos = Store.getTodos();
  if (!todos[index]) return;
  todos[index].done = !todos[index].done;
  Store.saveTodos(todos);
  if (todos[index].done) {
    playSound('todoDone');
    /* Check if ALL tasks are now done */
    if (todos.every(t => t.done)) {
      playSound('todoAllDone');
      showToast('<i class="fa-solid fa-party-horn"></i> All tasks completed! 🎉', 'success', 4000);
    }
  } else {
    playSound('todoAdded');
  }
  renderTodo();
}

/* ------ Delete ------ */
function openTodoDeleteModal(index) {
  const t = Store.getTodos()[index];
  if (!t) return;
  document.getElementById('todoDeleteTaskName').textContent = `"${t.task}"`;
  document.getElementById('todoDeleteConfirmBtn').onclick = () => confirmDeleteTodo(index);
  document.getElementById('todoDeleteOverlay').classList.add('active');
  document.getElementById('todoDeleteModal').classList.add('active');
}

function confirmDeleteTodo(index) {
  const todos = Store.getTodos();
  todos.splice(index, 1);
  Store.saveTodos(todos);
  playSound('todoDeleted');
  closeTodoDeleteModal();
  renderTodo();
  showToast('<i class="fa-solid fa-check"></i> Task deleted', '');
}

function closeTodoDeleteModal() {
  document.getElementById('todoDeleteOverlay').classList.remove('active');
  document.getElementById('todoDeleteModal').classList.remove('active');
}

/* ------ Init filters on DOMContentLoaded ------ */
document.addEventListener('DOMContentLoaded', initTodoFilters);

/* ============================================================
   § TO-DO REMINDERS
   ============================================================ */

/* Tracks which notification keys were already shown this session
   so we don't spam the same alert repeatedly */
const _todoNotifiedKeys = new Set();

/* Send an OS-level notification via the SW LOCAL_NOTIFY channel */
function sendTodoOSNotification(title, body, tag) {
  if (!('serviceWorker' in navigator)) return;
  if (Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({
      type: 'LOCAL_NOTIFY',
      title,
      options: {
        body,
        icon:    './icon-192.png',
        badge:   './icon-96.png',
        tag,                      /* same tag = replaces previous, no spam */
        renotify: false,
        vibrate: [200, 100, 200],
        data: { url: '/index.html#todo' }
      }
    });
  });
}

/* Request notification permission if not yet granted */
function requestTodoNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/* Core checker — runs on page load and every hour */
function checkTodoReminders() {
  const todos = Store.getTodos();
  if (!todos.length) return;

  const today    = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const overdue      = todos.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00') < today);
  const dueToday     = todos.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00').getTime() === today.getTime());
  const dueTomorrow  = todos.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00').getTime() === tomorrow.getTime());
  const highPending  = todos.filter(t => !t.done && t.priority === 'High');

  /* ── Overdue tasks ── */
  if (overdue.length) {
    const key = `overdue-${overdue.map(t => t.task).join(',')}`;
    if (!_todoNotifiedKeys.has(key)) {
      _todoNotifiedKeys.add(key);
      playSound('todoReminder');
      showToast(
        `<i class="fa-solid fa-triangle-exclamation"></i> ${overdue.length} task${overdue.length > 1 ? 's are' : ' is'} overdue!`,
        'error', 5000
      );
      sendTodoOSNotification(
        '⚠️ Overdue Tasks',
        `${overdue.length} task${overdue.length > 1 ? 's are' : ' is'} overdue: ${overdue.slice(0,2).map(t => t.task).join(', ')}${overdue.length > 2 ? '…' : ''}`,
        'todo-overdue'
      );
    }
  }

  /* ── Due today ── */
  if (dueToday.length) {
    const key = `today-${today.toDateString()}`;
    if (!_todoNotifiedKeys.has(key)) {
      _todoNotifiedKeys.add(key);
      playSound('todoReminder');
      showToast(
        `<i class="fa-solid fa-calendar-day"></i> ${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today!`,
        'warning', 5000
      );
      sendTodoOSNotification(
        '📅 Due Today',
        `${dueToday.slice(0,2).map(t => t.task).join(', ')}${dueToday.length > 2 ? ` +${dueToday.length - 2} more` : ''}`,
        'todo-due-today'
      );
    }
  }

  /* ── Due tomorrow ── */
  if (dueTomorrow.length) {
    const key = `tomorrow-${tomorrow.toDateString()}`;
    if (!_todoNotifiedKeys.has(key)) {
      _todoNotifiedKeys.add(key);
      showToast(
        `<i class="fa-solid fa-bell"></i> ${dueTomorrow.length} task${dueTomorrow.length > 1 ? 's' : ''} due tomorrow.`,
        '', 4000
      );
      sendTodoOSNotification(
        '🔔 Due Tomorrow',
        `${dueTomorrow.slice(0,2).map(t => t.task).join(', ')}${dueTomorrow.length > 2 ? ` +${dueTomorrow.length - 2} more` : ''}`,
        'todo-due-tomorrow'
      );
    }
  }

  /* ── High priority pending ── */
  if (highPending.length) {
    const key = `high-${today.toDateString()}`;
    if (!_todoNotifiedKeys.has(key)) {
      _todoNotifiedKeys.add(key);
      showToast(
        `<i class="fa-solid fa-circle-exclamation"></i> ${highPending.length} high-priority task${highPending.length > 1 ? 's' : ''} pending.`,
        'warning', 4000
      );
      sendTodoOSNotification(
        '🔴 High Priority Tasks',
        `${highPending.length} high-priority task${highPending.length > 1 ? 's' : ''} still pending.`,
        'todo-high-priority'
      );
    }
  }
}

/* Stagger toasts so they don't all fire at once on page load */
function scheduleTodoReminders() {
  requestTodoNotificationPermission();

  /* Stagger: overdue → 1s, today → 3s, tomorrow → 5s, high-pri → 7s */
  const todos   = Store.getTodos();
  if (!todos.length) return;

  const today   = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const overdue     = todos.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00') < today);
  const dueToday    = todos.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00').getTime() === today.getTime());
  const dueTomorrow = todos.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00').getTime() === tomorrow.getTime());
  const highPending = todos.filter(t => !t.done && t.priority === 'High');

  let delay = 1500;
  const gap = 2000;

  if (overdue.length) {
    setTimeout(() => {
      playSound('todoReminder');
      showToast(`<i class="fa-solid fa-triangle-exclamation"></i> ${overdue.length} task${overdue.length > 1 ? 's are' : ' is'} overdue!`, 'error', 5000);
      sendTodoOSNotification('⚠️ Overdue Tasks',
        `${overdue.slice(0,2).map(t=>t.task).join(', ')}${overdue.length > 2 ? '…' : ''}`, 'todo-overdue');
    }, delay); delay += gap;
  }

  if (dueToday.length) {
    setTimeout(() => {
      playSound('todoReminder');
      showToast(`<i class="fa-solid fa-calendar-day"></i> ${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today!`, 'warning', 5000);
      sendTodoOSNotification('📅 Due Today',
        `${dueToday.slice(0,2).map(t=>t.task).join(', ')}${dueToday.length > 2 ? ` +${dueToday.length-2} more` : ''}`, 'todo-due-today');
    }, delay); delay += gap;
  }

  if (dueTomorrow.length) {
    setTimeout(() => {
      showToast(`<i class="fa-solid fa-bell"></i> ${dueTomorrow.length} task${dueTomorrow.length > 1 ? 's' : ''} due tomorrow.`, '', 4000);
      sendTodoOSNotification('🔔 Due Tomorrow',
        `${dueTomorrow.slice(0,2).map(t=>t.task).join(', ')}${dueTomorrow.length > 2 ? ` +${dueTomorrow.length-2} more` : ''}`, 'todo-due-tomorrow');
    }, delay); delay += gap;
  }

  if (highPending.length) {
    setTimeout(() => {
      showToast(`<i class="fa-solid fa-circle-exclamation"></i> ${highPending.length} high-priority task${highPending.length > 1 ? 's' : ''} pending.`, 'warning', 4000);
      sendTodoOSNotification('🔴 High Priority',
        `${highPending.length} high-priority task${highPending.length > 1 ? 's' : ''} still pending.`, 'todo-high-priority');
    }, delay);
  }

  /* Re-check every hour for due-today reminders */
  setInterval(checkTodoReminders, 60 * 60 * 1000);
}



/* ============================================================
   § TAKECARE — Daily wellness check-in
   ============================================================ */

let tcCurrentDate = getLocalDateString();
let _tcSliderTimer = null;
let _tcSliderSoundEnabled = false;
let tcWaterCount  = 0;

/* ── Get local YYYY-MM-DD ── */
function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ── Date navigator ── */
function tcChangeDate(dir) {

  // Parse safely in local time
  const [y, m, d] = tcCurrentDate.split('-').map(Number);

  // Create local date
  const date = new Date(y, m - 1, d);

  // Change day
  date.setDate(date.getDate() + dir);

  // Convert back to local YYYY-MM-DD
  const next = getLocalDateString(date);

  // Today's local date
  const today = getLocalDateString();

  // Prevent future dates
  if (next > today) return;

  tcCurrentDate = next;
  playSound('tcDateNav');

  renderTakeCare();
}

/* ── Date label formatter ── */
function tcFormatDateLabel(str) {

  const [y, m, d] = str.split('-').map(Number);

  const date = new Date(y, m - 1, d);

  const today = getLocalDateString();

  if (str === today) {
    return 'Today — ' + date.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

/* ── Main render ── */
function renderTakeCare() {
  const today   = new Date().toISOString().split('T')[0];
  const isToday = tcCurrentDate === today;
  const all     = Store.getTakeCare();
  const log     = all[tcCurrentDate] || null;

  /* Date label + next btn */
  const lbl = document.getElementById('tcDateLabel');
  if (lbl) lbl.textContent = tcFormatDateLabel(tcCurrentDate);
  const nextBtn = document.getElementById('tcNextBtn');
  if (nextBtn) nextBtn.disabled = isToday;

  /* Vibe card */
  tcRenderVibeCard(log);

  /* Reset UI state to blank, then populate from saved log */
  tcResetUI();
  if (log) tcPopulateUI(log);

  /* Grind report always reads live data */
  tcRenderGrindReport();

  /* Summaries */
  tcUpdateAllSummaries(log);

  /* Save area */
  const saveArea = document.getElementById('tc-save-area');
  if (saveArea) {
    saveArea.innerHTML = isToday
      ? `<button class="btn-primary tc-save-btn" onclick="tcSave()">save the vibe ✓</button>`
      : `<p class="tc-readonly-msg">this is a past log — read only 📖</p>`;
  }

  /* Make past logs read-only */
  tcSetReadOnly(!isToday);

  /* Weekly snapshot */
  tcRenderWeekly();
  /* Enable slider sound only after render — prevents firing during tcPopulateUI */
  _tcSliderSoundEnabled = false;
  setTimeout(() => { _tcSliderSoundEnabled = true; }, 150);

}

/* ── Vibe score calculation ── */
function tcVibeScore(log) {
  if (!log) return -1;
  let score = 0;
  /* Sleep: rating 0-4 → 0-20pts */
  if (log.sleep && log.sleep.rating != null) score += (log.sleep.rating / 4) * 20;
  /* Activity: couch=0, anything else=20 */
  if (log.activity && log.activity.type) score += log.activity.type === 'couch' ? 0 : 20;
  /* Screen: 0h=15, 8h=0 (inverse) */
  if (log.screen && log.screen.total != null) score += Math.max(0, 15 - (log.screen.total / 8) * 15);
  /* Food: meals/4 * 10 + water/8 * 10 */
  if (log.food) {
    const meals = (log.food.meals || []).length;
    score += (meals / 4) * 10;
    score += Math.min(10, ((log.food.water || 0) / 8) * 10);
  }
  /* Mood: emoji 0-5 → 0-20 */
  if (log.mood && log.mood.emoji != null) score += (log.mood.emoji / 5) * 20;
  /* Bonus: note filled */
  if (log.mood && log.mood.note && log.mood.note.trim().length > 0) score += 5;
  return Math.round(Math.min(100, score));
}

function tcVibeClass(score) {
  if (score < 0)   return { cls: '',              label: 'log your day to see your vibe' };
  if (score >= 85) return { cls: 'vibe-thriving',  label: 'thriving 🌸' };
  if (score >= 65) return { cls: 'vibe-okay',      label: 'doing okay 🌿' };
  if (score >= 45) return { cls: 'vibe-getting',   label: 'getting through it 🌥️' };
  if (score >= 25) return { cls: 'vibe-rough',     label: 'rough day 🌧️' };
  return                  { cls: 'vibe-survival',  label: 'survival mode 💀' };
}

function tcRenderVibeCard(log) {
  const card  = document.getElementById('tcVibeCard');
  const label = document.getElementById('tcVibeLabel');
  if (!card || !label) return;
  const score = tcVibeScore(log);
  const v     = tcVibeClass(score);
  card.className  = 'tc-vibe-card ' + v.cls;
  label.textContent = v.label;
}

/* ── Accordion ── */
function tcToggleCard(id) {
  const card = document.getElementById('tc-card-' + id);
  if (!card) return;
  const isOpen = card.classList.contains('open');
  document.querySelectorAll('.tc-card.open').forEach(c => c.classList.remove('open'));
  if (!isOpen) {
    card.classList.add('open');
    playSound('tcCardOpen');
  } else {
    playSound('tcCardClose');
  }
}

function tcCloseAllCards() {
  document.querySelectorAll('.tc-card.open').forEach(c => c.classList.remove('open'));
}

/* ── Generic single-select helper ── */
function tcSelect(btn, groupId) {
  const container = btn.closest('[id="tc-' + groupId + '"]') ||
                    btn.closest('.tc-card-body');
  /* Deselect siblings in same group */
  const selector = btn.classList.contains('tc-pill')
    ? '.tc-pill' : btn.classList.contains('tc-emoji-btn')
    ? '.tc-emoji-btn' : btn.classList.contains('tc-activity-btn')
    ? '.tc-activity-btn' : null;
  if (selector && container) {
    const parentGroup = document.getElementById('tc-' + groupId);
    if (parentGroup) parentGroup.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
  }
  btn.classList.toggle('active');

  /* Special: show/hide duration row for activity */
  if (groupId === 'activity-type') {
    const row = document.getElementById('tc-duration-row');
    if (row) row.style.display = (btn.dataset.val === 'couch' || !btn.classList.contains('active')) ? 'none' : '';
  }
  tcUpdateAllSummaries(null);

  /* Sound: different tone for emoji vs pill vs activity */
  if (btn.classList.contains('tc-emoji-btn'))    playSound('tcEmojiSelect');
  else if (btn.classList.contains('tc-pill'))     playSound('tcPillSelect');
  else if (btn.classList.contains('tc-activity-btn')) playSound('tcActivitySelect');
}

/* ── Meal multi-select ── */
function tcToggleMeal(btn) {
  btn.classList.toggle('active');
  playSound(btn.classList.contains('active') ? 'tcMealToggleOn' : 'tcMealToggleOff');
  tcUpdateAllSummaries(null);
}

/* ── Water drops ── */
function tcSetWater(idx) {
  /* If tapping the last filled drop, decrement; else fill up to idx */
  const drops = document.querySelectorAll('#tc-water-drops .tc-drop');
  const filledCount = document.querySelectorAll('#tc-water-drops .tc-drop.filled').length;
  if (idx === filledCount - 1) {
    /* Decrement */
    tcWaterCount = idx;
  } else {
    tcWaterCount = idx + 1;
  }
  drops.forEach((d, i) => d.classList.toggle('filled', i < tcWaterCount));
  playSound(tcWaterCount > 0 ? 'tcWaterFill' : 'tcWaterEmpty');
  const lbl = document.getElementById('tc-water-label');
  if (lbl) lbl.textContent = `💧 × ${tcWaterCount}`;
  tcUpdateAllSummaries(null);
}

/* ── Sliders ── */
function tcUpdateSlider(id) {
  const input = document.getElementById('tc-' + id);
  const val   = document.getElementById('tc-' + id + '-val');
  if (!input || !val) return;
  const v = parseFloat(input.value);
  val.textContent = v % 1 === 0 ? v + 'h' : v + 'h';
  if (_tcSliderSoundEnabled) {
    clearTimeout(_tcSliderTimer);
    _tcSliderTimer = setTimeout(() => playSound('tcSliderMove'), 80);
  }

  /* Roast label — based on total screen time */
  if (id === 'screen-total' || id === 'screen-gaming') {
    const total = parseFloat(document.getElementById('tc-screen-total')?.value || 0);
    const roast = document.getElementById('tc-roast-label');
    if (roast) {
      if      (total === 0)      roast.textContent = 'respectfully impressive 🫡';
      else if (total <= 2)       roast.textContent = 'healthy decompression ✅';
      else if (total <= 4)       roast.textContent = 'okay we had a day 😅';
      else                       roast.textContent = 'bestie... 💀';
    }
  }
  tcUpdateAllSummaries(null);
}

/* ── Build 12h select options (called once on DOMContentLoaded) ── */
function tcBuildTimeSelects() {
  ['tc-bedtime-h','tc-wake-h'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    for (let h = 1; h <= 12; h++) {
      const o = document.createElement('option');
      o.value = String(h);
      o.textContent = String(h).padStart(2,'0');
      sel.appendChild(o);
    }
  });
  ['tc-bedtime-m','tc-wake-m'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    for (let m = 0; m < 60; m += 5) {
      const o = document.createElement('option');
      o.value = String(m);
      o.textContent = String(m).padStart(2,'0');
      sel.appendChild(o);
    }
  });
}

/* ── Sleep duration calc ── */
function tcCalcSleep() {
  const dur = document.getElementById('tc-sleep-duration');
  if (!dur) return;

  /* Read 12h selects → convert to 24h minutes */
  function readTime(prefix) {
    const hEl    = document.getElementById(prefix + '-h');
    const mEl    = document.getElementById(prefix + '-m');
    const ampmEl = document.getElementById(prefix + '-ampm');
    if (!hEl || !mEl || !ampmEl) return null;
    let h = parseInt(hEl.value, 10);
    const m    = parseInt(mEl.value, 10);
    const ampm = ampmEl.value;
    if (ampm === 'AM') { if (h === 12) h = 0; }
    else               { if (h !== 12) h += 12; }
    return h * 60 + m;
  }

  const bedMins  = readTime('tc-bedtime');
  const wakeMins = readTime('tc-wake');
  if (bedMins === null || wakeMins === null) { dur.textContent = ''; return; }

  let diff = wakeMins - bedMins;
  if (diff < 0) diff += 24 * 60; /* crossed midnight */
  const h = Math.floor(diff / 60), m = diff % 60;
  dur.textContent = `that's ${h}h${m > 0 ? ' ' + m + 'm' : ''}`;
}

/* ── Get 24h "HH:MM" string from 12h selects (for storage) ── */
function tcGetTimeValue(prefix) {
  const hEl    = document.getElementById(prefix + '-h');
  const mEl    = document.getElementById(prefix + '-m');
  const ampmEl = document.getElementById(prefix + '-ampm');
  if (!hEl || !mEl || !ampmEl) return '';
  let h = parseInt(hEl.value, 10);
  const m    = parseInt(mEl.value, 10);
  const ampm = ampmEl.value;
  if (ampm === 'AM') { if (h === 12) h = 0; }
  else               { if (h !== 12) h += 12; }
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

/* ── Set 12h selects from a "HH:MM" string (for populate) ── */
function tcSetTimeValue(prefix, hhmm) {
  if (!hhmm) return;
  const [hh, mm] = hhmm.split(':').map(Number);
  let h    = hh % 12 || 12;
  const ampm = hh < 12 ? 'AM' : 'PM';
  /* Round minutes to nearest 5 for the select options */
  const m5 = Math.round(mm / 5) * 5 % 60;
  const hEl    = document.getElementById(prefix + '-h');
  const mEl    = document.getElementById(prefix + '-m');
  const ampmEl = document.getElementById(prefix + '-ampm');
  if (hEl)    hEl.value    = String(h);
  if (mEl)    mEl.value    = String(m5);
  if (ampmEl) ampmEl.value = ampm;
}

/* ── Mood note char counter ── */
function tcNoteCounter() {
  const ta  = document.getElementById('tc-mood-note');
  const ctr = document.getElementById('tc-char-count');
  if (ta && ctr) ctr.textContent = `${ta.value.length} / 120`;
}

/* ── Grind report ── */
function tcRenderGrindReport() {
  const body  = document.getElementById('tc-receipt-body');
  if (!body) return;
  const today = new Date().toISOString().split('T')[0];
  const pomo  = Store.getPomoSettings();
  const sessions = (pomo.sessionDate === today) ? (pomo.sessions || 0) : 0;
  const exams = Store.getExams();
  const upcoming = exams.filter(e => {
    const d = daysUntil(e.date);
    return d >= 0 && d <= 3;
  });
  let html = `<div class="tc-receipt-row"><span>today's receipts 🧾</span></div>
    <div class="tc-receipt-row"><span>🍅 pomodoros done</span><strong>${sessions}</strong></div>`;
  if (upcoming.length === 0) {
    html += `<div class="tc-receipt-row"><span>📅 no exams in 3 days</span><strong>✅</strong></div>`;
  } else {
    upcoming.forEach(ex => {
      const t = Store.getTracker(ex.id);
      const topics = t.topics || [];
      const done   = topics.filter(tp => tp.done).length;
      const pct    = topics.length ? Math.round((done / topics.length) * 100) : (t.manualProgress || 0);
      const d      = daysUntil(ex.date);
      html += `<div class="tc-receipt-row"><span>📅 ${esc(ex.subject)}</span><strong>${d === 0 ? 'today!' : 'in ' + d + 'd'}</strong></div>
               <div class="tc-receipt-row"><span>📈 progress</span><strong>${pct}%</strong></div>`;
    });
  }
  body.innerHTML = html;
  /* Grind summary */
  const sum = document.getElementById('tc-summary-grind');
  if (sum) sum.textContent = `${sessions} 🍅 • ${upcoming.length} exam${upcoming.length !== 1 ? 's' : ''} soon`;
}

/* ── Summaries (collapsed header) ── */
function tcUpdateAllSummaries(log) {
  /* Sleep */
  const sleepRatingEmojis = ['💀','😵','😐','😌','🥰'];
  const sleepActive = document.querySelector('#tc-sleep-rating .tc-emoji-btn.active');
  
  const bedtime = tcGetTimeValue('tc-bedtime');
  const wake    = tcGetTimeValue('tc-wake');
  let sleepSum = 'not logged yet';
  if (sleepActive || bedtime) {
    let parts = [];
    if (bedtime && wake) {
      let [bh,bm] = bedtime.split(':').map(Number);
      let [wh,wm] = wake.split(':').map(Number);
      let mins = (wh*60+wm)-(bh*60+bm); if(mins<0) mins+=1440;
      parts.push(`slept ${Math.floor(mins/60)}h${mins%60?mins%60+'m':''}`);
    }
    if (sleepActive) parts.push(sleepRatingEmojis[+sleepActive.dataset.val]);
    sleepSum = parts.join(' ') || 'not logged yet';
  }
  const ss = document.getElementById('tc-summary-sleep');
  if (ss) ss.textContent = sleepSum;

  /* Activity */
  const actActive = document.querySelector('#tc-activity-type .tc-activity-btn.active');
  const durActive = document.querySelector('#tc-activity-duration .tc-pill.active');
  let actSum = 'not logged yet';
  if (actActive) {
    actSum = actActive.dataset.val === 'couch'
      ? 'full couch mode 🛋️'
      : `${durActive ? durActive.dataset.val : ''} ${actActive.textContent.trim()}`.trim();
  }
  const as = document.getElementById('tc-summary-activity');
  if (as) as.textContent = actSum;

  /* Screen */
  const st = parseFloat(document.getElementById('tc-screen-total')?.value || 0);
  const sg = parseFloat(document.getElementById('tc-screen-gaming')?.value || 0);
  const screenSum = (st > 0 || sg > 0) ? `${st}h screen • ${sg}h gaming` : 'not logged yet';
  const sc = document.getElementById('tc-summary-screen');
  if (sc) sc.textContent = screenSum;

  /* Food */
  const activeMeals = document.querySelectorAll('#tc-meals .tc-meal-btn.active').length;
  const foodSum = activeMeals > 0 ? `${activeMeals} meals • 💧×${tcWaterCount}` : 'not logged yet';
  const fs = document.getElementById('tc-summary-food');
  if (fs) fs.textContent = foodSum;

  /* Mood */
  const moodEmojis = ['😭','😤','😶','🫠','😌','🤩'];
  const moodActive   = document.querySelector('#tc-mood-emoji .tc-emoji-btn.active');
  const stressActive = document.querySelector('#tc-stress .tc-pill.active');
  let moodSum = 'not logged yet';
  if (moodActive || stressActive) {
    const parts = [];
    if (moodActive)   parts.push(moodEmojis[+moodActive.dataset.val]);
    if (stressActive) parts.push(stressActive.dataset.val);
    moodSum = parts.join(' ');
  }
  const ms = document.getElementById('tc-summary-mood');
  if (ms) ms.textContent = moodSum;
}

/* ── Reset UI to blank ── */
function tcResetUI() {
  /* Deselect all buttons */
  document.querySelectorAll('#takecare .tc-emoji-btn, #takecare .tc-pill, #takecare .tc-activity-btn, #takecare .tc-meal-btn')
    .forEach(b => b.classList.remove('active'));
  /* Sliders */
  ['tc-screen-total','tc-screen-gaming'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = 0; }
  });
  document.getElementById('tc-screen-total-val') && (document.getElementById('tc-screen-total-val').textContent = '0h');
  document.getElementById('tc-screen-gaming-val') && (document.getElementById('tc-screen-gaming-val').textContent = '0h');
  document.getElementById('tc-roast-label') && (document.getElementById('tc-roast-label').textContent = 'respectfully impressive 🫡');
  /* Time inputs */
  ['tc-bedtime','tc-wake'].forEach(prefix => {
    const hEl = document.getElementById(prefix + '-h');
    const mEl = document.getElementById(prefix + '-m');
    const amEl = document.getElementById(prefix + '-ampm');
    if (hEl) hEl.value = '12';
    if (mEl) mEl.value = '0';
    if (amEl) amEl.value = 'AM';
  });
  const durEl = document.getElementById('tc-sleep-duration');
  if (durEl) durEl.textContent = '';
  /* Water */
  tcWaterCount = 0;
  document.querySelectorAll('#tc-water-drops .tc-drop').forEach(d => d.classList.remove('filled'));
  document.getElementById('tc-water-label') && (document.getElementById('tc-water-label').textContent = '💧 × 0');
  /* Textarea */
  const ta = document.getElementById('tc-mood-note');
  if (ta) ta.value = '';
  document.getElementById('tc-char-count') && (document.getElementById('tc-char-count').textContent = '0 / 120');
  /* Duration row */
  const dr = document.getElementById('tc-duration-row');
  if (dr) dr.style.display = 'none';
}

/* ── Populate UI from saved log ── */
function tcPopulateUI(log) {
  if (!log) return;

  /* Sleep */
  if (log.sleep) {
    if (log.sleep.rating != null) {
      const btn = document.querySelector(`#tc-sleep-rating .tc-emoji-btn[data-val="${log.sleep.rating}"]`);
      if (btn) btn.classList.add('active');
    }
    if (log.sleep.bedtime) tcSetTimeValue('tc-bedtime', log.sleep.bedtime);
    if (log.sleep.wake)    tcSetTimeValue('tc-wake',    log.sleep.wake);
    tcCalcSleep();
    if (log.sleep.tag) {
      const btn = document.querySelector(`#tc-sleep-tag .tc-pill[data-val="${esc(log.sleep.tag)}"]`);
      if (btn) btn.classList.add('active');
    }
  }

  /* Activity */
  if (log.activity && log.activity.type) {
    const btn = document.querySelector(`#tc-activity-type .tc-activity-btn[data-val="${log.activity.type}"]`);
    if (btn) {
      btn.classList.add('active');
      const dr = document.getElementById('tc-duration-row');
      if (dr) dr.style.display = log.activity.type === 'couch' ? 'none' : '';
    }
    if (log.activity.duration) {
      const db = document.querySelector(`#tc-activity-duration .tc-pill[data-val="${log.activity.duration}"]`);
      if (db) db.classList.add('active');
    }
  }

  /* Screen */
  if (log.screen) {
    const st = document.getElementById('tc-screen-total');
    if (st) { st.value = log.screen.total || 0; tcUpdateSlider('screen-total'); }
    const sg = document.getElementById('tc-screen-gaming');
    if (sg) { sg.value = log.screen.gaming || 0; tcUpdateSlider('screen-gaming'); }
  }

  /* Food */
  if (log.food) {
    (log.food.meals || []).forEach(meal => {
      const btn = document.querySelector(`#tc-meals .tc-meal-btn[data-val="${meal}"]`);
      if (btn) btn.classList.add('active');
    });
    tcWaterCount = log.food.water || 0;
    document.querySelectorAll('#tc-water-drops .tc-drop').forEach((d,i) => d.classList.toggle('filled', i < tcWaterCount));
    const wl = document.getElementById('tc-water-label');
    if (wl) wl.textContent = `💧 × ${tcWaterCount}`;
    if (log.food.rating) {
      const btn = document.querySelector(`#tc-food-rating .tc-pill[data-val="${log.food.rating}"]`);
      if (btn) btn.classList.add('active');
    }
  }

  /* Mood */
  if (log.mood) {
    if (log.mood.emoji != null) {
      const btn = document.querySelector(`#tc-mood-emoji .tc-emoji-btn[data-val="${log.mood.emoji}"]`);
      if (btn) btn.classList.add('active');
    }
    if (log.mood.stress) {
      const btn = document.querySelector(`#tc-stress .tc-pill[data-val="${log.mood.stress}"]`);
      if (btn) btn.classList.add('active');
    }
    const ta = document.getElementById('tc-mood-note');
    if (ta && log.mood.note) { ta.value = log.mood.note; tcNoteCounter(); }
  }
}

/* ── Set read-only ── */
function tcSetReadOnly(readonly) {
  document.querySelectorAll(
    '#takecare .tc-emoji-btn, #takecare .tc-pill, #takecare .tc-activity-btn, ' +
    '#takecare .tc-meal-btn, #takecare .tc-drop, #takecare .tc-slider, ' +
    '#takecare .tc-time-input, #takecare .tc-textarea'
  ).forEach(el => { el.disabled = readonly; });
}

/* ── Save ── */
function tcSave() {
  const today = new Date().toISOString().split('T')[0];
  if (tcCurrentDate !== today) return;

  const sleepRatingBtn  = document.querySelector('#tc-sleep-rating .tc-emoji-btn.active');
  const sleepTagBtn     = document.querySelector('#tc-sleep-tag .tc-pill.active');
  const actTypeBtn      = document.querySelector('#tc-activity-type .tc-activity-btn.active');
  const actDurBtn       = document.querySelector('#tc-activity-duration .tc-pill.active');
  const foodRatingBtn   = document.querySelector('#tc-food-rating .tc-pill.active');
  const moodEmojiBtn    = document.querySelector('#tc-mood-emoji .tc-emoji-btn.active');
  const stressBtn       = document.querySelector('#tc-stress .tc-pill.active');
  const meals           = [...document.querySelectorAll('#tc-meals .tc-meal-btn.active')].map(b => b.dataset.val);

  const log = {
    sleep: {
      rating:  sleepRatingBtn  ? +sleepRatingBtn.dataset.val  : null,
      bedtime: tcGetTimeValue('tc-bedtime'),
      wake:    tcGetTimeValue('tc-wake'),
      tag:     sleepTagBtn     ? sleepTagBtn.dataset.val      : '',
    },
    activity: {
      type:     actTypeBtn  ? actTypeBtn.dataset.val  : '',
      duration: actDurBtn   ? actDurBtn.dataset.val   : '',
    },
    screen: {
      total:  parseFloat(document.getElementById('tc-screen-total')?.value  || 0),
      gaming: parseFloat(document.getElementById('tc-screen-gaming')?.value || 0),
    },
    food: {
      meals,
      water:  tcWaterCount,
      rating: foodRatingBtn ? foodRatingBtn.dataset.val : '',
    },
    mood: {
      emoji:  moodEmojiBtn ? +moodEmojiBtn.dataset.val : null,
      stress: stressBtn    ? stressBtn.dataset.val     : '',
      note:   document.getElementById('tc-mood-note')?.value.trim() || '',
    },
    savedAt: Date.now(),
  };

  const all = Store.getTakeCare();
  all[today] = log;
  Store.saveTakeCare(all);

  tcRenderVibeCard(log);
  tcUpdateAllSummaries(log);
  tcRenderWeekly();
  showToast('vibe saved 🌿', 'success');
  playSound('tcVibeSaved');
}

/* ── Weekly snapshot ── */
function tcRenderWeekly() {
  const grid = document.getElementById('tc-weekly-grid');
  const line = document.getElementById('tc-weekly-line');
  if (!grid || !line) return;
  const all  = Store.getTakeCare();
  const today = new Date();

  let totalSleep = 0, sleepDays = 0;
  let movedDays = 0;
  let moodCounts = [0,0,0,0,0,0];
  let totalScreen = 0, screenDays = 0;
  let daysLogged = 0;
  let bestDay = '', bestScore = -1;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const log = all[key];
    if (!log) continue;
    daysLogged++;

    /* Sleep hours */
    if (log.sleep && log.sleep.bedtime && log.sleep.wake) {
      let [bh,bm] = log.sleep.bedtime.split(':').map(Number);
      let [wh,wm] = log.sleep.wake.split(':').map(Number);
      let mins = (wh*60+wm)-(bh*60+bm); if(mins<0) mins+=1440;
      totalSleep += mins / 60;
      sleepDays++;
    }
    if (log.activity && log.activity.type && log.activity.type !== 'couch') movedDays++;
    if (log.mood && log.mood.emoji != null) moodCounts[log.mood.emoji]++;
    if (log.screen && log.screen.total != null) { totalScreen += log.screen.total; screenDays++; }

    const s = tcVibeScore(log);
    if (s > bestScore) { bestScore = s; bestDay = d.toLocaleDateString('en-US', { weekday:'long' }); }
  }

  const avgSleep   = sleepDays  ? +(totalSleep / sleepDays).toFixed(1)   : null;
  const avgScreen  = screenDays ? +(totalScreen / screenDays).toFixed(1) : null;
  const moodEmojis = ['😭','😤','😶','🫠','😌','🤩'];
  const topMoodIdx = moodCounts.indexOf(Math.max(...moodCounts));
  const topMood    = Math.max(...moodCounts) > 0 ? moodEmojis[topMoodIdx] : '—';

  const stats = [
    { label: 'avg sleep',       val: avgSleep  != null ? avgSleep + 'h'  : '—' },
    { label: 'days you moved',  val: `${movedDays} / 7` },
    { label: 'most common mood',val: topMood },
    { label: 'avg rot time',    val: avgScreen != null ? avgScreen + 'h' : '—' },
    { label: 'days logged',     val: `${daysLogged} / 7` },
    { label: 'best day',        val: bestDay || '—' },
  ];

  grid.innerHTML = stats.map(s => `
    <div class="tc-weekly-stat">
      <div class="tc-weekly-stat-label">${s.label}</div>
      <div class="tc-weekly-stat-val">${s.val}</div>
    </div>`).join('');

  /* Closing line */
  const rotAvg = avgScreen || 0;
  let closingLine = 'keep showing up for yourself 🌱';
  if      (daysLogged === 0)                          closingLine = 'no data yet — log your first day 🌱';
  else if (daysLogged <= 2)                           closingLine = 'hard to track a vibe you don\'t log. try tomorrow 🌱';
  else if (avgSleep != null && avgSleep > 7 && daysLogged >= 5) closingLine = 'you slept well and stayed consistent. lowkey thriving 🌿';
  else if (avgSleep != null && avgSleep < 5)          closingLine = 'bestie please sleep more 😭 your brain is begging';
  else if (rotAvg > 4)                                closingLine = 'heavy screen week but you still showed up. we don\'t judge 😅';
  else if (movedDays >= 5)                            closingLine = 'moving 5+ days? lowkey athlete era 🏃';
  else if (movedDays === 0)                           closingLine = 'zero movement this week — your couch misses you (and so does the outdoors) 🛋️';
  else if (topMoodIdx >= 4 && daysLogged >= 4)        closingLine = 'mostly good vibes this week. we see you thriving 🌸';
  else if (topMoodIdx <= 1 && daysLogged >= 4)        closingLine = 'rough week energy 🌧️ it happens. tomorrow is a fresh page';
  else if (daysLogged === 7)                          closingLine = '7 days logged in a row 🔥 you\'re actually built different';
  else if (avgSleep != null && avgSleep >= 7 && movedDays >= 3) closingLine = 'sleep + movement combo? your brain is eating well 🧠';

  line.textContent = closingLine;
}