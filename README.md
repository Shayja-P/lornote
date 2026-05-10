# Lornote

Firefox extension for taking timestamped notes on YouTube videos. Local-first, no accounts, no telemetry.

## Features

- Floating notes panel on every YouTube watch page (works in fullscreen too)
- Timestamped notes — click the timestamp to jump back to that moment
- White dots on the player progress bar mark where notes exist; click to seek + open the note
- Pause-on-type: when you start typing, video pauses; resumes 5 s after the last keystroke
- YouTube hotkeys (A, J, K, L, C, …) suppressed while typing in the panel
- Per-note hover actions: assign a folder, add tags with custom colors (12-color palette)
- "Save video to folder" action — group whole videos into video folders with a multiline description
- Library tab (toolbar icon): all notes across all videos, with
  - Note folders, video folders, tag chips
  - Search across title, text and tags
  - Layout switch: list, 2/3/4/5/6-column grid
  - Collapsible video cards
  - Settings cog: quick-action visibility (always / hover / never)
- Import / Export
  - Plain text paste (e.g. `(4) Title<URL>Notes:[1:00] first[1:28] second`)
  - JSON file import — accepts Lornote exports and `notes_<videoId>` legacy backups
  - JSON export of the entire database

## Install

### Temporary (development)

1. Clone this repo
2. Open `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on** → pick `manifest.json`

Resets when Firefox restarts.

## Build a signed-ready ZIP

```bash
cd lornote
zip -r -X lornote.zip . -x "*.DS_Store" "*.zip" "*.git*"
```

`manifest.json` must sit at the **root** of the ZIP.

## Storage

Everything lives in `browser.storage.local` under the key `ytmarker:db:v1`.
Schema:

```jsonc
{
  "videos": {
    "<videoId>": {
      "videoId": "...",
      "title": "...",
      "channel": "...",
      "url": "...",
      "folderId": "<videoFolderId|null>",
      "notes": [
        { "id": "...", "timestamp": 60, "text": "...", "tags": ["..."], "folderId": "<noteFolderId|null>", "createdAt": 0, "updatedAt": 0 }
      ]
    }
  },
  "folders":      [{ "id": "...", "name": "..." }],
  "videoFolders": [{ "id": "...", "name": "...", "description": "..." }],
  "tagPalette":   { "tagName": "#hex" },
  "settings":     { "quickActions": "hover", "layout": 1 }
}
```

The Library importer also accepts the legacy `{ "notes_<videoId>": [...] }`
shape from older note-taking extensions.

## License

[MIT](LICENSE) © 2026 Shayja-P
