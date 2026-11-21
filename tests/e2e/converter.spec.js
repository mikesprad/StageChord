// The ChordPro converter hands a song to StageChord, which adds it to the
// current library and opens it.
import { test, expect, openApp, waitForAppReady, waitForDialog, setTitles, clickMenu } from './helpers.js';

const SHEET = [
    'Writers: Ann Example',
    'HARBOUR LIGHTS',
    'Key: G BPM: 80',
    '',
    'Verse 1:',
    'G               C',
    'Ropes on the bollard and salt on the wind'
].join('\n');

async function convertAndAdd(page) {
    await page.goto('/chordpro-converter.html');
    await page.locator('#src').fill(SHEET);
    await expect(page.locator('#title')).toHaveValue('Harbour Lights');
    await expect(page.locator('#out')).toHaveValue(/\{key: G\}/);
    await page.getByRole('button', { name: 'Add to StageChord' }).click();
    await page.waitForURL(/index\.html/);
    await waitForAppReady(page);
}

test('Add to StageChord adds the song and opens it; a second time just opens it', async ({ page }) => {
    await openApp(page);
    await convertAndAdd(page);
    await expect(page.locator('#current-song-title')).toHaveText('Harbour Lights');
    await expect(page.locator('#song-view')).toContainText('salt on the wind');
    expect(await setTitles(page)).toEqual(['Harbour Lights']);

    const before = page.dialogs.length;
    await convertAndAdd(page);
    await waitForDialog(page, /already in this library/, before);
    expect(await setTitles(page)).toEqual(['Harbour Lights']);
});

test('Songs & Help links to the converter in the same window, and it links back', async ({ page }) => {
    await page.goto('/help.html');
    const link = page.getByRole('link', { name: 'ChordPro converter' });
    await expect(link).not.toHaveAttribute('target', /.+/);
    await link.click();
    await expect(page).toHaveURL(/chordpro-converter\.html/);
    await expect(page.getByRole('link', { name: '← Back to StageChord' })).toHaveAttribute('href', 'index.html');
});

test('Convert File in the menu opens the converter', async ({ page }) => {
    await openApp(page);
    await clickMenu(page, 'menu-convert-file');
    await expect(page).toHaveURL(/chordpro-converter\.html/);
});
