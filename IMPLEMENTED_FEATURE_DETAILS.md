# StageChord — Implemented Feature Details

## 1. PWA / Offline Mode
**Status:** Complete  
**Effort:** Low  
**Dependencies:** None  

StageChord is installable as a standalone app on mobile (Add to Home Screen) with full offline support.

### Implementation
- `manifest.json` with app name, icons, theme color (#2f7d6c), standalone display mode
- `service-worker.js` caches the app shell on install; uses network-first for app files (so updates take effect immediately) and cache-first for CDN assets (VexFlow)
- Old caches are cleaned up on service worker activation
- Apple meta tags for iOS Safari (apple-mobile-web-app-capable, apple-touch-icon)
- **"Add as App" menu button** in the Manage menu:
  - On Android Chrome: captures `beforeinstallprompt` and triggers the native install dialog
  - On iOS Safari: shows instructions to use Share → Add to Home Screen
  - Button auto-hides when already installed or after successful install
- Service worker version string (`CACHE_VERSION`) is bumped on each release; browser checks for updates in the background

---

## 2. Session Sharing
**Status:** Complete  
**Effort:** Medium  
**Dependencies:** None  

Share a complete set (song files, order, transpose, annotations, stave) with another user.

### Implementation
- **Share as Link:** Exports the setlist JSON, compresses it with deflate-raw via `CompressionStream`, base64url-encodes it, and places it in the URL hash fragment (`#setlist=...`). Uses the Web Share API or copies the link to clipboard. Recipients click the link and the app auto-imports the set.
- **Share as File:** Exports a `.stagechord.json` file via Web Share API, with download fallback.
- URL hash is cleaned after import so reloads don't re-import.
- On import, songs are added to the library (deduplicated by content hash) and a new setlist is created.

---

## 3. Online Song Directory
**Status:** Complete  
**Effort:** Medium  
**Dependencies:** Web server or static hosting for song files  

Load songs from an online directory instead of (or in addition to) local file upload.

### Approach
- Host `.chorpro` files on a web server (user's own server, or GitHub raw files).
- Serve a `songs.json` manifest listing available files.
- App fetches manifest, shows a song picker, fetches individual files on demand.
- No special backend needed — static file hosting is sufficient.

### Considerations
- **CORS:** If app is on GitHub Pages and songs are on a different domain, the server needs `Access-Control-Allow-Origin` headers. Same domain = no issue.
- **Sharing synergy:** With an online directory, session sharing (#2) only needs to transmit filenames + metadata (~200 bytes), not full file contents. Makes QR codes and URL sharing viable.

---

## 4. Musical Stave / Notation
**Status:** Complete  
**Effort:** High  
**Dependencies:** VexFlow (loaded from CDN)  

Displays a musical stave with notes per song. Users can add notes (semiquaver, quaver, crotchet, minim, semibreve) and rests, choosing pitch from scale-aware buttons. Supports key signatures, time signatures (4/4, 6/8), accidentals, dotted notes, ties, barlines, and octave up/down. Stave data is stored in localStorage per song. SVG icons for duration buttons ensure mobile compatibility. VexFlow renders notation as inline SVG.

---

## 5. In-App Chord Editing
**Status:** Complete  
**Effort:** Medium  
**Dependencies:** None  

Edit chords directly in the viewer by tapping/clicking them. Toggle edit mode, then tap any chord to change or delete it, or tap lyrics to insert new chords.

### Implementation
- **Edit mode toggle:** An "Edit Chords" button activates edit mode. Chords display a dashed underline to indicate they are tappable.
- **Chord popup:** Tapping a chord shows a popup positioned near the chord with all unique chords from the song (transposed to the current display key), plus a custom chord input field.
- **Change chord:** Select a chord from the popup grid or type a custom chord to replace the tapped chord.
- **Delete chord:** A "Delete Chord" button in the popup removes the chord from that position.
- **Insert chord:** In edit mode, tapping a lyric line (or lyric segment without a chord) opens the popup to add a new chord at that position.
- **Transpose compatibility:** Edits are stored as modified ChordPro source text in the original key. When the song is transposed, edited chords transpose correctly alongside all other chords.
- **Reset:** A "Reset Chords" button appears when the text differs from the original, allowing users to revert all chord edits.
- **Persistent storage:** The edited ChordPro text is saved in `songState.editedText` in IndexedDB. The original text is preserved separately for reset capability.

---

## 6. Song Bundles
**Status:** Complete  
**Effort:** Low  
**Dependencies:** None  

Pre-load a curated song collection via the Songs & Help page, so users don't start from scratch.

### Approach
- Host a bundle JSON file at a known path on the same server.
- Songs & Help lists available bundles with an "Import Bundle into Current Library" button and a Download link.
- Clicking Import stores the URL and active library id in localStorage, redirects to the app, which fetches and imports the bundle into the active library.
- Uses `importLibrary()` — no new DB logic needed.

### Considerations
- Bundle JSON version-agnostic: accepts any version field or a plain songs array.
- Imports always go into the active library (not always Default).

---

## 7. Quick UI Improvements
**Status:** Complete  
**Effort:** Low  
**Dependencies:** None  

A collection of small UX enhancements:

- **Scroll button label:** Renamed "Auto Scroll" to "Scroll" (and "Stop Scroll" to "Stop") to save nav bar space.
- **Edit tip:** When Edit mode is active, a small italic hint ("click chord / lyric to edit") appears below the sticky nav bar.
- **Tempo flash:** Clicking the tempo indicator (e.g. "Tempo: 120") flashes the sticky nav bar at the song's BPM as a visual metronome. Continues until clicked again or a new song is selected.
- **Android tempo robustness:** Tempo flash now validates BPM before starting, preventing crashes on older Android browsers.
- **Check for Update:** Added a "Check for Update" button under Songs & Help that updates the service worker, clears cached app files, and reloads the app without removing IndexedDB data.
- **Older iPad compatibility:** Added fallback action buttons for adding songs and browsing the library when the Manage menu may not behave reliably.
- **iOS 15 reliability hardening:** Replaced Safari-15-incompatible regex lookbehind in chord-edit tokenization so the main app module loads on older Safari engines.
- **Desktop-mode iPad detection:** Added fallback detection for iPadOS devices that report as `Macintosh` Safari 15, ensuring the compatible menu path is chosen.
- **Non-module import fallback:** When the module app cannot load, fallback script imports bundles and set files directly into IndexedDB. Fallback DB version matches main app (v2). Bundle imports go into active library via pending library id handoff.
- **Font size controls:** Added `Aa-` / `Aa+` controls that scale lyric and chord text together while keeping alignment intact.
- **Reorder Set:** Renamed the song order panel to Reorder Set and added a remove-song control in the reorder list.
- **Contact email:** A mailto link (`stagechord@spradbery.com`) is shown at the bottom of Songs & Help (removed from main menu).
- **Button row:** Comment, Stave, and Edit buttons are on their own line below the key/tempo info for a cleaner layout.
- **Edit mode (key/tempo):** The "Edit" button now also exposes inline Key and Tempo fields. Editing the key respects the current transpose offset. Both use standard ChordPro metadata directives.

---

---

## 8. Multi-Library Support
**Status:** Complete  
**Effort:** High  
**Dependencies:** None  

Organise songs and sets into separate libraries (e.g. Church, Funk Band). Each library is an isolated context with its own songs and saved sets.

### Implementation
- **IndexedDB v2 migration:** New `libraries` store. `songs` and `setlists` get a `libraryId` field. Existing rows migrated to Default on upgrade.
- **Default library:** Created on first run (id=1). Cannot be renamed or deleted.
- **Switch Library:** Prompts to save current set first. Restores last-used set for the target library.
- **Manage Libraries:** Create (17-char name limit, unique), rename, or delete. Delete moves songs and sets to Default.
- **Library-scoped queries:** `getAllSongs`, `getAllSetlists`, `addSong`, `saveSetlist`, `importLibrary`, `importSetlist` all accept `libraryId`.
- **Duplicate detection:** Per-library compound index `libraryContentHash` replaces the old global content-hash index.
- **Session persistence:** `currentLibraryId` and `libraryPerSetlist` written to localStorage on every change; flushed on every app startup so other pages always read the correct library.
- **Songs & Help import:** `stagechord_pending_import_library_id` carries the active library id across the redirect; app reads it directly without a DB round-trip.

---

## Priority Order
1. **#1 PWA** ✅
2. **#2 Session Sharing** ✅
3. **#4 Musical Stave** ✅
4. **#5 In-App Chord Editing** ✅
5. **#7 Quick UI Improvements** ✅
6. **#3 Online Song Directory** ✅
7. **#6 Song Bundles** ✅
8. **#8 Multi-Library Support** ✅
