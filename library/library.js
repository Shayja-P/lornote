(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const STORAGE_KEY = "ytmarker:db:v1";

  const state = {
    db: null,
    view: { type: "all" },
    search: "",
    layout: 1,
    openVideos: new Set(),
  };

  // --- Storage ---

  const PALETTE = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308",
    "#84cc16", "#22c55e", "#14b8a6", "#06b6d4",
    "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
  ];

  async function loadDb() {
    const out = await api.storage.local.get(STORAGE_KEY);
    const db = out[STORAGE_KEY] || { videos: {}, folders: [], version: 1 };
    db.tagPalette = db.tagPalette || {};
    db.settings = db.settings || { quickActions: "hover" };
    db.settings.layout = db.settings.layout || 1;
    db.videoFolders = db.videoFolders || [];
    return db;
  }
  function pickColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function tagColor(name) {
    return (state.db && state.db.tagPalette && state.db.tagPalette[name]) || pickColor(name);
  }
  async function saveDb(db) {
    db.updatedAt = Date.now();
    await api.storage.local.set({ [STORAGE_KEY]: db });
  }

  // --- Helpers ---

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
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  }
  function thumbUrl(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  }
  function ytUrl(videoId, ts) {
    return `https://www.youtube.com/watch?v=${videoId}${
      ts ? `&t=${Math.floor(ts)}s` : ""
    }`;
  }

  // --- Parser (kept in sync with content/youtube.js) ---

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

  // --- Aggregations ---

  function allNotes(db) {
    const out = [];
    for (const vid of Object.values(db.videos || {})) {
      for (const n of vid.notes || []) {
        out.push({ note: n, video: vid });
      }
    }
    return out;
  }
  function collectTags(db) {
    const set = new Set();
    for (const vid of Object.values(db.videos || {})) {
      for (const n of vid.notes || []) {
        (n.tags || []).forEach((t) => set.add(t));
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // --- Filtering ---

  function visibleEntries() {
    const all = allNotes(state.db);
    const q = state.search.trim().toLowerCase();
    return all.filter(({ note, video }) => {
      if (state.view.type === "uncategorized" && note.folderId) return false;
      if (state.view.type === "folder" && note.folderId !== state.view.id)
        return false;
      if (
        state.view.type === "tag" &&
        !(note.tags || []).includes(state.view.name)
      )
        return false;
      if (state.view.type === "videoFolder") {
        if ((video.folderId || null) !== state.view.id) return false;
      }
      if (state.view.type === "uncatVideos" && video.folderId) return false;
      if (q) {
        const hay = `${video.title || ""} ${note.text || ""} ${(
          note.tags || []
        ).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function groupByVideo(entries) {
    const map = new Map();
    for (const e of entries) {
      if (!map.has(e.video.videoId))
        map.set(e.video.videoId, { video: e.video, notes: [] });
      map.get(e.video.videoId).notes.push(e.note);
    }
    for (const g of map.values()) {
      g.notes.sort((a, b) => a.timestamp - b.timestamp);
    }
    return [...map.values()].sort(
      (a, b) => (b.video.updatedAt || 0) - (a.video.updatedAt || 0)
    );
  }

  // --- Rendering ---

  function render() {
    renderNav();
    renderResults();
  }

  function renderNav() {
    const folders = state.db.folders || [];
    const folderEl = document.getElementById("folders");
    folderEl.innerHTML = folders.length
      ? ""
      : `<div class="muted" style="padding:6px 10px; color:var(--muted); font-size:12px;">No folders yet</div>`;
    for (const f of folders) {
      const btn = document.createElement("button");
      btn.className = "nav-item";
      if (state.view.type === "folder" && state.view.id === f.id)
        btn.classList.add("active");
      btn.dataset.folderId = f.id;
      btn.innerHTML = `<span class="ico">▤</span> <span style="flex:1">${escapeHtml(
        f.name
      )}</span> <span class="counter" data-fcount></span>`;
      btn.addEventListener("click", () => {
        state.view = { type: "folder", id: f.id, name: f.name };
        render();
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (confirm(`Delete folder "${f.name}"? Notes will become uncategorized.`)) {
          deleteFolder(f.id);
        }
      });
      folderEl.appendChild(btn);
    }

    // Counts
    const counts = { all: 0, uncat: 0, byFolder: {} };
    for (const { note } of allNotes(state.db)) {
      counts.all++;
      if (!note.folderId) counts.uncat++;
      else counts.byFolder[note.folderId] = (counts.byFolder[note.folderId] || 0) + 1;
    }
    document
      .querySelectorAll("#nav .nav-item")
      .forEach((el) => el.classList.remove("active"));
    document
      .querySelector(`.nav-item[data-view="${state.view.type === "all" ? "all" : ""}"]`)
      ?.classList.toggle("active", state.view.type === "all");
    document
      .querySelector('.nav-item[data-view="uncategorized"]')
      ?.classList.toggle("active", state.view.type === "uncategorized");
    if (state.view.type === "folder") {
      document
        .querySelector(`#folders .nav-item[data-folder-id="${state.view.id}"]`)
        ?.classList.add("active");
    }
    folderEl.querySelectorAll("[data-fcount]").forEach((el) => {
      const id = el.closest(".nav-item").dataset.folderId;
      const c = counts.byFolder[id] || 0;
      el.textContent = c ? c : "";
    });

    // Tags
    const tagsEl = document.getElementById("tags");
    const tags = collectTags(state.db);
    tagsEl.innerHTML = tags.length
      ? ""
      : `<div class="muted" style="padding:4px 6px; color:var(--muted); font-size:12px;">No tags yet</div>`;
    for (const t of tags) {
      const pill = document.createElement("button");
      pill.className =
        "tag-pill" +
        (state.view.type === "tag" && state.view.name === t ? " active" : "");
      pill.textContent = `#${t}`;
      pill.addEventListener("click", () => {
        state.view =
          state.view.type === "tag" && state.view.name === t
            ? { type: "all" }
            : { type: "tag", name: t };
        render();
      });
      tagsEl.appendChild(pill);
    }

    renderVideoFolders();
  }

  function renderVideoFolders() {
    const host = document.getElementById("vfolders");
    if (!host) return;
    host.innerHTML = "";
    const vfolders = state.db.videoFolders || [];
    // Uncategorized videos count
    const counts = { uncat: 0, byFolder: {} };
    for (const v of Object.values(state.db.videos || {})) {
      if (!v.folderId) counts.uncat++;
      else counts.byFolder[v.folderId] = (counts.byFolder[v.folderId] || 0) + 1;
    }
    const uncatBtn = document.createElement("button");
    uncatBtn.className = "nav-item";
    if (state.view.type === "uncatVideos") uncatBtn.classList.add("active");
    uncatBtn.innerHTML = `<span class="ico">▢</span> <span style="flex:1">No video folder</span> <span class="counter">${counts.uncat || ""}</span>`;
    uncatBtn.addEventListener("click", () => {
      state.view = { type: "uncatVideos" };
      render();
    });
    host.appendChild(uncatBtn);

    for (const f of vfolders) {
      const row = document.createElement("div");
      row.className = "vfolder-row";
      const c = counts.byFolder[f.id] || 0;
      const isActive =
        state.view.type === "videoFolder" && state.view.id === f.id;
      row.innerHTML = `
        <button class="nav-item ${isActive ? "active" : ""}" data-vfid="${f.id}">
          <span class="ico">▤</span>
          <span style="flex:1">${escapeHtml(f.name)}</span>
          <span class="counter">${c || ""}</span>
        </button>
        <button class="ico-edit" title="Edit folder">✎</button>
      `;
      row.querySelector(".nav-item").addEventListener("click", () => {
        state.view = { type: "videoFolder", id: f.id, name: f.name };
        render();
      });
      row.querySelector(".ico-edit").addEventListener("click", (e) => {
        e.stopPropagation();
        openVideoFolderEditor(f);
      });
      host.appendChild(row);
    }
  }

  function viewTitle() {
    if (state.view.type === "all") return "All notes";
    if (state.view.type === "uncategorized") return "Uncategorized";
    if (state.view.type === "folder") return state.view.name;
    if (state.view.type === "tag") return `#${state.view.name}`;
    if (state.view.type === "videoFolder")
      return state.view.name || "Video folder";
    if (state.view.type === "uncatVideos") return "Videos: uncategorized";
    return "Notes";
  }

  function renderResults() {
    const entries = visibleEntries();
    const groups = groupByVideo(entries);
    const total = entries.length;

    document.getElementById("view-title").textContent = viewTitle();
    document.getElementById("counter").textContent = total
      ? `${total} note${total === 1 ? "" : "s"}`
      : "";

    const results = document.getElementById("results");
    const empty = document.getElementById("empty");

    results.dataset.cols = String(state.layout || 1);

    if (Object.keys(state.db.videos || {}).length === 0) {
      results.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    results.innerHTML = "";

    if (state.view.type === "videoFolder") {
      const f = (state.db.videoFolders || []).find(
        (x) => x.id === state.view.id
      );
      if (f && f.description) {
        const desc = document.createElement("div");
        desc.className = "vfolder-desc";
        desc.style.gridColumn = "1 / -1";
        desc.textContent = f.description;
        results.appendChild(desc);
      }
    }

    if (total === 0) {
      const msg = document.createElement("div");
      msg.style.cssText =
        "padding:60px 0; text-align:center; color:var(--muted); grid-column:1/-1;";
      msg.textContent = "No notes match this view.";
      results.appendChild(msg);
      return;
    }

    for (const g of groups) {
      results.appendChild(renderVideoCard(g));
    }
  }

  function renderVideoCard({ video, notes }) {
    const card = document.createElement("article");
    card.className = "video-card";
    const isOpen = state.openVideos.has(video.videoId);
    card.dataset.open = isOpen ? "true" : "false";

    const head = document.createElement("div");
    head.className = "video-head";

    const thumb = document.createElement("div");
    thumb.className = "video-thumb";
    thumb.style.backgroundImage = `url('${thumbUrl(video.videoId)}')`;

    const meta = document.createElement("div");
    meta.className = "video-meta";
    const folderName = videoFolderName(video.folderId);
    meta.innerHTML = `
      <div class="video-title">${escapeHtml(video.title || video.videoId)}</div>
      <div class="video-sub">${escapeHtml(video.channel || "")}${
      video.channel ? " · " : ""
    }<a href="${ytUrl(video.videoId)}" target="_blank" rel="noopener" style="color:var(--muted)">${
      video.videoId
    }</a></div>
      ${
        folderName
          ? `<span class="video-folder-tag">▤ ${escapeHtml(folderName)}</span>`
          : ""
      }
    `;
    meta.querySelector("a").addEventListener("click", (e) => e.stopPropagation());

    const right = document.createElement("div");
    right.style.cssText = "display:flex; gap:6px; align-items:center;";
    const count = document.createElement("span");
    count.className = "video-count";
    count.textContent = notes.length;
    const moveBtn = document.createElement("button");
    moveBtn.className = "icon-btn";
    moveBtn.title = "Move to video folder";
    moveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm9 8h2v-2h2v-2h-2V8h-2v2h-2v2h2v2Z"/></svg>`;
    moveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      promptMoveVideo(video);
    });
    const chev = document.createElement("span");
    chev.className = "chev";
    chev.textContent = "▶";

    right.appendChild(moveBtn);
    right.appendChild(count);
    right.appendChild(chev);

    head.appendChild(thumb);
    head.appendChild(meta);
    head.appendChild(right);

    head.addEventListener("click", () => {
      if (state.openVideos.has(video.videoId))
        state.openVideos.delete(video.videoId);
      else state.openVideos.add(video.videoId);
      renderResults();
    });

    card.appendChild(head);
    const list = document.createElement("div");
    list.className = "video-notes";
    for (const n of notes) list.appendChild(renderNoteRow(video, n));
    card.appendChild(list);
    return card;
  }

  function videoFolderName(id) {
    if (!id) return "";
    const f = (state.db.videoFolders || []).find((x) => x.id === id);
    return f ? f.name : "";
  }

  function promptMoveVideo(video) {
    const folders = state.db.videoFolders || [];
    const opts = ["(uncategorized)", ...folders.map((f) => f.name)];
    const cur = video.folderId
      ? folders.findIndex((f) => f.id === video.folderId) + 1
      : 0;
    const choice = prompt(
      `Move "${video.title || video.videoId}" to folder:\n` +
        opts.map((n, i) => `${i}: ${n}`).join("\n") +
        `\n\nEnter number, or type a new folder name:`,
      String(cur)
    );
    if (choice === null) return;
    const num = Number(choice);
    if (!Number.isNaN(num) && num >= 0 && num < opts.length) {
      const folderId = num === 0 ? null : folders[num - 1].id;
      setVideoFolder(video.videoId, folderId);
    } else {
      const name = choice.trim();
      if (!name) return;
      const id = uid();
      state.db.videoFolders = state.db.videoFolders || [];
      state.db.videoFolders.push({
        id,
        name,
        description: "",
        createdAt: Date.now(),
      });
      setVideoFolder(video.videoId, id);
    }
  }

  function renderNoteRow(video, n) {
    const row = document.createElement("div");
    row.className = "note";

    const ts = document.createElement("a");
    ts.className = "ts-btn";
    ts.href = ytUrl(video.videoId, n.timestamp);
    ts.target = "_blank";
    ts.rel = "noopener";
    ts.textContent = fmtTime(n.timestamp);

    const body = document.createElement("div");
    const text = document.createElement("div");
    text.className = "note-text";
    text.contentEditable = "true";
    text.spellcheck = false;
    text.textContent = n.text;
    text.addEventListener("blur", () =>
      updateNote(video.videoId, n.id, { text: text.textContent.trim() })
    );

    const meta = document.createElement("div");
    meta.className = "note-meta";

    // Folder select
    const folderSel = document.createElement("select");
    folderSel.innerHTML = `<option value="">No folder</option>` +
      (state.db.folders || [])
        .map(
          (f) =>
            `<option value="${f.id}" ${
              n.folderId === f.id ? "selected" : ""
            }>${escapeHtml(f.name)}</option>`
        )
        .join("");
    folderSel.addEventListener("change", () =>
      updateNote(video.videoId, n.id, {
        folderId: folderSel.value || null,
      })
    );

    meta.appendChild(folderSel);

    // Tag chips
    for (const t of n.tags || []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      const c = tagColor(t);
      chip.style.background = c + "33";
      chip.style.color = c;
      chip.style.borderColor = c;
      chip.innerHTML = `#${escapeHtml(t)} <button title="Remove tag">×</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        const next = (n.tags || []).filter((x) => x !== t);
        updateNote(video.videoId, n.id, { tags: next });
      });
      meta.appendChild(chip);
    }

    // Tag input
    const tagInput = document.createElement("input");
    tagInput.type = "text";
    tagInput.className = "tag-input";
    tagInput.placeholder = "+ tag (Enter)";
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && tagInput.value.trim()) {
        e.preventDefault();
        const t = tagInput.value.trim().replace(/^#/, "");
        const tags = [...new Set([...(n.tags || []), t])];
        updateNote(video.videoId, n.id, { tags });
        tagInput.value = "";
      }
    });
    meta.appendChild(tagInput);

    body.appendChild(text);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "note-actions";
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.title = "Delete note";
    del.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7Zm3-4h6l1 2h4v2H4V5h4l1-2Z"/></svg>`;
    del.addEventListener("click", () => deleteNote(video.videoId, n.id));
    actions.appendChild(del);

    row.appendChild(ts);
    row.appendChild(body);
    row.appendChild(actions);
    return row;
  }

  // --- Mutations ---

  async function updateNote(videoId, noteId, patch) {
    const vid = state.db.videos[videoId];
    if (!vid) return;
    const note = vid.notes.find((x) => x.id === noteId);
    if (!note) return;
    Object.assign(note, patch, { updatedAt: Date.now() });
    vid.updatedAt = Date.now();
    await saveDb(state.db);
    render();
  }

  async function deleteNote(videoId, noteId) {
    const vid = state.db.videos[videoId];
    if (!vid) return;
    vid.notes = vid.notes.filter((x) => x.id !== noteId);
    if (vid.notes.length === 0) delete state.db.videos[videoId];
    else vid.updatedAt = Date.now();
    await saveDb(state.db);
    render();
  }

  async function deleteFolder(folderId) {
    state.db.folders = (state.db.folders || []).filter((f) => f.id !== folderId);
    for (const v of Object.values(state.db.videos || {})) {
      for (const n of v.notes) if (n.folderId === folderId) n.folderId = null;
    }
    if (state.view.type === "folder" && state.view.id === folderId) {
      state.view = { type: "all" };
    }
    await saveDb(state.db);
    render();
  }

  async function createVideoFolder(name, description = "") {
    if (!name.trim()) return;
    state.db.videoFolders = state.db.videoFolders || [];
    state.db.videoFolders.push({
      id: uid(),
      name: name.trim(),
      description: description || "",
      createdAt: Date.now(),
    });
    await saveDb(state.db);
    render();
  }

  async function updateVideoFolder(id, patch) {
    const f = (state.db.videoFolders || []).find((x) => x.id === id);
    if (!f) return;
    Object.assign(f, patch, { updatedAt: Date.now() });
    await saveDb(state.db);
    render();
  }

  async function deleteVideoFolder(id) {
    state.db.videoFolders = (state.db.videoFolders || []).filter(
      (x) => x.id !== id
    );
    for (const v of Object.values(state.db.videos || {})) {
      if (v.folderId === id) v.folderId = null;
    }
    if (state.view.type === "videoFolder" && state.view.id === id) {
      state.view = { type: "all" };
    }
    await saveDb(state.db);
    render();
  }

  function openVideoFolderEditor(folder) {
    const dlg = document.getElementById("vfolder-dialog");
    const title = document.getElementById("vf-title");
    const name = document.getElementById("vf-name");
    const desc = document.getElementById("vf-desc");
    const del = document.getElementById("vf-delete");
    title.textContent = folder ? "Edit video folder" : "New video folder";
    name.value = folder ? folder.name : "";
    desc.value = folder ? folder.description || "" : "";
    del.style.display = folder ? "" : "none";
    del.onclick = async () => {
      if (!folder) return;
      if (
        confirm(
          `Delete video folder "${folder.name}"? Videos inside become uncategorized.`
        )
      ) {
        await deleteVideoFolder(folder.id);
        dlg.close("cancel");
      }
    };
    dlg.onclose = async () => {
      if (dlg.returnValue !== "default") return;
      const n = name.value.trim();
      if (!n) return;
      if (folder) {
        await updateVideoFolder(folder.id, { name: n, description: desc.value });
      } else {
        await createVideoFolder(n, desc.value);
      }
    };
    dlg.showModal();
  }

  async function setVideoFolder(videoId, folderId) {
    const v = state.db.videos[videoId];
    if (!v) return;
    v.folderId = folderId || null;
    v.updatedAt = Date.now();
    await saveDb(state.db);
    render();
  }

  async function createFolder(name) {
    if (!name.trim()) return;
    state.db.folders = state.db.folders || [];
    state.db.folders.push({
      id: uid(),
      name: name.trim(),
      createdAt: Date.now(),
    });
    await saveDb(state.db);
    render();
  }

  // --- Import / Export ---

  async function doImport(text) {
    const parsed = parseImport(text);
    if (!parsed || parsed.entries.length === 0) {
      alert("No timestamps detected.");
      return;
    }
    if (!parsed.videoId) {
      alert("Could not detect a YouTube URL in the pasted text.");
      return;
    }
    const id = parsed.videoId;
    if (!state.db.videos[id]) {
      state.db.videos[id] = {
        videoId: id,
        title: parsed.title || id,
        channel: "",
        url: ytUrl(id),
        notes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else if (parsed.title) {
      state.db.videos[id].title = parsed.title;
    }
    const vid = state.db.videos[id];
    for (const e of parsed.entries) {
      vid.notes.push({
        id: uid(),
        timestamp: e.timestamp,
        text: e.text,
        tags: [],
        folderId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    vid.updatedAt = Date.now();
    await saveDb(state.db);
    render();
    alert(`Imported ${parsed.entries.length} notes into "${vid.title}".`);
  }

  async function doImportJson(obj) {
    if (!obj || typeof obj !== "object") {
      alert("File is not valid JSON.");
      return;
    }

    // Lornote native export → merge full DB
    if (obj.videos && typeof obj.videos === "object" && !Array.isArray(obj.videos)) {
      let videoCount = 0;
      let noteCount = 0;
      for (const [vid, src] of Object.entries(obj.videos)) {
        if (!src || typeof src !== "object") continue;
        if (!state.db.videos[vid]) {
          state.db.videos[vid] = {
            videoId: vid,
            title: src.title || vid,
            channel: src.channel || "",
            url: src.url || ytUrl(vid),
            notes: [],
            createdAt: src.createdAt || Date.now(),
            updatedAt: Date.now(),
          };
          videoCount++;
        }
        const dst = state.db.videos[vid];
        if (src.folderId && !dst.folderId) dst.folderId = src.folderId;
        for (const n of src.notes || []) {
          dst.notes.push({
            id: uid(),
            timestamp: Number(n.timestamp) || 0,
            text: String(n.text || ""),
            tags: Array.isArray(n.tags) ? n.tags : [],
            folderId: n.folderId || null,
            createdAt: n.createdAt || Date.now(),
            updatedAt: Date.now(),
          });
          noteCount++;
        }
        dst.updatedAt = Date.now();
      }
      for (const f of obj.folders || []) {
        if (!state.db.folders.find((x) => x.id === f.id)) state.db.folders.push(f);
      }
      for (const f of obj.videoFolders || []) {
        if (!state.db.videoFolders.find((x) => x.id === f.id))
          state.db.videoFolders.push(f);
      }
      Object.assign(state.db.tagPalette, obj.tagPalette || {});
      await saveDb(state.db);
      render();
      alert(`Imported ${videoCount} videos, ${noteCount} notes (Lornote backup).`);
      return;
    }

    // YT Notes legacy backup → keys like "notes_<videoId>": [{id,text,timestamp,createdAt}]
    const noteKeys = Object.keys(obj).filter(
      (k) => k.startsWith("notes_") && Array.isArray(obj[k])
    );
    if (noteKeys.length) {
      let videoCount = 0;
      let noteCount = 0;
      const skipKeys = new Set(["notes_panel_width"]);
      for (const k of noteKeys) {
        if (skipKeys.has(k)) continue;
        const videoId = k.slice("notes_".length);
        const src = obj[k];
        if (!videoId || src.length === 0) continue;
        if (!state.db.videos[videoId]) {
          state.db.videos[videoId] = {
            videoId,
            title: videoId,
            channel: "",
            url: ytUrl(videoId),
            notes: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          videoCount++;
        }
        const dst = state.db.videos[videoId];
        for (const n of src) {
          if (!n || typeof n !== "object") continue;
          dst.notes.push({
            id: uid(),
            timestamp: Number(n.timestamp) || 0,
            text: String(n.text || ""),
            tags: [],
            folderId: null,
            createdAt: n.createdAt
              ? new Date(n.createdAt).getTime() || Date.now()
              : Date.now(),
            updatedAt: Date.now(),
          });
          noteCount++;
        }
        dst.updatedAt = Date.now();
      }
      await saveDb(state.db);
      render();
      alert(
        `Imported ${noteCount} notes across ${videoCount} videos (YT Notes backup).\n\nTitles will fill in next time you visit each video.`
      );
      return;
    }

    alert("Unrecognized JSON shape. Expected Lornote export or YT Notes backup.");
  }

  function doExport() {
    const blob = new Blob([JSON.stringify(state.db, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lornote-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Wire up ---

  function wire() {
    document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
      el.addEventListener("click", () => {
        state.view = { type: el.dataset.view };
        render();
      });
    });

    document.getElementById("search").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderResults();
    });

    const importDlg = document.getElementById("import-dialog");
    const fileInp = document.getElementById("import-file");
    document.getElementById("import").addEventListener("click", () => {
      document.getElementById("import-text").value = "";
      fileInp.value = "";
      importDlg.showModal();
    });
    importDlg.addEventListener("close", async () => {
      if (importDlg.returnValue !== "default") return;
      const file = fileInp.files && fileInp.files[0];
      if (file) {
        try {
          const txt = await file.text();
          const obj = JSON.parse(txt);
          await doImportJson(obj);
          return;
        } catch (e) {
          alert("Could not parse JSON file: " + e.message);
          return;
        }
      }
      const txt = document.getElementById("import-text").value;
      if (txt) await doImport(txt);
    });

    const folderDlg = document.getElementById("folder-dialog");
    document.getElementById("new-folder").addEventListener("click", () => {
      document.getElementById("folder-name").value = "";
      folderDlg.showModal();
    });
    folderDlg.addEventListener("close", async () => {
      if (folderDlg.returnValue === "default") {
        const name = document.getElementById("folder-name").value;
        if (name) await createFolder(name);
      }
    });

    document.getElementById("export").addEventListener("click", doExport);

    document.getElementById("new-vfolder").addEventListener("click", () =>
      openVideoFolderEditor(null)
    );

    const ls = document.getElementById("layout-switch");
    ls.querySelectorAll("button").forEach((b) => {
      if (Number(b.dataset.cols) === state.layout) b.classList.add("active");
      b.addEventListener("click", async () => {
        state.layout = Number(b.dataset.cols);
        ls.querySelectorAll("button").forEach((x) =>
          x.classList.toggle("active", x === b)
        );
        state.db.settings = state.db.settings || {};
        state.db.settings.layout = state.layout;
        await saveDb(state.db);
        renderResults();
      });
    });

    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      state.db = changes[STORAGE_KEY].newValue || {
        videos: {},
        folders: [],
      };
      state.db.tagPalette = state.db.tagPalette || {};
      state.db.settings = state.db.settings || { quickActions: "hover" };
      state.db.videoFolders = state.db.videoFolders || [];
      render();
    });
  }

  async function boot() {
    state.db = await loadDb();
    state.layout = (state.db.settings && state.db.settings.layout) || 1;
    wire();
    render();
  }
  boot();
})();
