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

test('pinching changes the song text size (two-finger touch)', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [SONG_ONE]);
    const size = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--song-font-size').trim());
    await expect.poll(size).toBe('1.00rem');
    const view = page.locator('#song-view');
    const fingers = (gap) => [{ identifier: 0, clientX: 200, clientY: 400 }, { identifier: 1, clientX: 200 + gap, clientY: 400 }];
    await view.dispatchEvent('touchstart', { touches: fingers(100), changedTouches: fingers(100), targetTouches: fingers(100) });
    await view.dispatchEvent('touchmove', { touches: fingers(150), changedTouches: fingers(150), targetTouches: fingers(150) });
    await view.dispatchEvent('touchend', { touches: [], changedTouches: fingers(150), targetTouches: [] });
    await expect.poll(size).toBe('1.50rem');
    await expect(page.locator('#current-song-title')).toHaveText(SONG_ONE.title); // not a swipe
});

test('the Safari pinch gesture changes the song text size', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [SONG_ONE]);
    const size = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--song-font-size').trim());
    const prevented = await page.evaluate(() => {
        const fire = (type, scale) => {
            const e = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(e, 'scale', { value: scale });
            document.dispatchEvent(e);
            return e.defaultPrevented;
        };
        const p = fire('gesturestart', 1);
        fire('gesturechange', 1.2);
        return p;
    });
    expect(prevented).toBe(true); // Safari's own page zoom is blocked
    await expect.poll(size).toBe('1.20rem');
    await page.evaluate(() => document.dispatchEvent(new Event('gestureend')));
});
