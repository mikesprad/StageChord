// One key per song: importing a set (file or link) sets each song's key across
// the whole app, including songs already in the library. Annotations, staves and
// edits on existing songs are kept.
import { readFile } from 'node:fs/promises';
import {
    test, expect, openApp, waitForAppReady, waitForDialog, clickMenu, addSongsToLibrary,
    addFromLibrary, importSetFile, newSet, saveSet, loadSet, selectSong, transposeBy, expectKey,
    chordLocator, readDb, songState, songTranspose, buildSetFile, shareLinkPath,
    SONG_ONE, SONG_TWO
} from './helpers.js';

const KEYS_UPDATED = /Updated the key of (\d+) existing song\(s\) to match the set\./;

// Library with both songs, SONG_ONE's key moved from G to A.
async function libraryWithKey(page) {
    await openApp(page);
    await addSongsToLibrary(page, [SONG_ONE, SONG_TWO]);
    await transposeBy(page, 2);
    await expectKey(page, 'A');
    await expect.poll(() => songTranspose(page, SONG_ONE)).toBe(2);
}

test('importing a set file updates the key of songs already in the library', async ({ page }) => {
    await libraryWithKey(page);

    const message = await importSetFile(page, buildSetFile('Gig', [
        { song: SONG_ONE, transpose: 5 },
        { song: SONG_TWO, transpose: 2 }
    ]));
    expect(message).toMatch(/^Imported set "Gig" with 2 song\(s\), 0 skipped\./);
    expect(message.match(KEYS_UPDATED)?.[1]).toBe('2');

    await expect(page.locator('#current-song-title')).toHaveText(SONG_ONE.title);
    await expectKey(page, 'C');
    await expect(chordLocator(page)).toHaveText(['C', 'F', 'G']);
    await selectSong(page, SONG_TWO);
    await expectKey(page, 'E');

    expect(await songTranspose(page, SONG_ONE)).toBe(5);
    expect(await songTranspose(page, SONG_TWO)).toBe(2);
    // No duplicate songs were created.
    expect((await readDb(page)).songs).toHaveLength(2);
});

test('the imported key applies everywhere the song is used', async ({ page }) => {
    await libraryWithKey(page);
    await saveSet(page, 'Sunday');

    await importSetFile(page, buildSetFile('Gig', [{ song: SONG_ONE, transpose: 7 }]));
    await expectKey(page, 'D');

    // An existing saved set picks up the new key...
    await loadSet(page, 'Sunday');
    await selectSong(page, SONG_ONE);
    await expectKey(page, 'D');

    // ...and so does a new set.
    await newSet(page);
    await addFromLibrary(page, [SONG_ONE]);
    await expectKey(page, 'D');
});

test('the import message only counts existing songs whose key changed', async ({ page }) => {
    await libraryWithKey(page);

    // Same key as the library: nothing to report.
    const unchanged = await importSetFile(page, buildSetFile('Same', [{ song: SONG_ONE, transpose: 2 }]));
    expect(unchanged).not.toMatch(KEYS_UPDATED);

    const changed = await importSetFile(page, buildSetFile('Different', [
        { song: SONG_ONE, transpose: 4 },
        { song: SONG_TWO, transpose: 0 }
    ]));
    expect(changed.match(KEYS_UPDATED)?.[1]).toBe('1');
});

test('an imported key of 0 resets a transposed song to its original key', async ({ page }) => {
    await libraryWithKey(page);

    await importSetFile(page, buildSetFile('Gig', [{ song: SONG_ONE, transpose: 0 }]));
    await expectKey(page, 'G');
    expect(await songTranspose(page, SONG_ONE)).toBe(0);
});

test('a set file from an older version without song state leaves the key alone', async ({ page }) => {
    await libraryWithKey(page);

    const message = await importSetFile(page, buildSetFile('Old', [{ song: SONG_ONE, state: null }]));
    expect(message).not.toMatch(KEYS_UPDATED);
    await expectKey(page, 'A');
    expect(await songTranspose(page, SONG_ONE)).toBe(2);
});

test('updating the key keeps the existing song annotation', async ({ page }) => {
    await openApp(page);

    // First import adds the song with its annotation; the second only moves the key.
    await importSetFile(page, buildSetFile('First', [{ song: SONG_ONE, transpose: 2, annotation: 'Capo 2' }]));
    await importSetFile(page, buildSetFile('Second', [{ song: SONG_ONE, transpose: 5, annotation: 'Other note' }]));

    await expectKey(page, 'C');
    const state = await songState(page, SONG_ONE);
    expect(state.transpose).toBe(5);
    expect(state.annotation).toBe('Capo 2');
});

test('importing a set with songs new to the library uses its keys', async ({ page }) => {
    await openApp(page);

    const message = await importSetFile(page, buildSetFile('Gig', [{ song: SONG_ONE, transpose: 5 }]));
    expect(message).not.toMatch(KEYS_UPDATED);
    await expectKey(page, 'C');
    expect(await songTranspose(page, SONG_ONE)).toBe(5);
});

test('opening a shared link updates the key and is not re-imported on reload', async ({ page }) => {
    await libraryWithKey(page);

    await openApp(page, shareLinkPath(buildSetFile('Linked', [{ song: SONG_ONE, transpose: 9 }])));
    const message = await waitForDialog(page, /^Imported shared set "Linked"/);
    expect(message.match(KEYS_UPDATED)?.[1]).toBe('1');

    await expectKey(page, 'E');
    expect(await songTranspose(page, SONG_ONE)).toBe(9);
    await expect(page).not.toHaveURL(/#setlist=/);

    // Reloading must not import the set a second time.
    await page.reload();
    await waitForAppReady(page);
    expect((await readDb(page)).setlists.filter((s) => s.name.startsWith('Linked'))).toHaveLength(1);
    await expectKey(page, 'E');
});

test.describe('sharing between two devices', () => {
    // Sender: saved set with SONG_ONE moved to Bb and SONG_TWO in its original key.
    async function senderSet(page) {
        await openApp(page);
        await addSongsToLibrary(page, [SONG_ONE, SONG_TWO]);
        await saveSet(page, 'Tour');
        await transposeBy(page, 3);
        await expectKey(page, 'Bb');
        await expect.poll(() => songTranspose(page, SONG_ONE)).toBe(3);
    }

    // Receiver: same songs, SONG_ONE in A and SONG_TWO moved to Eb.
    async function receiverLibrary(page) {
        await libraryWithKey(page);
        await selectSong(page, SONG_TWO);
        await transposeBy(page, 1);
        await expectKey(page, 'Eb');
        await expect.poll(() => songTranspose(page, SONG_TWO)).toBe(1);
    }

    async function expectSenderKeys(page) {
        await expectKey(page, 'Bb');
        expect(await songTranspose(page, SONG_ONE)).toBe(3);
        // The sender never transposed SONG_TWO, so the receiver's copy goes back to D.
        await selectSong(page, SONG_TWO);
        await expectKey(page, 'D');
        expect(await songTranspose(page, SONG_TWO)).toBe(0);
    }

    test('share as link', async ({ page, otherPage }) => {
        await senderSet(page);
        await clickMenu(page, 'menu-share-set-link');
        await expect.poll(() => page.evaluate(() => window.__copied)).toContain('#setlist=');
        const link = new URL(await page.evaluate(() => window.__copied));

        await receiverLibrary(otherPage);
        await openApp(otherPage, `${link.pathname}${link.hash}`);
        const message = await waitForDialog(otherPage, /^Imported shared set "Tour"/);
        expect(message.match(KEYS_UPDATED)?.[1]).toBe('2');

        await expectSenderKeys(otherPage);
    });

    test('share as file', async ({ page, otherPage }) => {
        await senderSet(page);
        const download = page.waitForEvent('download');
        await clickMenu(page, 'menu-share-set-file');
        const file = await download;
        expect(file.suggestedFilename()).toBe('Tour.stagechord.json');
        const data = JSON.parse(await readFile(await file.path(), 'utf8'));
        // Every song carries its key, including the untransposed one.
        expect(data.songs.map((s) => s.state && s.state.transpose)).toEqual([3, 0]);

        await receiverLibrary(otherPage);
        const message = await importSetFile(otherPage, data);
        expect(message.match(KEYS_UPDATED)?.[1]).toBe('2');

        await expectSenderKeys(otherPage);
    });
});
