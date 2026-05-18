/* ============================================================
   EXAMIA — notepad.js  v2  (FIXED)
   ════════════════════════════════════════════════════════════
   Add before </body> in index.html, after script.js:
     <script src="notepad.js" defer></script>

   KEY FIXES vs v1
   ────────────────────────────────────────────────────────────
   1. CURSOR / FOCUS
      toolbarMousedown() calls event.preventDefault() on every
      toolbar interaction so the editor NEVER loses its caret
      or selection when a button is clicked.

   2. FORMATBLOCK (text type selection)
      document.execCommand('formatBlock') requires the tag
      wrapped in angle brackets on some browsers:  '<h1>'
      We always pass the canonical form and normalise the
      queryCommandValue response for the dropdown refresh.

   3. FONT COLOUR
      Uses preset colour swatches instead of a bare
      <input type="color">, with a "custom" escape hatch.
      applyColor(null) removes colour (foreColor → inherit).

   4. MOBILE / RESPONSIVE
      • The overlays use the existing .modal-overlay class
        (z-index 300) — no custom z-index that could block
        the sidebar or hamburger menu.
      • body.overflow = 'hidden' is set/cleared correctly.
      • navigate('notepad') is wired so renderList() fires.

   5. DASHBOARD BLEED-THROUGH
      The section is hidden via CSS display:none when not active;
      contenteditable events are already scoped to the modal which
      is also display:none — no events bubble to the dashboard.

   6. AUTOSAVE + SAVE STATUS
      Autosaves silently 2.5 s after last keystroke.
      Indicator turns gold "● Unsaved" while dirty, green
      "✓ Saved" after save — no text mutation that breaks layout.
   ============================================================ */

'use strict';

const NP = (() => {

  /* ── Storage ─────────────────────────────────────────────── */
  const LS_KEY = 'examia_notes';

  function getNotes() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch { return []; }
  }
  function saveNotes(arr) {
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  }

  /* ── Internal state ──────────────────────────────────────── */
  let _editingId     = null;   // null = creating new note
  let _filterTag     = 'all';
  let _autoSaveTimer = null;
  let _dirty         = false;
  let _savedRange    = null;   // saved Selection before toolbar action

  /* ── Helpers: DOM shortcuts ──────────────────────────────── */
  const $  = id => document.getElementById(id);
  const ed = () => $('npEditor');

  /* ════════════════════════════════════════════════════════════
     § FOCUS / SELECTION MANAGEMENT
     The single biggest source of bugs in contenteditable editors
     is the toolbar stealing focus. We fix it at the source:
       • toolbarMousedown() is called by every toolbar element's
         onmousedown, and calls preventDefault() so the browser
         does NOT blur the editor.
       • saveRange() / restoreRange() are used for select elements
         (which can't use preventDefault cleanly on all browsers).
  ════════════════════════════════════════════════════════════ */

  function toolbarMousedown(e) {
    // Prevent the toolbar from stealing focus away from the editor
    e.preventDefault();
  }

  function saveRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      _savedRange = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreRange() {
    if (!_savedRange) {
      // No saved range — just focus the editor at end
      const e = ed();
      if (!e) return;
      e.focus();
      const sel = window.getSelection();
      const r   = document.createRange();
      r.selectNodeContents(e);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    const e = ed();
    if (e) e.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedRange);
  }

  /* ════════════════════════════════════════════════════════════
     § EXECCOMMAND WRAPPER
  ════════════════════════════════════════════════════════════ */

  function execFmt(cmd, val) {
    restoreRange();
    document.execCommand(cmd, false, val || null);
    refreshToolbar();
    markDirty();
  }

  /* ── formatBlock ─────────────────────────────────────────────
     Must pass tag in angle brackets for consistent cross-browser
     behaviour. Works in Chrome, Firefox, Safari, Edge.
  ─────────────────────────────────────────────────────────── */
  function applyBlock(tag) {
    restoreRange();
    // formatBlock requires '<tagname>' form
    const t = tag === 'p' ? 'p' : tag;
    document.execCommand('formatBlock', false, `<${t}>`);
    refreshToolbar();
    markDirty();
  }

  /* ── Text colour ─────────────────────────────────────────────
     applyColor(null)  → remove foreground colour (use inherit)
     applyColor('#hex') → apply that colour
  ─────────────────────────────────────────────────────────── */
  function applyColor(hex) {
    restoreRange();
    if (!hex) {
      // Remove colour by setting to the body's default text colour
      document.execCommand('removeFormat', false, null);
    } else {
      document.execCommand('foreColor', false, hex);
    }
    refreshToolbar();
    markDirty();
  }

  /* ════════════════════════════════════════════════════════════
     § TOOLBAR STATE REFRESH
     Called after every formatting action + on mouseup/keyup
     inside the editor.
  ════════════════════════════════════════════════════════════ */

  function refreshToolbar() {
    // Save current selection so toolbar actions can restore it
    saveRange();

    // Inline format active states
    const fmts = [
      ['bold',          'npBoldBtn'],
      ['italic',        'npItalicBtn'],
      ['underline',     'npUnderlineBtn'],
      ['strikeThrough', 'npStrikeBtn'],
    ];
    fmts.forEach(([cmd, id]) => {
      const btn = $(id);
      if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });

    // Block type dropdown
    const sel = $('npBlockType');
    if (sel) {
      let block = '';
      try { block = document.queryCommandValue('formatBlock').toLowerCase().replace(/[<>]/g, ''); }
      catch {}
      const map = { h1:'h1', h2:'h2', h3:'h3', p:'p', div:'p', '':'p', normal:'p' };
      sel.value = map[block] || 'p';
    }
  }

  /* ════════════════════════════════════════════════════════════
     § EDITOR EVENT HANDLERS
  ════════════════════════════════════════════════════════════ */

  function onEditorInput() {
    updateWordCount();
    markDirty();
    scheduleAutoSave();
  }

  function onEditorKeydown(e) {
    // Keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b': e.preventDefault(); execFmt('bold');      break;
        case 'i': e.preventDefault(); execFmt('italic');    break;
        case 'u': e.preventDefault(); execFmt('underline'); break;
        case 's': e.preventDefault(); saveNote();           break;
      }
    }
    // Tab → insert 4 spaces instead of focus-shift
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '    ');
    }
  }

  /* ════════════════════════════════════════════════════════════
     § WORD COUNT
  ════════════════════════════════════════════════════════════ */

  function updateWordCount() {
    const el = ed();
    const wc = $('npWordCount');
    if (!el || !wc) return;
    const words = (el.innerText || '').trim().split(/\s+/).filter(Boolean).length;
    wc.textContent = `${words} word${words !== 1 ? 's' : ''}`;
  }

  /* ════════════════════════════════════════════════════════════
     § DIRTY / SAVE STATUS
  ════════════════════════════════════════════════════════════ */

  function markDirty() {
    if (_dirty) return;
    _dirty = true;
    const ind = $('npSaveIndicator');
    if (ind) {
      ind.classList.add('dirty');
      ind.innerHTML = '<i class="fa-solid fa-circle"></i> Unsaved';
    }
  }

  function markClean() {
    _dirty = false;
    const ind = $('npSaveIndicator');
    if (ind) {
      ind.classList.remove('dirty');
      ind.innerHTML = '<i class="fa-solid fa-circle-check"></i> Saved';
    }
  }

  function scheduleAutoSave() {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
      if (_dirty) _persistNote(false);
    }, 2500);
  }

  /* ════════════════════════════════════════════════════════════
     § CORE PERSIST (shared by button-save + autosave)
  ════════════════════════════════════════════════════════════ */

  function _persistNote(showFeedback) {
    const title = ($('npTitleInput')?.value || '').trim();
    const tag   = $('npTagSelect')?.value  || 'Other';
    const html  = ed()?.innerHTML           || '';
    const text  = (ed()?.innerText         || '').trim();

    // Nothing worth saving
    if (!title && !text) { markClean(); return; }

    const notes = getNotes();
    const now   = new Date().toISOString();

    if (_editingId) {
      const idx = notes.findIndex(n => n.id === _editingId);
      if (idx !== -1) {
        notes[idx] = { ...notes[idx], title: title || 'Untitled', tag, html, updatedAt: now };
      }
    } else {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      notes.unshift({ id, title: title || 'Untitled', tag, html, createdAt: now, updatedAt: now });
      _editingId = id;
    }

    saveNotes(notes);
    markClean();
    renderList();

    if (showFeedback) {
      _toast('<i class="fa-solid fa-floppy-disk"></i> Note saved!', 'success');
      _playSound('saved');
      _notify('📝 Note Saved', `"${title || 'Untitled'}" saved to Notepad.`);
    }
  }

  /* ── Public save (button) ────────────────────────────────── */
  function saveNote() { _persistNote(true); }

  /* ════════════════════════════════════════════════════════════
     § OPEN / CLOSE MODAL
  ════════════════════════════════════════════════════════════ */

  function openNew() {
    _editingId = null;
    _dirty     = false;
    clearTimeout(_autoSaveTimer);

    $('npTitleInput').value  = '';
    $('npTagSelect').value   = 'Study';
    ed().innerHTML           = '';

    updateWordCount();
    markClean();
    _openModal();
    setTimeout(() => $('npTitleInput').focus(), 80);
    _playSound('open');
  }

  function openNote(id) {
    const note = getNotes().find(n => n.id === id);
    if (!note) return;

    _editingId = id;
    _dirty     = false;
    clearTimeout(_autoSaveTimer);

    $('npTitleInput').value = note.title || '';
    $('npTagSelect').value  = note.tag   || 'Other';
    ed().innerHTML          = note.html  || '';

    updateWordCount();
    markClean();
    _openModal();
    setTimeout(() => { ed().focus(); refreshToolbar(); }, 80);
    _playSound('open');
  }

  function _openModal() {
    $('npModalOverlay').classList.add('active');
    $('npModal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (_dirty) _persistNote(false);
    clearTimeout(_autoSaveTimer);
    $('npModalOverlay').classList.remove('active');
    $('npModal').classList.remove('active');
    document.body.style.overflow = '';
    _savedRange = null;
    renderList();
    _playSound('close');
  }

  /* ════════════════════════════════════════════════════════════
     § DELETE FLOW
  ════════════════════════════════════════════════════════════ */

  function confirmDelete(id, e) {
    e.stopPropagation();
    const note = getNotes().find(n => n.id === id);
    if (!note) return;
    $('npDeleteTitle').textContent   = `"${note.title || 'Untitled'}"`;
    $('npDeleteConfirmBtn').onclick  = () => _deleteNote(id);
    $('npDeleteOverlay').classList.add('active');
    $('npDeleteModal').classList.add('active');
  }

  function closeDeleteModal() {
    $('npDeleteOverlay').classList.remove('active');
    $('npDeleteModal').classList.remove('active');
  }

  function _deleteNote(id) {
    saveNotes(getNotes().filter(n => n.id !== id));
    closeDeleteModal();
    renderList();
    _playSound('deleted');
    _toast('<i class="fa-solid fa-trash"></i> Note deleted.', 'error');
  }

  /* ════════════════════════════════════════════════════════════
     § TAG FILTER
  ════════════════════════════════════════════════════════════ */

  function filterTag(btn) {
    document.querySelectorAll('.np-tag-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    _filterTag = btn.dataset.tag;
    renderList();
  }

  /* ════════════════════════════════════════════════════════════
     § RENDER NOTE CARDS
  ════════════════════════════════════════════════════════════ */

  function renderList() {
    const grid  = $('npGrid');
    const empty = $('npEmpty');
    if (!grid) return;

    let notes = getNotes();

    if (_filterTag !== 'all') notes = notes.filter(n => n.tag === _filterTag);

    const q = ($('npSearch')?.value || '').trim().toLowerCase();
    if (q) {
      notes = notes.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.html  || '').replace(/<[^>]*>/g, '').toLowerCase().includes(q)
      );
    }

    notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (!notes.length) {
      grid.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    grid.innerHTML = notes.map(note => {
      const preview = (note.html || '').replace(/<[^>]*>/g, '').trim().slice(0, 150);
      const date    = _relTime(note.updatedAt);
      const tc      = _tagColors(note.tag);
      return `
      <div class="np-card" onclick="NP.openNote('${_esc(note.id)}')">
        <div class="np-card-top">
          <div class="np-card-title">${_esc(note.title || 'Untitled')}</div>
          <span class="np-card-tag" style="background:${tc.bg};color:${tc.fg}">${_esc(note.tag || 'Other')}</span>
        </div>
        ${preview ? `<div class="np-card-preview">${_esc(preview)}</div>` : ''}
        <div class="np-card-footer">
          <span class="np-card-date"><i class="fa-regular fa-clock"></i> ${date}</span>
          <div class="np-card-actions">
            <button class="np-card-action-btn" title="Edit"
                    onclick="event.stopPropagation();NP.openNote('${_esc(note.id)}')">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="np-card-action-btn np-del" title="Delete"
                    onclick="NP.confirmDelete('${_esc(note.id)}',event)">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  /* ════════════════════════════════════════════════════════════
     § HELPERS
  ════════════════════════════════════════════════════════════ */

  function _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function _relTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 7)  return `${d}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  }

  function _tagColors(tag) {
    return {
      Study:    { bg:'var(--accent-light)',    fg:'var(--accent)' },
      Revision: { bg:'var(--teal-light)',      fg:'var(--teal-dark)' },
      Ideas:    { bg:'var(--gold-light)',      fg:'var(--gold)' },
      Personal: { bg:'var(--lavender-light)',  fg:'var(--lavender)' },
      Other:    { bg:'var(--surface2)',        fg:'var(--text-soft)' },
    }[tag] || { bg:'var(--surface2)', fg:'var(--text-soft)' };
  }

  /* ── Sound ───────────────────────────────────────────────── */
  function _playSound(kind) {
    if (typeof AudioFX === 'undefined') return;
    try {
      AudioFX.ensure();
      const s = {
        open:    () => AudioFX.beep(523.25, 0.08, 'sine',     0.035),
        close:   () => AudioFX.beep(440,    0.07, 'triangle', 0.03),
        saved:   () => AudioFX.sequence([[523.25,0.09,'sine',0.04],[659.25,0.11,'sine',0.05],[783.99,0.14,'sine',0.05]]),
        deleted: () => AudioFX.sequence([[392,0.10,'triangle',0.04],[311,0.12,'triangle',0.04],[261,0.16,'triangle',0.04]]),
      };
      if (s[kind]) s[kind]();
    } catch {}
  }

  /* ── Local notification via SW ───────────────────────────── */
  function _notify(title, body) {
    if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready.then(reg => {
      reg?.active?.postMessage({
        type: 'LOCAL_NOTIFY',
        title,
        options: {
          body,
          icon:   './icon-192.png',
          badge:  './icon-512.png',
          tag:    'notepad-save',
          silent: true,
          data:   { url: '/index.html#notepad' },
        },
      });
    }).catch(() => {});
  }

  /* ── Toast (delegates to existing showToast in script.js) ── */
  function _toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
  }

  /* ════════════════════════════════════════════════════════════
     § OVERLAY CLICK-OUTSIDE CLOSE
     Attached on init rather than inline onclick to avoid the
     event bubbling weirdness from the previous version.
  ════════════════════════════════════════════════════════════ */

  function _attachOverlayListeners() {
    $('npModalOverlay')?.addEventListener('click', closeModal);
    $('npDeleteOverlay')?.addEventListener('click', closeDeleteModal);
  }

  /* ════════════════════════════════════════════════════════════
     § WIRE INTO navigate() — add 'notepad' case
     We patch the existing navigate() function so renderList()
     is called whenever the Notepad section is activated.
     This fixes the "dashboard shows notepad actions" bug —
     the section is always hidden until navigate('notepad').
  ════════════════════════════════════════════════════════════ */

  function _patchNavigate() {
    if (typeof navigate !== 'function') return;
    const _origNavigate = navigate;
    window.navigate = function(sec) {
      _origNavigate(sec);
      if (sec === 'notepad') renderList();
    };
    // Also wire nav button directly in case navigate is already bound
    document.querySelectorAll('.nav-btn[data-section="notepad"]')
      .forEach(btn => btn.addEventListener('click', () => renderList()));
  }

  /* ════════════════════════════════════════════════════════════
     § INIT
  ════════════════════════════════════════════════════════════ */

  function _init() {
    _attachOverlayListeners();
    _patchNavigate();
    renderList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    // Called from HTML
    openNew,
    openNote,
    closeModal,
    saveNote,
    execFmt,
    applyBlock,
    applyColor,
    onEditorInput,
    onEditorKeydown,
    refreshToolbar,
    filterTag,
    renderList,
    confirmDelete,
    closeDeleteModal,
    markDirty,
    toolbarMousedown,
  };

})();