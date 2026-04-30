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

## Development

```
npm install   # install dev dependencies (Jest)
npm test      # run parser unit tests
```

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
