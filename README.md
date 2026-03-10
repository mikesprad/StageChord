# StageChord

Lightweight ChordPro renderer.

Pick one or more text files from your device, and the app displays song lyrics with chords shown above the corresponding words in bold. Works on phones/tablets using the browser's File API.

## Development

- `npm install` to get dev dependencies (Jest for parser tests).
- `npm test` runs parser unit tests.

## Usage

Open `index.html` in a browser (or serve directory with `npx http-server .`). Select `.chorpro` files and navigate between songs.
