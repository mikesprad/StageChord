// Minor keys: shown as "Am" (not "A"), spelled with their relative major's
// sharps/flats when transposed, and worked out from the chords when there's no {key:}.
import { test, expect, openApp, addSongsToLibrary, selectSong, transposeBy, expectKey, chordLocator, keyLocator } from './helpers.js';

const MINOR = { file: 'minor-key-test.chopro', title: 'Minor Key Test' };
const INFERRED_MINOR = { file: 'inferred-minor.chopro', title: 'Inferred Minor' };
const STARTS_ON_VI = { file: 'starts-on-vi.chopro', title: 'Starts On Vi' };

test('a minor key is shown as minor and transposes with flats where its relative major has them', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [MINOR]);
    await expectKey(page, 'Am');
    await transposeBy(page, 1);
    await expectKey(page, 'Bbm');
    await expect(chordLocator(page).first()).toHaveText('Bbm');
});

test('the key is worked out from the chords: Am only if the song starts and ends on Am', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [INFERRED_MINOR, STARTS_ON_VI]);
    await selectSong(page, INFERRED_MINOR);
    await expect(keyLocator(page)).toHaveText(/^Key \(inferred\): Am\s/);
    await selectSong(page, STARTS_ON_VI);
    await expect(keyLocator(page)).toHaveText(/^Key \(inferred\): C\s/);
});
