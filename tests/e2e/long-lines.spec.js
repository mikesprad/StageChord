// Long lyric lines wrap inside the screen on a phone: nothing spills past the
// edge (a sideways-scrolling page broke swipe and set off iOS text autosizing).
import { test, expect, openApp, clickMenu } from './helpers.js';

const SONG = `{title: Long Lines}

Chorus:
[G]Overflow in this place, fill our hearts with your l[Bm]ove
Your love, surroun[A]ds us
A line with no chords at all that is much too long to fit on a phone screen in one go
| [G] [D] [G] [D] [G] [A] [Bm] [A] [G] [D] [G] [D] [G] [A] [Bm] [A] |
`;

for (const editing of [false, true]) {
    test(`long lines wrap within an iPhone-width screen${editing ? ' in Edit mode' : ''}`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 700 });
        await openApp(page);
        const chooser = page.waitForEvent('filechooser');
        await clickMenu(page, 'menu-add-songs');
        await (await chooser).setFiles({ name: 'long-lines.chopro', mimeType: 'text/plain', buffer: Buffer.from(SONG) });
        await expect(page.locator('#current-song-title')).toHaveText('Long Lines');
        if (editing) await page.locator('button', { hasText: 'Edit song' }).click();

        const overflow = await page.evaluate(() => {
            const view = document.getElementById('song-view');
            const right = window.innerWidth;
            const wide = Array.from(view.querySelectorAll('*'))
                .filter((el) => el.getBoundingClientRect().right > right + 1)
                .map((el) => el.className + ': ' + el.textContent.slice(0, 30));
            return { page: document.documentElement.scrollWidth - window.innerWidth, wide };
        });
        expect(overflow.wide).toEqual([]);
        expect(overflow.page).toBeLessThanOrEqual(0);
    });
}
