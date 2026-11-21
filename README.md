# StageChord

Mobile-friendly ChordPro viewer and setlist manager. Runs entirely in the browser — no server, no accounts, works offline.

## Features
- Display ChordPro songs with chords above lyrics
- Transpose, add stave notation, edit chords and lyrics
- Edit a song's name and info (artist, key, tempo, etc.) with **Edit info**. The info lines at the top of a ChordPro file are hidden when a song is displayed. The key is a label for the chords as written: correcting it never moves the chords, and it's stored relative to the song's transpose
- **ChordPro converter** (`chordpro-converter.html`, linked from Songs & Help): paste a chord sheet or open a PDF, then **Add to StageChord** or download it
- Organise songs into **Libraries** (e.g. Church, Funk Band)
- Build and save **Sets** (setlists) per library
- Share sets as a link or file
- Import **Bundles** of songs from the Songs & Help page
- Installable as a PWA on iOS and Android

Done features, ideas and parked work are listed in [FEATURES.md](FEATURES.md).

## Guiding principle: it must work on rubbish old devices

**Every change must work on old iPads and old browsers, or fall back gracefully.** Musicians run StageChord on whatever tablet is on the music stand, often years out of date. In practice:

- No build step, so write JavaScript and CSS that old Safari can parse. In new code avoid optional chaining (`?.`), `??`, regex lookbehind, `Object.fromEntries`, `replaceAll`, `<dialog>`, flexbox `gap` and CSS `min()`/`max()`. If the app module fails to parse, the whole app falls back to the limited non-module script in `index.html`.
- Use plain DOM for UI (`createElement`, `addEventListener`, fixed overlays), and use 16px inputs so iOS doesn't zoom.
- If a feature can't work on a device, the rest of the app must still work: feature-detect, wrap risky calls in `try/catch`, and provide a fallback (see the iOS fallback menu and the non-module import fallback).
- Run `npm run check:old-browsers` (CI runs it on every PR). It fails on syntax and APIs old Safari can't run. The `ipad-legacy` Playwright project only fakes an old user agent on a modern engine, so it tests the fallback menus but can't catch syntax errors. That's what the check is for.

## ChordPro files

- **Header metadata is hidden.** Every line starting with `{` at the top of the file, up to the first lyric or section line, counts as metadata and is never shown. That includes a tag missing its `}` and a tag spread over several lines (`{flow: Intro` … `V2 Ch}`). The search for a missing `}` stops at a blank line, a new `{`, a chord line or 12 lines, so a stray `{` can't hide the song. All of this lives in `parser.js` (`classifyLines`), which the renderer and the editors share.
- **Tags the app uses:** `title`, `key`, `tempo`. Others (`artist`, `flow`, …) are kept and editable but not displayed. If a key appears more than once, the header wins over the body, and the first header value wins.
- **`{sc-comment: …}`** is StageChord's own tag for a comment under a section heading. It's the only `{…}` line shown in the song.
- **Edits never change the original text.** The original is kept for de-duplication and set imports. Chord, comment, key, tempo and details edits are stored as the song's edited text, Reset discards them, and bundles and shared sets carry them.

## Development

### Prerequisites
- Node.js 20 or later (required by Playwright)
- Playwright browsers, installed once per machine after `npm install`:

```
npx playwright install chromium webkit
```

### Running tests

```
npm install        # install dev dependencies (Jest, Playwright)
npm test           # unit tests (Jest)
npm run test:e2e   # end-to-end tests (Playwright)
npm run test:all   # old-browser check + both suites
npm run check:old-browsers   # just the iOS 12 syntax check

npm run test:e2e:ui       # Playwright UI: pick tests, watch them run, step through each action
npm run test:e2e:headed   # run in a visible Chromium window, one test at a time
```

The end-to-end tests start their own local server (`tests/e2e/serve.mjs`) and run each flow in desktop Chromium, a modern iPad, and an iOS 12 iPad profile. That last one exercises the iOS fallback menu. Run `npx playwright test --project=chromium` for a quicker single-browser pass.

Both suites run in GitHub Actions on every pull request and on pushes to `main` (`.github/workflows/tests.yml`). If the end-to-end tests fail, the `playwright-report` artifact on the run has the HTML report and a trace of each failed test (open it with `npx playwright show-trace`).

### Running the app locally

```
node tests/e2e/serve.mjs     # then open http://localhost:4173/index.html
```

Any static file server works, since there's no build step. The service worker caches the app, so after editing files do a hard reload, or tick "Bypass for network" (DevTools → Application → Service workers).

## Working together

Changes are infrequent (roughly monthly, one person at a time), so the process is deliberately light:

1. **Small cosmetic tweaks (spacing, wording, colours): the quick path.** Make the change, look at it in a browser locally (see "Running the app locally"), push straight to `main`, and ship. No new tests and no PR needed. CI still runs on the push. When asking Claude, say "quick tweak" and start a fresh session, which keeps it fast and cheap.
2. **Anything else: branch, then open a PR to `main`.** CI runs the old-browser check, unit tests and end-to-end tests. Merge when it's green. Ask the other person to look first if the change touches storage (`db.js` and the fallback in `index.html`), the service worker, or old-device support.
3. **Don't bump version numbers in a change.** `CACHE_VERSION` and the `?v=` build IDs in the repo are dev values. The release stamps the real version (see below), so there's nothing to conflict over.
4. **`main` should always be safe to release.**

## Releasing and deploying

**To ship, ask Claude to "ship it", or run this yourself** (needs the GitHub CLI, `gh`, logged in):

```
git checkout main && git pull
npm run release -- 1.2        # next version number; earlier releases were 1.0 and 1.1
```

`scripts/release.cjs` checks that `main` is clean, pushed and passing CI, and that the version is new. It then creates the GitHub release, with notes generated from the merged PRs, and follows the deploy until it's live. Nobody edits version numbers by hand.

Creating the release triggers the **Deploy** workflow (`.github/workflows/deploy.yml`), which:

1. runs the quick checks (old-browser check and unit tests, a few seconds). The full browser tests already passed on `main`, and the release script won't ship a commit unless they did;
2. builds `dist/` with `scripts/build-deploy.cjs`, a copy of the deploy files stamped with the tag (`?v=1.2`, `CACHE_VERSION = 'sv-1.2'`);
3. uploads `dist/` over FTPS, with `service-worker.js` last;
4. if the `APP_URL` repo variable is set, checks that the live `service-worker.js` reports the new version.

The release notes are the changelog. A release's tag is exactly what's live.

To **redeploy** a release: Actions → Deploy → *Run workflow*, and choose the release **tag** (not a branch) under "Use workflow from". To **roll back**, redeploy an older tag. It gets a different cache version, so devices are offered it as an update.

**Setup (once):** repo Settings → Secrets and variables → Actions:
- Secrets: `FTP_HOST`, `FTP_USERNAME`, `FTP_PASSWORD`, plus optional `FTP_REMOTE_DIR` (default `.`, the FTP account's home directory, which should be the app's folder).
- Variable: `APP_URL`, the app's public URL ending in `/`.

If the upload fails with a certificate error, set `FTP_HOST` to the server's own hostname (the one the host's control panel shows for FTP), not your domain.

**Emergency manual deploy:** `node scripts/build-deploy.cjs 1.2.1`, then upload the contents of `dist/` with `service-worker.js` last. Use a version number that hasn't been used before.

### How updates reach devices

The app is **cache-first**: it always opens instantly from the version installed on the device, even offline or on bad venue wifi, and never waits on the network. A new deploy downloads quietly in the background. The device then shows a dot on the menu button and an **Update Available** item, and the new version applies only when the user taps it. **Nothing may ever auto-update or auto-reload**, because it could happen mid-song on stage.

A new `CACHE_VERSION` is what triggers the update offer, which is why every release must have a new version.

**Server caching matters.** The host tells browsers to keep files for up to 30 days. If a browser keeps an old `service-worker.js`, it never notices a release and says "up to date". Three things prevent this:
- `deploy/htaccess`, uploaded as `.htaccess`, sets `no-cache` on `service-worker.js` and the HTML pages. The deploy never overwrites an `.htaccess` it didn't create, and it warns if the header is missing.
- The service worker is registered with `updateViaCache: 'none'`.
- A new version installs with `cache: 'reload'`, so it never reuses stale files.

## How it works

| File | Role |
|---|---|
| `index.html` | App shell; inline script with the service-worker update manager and a **non-module fallback** that can still import bundles/sets if `app.js` fails to load |
| `app.js` | The app: rendering, transposing, editing, sets, libraries, menus |
| `parser.js` | ChordPro parsing (shared with the tests) |
| `db.js` | IndexedDB storage |
| `stave.js` | Stave notation (loads `vexflow.bundle.js` on demand) |
| `service-worker.js` | Offline cache and update staging; `APP_ASSETS` is the list of files cached |
| `help.html`, `songlibs/` | Songs & Help page and the downloadable song bundles |
| `chordpro-converter.html` | Standalone chord sheet / PDF → ChordPro converter. **Add to StageChord** leaves the song in `localStorage` (`stagechord_pending_song`) and opens `index.html`, which adds it to the current library. Pasting works on old iPads; the PDF reader (pdf.js from cdnjs) needs a newer browser, so the button is replaced with a message there. Not in the offline cache |

**Data** (IndexedDB, per device, never sent anywhere):
- **libraries**: songs and sets belong to one library (e.g. Church, Funk Band).
- **songs**: `filename` and `originalText`, which never changes. Duplicates are detected by a hash of the original text, and imported sets match songs the same way.
- **songState**: per-song changes: `transpose` (the song's one key across the app), `annotation` (memo), `stave`, and `editedText` (chord/lyric/metadata edits; Reset clears it).
- **setlists**: ordered song IDs, per library.

**Storage rules:**
- Changing the schema means bumping `DB_VERSION` in `db.js` and adding a migration there. The fallback in `index.html` opens the same database, so update its `FALLBACK_DB_VERSION` to match.
- Bundles and shared sets are versioned (`version: 2`). Keep importing older files working.

**Users' data:** everything lives in the browser on that device. **Deleting the iOS home-screen app wipes its library.** If someone's app is stuck, tell them to force-quit and reopen it. Only suggest reinstalling after they've used *Export Bundle* to save their songs.
