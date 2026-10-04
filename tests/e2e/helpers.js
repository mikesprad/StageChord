import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

export const SONG_ONE = { file: 'key-test-one.chopro', title: 'Key Test One' }; // {key: G}
export const SONG_TWO = { file: 'key-test-two.chopro', title: 'Key Test Two' }; // {key: D}

export function fixtureText(song) {
    return readFileSync(fixturePath(song.file), 'utf8');
}

// Every page: record dialogs and answer them predictably, and replace the
// Web Share / clipboard APIs with a stub so share flows are observable.
export async function preparePage(page) {
    page.dialogs = [];
    page.promptAnswer = null;
    page.on('dialog', async (dialog) => {
        const message = dialog.message();
        page.dialogs.push({ type: dialog.type(), message });
        if (dialog.type() === 'prompt') {
            await dialog.accept(page.promptAnswer ?? dialog.defaultValue());
        } else if (dialog.type() === 'confirm' && message.startsWith('You have songs in your current set')) {
            await dialog.dismiss(); // "Continue without saving"
        } else {
            await dialog.accept();
        }
    });
    await page.addInitScript(() => {
        window.__copied = null;
        Object.defineProperty(Navigator.prototype, 'share', { configurable: true, get: () => undefined });
        Object.defineProperty(Navigator.prototype, 'clipboard', {
            configurable: true,
            get: () => ({ writeText: async (text) => { window.__copied = text; } })
        });
    });
    return page;
}

export const test = base.extend({
    page: async ({ page }, use) => {
        await use(await preparePage(page));
    },
    // A second, independent browser (own IndexedDB) on the same device profile.
    otherPage: async ({ browser, baseURL, userAgent, viewport, deviceScaleFactor, isMobile, hasTouch, serviceWorkers }, use) => {
        const context = await browser.newContext({
            baseURL, userAgent, viewport, deviceScaleFactor, isMobile, hasTouch, serviceWorkers
        });
        await use(await preparePage(await context.newPage()));
        await context.close();
    }
});

export { expect };

export async function openApp(page, path = '/index.html') {
    // Leave the page first so a hash-only change still loads the app afresh.
    if (page.url() !== 'about:blank') await page.goto('about:blank');
    await page.goto(path);
    await waitForAppReady(page);
}

// The app writes its session ref once startup (import/restore) has finished.
export async function waitForAppReady(page) {
    await page.waitForFunction(() => window.__stagechordAppReady && localStorage.getItem('stagechord_session'));
}

// Waits for a dialog matching pattern and returns its message.
export async function waitForDialog(page, pattern, since = 0) {
    const find = () => page.dialogs.slice(since).find((d) => pattern.test(d.message));
    await expect.poll(() => !!find()).toBe(true);
    return find().message;
}

export async function clickMenu(page, id) {
    await page.locator('#menu-btn').click();
    const iosFallback = await page.evaluate(() => document.body.classList.contains('ios-fallback-mode'));
    await page.locator(iosFallback ? `#ios-${id}` : `#${id}`).click();
}

async function chooseFiles(page, menuId, files) {
    const chooser = page.waitForEvent('filechooser');
    await clickMenu(page, menuId);
    await (await chooser).setFiles(files);
}

export async function addSongsToLibrary(page, songs) {
    await chooseFiles(page, 'menu-add-songs', songs.map((s) => fixturePath(s.file)));
    await expect(page.locator('#file-select option')).not.toHaveCount(0);
}

// Imports a set file through the menu and returns the import alert message.
export async function importSetFile(page, data) {
    const before = page.dialogs.length;
    await chooseFiles(page, 'menu-import-set', {
        name: `${data.name}.stagechord.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(data))
    });
    return waitForDialog(page, /^Imported set/, before);
}

export async function addFromLibrary(page, songs) {
    await clickMenu(page, 'menu-add-songs-to-set');
    for (const song of songs) {
        await page.locator('#library-song-list label', { hasText: song.title }).click();
    }
    await page.locator('#library-add-selected').click();
    await expect(page.locator('#library-modal')).toBeHidden();
}

export async function newSet(page) {
    await clickMenu(page, 'menu-new-set');
    await expect(page.locator('#file-select option')).toHaveCount(0);
}

export async function saveSet(page, name) {
    await clickMenu(page, 'menu-save-set');
    await page.locator('#saveset-name').fill(name);
    await page.locator('#saveset-confirm').click();
    await expect(page.locator('#saveset-modal')).toBeHidden();
}

export async function loadSet(page, name) {
    await clickMenu(page, 'menu-load-set');
    await page.locator('.setlist-item', { has: page.locator('.setlist-item-name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) }).click();
    await expect(page.locator('#loadset-modal')).toBeHidden();
}

export async function selectSong(page, song) {
    await page.locator('#file-select').selectOption({ label: song.title });
    await expect(page.locator('#current-song-title')).toHaveText(song.title);
}

export async function transposeBy(page, semitones) {
    const button = page.locator('#current-song-key button', { hasText: semitones > 0 ? '+' : '-' });
    for (let i = 0; i < Math.abs(semitones); i++) await button.click();
}

export function keyLocator(page) {
    return page.locator('#current-song-key');
}

export async function expectKey(page, key) {
    await expect(keyLocator(page)).toHaveText(new RegExp(`^Key: ${escapeRegExp(key)}\\s`));
}

export function chordLocator(page) {
    return page.locator('#song-view .chord');
}

export async function setTitles(page) {
    return page.locator('#file-select option').allTextContents();
}

// Snapshot of IndexedDB, read independently of the app's own modules.
export async function readDb(page) {
    return page.evaluate(() => new Promise((resolve, reject) => {
        const req = indexedDB.open('stagechord');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
            const db = req.result;
            const stores = ['songs', 'songState', 'setlists'];
            const tx = db.transaction(stores, 'readonly');
            const out = {};
            for (const name of stores) {
                const r = tx.objectStore(name).getAll();
                r.onsuccess = () => { out[name] = r.result; };
            }
            tx.oncomplete = () => { db.close(); resolve(out); };
            tx.onerror = () => reject(tx.error);
        };
    }));
}

export async function songIdFor(page, song) {
    const { songs } = await readDb(page);
    const record = songs.find((s) => s.filename === song.file);
    if (!record) throw new Error(`Song ${song.file} not in library`);
    return record.id;
}

// The song's saved state (songState record), or null when none exists.
export async function songState(page, song) {
    const id = await songIdFor(page, song);
    const { songState: states } = await readDb(page);
    return states.find((s) => s.songId === id) || null;
}

// The song's key (songState.transpose): one per song, shared by every set.
export async function songTranspose(page, song) {
    const state = await songState(page, song);
    return state ? state.transpose : 0;
}

// Build a set file in the same shape exportSetlist() produces. An entry with
// state: null mimics files from older versions, which omitted untouched songs' state.
export function buildSetFile(name, entries) {
    return {
        version: 2,
        type: 'setlist',
        exportedAt: new Date().toISOString(),
        name,
        songs: entries.map(({ song, transpose, annotation = '', state }) => ({
            filename: song.file,
            originalText: fixtureText(song),
            state: state !== undefined
                ? state
                : { transpose, annotation, stave: null, staveTimeSig: null, editedText: null }
        }))
    };
}

// Encode a set the way shareCurrentSetAsLink() does: deflate-raw + base64url.
export function shareLinkPath(data) {
    const b64url = deflateRawSync(Buffer.from(JSON.stringify(data)))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `/index.html#setlist=${b64url}`;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
