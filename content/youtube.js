(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;

  const STORAGE_KEY = "ytmarker:db:v1";
  const PANEL_ID = "ytm-panel";
  const BUTTON_ID = "ytm-button";
  const DOTS_ID = "ytm-dots";

  const state = {
    videoId: null,
    db: null,
    open: false,
    selectedNoteId: null,
  };

  function getVideoIdFromUrl(href) {
    try {
      const u = new URL(href);
      if (u.hostname.endsWith("youtube.com")) {
        if (u.pathname === "/watch") return u.searchParams.get("v");
        const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/);
        if (m) return m[2];
      }
      if (u.hostname === "youtu.be") return u.pathname.slice(1);
    } catch {}
    return null;
  }

  const PALETTE = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308",
    "#84cc16", "#22c55e", "#14b8a6", "#06b6d4",
    "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
  ];

  async function loadDb() {
    const out = await api.storage.local.get(STORAGE_KEY);
    const db = out[STORAGE_KEY] || {
      videos: {},
      folders: [],
      version: 1,
    };
    db.tagPalette = db.tagPalette || {};
    db.settings = db.settings || { quickActions: "hover" };
    db.videoFolders = db.videoFolders || [];
    return db;
  }

  function pickColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function tagColor(db, name) {
    return (db.tagPalette && db.tagPalette[name]) || pickColor(name);
  }

  async function saveDb(db) {
    db.updatedAt = Date.now();
    await api.storage.local.set({ [STORAGE_KEY]: db });
  }

  function ensureVideo(db, videoId) {
    if (!db.videos[videoId]) {
      db.videos[videoId] = {
        videoId,
        title: document.title.replace(/ - YouTube$/, ""),
        channel: getChannelName(),
        url: location.href,
        notes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      db.videos[videoId].title =
        document.title.replace(/ - YouTube$/, "") || db.videos[videoId].title;
      db.videos[videoId].channel =
        getChannelName() || db.videos[videoId].channel;
      db.videos[videoId].url = location.href;
    }
    return db.videos[videoId];
  }

  function getChannelName() {
    const el = document.querySelector(
      "#channel-name a, ytd-channel-name a, ytd-video-owner-renderer a"
    );
    return el ? el.textContent.trim() : "";
  }

  function getVideo() {
    return document.querySelector("video.html5-main-video, video");
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // --- UI ---

  function buildButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement("div");
    btn.id = BUTTON_ID;
    btn.className = "ytm-button";
    btn.innerHTML = `
      <button class="ytm-button-top" title="Open notes">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm10 1.5V8h2.5L15 5.5ZM7 11h10v1.5H7V11Zm0 3.5h7V16H7v-1.5Z"/></svg>
        <span>Notes</span>
      </button>
      <button class="ytm-button-lib" title="Open library">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z"/></svg>
      </button>
    `;
    document.body.appendChild(btn);
    btn.querySelector(".ytm-button-top").addEventListener("click", togglePanel);
    btn.querySelector(".ytm-button-lib").addEventListener("click", () => {
      api.runtime.sendMessage({ type: "openLibrary" });
    });
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.className = "ytm-panel";
    panel.innerHTML = `
      <header class="ytm-panel-head">
        <div class="ytm-title">Video Notes</div>
        <div class="ytm-head-actions">
          <button class="ytm-icon-btn" data-act="import" title="Import from clipboard">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 20h14v-2H5v2ZM12 4l-5 5h3v6h4V9h3l-5-5Z"/></svg>
          </button>
          <button class="ytm-icon-btn" data-act="copy" title="Copy all notes">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg>
          </button>
          <button class="ytm-icon-btn" data-act="vfolder" title="Save video to folder">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm9 8h2v-2h2v-2h-2V8h-2v2h-2v2h2v2Z"/></svg>
          </button>
          <button class="ytm-icon-btn" data-act="library" title="Open library">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z"/></svg>
          </button>
          <button class="ytm-icon-btn" data-act="settings" title="Settings">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.5-2-3.5-2.4.9a8 8 0 0 0-1.7-1L14.9 3h-4l-.4 2.9a8 8 0 0 0-1.7 1l-2.4-.9-2 3.5L6.6 11a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.5 2.4-.9a8 8 0 0 0 1.7 1l.4 2.9h4l.4-2.9a8 8 0 0 0 1.7-1l2.4.9 2-3.5L19.4 13ZM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/></svg>
          </button>
          <button class="ytm-icon-btn" data-act="close" title="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4Z"/></svg>
          </button>
        </div>
      </header>
      <div class="ytm-search">
        <input type="text" placeholder="Search notes…" data-search />
      </div>
      <div class="ytm-list" data-list></div>
      <footer class="ytm-compose">
        <textarea data-compose placeholder="Add a note at current timestamp…" rows="2"></textarea>
        <div class="ytm-compose-row">
          <span class="ytm-ts" data-ts>0:00</span>
          <button class="ytm-add" data-add>Add note</button>
        </div>
      </footer>
    `;
    document.body.appendChild(panel);

    panel
      .querySelector('[data-act="close"]')
      .addEventListener("click", () => setOpen(false));
    panel
      .querySelector('[data-act="library"]')
      .addEventListener("click", () =>
        api.runtime.sendMessage({ type: "openLibrary" })
      );
    panel
      .querySelector('[data-act="copy"]')
      .addEventListener("click", copyAllNotes);
    panel
      .querySelector('[data-act="import"]')
      .addEventListener("click", importFromClipboard);
    panel
      .querySelector('[data-act="settings"]')
      .addEventListener("click", (e) => {
        e.stopPropagation();
        openSettingsPopover(e.currentTarget);
      });
    panel
      .querySelector('[data-act="vfolder"]')
      .addEventListener("click", (e) => {
        e.stopPropagation();
        openVideoFolderPopover(e.currentTarget);
      });
    panel.querySelector("[data-add]").addEventListener("click", onAdd);
    const composeEl = panel.querySelector("[data-compose]");
    composeEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onAdd();
      }
    });
    composeEl.addEventListener("input", typingPauseTick);
    composeEl.addEventListener("focus", typingPauseTick);
    blockYTKeys(composeEl);
    const searchEl = panel.querySelector("[data-search]");
    searchEl.addEventListener("input", () => renderList());
    blockYTKeys(searchEl);

    applyQuickActionMode();
    setInterval(updateComposeTime, 500);
  }

  // --- Pause-on-type ---

  let _resumeTimer = null;
  let _wasPlaying = false;

  function typingPauseTick() {
    const v = getVideo();
    if (!v) return;
    if (!v.paused) {
      _wasPlaying = true;
      v.pause();
    }
    if (_resumeTimer) clearTimeout(_resumeTimer);
    _resumeTimer = setTimeout(() => {
      _resumeTimer = null;
      const vv = getVideo();
      if (vv && _wasPlaying) {
        _wasPlaying = false;
        vv.play().catch(() => {});
      } else {
        _wasPlaying = false;
      }
    }, 5000);
  }

  function blockYTKeys(el) {
    if (!el || el.dataset.ytmBlocked) return;
    el.dataset.ytmBlocked = "1";
    const stop = (e) => e.stopPropagation();
    el.addEventListener("keydown", stop, true);
    el.addEventListener("keyup", stop, true);
    el.addEventListener("keypress", stop, true);
  }

  function applyQuickActionMode() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !state.db) return;
    const mode = (state.db.settings && state.db.settings.quickActions) || "hover";
    panel.dataset.quick = mode;
  }

  function setOpen(v) {
    state.open = v;
    const panel = document.getElementById(PANEL_ID);
    const btn = document.getElementById(BUTTON_ID);
    if (panel) panel.classList.toggle("ytm-open", v);
    if (btn) btn.classList.toggle("ytm-hidden", v);
  }

  function togglePanel() {
    setOpen(!state.open);
    if (state.open) renderList();
  }

  function updateComposeTime() {
    const v = getVideo();
    const tsEl = document.querySelector(`#${PANEL_ID} [data-ts]`);
    if (v && tsEl) tsEl.textContent = fmtTime(v.currentTime || 0);
  }

  function getCurrentNotes() {
    if (!state.db || !state.videoId) return [];
    const v = state.db.videos[state.videoId];
    return v ? v.notes.slice().sort((a, b) => a.timestamp - b.timestamp) : [];
  }

  function renderList() {
    const list = document.querySelector(`#${PANEL_ID} [data-list]`);
    if (!list) return;
    const search = (
      document.querySelector(`#${PANEL_ID} [data-search]`)?.value || ""
    )
      .trim()
      .toLowerCase();
    const notes = getCurrentNotes().filter((n) =>
      search ? n.text.toLowerCase().includes(search) : true
    );
    list.innerHTML = "";
    if (notes.length === 0) {
      list.innerHTML = `<div class="ytm-empty">No notes yet. Add one below.</div>`;
      renderDots();
      return;
    }
    for (const n of notes) {
      list.appendChild(renderNoteRow(n));
    }
    renderDots();
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
          c
        ])
    );
  }

  function renderNoteRow(n) {
    const row = document.createElement("div");
    row.className = "ytm-note";
    row.dataset.id = n.id;
    if (state.selectedNoteId === n.id) row.classList.add("ytm-selected");

    const ts = document.createElement("button");
    ts.className = "ytm-ts-btn";
    ts.textContent = fmtTime(n.timestamp);
    ts.addEventListener("click", () => seekTo(n.timestamp));

    const body = document.createElement("div");
    body.className = "ytm-note-body";

    const edit = document.createElement("div");
    edit.className = "ytm-note-text";
    edit.contentEditable = "true";
    edit.spellcheck = false;
    edit.textContent = n.text;
    edit.addEventListener("blur", () =>
      updateNoteText(n.id, edit.textContent.trim())
    );
    edit.addEventListener("input", typingPauseTick);
    edit.addEventListener("focus", typingPauseTick);
    blockYTKeys(edit);

    const meta = document.createElement("div");
    meta.className = "ytm-note-meta";

    const fLabel = folderLabel(n.folderId);
    if (fLabel) {
      const fchip = document.createElement("span");
      fchip.className = "ytm-folder-chip";
      fchip.textContent = "▤ " + fLabel;
      meta.appendChild(fchip);
    }
    for (const t of n.tags || []) {
      const chip = document.createElement("span");
      chip.className = "ytm-tag";
      chip.style.background = tagColor(state.db, t) + "33";
      chip.style.color = tagColor(state.db, t);
      chip.style.borderColor = tagColor(state.db, t);
      chip.innerHTML = `#${escapeHtml(t)} <button title="Remove" data-x>×</button>`;
      chip.querySelector("[data-x]").addEventListener("click", (e) => {
        e.stopPropagation();
        const next = (n.tags || []).filter((x) => x !== t);
        updateNoteTags(n.id, next);
      });
      meta.appendChild(chip);
    }

    body.appendChild(edit);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "ytm-note-actions";

    const fBtn = document.createElement("button");
    fBtn.className = "ytm-icon-btn ytm-quick";
    fBtn.title = "Folder";
    fBtn.innerHTML =
      `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/></svg>`;
    fBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openFolderPopover(fBtn, n);
    });

    const tBtn = document.createElement("button");
    tBtn.className = "ytm-icon-btn ytm-quick";
    tBtn.title = "Tag";
    tBtn.innerHTML =
      `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 12.4 12.4 21 3 11.6V3h8.6L21 12.4ZM7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>`;
    tBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTagPopover(tBtn, n);
    });

    const del = document.createElement("button");
    del.className = "ytm-icon-btn ytm-del";
    del.title = "Delete";
    del.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7Zm3-4h6l1 2h4v2H4V5h4l1-2Z"/></svg>`;
    del.addEventListener("click", () => deleteNote(n.id));

    actions.appendChild(fBtn);
    actions.appendChild(tBtn);
    actions.appendChild(del);

    row.appendChild(ts);
    row.appendChild(body);
    row.appendChild(actions);
    return row;
  }

  function folderLabel(id) {
    if (!id || !state.db) return "";
    const f = (state.db.folders || []).find((x) => x.id === id);
    return f ? f.name : "";
  }

  async function updateNoteTags(id, tags) {
    if (!state.db || !state.videoId) return;
    const vd = state.db.videos[state.videoId];
    const n = vd && vd.notes.find((x) => x.id === id);
    if (!n) return;
    n.tags = tags;
    n.updatedAt = Date.now();
    await saveDb(state.db);
    renderList();
  }

  async function updateNoteFolder(id, folderId) {
    if (!state.db || !state.videoId) return;
    const vd = state.db.videos[state.videoId];
    const n = vd && vd.notes.find((x) => x.id === id);
    if (!n) return;
    n.folderId = folderId || null;
    n.updatedAt = Date.now();
    await saveDb(state.db);
    renderList();
  }

  function seekTo(ts) {
    const v = getVideo();
    if (v) {
      v.currentTime = ts;
      v.play && v.play().catch(() => {});
    }
  }

  async function onAdd() {
    const ta = document.querySelector(`#${PANEL_ID} [data-compose]`);
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;
    const v = getVideo();
    const ts = v ? Math.floor(v.currentTime) : 0;
    await addNote({ timestamp: ts, text });
    ta.value = "";
  }

  async function addNote({ timestamp, text, tags = [], folderId = null }) {
    if (!state.videoId) return;
    state.db = state.db || (await loadDb());
    const vd = ensureVideo(state.db, state.videoId);
    const note = {
      id: uid(),
      timestamp,
      text,
      tags,
      folderId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    vd.notes.push(note);
    vd.updatedAt = Date.now();
    await saveDb(state.db);
    renderList();
  }

  async function deleteNote(id) {
    if (!state.db || !state.videoId) return;
    const vd = state.db.videos[state.videoId];
    if (!vd) return;
    vd.notes = vd.notes.filter((n) => n.id !== id);
    vd.updatedAt = Date.now();
    await saveDb(state.db);
    renderList();
  }

  async function updateNoteText(id, text) {
    if (!state.db || !state.videoId) return;
    const vd = state.db.videos[state.videoId];
    const n = vd && vd.notes.find((x) => x.id === id);
    if (!n) return;
    if (n.text === text) return;
    n.text = text;
    n.updatedAt = Date.now();
    await saveDb(state.db);
  }

  // --- Dots ---

  function renderDots() {
    document.getElementById(DOTS_ID)?.remove();
    const bar =
      document.querySelector(".ytp-progress-bar-container") ||
      document.querySelector(".ytp-progress-bar");
    if (!bar) return;
    if (getComputedStyle(bar).position === "static") {
      bar.style.position = "relative";
    }
    const v = getVideo();
    if (!v || !v.duration || !isFinite(v.duration)) return;
    const notes = getCurrentNotes();
    if (!notes.length) return;
    const layer = document.createElement("div");
    layer.id = DOTS_ID;
    layer.className = "ytm-dots";
    for (const n of notes) {
      const dot = document.createElement("button");
      dot.className = "ytm-dot";
      const pct = Math.max(0, Math.min(100, (n.timestamp / v.duration) * 100));
      dot.style.left = pct + "%";
      dot.title = `[${fmtTime(n.timestamp)}] ${n.text.slice(0, 60)}`;
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        seekTo(n.timestamp);
        state.selectedNoteId = n.id;
        setOpen(true);
        renderList();
        const row = document.querySelector(
          `#${PANEL_ID} .ytm-note[data-id="${n.id}"]`
        );
        if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      layer.appendChild(dot);
    }
    bar.appendChild(layer);
  }

  // --- Importer (paste YT-Notes-style block) ---

  async function importFromClipboard() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      const inp = prompt("Paste your notes block here:");
      if (!inp) return;
      text = inp;
    }
    const parsed = parseImport(text);
    if (!parsed || parsed.entries.length === 0) {
      alert("Lornote: no timestamps detected in clipboard.");
      return;
    }
    let target = parsed.videoId || state.videoId;
    if (!target) {
      alert("Lornote: no video URL found and no current video.");
      return;
    }
    state.db = state.db || (await loadDb());
    const vd = ensureVideo(state.db, target);
    if (parsed.title) vd.title = parsed.title;
    for (const e of parsed.entries) {
      vd.notes.push({
        id: uid(),
        timestamp: e.timestamp,
        text: e.text,
        tags: [],
        folderId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    vd.updatedAt = Date.now();
    await saveDb(state.db);
    renderList();
    alert(`Imported ${parsed.entries.length} notes.`);
  }

  async function copyAllNotes() {
    const notes = getCurrentNotes();
    if (!notes.length) return;
    const title = state.db.videos[state.videoId]?.title || document.title;
    const url = `https://youtube.com/watch?v=${state.videoId}`;
    const lines = [
      `${title}`,
      url,
      "Notes:",
      ...notes.map((n) => `[${fmtTime(n.timestamp)}] ${n.text}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      flash("Copied notes to clipboard.");
    } catch {
      flash("Copy failed (clipboard permission).");
    }
  }

  function flash(msg) {
    const el = document.createElement("div");
    el.className = "ytm-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  // --- Popovers ---

  function closePopovers() {
    document.querySelectorAll(".ytm-popover").forEach((el) => el.remove());
    document.removeEventListener("mousedown", _popDismiss, true);
    document.removeEventListener("keydown", _popKey, true);
  }
  function _popDismiss(e) {
    if (!e.target.closest(".ytm-popover") && !e.target.closest(".ytm-quick") && !e.target.closest('[data-act="settings"]')) {
      closePopovers();
    }
  }
  function _popKey(e) {
    if (e.key === "Escape") closePopovers();
  }
  function mountPopover(anchor, el) {
    closePopovers();
    el.classList.add("ytm-popover");
    const host = document.fullscreenElement || document.body;
    host.appendChild(el);
    const ar = anchor.getBoundingClientRect();
    el.style.position = "fixed";
    el.style.right = `${Math.max(8, window.innerWidth - ar.right - 8)}px`;
    el.style.top = `${ar.bottom + 6}px`;
    el.style.zIndex = "2147483647";
    setTimeout(() => {
      document.addEventListener("mousedown", _popDismiss, true);
      document.addEventListener("keydown", _popKey, true);
    }, 0);
  }

  function openSettingsPopover(anchor) {
    const mode = (state.db.settings && state.db.settings.quickActions) || "hover";
    const el = document.createElement("div");
    el.innerHTML = `
      <div class="ytm-pop-title">Quick actions visibility</div>
      <label><input type="radio" name="qa" value="always" ${mode === "always" ? "checked" : ""}/> Always show</label>
      <label><input type="radio" name="qa" value="hover" ${mode === "hover" ? "checked" : ""}/> Show on hover</label>
      <label><input type="radio" name="qa" value="never" ${mode === "never" ? "checked" : ""}/> Never show</label>
    `;
    el.querySelectorAll('input[name="qa"]').forEach((inp) => {
      inp.addEventListener("change", async () => {
        state.db.settings = state.db.settings || {};
        state.db.settings.quickActions = inp.value;
        await saveDb(state.db);
        applyQuickActionMode();
      });
    });
    mountPopover(anchor, el);
  }

  function openFolderPopover(anchor, note) {
    const el = document.createElement("div");
    const folders = state.db.folders || [];
    el.innerHTML = `
      <div class="ytm-pop-title">Folder</div>
      <div class="ytm-pop-list" data-list></div>
      <div class="ytm-pop-row">
        <input type="text" data-new placeholder="New folder name" />
        <button class="ytm-pop-go" data-create>Add</button>
      </div>
    `;
    const list = el.querySelector("[data-list]");
    const noneBtn = document.createElement("button");
    noneBtn.className = "ytm-pop-item";
    noneBtn.textContent = "(no folder)";
    if (!note.folderId) noneBtn.classList.add("active");
    noneBtn.addEventListener("click", async () => {
      await updateNoteFolder(note.id, null);
      closePopovers();
    });
    list.appendChild(noneBtn);
    for (const f of folders) {
      const b = document.createElement("button");
      b.className = "ytm-pop-item";
      if (note.folderId === f.id) b.classList.add("active");
      b.textContent = "▤ " + f.name;
      b.addEventListener("click", async () => {
        await updateNoteFolder(note.id, f.id);
        closePopovers();
      });
      list.appendChild(b);
    }
    const inp = el.querySelector("[data-new]");
    blockYTKeys(inp);
    const submit = async () => {
      const name = inp.value.trim();
      if (!name) return;
      const newId = uid();
      state.db.folders = state.db.folders || [];
      state.db.folders.push({ id: newId, name, createdAt: Date.now() });
      await saveDb(state.db);
      await updateNoteFolder(note.id, newId);
      closePopovers();
    };
    el.querySelector("[data-create]").addEventListener("click", submit);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    mountPopover(anchor, el);
  }

  function openVideoFolderPopover(anchor) {
    const el = document.createElement("div");
    const folders = state.db.videoFolders || [];
    const cur = state.db.videos[state.videoId];
    el.innerHTML = `
      <div class="ytm-pop-title">Save this video to a folder</div>
      <div class="ytm-pop-list" data-list></div>
      <div class="ytm-pop-row">
        <input type="text" data-new placeholder="New video folder" />
        <button class="ytm-pop-go" data-create>Add</button>
      </div>
    `;
    const list = el.querySelector("[data-list]");
    const noneBtn = document.createElement("button");
    noneBtn.className = "ytm-pop-item";
    noneBtn.textContent = "(uncategorized)";
    if (!cur || !cur.folderId) noneBtn.classList.add("active");
    noneBtn.addEventListener("click", async () => {
      await assignVideoFolder(null);
      closePopovers();
    });
    list.appendChild(noneBtn);
    for (const f of folders) {
      const b = document.createElement("button");
      b.className = "ytm-pop-item";
      if (cur && cur.folderId === f.id) b.classList.add("active");
      b.textContent = "▤ " + f.name;
      b.addEventListener("click", async () => {
        await assignVideoFolder(f.id);
        closePopovers();
      });
      list.appendChild(b);
    }
    const inp = el.querySelector("[data-new]");
    blockYTKeys(inp);
    const submit = async () => {
      const name = inp.value.trim();
      if (!name) return;
      const newId = uid();
      state.db.videoFolders = state.db.videoFolders || [];
      state.db.videoFolders.push({
        id: newId,
        name,
        description: "",
        createdAt: Date.now(),
      });
      await saveDb(state.db);
      await assignVideoFolder(newId);
      closePopovers();
    };
    el.querySelector("[data-create]").addEventListener("click", submit);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    mountPopover(anchor, el);
  }

  async function assignVideoFolder(folderId) {
    if (!state.db || !state.videoId) return;
    const v = state.db.videos[state.videoId];
    if (!v) return;
    v.folderId = folderId || null;
    v.updatedAt = Date.now();
    await saveDb(state.db);
    flash(folderId ? "Saved to folder." : "Removed from folder.");
  }

  function openTagPopover(anchor, note) {
    const el = document.createElement("div");
    el.innerHTML = `
      <div class="ytm-pop-title">Tag</div>
      <input type="text" data-name placeholder="Tag name" maxlength="80" />
      <div class="ytm-pop-swatches" data-sw></div>
      <div class="ytm-pop-list" data-existing></div>
      <div class="ytm-pop-row">
        <button class="ytm-pop-go" data-add>Add tag</button>
      </div>
    `;
    const sw = el.querySelector("[data-sw]");
    let chosenColor = PALETTE[0];
    PALETTE.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "ytm-swatch";
      b.style.background = c;
      if (i === 0) b.classList.add("active");
      b.addEventListener("click", (e) => {
        e.preventDefault();
        chosenColor = c;
        sw.querySelectorAll(".ytm-swatch").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      });
      sw.appendChild(b);
    });
    const existing = collectAllTags(state.db);
    const ex = el.querySelector("[data-existing]");
    if (existing.length) {
      const lbl = document.createElement("div");
      lbl.className = "ytm-pop-sub";
      lbl.textContent = "Existing";
      ex.appendChild(lbl);
      for (const t of existing) {
        const b = document.createElement("button");
        b.className = "ytm-pop-tag";
        b.style.background = tagColor(state.db, t) + "33";
        b.style.color = tagColor(state.db, t);
        b.style.borderColor = tagColor(state.db, t);
        if ((note.tags || []).includes(t)) b.classList.add("active");
        b.textContent = "#" + t;
        b.addEventListener("click", async () => {
          const cur = note.tags || [];
          const next = cur.includes(t)
            ? cur.filter((x) => x !== t)
            : [...cur, t];
          await updateNoteTags(note.id, next);
          closePopovers();
        });
        ex.appendChild(b);
      }
    }
    const nameInp = el.querySelector("[data-name]");
    nameInp.addEventListener("input", typingPauseTick);
    blockYTKeys(nameInp);
    const add = async () => {
      const name = nameInp.value.trim().replace(/^#/, "");
      if (!name) return;
      state.db.tagPalette = state.db.tagPalette || {};
      state.db.tagPalette[name] = chosenColor;
      const tags = [...new Set([...(note.tags || []), name])];
      await saveDb(state.db);
      await updateNoteTags(note.id, tags);
      closePopovers();
    };
    el.querySelector("[data-add]").addEventListener("click", add);
    nameInp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        add();
      }
    });
    mountPopover(anchor, el);
    setTimeout(() => nameInp.focus(), 30);
  }

  function collectAllTags(db) {
    const set = new Set();
    for (const v of Object.values(db.videos || {})) {
      for (const n of v.notes || []) (n.tags || []).forEach((t) => set.add(t));
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // --- Parser for pasted notes blocks ---

  function parseImport(raw) {
    if (!raw) return null;
    const text = String(raw).replace(/\r\n?/g, "\n").trim();
    const urlMatch = text.match(
      /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s<>")\]]*v=([\w-]{6,})|youtu\.be\/([\w-]{6,}))/
    );
    let videoId = null;
    let titleEnd = text.length;
    let urlEnd = 0;
    if (urlMatch) {
      videoId = urlMatch[1] || urlMatch[2] || null;
      titleEnd = urlMatch.index;
      urlEnd = urlMatch.index + urlMatch[0].length;
    }
    let title = text
      .slice(0, titleEnd)
      .replace(/^\s*\(\d+\)\s*/, "")
      .replace(/[<\s]+$/, "")
      .trim();

    const tail = text.slice(urlEnd);
    const notesIdx = tail.search(/Notes:/i);
    const body = notesIdx >= 0 ? tail.slice(notesIdx + 6) : tail;

    const entries = [];
    const re = /\[(\d{1,2}(?::\d{1,2}){1,2})\]\s*/g;
    const positions = [];
    let m;
    while ((m = re.exec(body)) !== null) {
      positions.push({ idx: m.index, end: re.lastIndex, time: m[1] });
    }
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const next = positions[i + 1];
      const txt = body.slice(p.end, next ? next.idx : body.length).trim();
      const ts = parseTimestamp(p.time);
      if (txt) entries.push({ timestamp: ts, text: txt });
    }
    return { videoId, title, entries };
  }

  function parseTimestamp(s) {
    const parts = s.split(":").map((n) => parseInt(n, 10));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  // --- Lifecycle / SPA ---

  async function refresh() {
    const id = getVideoIdFromUrl(location.href);
    state.videoId = id;
    state.selectedNoteId = null;
    state.db = await loadDb();
    if (id) {
      ensureVideo(state.db, id);
      await saveDb(state.db);
    }
    if (id) {
      buildButton();
      buildPanel();
      applyQuickActionMode();
    } else {
      document.getElementById(PANEL_ID)?.remove();
      document.getElementById(BUTTON_ID)?.remove();
      document.getElementById(DOTS_ID)?.remove();
      return;
    }
    renderList();
  }

  function attachVideoListeners() {
    const v = getVideo();
    if (!v || v.dataset.ytmBound) return;
    v.dataset.ytmBound = "1";
    v.addEventListener("loadedmetadata", renderDots);
    v.addEventListener("durationchange", renderDots);
  }

  function fullscreenContainer() {
    return document.fullscreenElement || null;
  }

  function relocateForFullscreen() {
    const fs = fullscreenContainer();
    const btn = document.getElementById(BUTTON_ID);
    const panel = document.getElementById(PANEL_ID);
    const target = fs || document.body;
    if (btn && btn.parentElement !== target) target.appendChild(btn);
    if (panel && panel.parentElement !== target) target.appendChild(panel);
  }

  document.addEventListener("fullscreenchange", relocateForFullscreen);

  // Re-render dots when player redraws progress bar
  const dotObserver = new MutationObserver(() => {
    if (!document.getElementById(DOTS_ID)) renderDots();
  });

  function bootObserver() {
    const player = document.querySelector(".ytp-chrome-bottom, #movie_player");
    if (player) {
      dotObserver.observe(player, { childList: true, subtree: true });
    }
  }

  // SPA navigation
  document.addEventListener("yt-navigate-finish", () => {
    setTimeout(() => {
      refresh();
      attachVideoListeners();
      bootObserver();
    }, 200);
  });

  // Storage change reflection (e.g. library tab edits)
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    state.db = changes[STORAGE_KEY].newValue || {
      videos: {},
      folders: [],
      tagPalette: {},
      settings: { quickActions: "hover" },
    };
    state.db.tagPalette = state.db.tagPalette || {};
    state.db.settings = state.db.settings || { quickActions: "hover" };
    applyQuickActionMode();
    if (state.open) renderList();
    else renderDots();
  });

  // Initial boot
  refresh().then(() => {
    attachVideoListeners();
    bootObserver();
  });

  // Re-attach listeners on player swaps
  setInterval(() => {
    attachVideoListeners();
    if (state.videoId && !document.getElementById(DOTS_ID)) renderDots();
  }, 2000);
})();
