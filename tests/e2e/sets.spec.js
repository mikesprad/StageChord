import {
    test, expect, openApp, waitForAppReady, addSongsToLibrary, addFromLibrary, newSet, saveSet,
    loadSet, selectSong, transposeBy, expectKey, setTitles, songTranspose,
    SONG_ONE, SONG_TWO
} from './helpers.js';

test.beforeEach(async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [SONG_ONE, SONG_TWO]);
});

test('a reordered, saved set restores after reload and loads back by name', async ({ page }) => {
    await page.locator('#song-order-btn').click();
    await page.locator('#song-reorder-list li', { hasText: SONG_ONE.title }).getByRole('button', { name: '↓' }).click();
    await page.locator('#song-order-done-btn').click();
    expect(await setTitles(page)).toEqual([SONG_TWO.title, SONG_ONE.title]);

    await saveSet(page, 'Sunday');

    await page.reload();
    await waitForAppReady(page);
    expect(await setTitles(page)).toEqual([SONG_TWO.title, SONG_ONE.title]);

    await newSet(page);
    await loadSet(page, 'Sunday');
    expect(await setTitles(page)).toEqual([SONG_TWO.title, SONG_ONE.title]);
});

test('transposing in a saved set changes the song key everywhere', async ({ page }) => {
    await saveSet(page, 'Sunday');
    await selectSong(page, SONG_ONE);
    await transposeBy(page, 5);
    await expectKey(page, 'C');
    await expect.poll(() => songTranspose(page, SONG_ONE)).toBe(5);

    // A new set uses the same key...
    await newSet(page);
    await addFromLibrary(page, [SONG_ONE]);
    await expectKey(page, 'C');

    // ...and so does the saved set after reloading it.
    await loadSet(page, 'Sunday');
    await selectSong(page, SONG_ONE);
    await expectKey(page, 'C');
});

test('a song has one key across saved sets', async ({ page }) => {
    await saveSet(page, 'Morning');
    await selectSong(page, SONG_ONE);
    await transposeBy(page, 2);
    await expectKey(page, 'A');

    await newSet(page);
    await addFromLibrary(page, [SONG_ONE]);
    await saveSet(page, 'Evening');
    await expectKey(page, 'A');
    await transposeBy(page, 5);
    await expectKey(page, 'D');
    await expect.poll(() => songTranspose(page, SONG_ONE)).toBe(7);

    // The change made in Evening shows in Morning too.
    await loadSet(page, 'Morning');
    await selectSong(page, SONG_ONE);
    await expectKey(page, 'D');
});
