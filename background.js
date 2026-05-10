const api = typeof browser !== "undefined" ? browser : chrome;

api.action.onClicked.addListener(async () => {
  const url = api.runtime.getURL("library/library.html");
  const tabs = await api.tabs.query({});
  const existing = tabs.find((t) => t.url && t.url.startsWith(url));
  if (existing) {
    await api.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await api.windows.update(existing.windowId, { focused: true });
    }
  } else {
    await api.tabs.create({ url });
  }
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "openLibrary") {
    api.tabs.create({ url: api.runtime.getURL("library/library.html") });
    sendResponse({ ok: true });
  }
  return true;
});
