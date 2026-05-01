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
- Older iPad / iOS compatibility hardening: Safari 15-safe parsing, desktop-mode iPad detection, and non-module fallback import support for bundle and set files.
- Font size controls for both lyrics and chords with alignment preserved.
- Reorder Set replaces Song Order and includes remove-song controls.
- Check for Update menu item that forces cache refresh and reloads the app without clearing IndexedDB.
- Android tempo flash now validates BPM values for stability.
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

## Suggested Priorities
1. Display key distance from original
2. Add comment anywhere
3. Bulk copy/move songs between libraries
4. Further older device compatibility improvements
