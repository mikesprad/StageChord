// Swipe left / right on the song to move between songs in the set.
import { test, expect, openApp, addSongsToLibrary, SONG_ONE, SONG_TWO } from './helpers.js';

async function swipe(page, fromX, toX, y = 400) {
    const view = page.locator('#song-view');
    const touch = (x) => [{ identifier: 0, clientX: x, clientY: y }];
    await view.dispatchEvent('touchstart', { touches: touch(fromX), changedTouches: touch(fromX), targetTouches: touch(fromX) });
    await view.dispatchEvent('touchend', { touches: [], changedTouches: touch(toX), targetTouches: [] });
}

test('swiping left and right changes song, and does nothing past the ends', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'touch devices only');
    await openApp(page);
    await addSongsToLibrary(page, [SONG_ONE, SONG_TWO]);
    await page.locator('#file-select').selectOption({ label: SONG_ONE.title });
    const title = page.locator('#current-song-title');
    await expect(title).toHaveText(SONG_ONE.title);

    await swipe(page, 400, 200);                       // left: next
    await expect(title).toHaveText(SONG_TWO.title);
    await expect(page.locator('#swipe-toast')).toHaveText(SONG_TWO.title);

    await swipe(page, 400, 200);                       // already the last song
    await expect(title).toHaveText(SONG_TWO.title);

    await swipe(page, 200, 400);                       // right: previous
    await expect(title).toHaveText(SONG_ONE.title);

    await swipe(page, 400, 360);                       // too short: not a swipe
    await expect(title).toHaveText(SONG_ONE.title);
    const width = await page.evaluate(() => window.innerWidth);
    await swipe(page, width - 5, width - 300);         // from the screen edge: ignored
    await expect(title).toHaveText(SONG_ONE.title);
});
