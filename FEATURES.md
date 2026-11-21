# StageChord — Feature Roadmap

## Implemented Feature Details
The full implementation notes are preserved in `IMPLEMENTED_FEATURE_DETAILS.md`.

## Completed Features
- PWA / Offline Mode: installable on mobile, service worker caching, add-to-home-screen support, update-aware cache versioning.
- Session Sharing: export/import setlists via link or `.stagechord.json` file, with deduplication and auto-import.
- Open Set from Link: import full hosted sets via `?setUrl=` (HTTPS), with draft auto-save, partial import tolerance, and clear status messaging.
- Online Song Directory: fetch song manifests and `.chorpro` files from static hosting.
- Musical Stave / Notation: VexFlow-based stave editor with notes, rests, key/time signatures, and persistent song data.
- In-App Chord Editing: tap chords/lyrics to edit, delete, insert, and reset with transpose-safe storage.
- Packaged Song Library: bundle import support for offline onboarding via Songs & Help page.
- Quick UI Improvements: cleaner button layout, edit hints, tempo flash, and usability refinements.
- Older iPad / iOS compatibility fallback for the Manage menu.
- Older iPad / iOS compatibility hardening: iOS 12 / Safari 12-safe code (enforced by `npm run check:old-browsers`), desktop-mode iPad detection, and non-module fallback import support for bundle and set files.
- Font size controls for both lyrics and chords with alignment preserved.
- Reorder Set replaces Song Order and includes remove-song controls.
- User-controlled updates: the app always opens from the installed version (cache-first); a new version downloads in the background and shows as "Update Available", applying only when the user taps it. Never auto-reloads.
- Android tempo flash now validates BPM values for stability.
- Song info (1.2–1.5): the ChordPro header (every `{...}` line at the top, including unclosed or multi-line tags) is hidden when the song is shown. "Edit info" on the title row edits the song name and info lines (artist, etc.). Changes are saved as the song's edits; the original file is kept.
- Release process (1.2–1.5): `npm run release -- X.Y` (or ask Claude to "ship it") publishes a GitHub release, which deploys over FTPS. The server no longer caches service-worker.js or HTML, so devices see updates.
- ChordPro converter (1.7–1.11): `chordpro-converter.html`, from the menu (Convert File) and Songs & Help. Paste a chord sheet or open a PDF. It reads title, writers, artist, key, tempo and time, keeps footers (CCLI, copyright) out of the lyrics, handles large print, letter-by-letter PDFs, repeat marks, bar lines and beats, and joins wrapped bar lines. Chords stay exactly where the sheet puts them, and split words are left as written. **Add to StageChord** adds the song to the current library and opens it. On old iPads pasting works but PDF doesn't.
- Keys (1.8–1.11): key and tempo are edited in Edit info. Keys are always shown as major (a minor key as its relative major). With no `{key}`, the key is worked out from all the chords.
- Stage use (1.10–1.11): swipe left/right on a song to change song in the set (also while scrolling). No page zoom (it pushed the control bar off the screen); a pinch changes the song text size instead, like A-/A+.
- "Update Available" that never cleared is fixed (1.9).
- Multi-Library support: separate song/set contexts (e.g. Church, Funk Band) with Switch Library, Manage Libraries, and per-library bundle export/import. Songs and sets are library-scoped. Existing data migrated to Default library on upgrade (IndexedDB v2).

## Potential Features
- Comment Anywhere (feature request, not yet implemented): allow adding a comment at any position in a song flow (between lines, before/after a section, or next to chord/lyric lines) using the same rendering/behavior as existing comments.
- UI ideas to explore for Comment Anywhere:
	- Edit-mode insertion handles: show small "+ comment" controls between lines/sections.
	- Long-press context action: long-press a line or section and choose "Add comment before" or "Add comment after".
	- Structure lane: add a lightweight timeline/outline lane where comments can be dropped between section markers.
	- Keyboard-first shortcut (desktop/tablet): focused line + shortcut opens comment editor at cursor position.
- Display how far the current key is from the original key.
- Copy or move songs between libraries in bulk.
- Export all libraries in one file.

## Parked for later
- **Export / email ChordPro:** download a song, or a whole set, as `.chopro` files (with edits and song info applied) and email them. Editing already stores the changes; this is the "get them out" half.
- **Test site:** deploy to a test copy before going live. Caveat: a path like `spradbery.com/stagechord/test` is the same origin as the live app, so on a given device it would share (and could damage) the live song library. Use a subdomain whose docroot is a folder inside the FTP home instead, or give the test build a different database name.
- **GitHub Actions housekeeping:** move `actions/checkout`, `actions/setup-node`, `actions/cache` and `actions/upload-artifact` to versions that run on Node 24. CI shows deprecation warnings for these now, but they still work. Also watch for `ubuntu-latest` moving to Ubuntu 26.

## Suggested Priorities
1. Display key distance from original
2. Add comment anywhere
3. Bulk copy/move songs between libraries
4. Further older device compatibility improvements
