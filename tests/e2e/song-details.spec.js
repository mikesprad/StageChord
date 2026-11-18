// Header metadata is hidden (even unclosed or multi-line), and the song name and
// details can be edited in Edit mode and are stored as an edit.
import { test, expect, openApp, addSongsToLibrary, songState } from './helpers.js';

const SONG = { file: 'metadata-test.chopro', title: 'Metadata Test' };

test('header metadata is hidden, including unclosed and multi-line tags', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [SONG]);
    const view = page.locator('#song-view');
    await expect(view).toContainText('Only lyric line');
    await expect(view).not.toContainText('flow');
    await expect(view).not.toContainText('V2 Ch');
    await expect(view).not.toContainText('tempo');
    await expect(view).not.toContainText('{');
});

test('song name and details can be edited and survive a reload', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [SONG]);
    await expect(page.locator('#current-song-title')).toHaveText(SONG.title);

    // "Edit info" is always visible, not hidden inside edit mode.
    await page.getByRole('button', { name: 'Edit info' }).click();
    await expect(page.locator('#song-details-panel')).toContainText('Song info');
    await page.locator('#song-details-title').fill('Renamed Song');
    const rows = page.locator('.song-details-row');
    let flowRow = null;
    for (let i = 0; i < await rows.count(); i++) {
        if (await rows.nth(i).locator('.song-details-key').inputValue() === 'flow') flowRow = rows.nth(i);
    }
    expect(flowRow).not.toBeNull();
    await expect(flowRow.locator('.song-details-value')).toHaveValue('Intro V1 Ch V2 Ch');
    await flowRow.locator('.song-details-value').fill('V1 Ch V2 Ch Ch');
    await page.getByRole('button', { name: '+ Add song info' }).click();
    const newRow = page.locator('.song-details-row').last();
    await newRow.locator('.song-details-key').fill('artist');
    await newRow.locator('.song-details-value').fill('Someone');
    await page.locator('#song-details-panel').getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('#current-song-title')).toHaveText('Renamed Song');
    await expect(page.locator('#file-select option')).toHaveText(['Renamed Song']);
    await expect(page.locator('#song-view')).not.toContainText('Someone');

    const state = await songState(page, SONG);
    expect(state.editedText).toContain('{title: Renamed Song}');
    expect(state.editedText).toContain('{flow: V1 Ch V2 Ch Ch}');
    expect(state.editedText).toContain('{artist: Someone}');
    expect(state.editedText).toContain('[G]Only lyric line');

    await page.reload();
    await expect(page.locator('#current-song-title')).toHaveText('Renamed Song');
});

test('song header layout: info button on the title row, song buttons below', async ({ page }) => {
    await openApp(page);
    await addSongsToLibrary(page, [SONG]);
    const top = async (sel) => (await page.locator(sel).boundingBox()).y;
    const editInfo = page.getByRole('button', { name: 'Edit info' });
    await expect(editInfo).toBeVisible();
    expect(Math.abs((await editInfo.boundingBox()).y - await top('#current-song-title'))).toBeLessThan(15);
    await expect(page.locator('#song-btn-row button')).toHaveText(['+Memo', '+Stave', '✎ Edit song', 'A-', 'A+']);
    expect(await top('#song-btn-row')).toBeGreaterThan(await top('#current-song-title') + 10);
});

test('"Edit info" wraps flush left, in line with +Memo, on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 340, height: 700 });
    await openApp(page);
    await addSongsToLibrary(page, [SONG]);
    const info = await page.getByRole('button', { name: 'Edit info' }).boundingBox();
    const title = await page.locator('#current-song-title').boundingBox();
    const memo = await page.getByRole('button', { name: '+Memo' }).boundingBox();
    expect(info.y).toBeGreaterThan(title.y + 10); // it wrapped at this width
    expect(Math.abs(info.x - memo.x)).toBeLessThan(1);
});
