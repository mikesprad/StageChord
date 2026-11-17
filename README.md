# StageChord

Mobile-friendly ChordPro viewer and setlist manager. Runs entirely in the browser — no server, no accounts, works offline.

## Features
- Display ChordPro songs with chords above lyrics
- Transpose, add stave notation, edit chords and lyrics
- Organise songs into **Libraries** (e.g. Church, Funk Band)
- Build and save **Sets** (setlists) per library
- Share sets as a link or file
- Import **Bundles** of songs from the Songs & Help page
- Installable as a PWA on iOS and Android

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

## Deployment

Copy the following files/folders to your web server root (no build step required):

```
index.html
help.html
app.js
db.js
parser.js
stave.js
styles.css
manifest.json
service-worker.js
vexflow.bundle.js
icons/
songlibs/
```

Serve over HTTPS for PWA install and service worker support. All data is stored in the browser's IndexedDB — nothing is sent to the server.
