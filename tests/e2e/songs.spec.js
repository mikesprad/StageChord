import {
    test, expect, openApp, addSongsToLibrary, selectSong, transposeBy, expectKey,
    chordLocator, songTranspose, SONG_ONE, SONG_TWO
} from './helpers.js';

test.beforeEach(async ({ page }) => {
    await openApp(page);
});

test('adding songs to the library shows them in the current set', async ({ page }) => {
    await addSongsToLibrary(page, [SONG_ONE, SONG_TWO]);

    await expect(page.locator('#file-select option')).toHaveText([SONG_ONE.title, SONG_TWO.title]);
    await expect(page.locator('#current-song-title')).toHaveText(SONG_ONE.title);
    await expectKey(page, 'G');
    await expect(chordLocator(page)).toHaveText(['G', 'C', 'D']);

    await page.locator('#next-btn').click();
    await expect(page.locator('#current-song-title')).toHaveText(SONG_TWO.title);
    await expectKey(page, 'D');
    await expect(page.locator('#next-btn')).toBeDisabled();
});

test('transposing changes the song key and survives reload', async ({ page }) => {
    await addSongsToLibrary(page, [SONG_ONE, SONG_TWO]);

    await transposeBy(page, 2);
    await expectKey(page, 'A');
    await expect(chordLocator(page)).toHaveText(['A', 'D', 'E']);
    await expect.poll(() => songTranspose(page, SONG_ONE)).toBe(2);
    expect(await songTranspose(page, SONG_TWO)).toBe(0);

    await page.reload();
    await selectSong(page, SONG_ONE);
    await expectKey(page, 'A');
    await expect(chordLocator(page)).toHaveText(['A', 'D', 'E']);
});
