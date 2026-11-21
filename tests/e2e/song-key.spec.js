// Keys are always shown as major: a minor key is shown as its relative major
// (Am -> C), and with no {key:} the key is worked out from the chords.
import { test, expect, openApp, addSongsToLibrary, selectSong, transposeBy, expectKey, chordLocator, keyLocator } from './helpers.js';

const MINOR = { file: 'minor-key-test.chopro', title: 'Minor Key Test' }; // {key: Am}
const INFERRED_MINOR = { file: 'inferred-minor.chopro', title: 'Inferred Minor' };
const STARTS_ON_VI = { file: 'starts-on-vi.chopro', title: 'Starts On Vi' };

test('{key: Am} is shown as C, and transposes like C', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [MINOR]);
    await expectKey(page, 'C');
    await transposeBy(page, 1);
    await expectKey(page, 'Db');
    await expect(chordLocator(page).first()).toHaveText('Bbm');
});

test('with no key, songs in C that start (or start and end) on Am are shown in C', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [INFERRED_MINOR, STARTS_ON_VI]);
    await selectSong(page, INFERRED_MINOR);
    await expect(keyLocator(page)).toHaveText(/^Key \(inferred\): C\s/);
    await selectSong(page, STARTS_ON_VI);
    await expect(keyLocator(page)).toHaveText(/^Key \(inferred\): C\s/);
});
