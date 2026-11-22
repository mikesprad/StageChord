// Add Songs to Set: the search box filters the list by song name as you type.
import { test, expect, openApp, clickMenu } from './helpers.js';

const TITLES = ['Living Hope', 'Alive', 'King of Hope', "What's Up", 'Beautiful Saviour'];

async function addTitledSongs(page, titles) {
    const chooser = page.waitForEvent('filechooser');
    await clickMenu(page, 'menu-add-songs');
    await (await chooser).setFiles(titles.map((t) => ({
        name: t.replace(/[^A-Za-z ]/g, '') + '.chopro',
        mimeType: 'text/plain',
        buffer: Buffer.from(`{title: ${t}}\n{key: G}\n\n[G]Ropes on the [C]bollard\n`)
    })));
    await expect(page.locator('#file-select option')).toHaveCount(titles.length);
}

const shown = (page) => page.locator('#library-song-list .library-song-item:not(.filtered-out) label');

test.beforeEach(async ({ page }) => {
    await openApp(page);
    await addTitledSongs(page, TITLES);
    await clickMenu(page, 'menu-new-set');
    await expect(page.locator('#file-select option')).toHaveCount(0);
    await clickMenu(page, 'menu-add-songs-to-set');
    await expect(page.locator('#library-modal')).toBeVisible();
});

test('typing filters the songs by name, ignoring case, accents and punctuation', async ({ page }) => {
    const search = page.locator('#library-search');
    await expect(search).toHaveValue('');
    await expect(shown(page)).toHaveCount(TITLES.length);
    await expect(page.locator('#library-search-count')).toBeHidden();

    await search.fill('liv');
    await expect(shown(page)).toHaveText(['Alive', 'Living Hope']);
    await expect(page.locator('#library-search-count')).toHaveText('2 of 5 songs');

    await search.fill('HOPE king');                       // every word, any order
    await expect(shown(page)).toHaveText(['King of Hope']);

    await search.fill('whats');                           // apostrophe ignored
    await expect(shown(page)).toHaveText(["What's Up"]);

    await search.fill('savíour');                         // accent ignored
    await expect(shown(page)).toHaveText(['Beautiful Saviour']);

    await search.fill('zzz');
    await expect(shown(page)).toHaveCount(0);
    await expect(page.locator('#library-search-count')).toHaveText('No songs match');

    await page.locator('#library-search-clear').click();
    await expect(search).toHaveValue('');
    await expect(shown(page)).toHaveCount(TITLES.length);
    await expect(page.locator('#library-search-clear')).toBeHidden();
});

test('ticked songs stay ticked while hidden, and are all added', async ({ page }) => {
    const search = page.locator('#library-search');
    await search.fill('alive');
    await page.locator('#library-song-list label', { hasText: 'Alive' }).click();
    await search.fill('king');
    await page.locator('#library-song-list label', { hasText: 'King of Hope' }).click();
    await page.locator('#library-add-selected').click();
    await expect(page.locator('#library-modal')).toBeHidden();
    await expect(page.locator('#file-select option')).toHaveText(['Alive', 'King of Hope']);

    // Opening again starts with an empty search and the whole list
    await clickMenu(page, 'menu-add-songs-to-set');
    await expect(search).toHaveValue('');
    await expect(shown(page)).toHaveCount(TITLES.length);
});
