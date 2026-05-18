/* ============================================================
   EXAMIA — timetable.js  v1
   Self-contained Timetable module.
   Exposes a single global: TT

   Features
   ────────
   • Day-view timeline  (scrollable hour grid)
   • Week-view grid     (7-day compact overview)
   • Add / Edit / Delete time blocks
   • Block colours, categories, notes, repeat (daily/weekdays/weekly)
   • Reminder notifications via SW LOCAL_NOTIFY
   • playSound() with Web Audio API tones (chime / bell / ping)
   • All data in localStorage key: 'examia_timetable'
   • Zero coupling with script.js / notepad.js / notifications.js
   ============================================================ */

'use strict';

const TT = (() => {

  /* ── Storage key ── */
  const LS_KEY = 'examia_timetable';

  /* ── State ── */
  let _blocks      = [];   // all saved blocks
  let _editId      = null; // id of block being edited (null = new)
  let _view        = 'day';
  let _viewDate    = _todayStr(); // YYYY-MM-DD currently viewed
  let _weekStart   = null;  // Monday of current week view
  let _popupBlock  = null;  // currently open popup block
  let _reminderMap = {};    // { blockId: timeoutId } for upcoming reminders
  let _nowLineRaf  = null;  // requestAnimationFrame handle for now-line

  /* ── Hours shown (06:00 – 23:00) ── */
  const HOUR_START = 6;
  const HOUR_END   = 23;
  const HOUR_PX    = 60;   // pixels per hour in day view

  /* ── Days ── */
  const DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DAY_FULL   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_NAMES= ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];


  /* ════════════════════════════════════════
     § PERSISTENCE
  ════════════════════════════════════════ */

  function _load() {
    try { _blocks = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch { _blocks = []; }
  }

  function _save() {
    localStorage.setItem(LS_KEY, JSON.stringify(_blocks));
  }


  /* ════════════════════════════════════════
     § UTILITIES
  ════════════════════════════════════════ */

  function _todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /** Parse "HH:MM" → minutes from midnight */
  function _toMin(t) {
    if (!t) return NaN;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  /** Minutes from midnight → "H:MM AM/PM" */
  function _fmtTime(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    const dt = new Date(); dt.setHours(h, m, 0, 0);
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  /** Duration in minutes → "Xh Ym" */
  function _fmtDur(mins) {
    if (!mins || mins <= 0) return '';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
  }

  /** "YYYY-MM-DD" → Date (local midnight) */
  function _parseDate(s) { return new Date(s + 'T00:00:00'); }

  /** Date → "YYYY-MM-DD" */
  function _dateStr(d) { return d.toISOString().split('T')[0]; }

  /** Monday of the week containing dateStr */
  function _weekMonday(dateStr) {
    const d = _parseDate(dateStr);
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0) ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return _dateStr(d);
  }

  function _addDays(dateStr, n) {
    const d = _parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return _dateStr(d);
  }

  function _isSameWeekday(dateStr, dow) {
    return _parseDate(dateStr).getDay() === dow;
  }

  function _isWeekday(dateStr) {
    const d = _parseDate(dateStr).getDay();
    return d >= 1 && d <= 5;
  }

  /**
   * Expand a block's repeat pattern into all effective dates
   * for a given range [fromStr, toStr].
   * Returns array of {block, date} objects.
   */
  function _expandBlock(block, fromStr, toStr) {
    const from  = _parseDate(fromStr);
    const to    = _parseDate(toStr);
    const orig  = _parseDate(block.date);
    const results = [];

    let cur = new Date(orig);
    while (cur <= to) {
      if (cur >= from) {
        results.push({ block, date: _dateStr(cur) });
      }
      if (block.repeat === 'none' || !block.repeat) break;
      if (block.repeat === 'daily')    cur.setDate(cur.getDate() + 1);
      else if (block.repeat === 'weekly')   cur.setDate(cur.getDate() + 7);
      else if (block.repeat === 'weekdays') {
        do { cur.setDate(cur.getDate() + 1); } while (!_isWeekday(_dateStr(cur)));
      } else break;
    }
    return results;
  }

  /** All blocks visible on a given date */
  function _blocksOnDate(dateStr) {
    const result = [];
    for (const b of _blocks) {
      const expanded = _expandBlock(b, dateStr, dateStr);
      if (expanded.length) result.push(b);
    }
    return result.sort((a, b) => _toMin(a.startTime) - _toMin(b.startTime));
  }


  /* ════════════════════════════════════════
     § SOUND  (Web Audio API, no files)
  ════════════════════════════════════════ */

  let _audioCtx = null;

  function _getAudioCtx() {
    if (!_audioCtx) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return null; }
    }
    return _audioCtx;
  }

  /**
   * playSound(type)
   * type: 'chime' | 'bell' | 'ping' | 'none'
   * Uses Web Audio API — no external files needed.
   */
  function playSound(type = 'chime') {
    const ctx = _getAudioCtx();
    if (!ctx || type === 'none') return;

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;

    if (type === 'chime') {
      // Three rising tones: C5 E5 G5
      [[523.25, 0], [659.25, 0.18], [783.99, 0.36]].forEach(([freq, delay]) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + delay);
        gain.gain.setValueAtTime(0, now + delay);
        gain.gain.linearRampToValueAtTime(0.28, now + delay + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.6);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.65);
      });

    } else if (type === 'bell') {
      // Single rich bell tone with slight detuning
      [440, 880, 1320].forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.22 / (i + 1), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.85);
      });

    } else if (type === 'ping') {
      // Short bright ping
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1047, now); // C6
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.38);
    }
  }


  /* ════════════════════════════════════════
     § NOTIFICATIONS
  ════════════════════════════════════════ */

  /**
   * Send a LOCAL_NOTIFY via service worker (same pattern as notifications.js).
   * Falls back to Notification API directly if SW not ready.
   */
  async function _localNotify(title, options = {}) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const opts = {
      icon:    './icon-192.png',
      badge:   './icon-512.png',
      vibrate: [150, 80, 150],
      ...options,
    };

    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active.postMessage({ type: 'LOCAL_NOTIFY', title, options: opts });
    } catch {
      // SW not available — use Notification directly
      try { new Notification(title, opts); } catch { /* silent */ }
    }
  }

  /**
   * Schedule reminder setTimeout for a single block instance.
   * Clears any existing timeout for that block first.
   */
  /** Schedule a reminder — persists to SW so it fires even when app is closed */
  async function _scheduleReminder(block, dateStr) {
    if (!block.reminder || parseInt(block.reminder) === 0) return;

    const reminderMin = parseInt(block.reminder);
    const [sh, sm]    = block.startTime.split(':').map(Number);
    const fireTime    = new Date(dateStr + 'T00:00:00');
    fireTime.setHours(sh, sm - reminderMin, 0, 0);

    const msUntil = fireTime.getTime() - Date.now();
    if (msUntil <= 0) return; // already passed

    const alarm = {
      tag:    'tt-reminder-' + block.id + '-' + dateStr,
      fireAt: fireTime.getTime(),
      title:  `${_catIcon(block.category)} Upcoming: ${block.subject}`,
      body:   `Starts at ${_fmtTime(block.startTime)} · ${_fmtDur(_toMin(block.endTime) - _toMin(block.startTime))} long`,
      url:    '/index.html#timetable',
    };

    try {
      const reg = await navigator.serviceWorker.ready;
      reg.active.postMessage({ type: 'SCHEDULE_ALARM', alarm });
    } catch { /* SW not ready — silently skip */ }
  }

  /** (Re)schedule reminders for all future blocks */
  function _scheduleAllReminders() {
    // Clear existing
    Object.values(_reminderMap).forEach(clearTimeout);
    _reminderMap = {};

    const today = _todayStr();
    // Look 7 days ahead
    for (let i = 0; i < 7; i++) {
      const d = _addDays(today, i);
      for (const b of _blocksOnDate(d)) {
        if (!b.done) _scheduleReminder(b, d);
      }
    }
  }

  function _catIcon(cat) {
    const map = {
      Study: '📖', Revision: '🔁', Assignment: '✏️', Project: '🗂️',
      Practice: '🏋️', Break: '☕', Personal: '🌿', Other: '📌',
    };
    return map[cat] || '📌';
  }


  /* ════════════════════════════════════════
     § MODAL
  ════════════════════════════════════════ */

  function openModal(id = null) {
    _editId = id;
    const modal   = document.getElementById('ttModal');
    const overlay = document.getElementById('ttModalOverlay');
    const title   = document.getElementById('ttModalTitle');

    // Reset form
    document.getElementById('ttSubject').value  = '';
    document.getElementById('ttCategory').value = 'Study';
    document.getElementById('ttDate').value     = _viewDate;
    document.getElementById('ttStart').value    = '';
    document.getElementById('ttEnd').value      = '';
    document.getElementById('ttReminder').value = '10';
    document.getElementById('ttSound').value    = 'chime';
    document.getElementById('ttNotes').value    = '';
    document.getElementById('ttRepeat').value   = 'none';
    document.getElementById('ttColor').value    = '#5BA4CF';
    document.getElementById('ttSubjectErr').style.display = 'none';
    document.getElementById('ttTimeErr').style.display    = 'none';

    // Reset colour swatches
    document.querySelectorAll('.tt-color-swatch').forEach(s => s.classList.remove('active'));
    const firstSwatch = document.querySelector('.tt-color-swatch[data-color="#5BA4CF"]');
    if (firstSwatch) firstSwatch.classList.add('active');

    if (id) {
      // Populate for edit
      const b = _blocks.find(x => x.id === id);
      if (b) {
        title.innerHTML = '<i class="fa-solid fa-pen-to-square" style="color:var(--accent)"></i> Edit Block';
        document.getElementById('ttSubject').value  = b.subject;
        document.getElementById('ttCategory').value = b.category || 'Study';
        document.getElementById('ttDate').value     = b.date;
        document.getElementById('ttStart').value    = b.startTime;
        document.getElementById('ttEnd').value      = b.endTime;
        document.getElementById('ttReminder').value = b.reminder || '10';
        document.getElementById('ttSound').value    = b.sound || 'chime';
        document.getElementById('ttNotes').value    = b.notes || '';
        document.getElementById('ttRepeat').value   = b.repeat || 'none';
        document.getElementById('ttColor').value    = b.color || '#5BA4CF';

        // Set colour swatch
        document.querySelectorAll('.tt-color-swatch').forEach(s => {
          s.classList.toggle('active', s.dataset.color === (b.color || '#5BA4CF'));
        });
      }
    } else {
      title.innerHTML = '<i class="fa-solid fa-calendar-plus" style="color:var(--accent)"></i> Add Time Block';
    }

    overlay.classList.add('active');
    modal.classList.add('active');
    document.getElementById('ttSubject').focus();
  }

  function closeModal() {
    document.getElementById('ttModal').classList.remove('active');
    document.getElementById('ttModalOverlay').classList.remove('active');
    _editId = null;
  }

  function liveValidate() {
    const sub   = document.getElementById('ttSubject').value.trim();
    const start = document.getElementById('ttStart').value;
    const end   = document.getElementById('ttEnd').value;

    document.getElementById('ttSubjectErr').style.display = sub ? 'none' : 'block';

    const timeErr = start && end && _toMin(end) <= _toMin(start);
    document.getElementById('ttTimeErr').style.display = timeErr ? 'block' : 'none';
  }

  function pickColor(hex, btn) {
    document.getElementById('ttColor').value = hex;
    document.querySelectorAll('.tt-color-swatch').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
  }

  function saveBlock() {
    const subject   = document.getElementById('ttSubject').value.trim();
    const category  = document.getElementById('ttCategory').value;
    const date      = document.getElementById('ttDate').value;
    const startTime = document.getElementById('ttStart').value;
    const endTime   = document.getElementById('ttEnd').value;
    const reminder  = document.getElementById('ttReminder').value;
    const sound     = document.getElementById('ttSound').value;
    const notes     = document.getElementById('ttNotes').value.trim();
    const repeat    = document.getElementById('ttRepeat').value;
    const color     = document.getElementById('ttColor').value || '#5BA4CF';

    // Validate
    if (!subject) { document.getElementById('ttSubjectErr').style.display = 'block'; return; }
    if (!date)    { _showToast('Please pick a date.', 'warn'); return; }
    if (!startTime || !endTime) { _showToast('Start and end time are required.', 'warn'); return; }
    if (_toMin(endTime) <= _toMin(startTime)) {
      document.getElementById('ttTimeErr').style.display = 'block'; return;
    }

    if (_editId) {
      const idx = _blocks.findIndex(b => b.id === _editId);
      if (idx !== -1) {
        _blocks[idx] = { ..._blocks[idx], subject, category, date, startTime, endTime,
                         reminder, sound, notes, repeat, color };
      }
      _showToast('Block updated!', 'success');
    } else {
      _blocks.push({ id: _uid(), subject, category, date, startTime, endTime,
                     reminder, sound, notes, repeat, color, done: false,
                     createdAt: new Date().toISOString() });
      _showToast('Block added!', 'success');
    }

    _save();
    _scheduleAllReminders();
    closeModal();
    render();
  }


  /* ════════════════════════════════════════
     § DELETE MODAL
  ════════════════════════════════════════ */

  function _openDeleteModal(id) {
    const b = _blocks.find(x => x.id === id);
    if (!b) return;
    document.getElementById('ttDeleteTitle').textContent = b.subject;
    document.getElementById('ttDeleteOverlay').classList.add('active');
    document.getElementById('ttDeleteModal').classList.add('active');
    document.getElementById('ttDeleteConfirmBtn').onclick = () => _confirmDelete(id);
  }

  function closeDeleteModal() {
    document.getElementById('ttDeleteOverlay').classList.remove('active');
    document.getElementById('ttDeleteModal').classList.remove('active');
  }

  function _confirmDelete(id) {
    _blocks = _blocks.filter(b => b.id !== id);
    _save();
    closeDeleteModal();
    _closePopup();
    _showToast('Block deleted.', 'info');
    _scheduleAllReminders();
    render();
  }


  /* ════════════════════════════════════════
     § BLOCK POPUP
  ════════════════════════════════════════ */

  function _openPopup(blockId, anchorEl) {
    _closePopup();
    const b = _blocks.find(x => x.id === blockId);
    if (!b) return;
    _popupBlock = blockId;

    // Overlay to close on outside click
    const ov = document.createElement('div');
    ov.className = 'tt-popup-overlay';
    ov.id = 'ttPopupOverlay';
    ov.onclick = _closePopup;
    document.body.appendChild(ov);

    // Popup
    const durMin = _toMin(b.endTime) - _toMin(b.startTime);
    const p = document.createElement('div');
    p.className = 'tt-popup';
    p.id = 'ttPopup';
    p.innerHTML = `
      <div class="tt-popup-header">
        <div class="tt-popup-color-dot" style="background:${_esc(b.color || '#5BA4CF')}"></div>
        <div class="tt-popup-title">${_esc(b.subject)}</div>
        <button class="tt-popup-close" onclick="TT._closePopup()" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="tt-popup-meta">
        <span><i class="fa-solid fa-clock"></i>
          ${_fmtTime(b.startTime)} – ${_fmtTime(b.endTime)}
          <span style="color:var(--text-muted);margin-left:.25rem">(${_fmtDur(durMin)})</span>
        </span>
        <span><i class="fa-solid fa-tag"></i> ${_esc(b.category || 'Study')}</span>
        ${b.repeat && b.repeat !== 'none'
          ? `<span><i class="fa-solid fa-rotate"></i> ${_esc(_repeatLabel(b.repeat))}</span>`
          : ''}
        ${b.reminder && b.reminder !== '0'
          ? `<span><i class="fa-solid fa-bell"></i> ${b.reminder} min before</span>`
          : ''}
      </div>
      ${b.notes ? `<div class="tt-popup-notes">${_esc(b.notes)}</div>` : ''}
      <div class="tt-popup-actions">
        <button class="tt-popup-btn ${b.done ? 'tt-popup-btn-edit' : 'tt-popup-btn-done'}"
                onclick="TT.toggleDone('${b.id}')">
          <i class="fa-solid ${b.done ? 'fa-rotate-left' : 'fa-circle-check'}"></i>
          ${b.done ? 'Undo' : 'Mark Done'}
        </button>
        <button class="tt-popup-btn tt-popup-btn-edit" onclick="TT._closePopup();TT.openModal('${b.id}')">
          <i class="fa-solid fa-pen-to-square"></i> Edit
        </button>
        <button class="tt-popup-btn tt-popup-btn-delete" onclick="TT._closePopup();TT._openDeleteModal('${b.id}')">
          <i class="fa-solid fa-trash"></i> Delete
        </button>
      </div>`;

    document.body.appendChild(p);

    // Position popup near anchor
    const rect = anchorEl.getBoundingClientRect();
    const pw = 340;
    let left = rect.left + rect.width / 2 - pw / 2;
    let top  = rect.bottom + 8 + window.scrollY;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    p.style.left = left + 'px';
    p.style.top  = top  + 'px';
  }

  function _closePopup() {
    document.getElementById('ttPopup')?.remove();
    document.getElementById('ttPopupOverlay')?.remove();
    _popupBlock = null;
  }

  function _repeatLabel(r) {
    return { daily: 'Repeats daily', weekdays: 'Repeats weekdays', weekly: 'Repeats weekly' }[r] || '';
  }

  function toggleDone(id) {
    const b = _blocks.find(x => x.id === id);
    if (!b) return;
    b.done = !b.done;
    _save();
    _closePopup();
    if (b.done) playSound('ping');
    render();
  }


  /* ════════════════════════════════════════
     § VIEW SWITCHING
  ════════════════════════════════════════ */

  function setView(v) {
    _view = v;
    document.getElementById('ttDayViewBtn')?.classList.toggle('active', v === 'day');
    document.getElementById('ttWeekViewBtn')?.classList.toggle('active', v === 'week');
    document.getElementById('ttDayNav').style.display   = v === 'day'  ? '' : 'none';
    document.getElementById('ttWeekStrip').style.display = v === 'week' ? '' : 'none';
    if (v === 'week') _weekStart = _weekMonday(_viewDate);
    render();
  }

  function shiftDay(n) {
    _viewDate = _addDays(_viewDate, n);
    render();
  }

  function goToday() {
    _viewDate = _todayStr();
    if (_view === 'week') _weekStart = _weekMonday(_viewDate);
    render();
  }

  function shiftWeek(n) {
    _weekStart = _addDays(_weekStart, n * 7);
    render();
  }


  /* ════════════════════════════════════════
     § RENDER — DAY VIEW
  ════════════════════════════════════════ */

  function _renderDayView() {
    const wrap = document.getElementById('ttTimeline');
    wrap.innerHTML = '';
    document.getElementById('ttTimeline').parentElement.style.display = '';

    // Day label
    const d = _parseDate(_viewDate);
    const isToday = _viewDate === _todayStr();
    document.getElementById('ttDayLabel').textContent =
      isToday ? `Today — ${DAY_FULL[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`
               : `${DAY_FULL[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

    const blocks = _blocksOnDate(_viewDate);

    // Update summary
    _updateSummary(blocks);

    // Empty state
    if (!blocks.length) {
      document.getElementById('ttEmpty').style.display = '';
      document.getElementById('ttTimeline').parentElement.style.display = 'none';
      return;
    }
    document.getElementById('ttEmpty').style.display = 'none';

    // Render hour rows
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      const row  = document.createElement('div');
      row.className = 'tt-hour-row';

      const label = document.createElement('div');
      label.className = 'tt-hour-label';
      label.textContent = h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;

      const slot = document.createElement('div');
      slot.className = 'tt-hour-slot';

      row.appendChild(label);
      row.appendChild(slot);
      wrap.appendChild(row);
    }

    // Place blocks
    blocks.forEach(b => {
      const startMin = _toMin(b.startTime);
      const endMin   = _toMin(b.endTime);
      const durMin   = endMin - startMin;

      if (startMin < HOUR_START * 60 || endMin > (HOUR_END + 1) * 60) return; // outside range

      const topPct  = (startMin - HOUR_START * 60) / 60; // fractional hours from grid top
      const heightPct = durMin / 60;

      const card = document.createElement('div');
      card.className = 'tt-block' + (b.done ? ' tt-done' : '') + (durMin < 40 ? ' tt-short' : '');
      card.style.cssText = `
        top: ${topPct * HOUR_PX}px;
        height: ${Math.max(heightPct * HOUR_PX - 4, 20)}px;
        background: ${b.color || '#5BA4CF'};
      `;
      card.innerHTML = `
        <div class="tt-block-title">${_esc(b.subject)}</div>
        <div class="tt-block-time">${_fmtTime(b.startTime)} – ${_fmtTime(b.endTime)}</div>
        <div class="tt-block-cat">${_esc(b.category || '')}</div>
      `;
      card.onclick = (e) => { e.stopPropagation(); _openPopup(b.id, card); };

      // Place in correct hour slot
      const hourIdx = Math.floor(startMin / 60) - HOUR_START;
      const slots   = wrap.querySelectorAll('.tt-hour-slot');
      if (slots[hourIdx]) slots[hourIdx].style.position = 'relative';

      // Use absolute positioning relative to the whole timeline
      card.style.position = 'absolute';
      const totalTop = topPct * HOUR_PX;
      card.style.top    = totalTop + 'px';
      card.style.height = Math.max(heightPct * HOUR_PX - 4, 22) + 'px';

      // We'll append to the wrap and position absolutely within it
      wrap.style.position = 'relative';
      wrap.appendChild(card);
    });

    // Current-time line (today only)
    if (isToday) _renderNowLine(wrap);
  }

  function _renderNowLine(wrap) {
    cancelAnimationFrame(_nowLineRaf);
    const draw = () => {
      document.querySelector('.tt-now-line')?.remove();
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (nowMin < HOUR_START * 60 || nowMin > (HOUR_END + 1) * 60) return;
      const top = (nowMin - HOUR_START * 60) / 60 * HOUR_PX;
      const line = document.createElement('div');
      line.className = 'tt-now-line';
      line.style.top = top + 'px';
      wrap.appendChild(line);
      _nowLineRaf = setTimeout(draw, 30000); // update every 30s
    };
    draw();
  }


  /* ════════════════════════════════════════
     § RENDER — WEEK VIEW
  ════════════════════════════════════════ */

  function _renderWeekView() {
    if (!_weekStart) _weekStart = _weekMonday(_viewDate);

    const today = _todayStr();
    const wrap  = document.getElementById('ttTimeline');
    wrap.style.position = '';
    wrap.innerHTML = '';

    // Week day header strip
    const dayStrip = document.getElementById('ttWeekDays');
    dayStrip.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const ds   = _addDays(_weekStart, i);
      const d    = _parseDate(ds);
      const isT  = ds === today;
      const isSel = ds === _viewDate;
      const dayBlocks = _blocksOnDate(ds);

      const btn = document.createElement('button');
      btn.className = 'tt-week-day' +
        (isT  ? ' tt-wd-today'    : '') +
        (isSel ? ' tt-wd-selected' : '');
      btn.innerHTML = `
        <span class="tt-week-day-name">${DAY_NAMES[d.getDay()]}</span>
        <span class="tt-week-day-num">${d.getDate()}</span>
        <div class="tt-week-dot-row">
          ${dayBlocks.slice(0,3).map(b =>
            `<span class="tt-week-dot" style="background:${b.color||'#5BA4CF'}"></span>`
          ).join('')}
        </div>`;
      btn.onclick = () => { _viewDate = ds; _renderWeekView(); };
      dayStrip.appendChild(btn);
    }

    // Week date range label
    const wEnd = _addDays(_weekStart, 6);
    const ws   = _parseDate(_weekStart);
    const we   = _parseDate(wEnd);
    document.getElementById('ttDayLabel') && (
      document.getElementById('ttDayLabel').textContent = ''
    );

    // Build week grid
    const gridWrap = document.createElement('div');
    gridWrap.className = 'tt-week-grid-wrap';
    const grid = document.createElement('div');
    grid.className = 'tt-week-grid';
    gridWrap.appendChild(grid);
    wrap.appendChild(gridWrap);

    // Header row
    const corner = document.createElement('div');
    corner.className = 'tt-wg-header-cell';
    corner.textContent = '';
    grid.appendChild(corner);

    for (let i = 0; i < 7; i++) {
      const ds = _addDays(_weekStart, i);
      const d  = _parseDate(ds);
      const cell = document.createElement('div');
      cell.className = 'tt-wg-header-cell' + (ds === today ? ' tt-wg-today' : '');
      cell.innerHTML = `${DAY_NAMES[d.getDay()]}<br><strong>${d.getDate()}</strong>`;
      grid.appendChild(cell);
    }

    // Hour rows
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      const label = document.createElement('div');
      label.className = 'tt-wg-label';
      label.textContent = h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h-12} PM`;
      grid.appendChild(label);

      for (let i = 0; i < 7; i++) {
        const ds = _addDays(_weekStart, i);
        const cell = document.createElement('div');
        cell.className = 'tt-wg-cell';

        // Add chips for blocks starting in this hour
        const dayBlocks = _blocksOnDate(ds).filter(b => {
          const sm = _toMin(b.startTime);
          return Math.floor(sm / 60) === h;
        });

        dayBlocks.forEach(b => {
          const chip = document.createElement('div');
          chip.className = 'tt-wg-chip' + (b.done ? ' tt-done' : '');
          chip.style.background = b.color || '#5BA4CF';
          chip.textContent = b.subject;
          chip.title = `${b.subject} · ${_fmtTime(b.startTime)}–${_fmtTime(b.endTime)}`;
          chip.onclick = () => { _viewDate = ds; setView('day'); };
          cell.appendChild(chip);
        });

        grid.appendChild(cell);
      }
    }

    // Summary across whole week
    let allBlocks = [];
    for (let i = 0; i < 7; i++) allBlocks = allBlocks.concat(_blocksOnDate(_addDays(_weekStart, i)));
    _updateSummary(allBlocks);

    // Empty state
    if (!allBlocks.length) {
      document.getElementById('ttEmpty').style.display = '';
      gridWrap.style.display = 'none';
    } else {
      document.getElementById('ttEmpty').style.display = 'none';
      gridWrap.style.display = '';
    }
  }


  /* ════════════════════════════════════════
     § SUMMARY PILLS
  ════════════════════════════════════════ */

  function _updateSummary(blocks) {
    let totalMins = 0, done = 0;
    blocks.forEach(b => {
      totalMins += _toMin(b.endTime) - _toMin(b.startTime);
      if (b.done) done++;
    });
    const h = Math.floor(totalMins / 60), m = totalMins % 60;
    document.getElementById('ttTotalHours').textContent =
      h && m ? `${h}h ${m}m` : h ? `${h}h` : m ? `${m}m` : '0m';
    document.getElementById('ttDoneCount').textContent    = done;
    document.getElementById('ttPendingCount').textContent = blocks.length - done;
  }


  /* ════════════════════════════════════════
     § MASTER RENDER
  ════════════════════════════════════════ */

  function render() {
    _closePopup();
    if (_view === 'day') _renderDayView();
    else                 _renderWeekView();
  }


  /* ════════════════════════════════════════
     § TOAST  (reuses existing #toast if present, else inline)
  ════════════════════════════════════════ */

  let _toastTimer = null;

  function _showToast(msg, type = 'info') {
    // Try to reuse the global toast element from script.js
    const t = document.getElementById('toast');
    if (t) {
      t.textContent = msg;
      t.className   = 'toast show';
      if (type === 'success') t.style.background = 'var(--success)';
      else if (type === 'warn') t.style.background = 'var(--warning)';
      else t.style.background = '';
      clearTimeout(_toastTimer);
      _toastTimer = setTimeout(() => {
        t.className = 'toast';
        t.style.background = '';
      }, 2800);
    } else {
      console.info('[TT]', msg);
    }
  }


  /* ════════════════════════════════════════
     § INIT
  ════════════════════════════════════════ */

  function init() {
    _load();
    _weekStart = _weekMonday(_viewDate);
    _scheduleAllReminders();

    // Render when the timetable section becomes visible
    // (reuse the existing navigate() global or observe active class)
    const section = document.getElementById('timetable');
    if (!section) return;

    // MutationObserver watches for 'active' class added by script.js's navigate()
    const obs = new MutationObserver(() => {
      if (section.classList.contains('active')) render();
    });
    obs.observe(section, { attributes: true, attributeFilter: ['class'] });

    // Also render if already active on init
    if (section.classList.contains('active')) render();

    console.info('[TT] Timetable module initialised.');
  }


  /* ════════════════════════════════════════
     § PUBLIC API
  ════════════════════════════════════════ */
  return {
    init,
    render,
    setView,
    shiftDay,
    shiftWeek,
    goToday,
    openModal,
    closeModal,
    liveValidate,
    pickColor,
    saveBlock,
    closeDeleteModal,
    toggleDone,
    playSound,
    // exposed for popup inline HTML
    _closePopup,
    _openDeleteModal,
  };

})();

/* Auto-init when DOM is ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', TT.init);
} else {
  TT.init();
}