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

## 6. Packaged Song Library
**Status:** Complete  
**Effort:** Low  
**Dependencies:** None  

Pre-load a curated song library with the app, so users don't start from scratch.

### Approach
- Host a library JSON file at a known URL (e.g. same server, or GitHub raw).
- Add a menu item (e.g. "Load Shared Library") that fetches the URL and imports all songs.
- Optionally bundle a snapshot as a local fallback for offline/first-load.
- Uses the existing `importLibrary()` function — no new DB logic needed.

### Considerations
- Library JSON is the same format as "Export Library" produces.
- Updates are easy: edit the hosted file, users re-import to get new songs.

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
- **Font size controls:** Added `Aa-` / `Aa+` controls that scale lyric and chord text together while keeping alignment intact.
- **Manage Set:** Renamed the song order panel to Manage Set and added a remove-song control in the reorder list.
- **Contact email:** A "Contact" mailto link (`stagechord@spradbery.com`) is shown at the bottom of the Manage menu.
- **Usage tracking:** A silent 1×1 tracking pixel is requested on app load (`https://spradbery.com/stagechord/ping.gif`) to count usage. Fails silently if offline — no errors shown to the user.
- **Button row:** Comment, Stave, and Edit buttons are on their own line below the key/tempo info for a cleaner layout.
- **Edit mode (key/tempo):** The "Edit" button (formerly "Edit Chords") now also exposes inline Key and Tempo fields. Editing the key respects the current transpose offset — the stored key is un-transposed before writing back to the ChordPro `{key:}` directive. Tempo is written as `{tempo:}`. Both are standard ChordPro metadata directives.
- Could auto-import on first visit (empty IndexedDB) for zero-friction onboarding.

---

## Priority Order (suggested)
1. **#1 PWA** ✅ Complete
2. **#2 Session Sharing** ✅ Complete
3. **#4 Musical Stave** ✅ Complete
4. **#5 In-App Chord Editing** ✅ Complete
5. **#7 Quick UI Improvements** ✅ Complete
6. **#3 Online Song Directory** — Complete
7. **#6 Packaged Song Library** — Complete
