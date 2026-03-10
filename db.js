// db.js — IndexedDB storage for StageChord
// Stores: songs (library), songState (user changes), setlists

const DB_NAME = 'stagechord';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('songs')) {
                const songStore = db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
                songStore.createIndex('filename', 'filename', { unique: false });
                songStore.createIndex('contentHash', 'contentHash', { unique: false });
            }
            if (!db.objectStoreNames.contains('songState')) {
                const stateStore = db.createObjectStore('songState', { keyPath: 'songId' });
                stateStore.createIndex('songId', 'songId', { unique: true });
            }
            if (!db.objectStoreNames.contains('setlists')) {
                db.createObjectStore('setlists', { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

// Simple content hash (works on both HTTP and HTTPS)
function hashText(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// ── Songs (library) ─────────────────────────────────

export async function addSong(filename, originalText) {
    const db = await openDB();
    const hash = hashText(originalText);

    // Check for duplicate by content hash
    const existing = await new Promise((resolve, reject) => {
        const tx = db.transaction('songs', 'readonly');
        const idx = tx.objectStore('songs').index('contentHash');
        const req = idx.getAll(hash);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    if (existing.length > 0) {
        return existing[0].id; // Already imported
    }

    return new Promise((resolve, reject) => {
        const tx = db.transaction('songs', 'readwrite');
        const store = tx.objectStore('songs');
        const req = store.add({
            filename,
            originalText,
            contentHash: hash,
            importedAt: Date.now()
        });
        req.onsuccess = () => resolve(req.result); // returns id
        req.onerror = () => reject(req.error);
    });
}

export async function getSong(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('songs', 'readonly');
        const req = tx.objectStore('songs').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllSongs() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('songs', 'readonly');
        const req = tx.objectStore('songs').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteSong(id) {
    const db = await openDB();
    const tx = db.transaction(['songs', 'songState'], 'readwrite');
    tx.objectStore('songs').delete(id);
    tx.objectStore('songState').delete(id);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ── Song State (user changes) ───────────────────────

export async function getSongState(songId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('songState', 'readonly');
        const req = tx.objectStore('songState').get(songId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function saveSongState(songId, state) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('songState', 'readwrite');
        tx.objectStore('songState').put({
            songId,
            transpose: state.transpose || 0,
            annotation: state.annotation || '',
            stave: state.stave || null,
            staveTimeSig: state.staveTimeSig || null,
            editedText: state.editedText || null,
            updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ── Setlists ────────────────────────────────────────

export async function saveSetlist(setlist) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('setlists', 'readwrite');
        const store = tx.objectStore('setlists');
        if (setlist.id) {
            store.put(setlist);
        } else {
            const req = store.add(setlist);
            req.onsuccess = () => { setlist.id = req.result; };
        }
        tx.oncomplete = () => resolve(setlist);
        tx.onerror = () => reject(tx.error);
    });
}

export async function getSetlist(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('setlists', 'readonly');
        const req = tx.objectStore('setlists').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllSetlists() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('setlists', 'readonly');
        const req = tx.objectStore('setlists').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteSetlist(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('setlists', 'readwrite');
        tx.objectStore('setlists').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ── Export / Import Library ─────────────────────────

export async function exportLibrary() {
    const songs = await getAllSongs();
    const db = await openDB();
    const states = await new Promise((resolve, reject) => {
        const tx = db.transaction('songState', 'readonly');
        const req = tx.objectStore('songState').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    const stateMap = {};
    states.forEach(s => { stateMap[s.songId] = s; });

    const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        songs: songs.map(song => ({
            filename: song.filename,
            originalText: song.originalText,
            state: stateMap[song.id] ? {
                transpose: stateMap[song.id].transpose || 0,
                annotation: stateMap[song.id].annotation || '',
                stave: stateMap[song.id].stave || null,
                staveTimeSig: stateMap[song.id].staveTimeSig || null,
                editedText: stateMap[song.id].editedText || null
            } : null
        }))
    };
    return data;
}

export async function importLibrary(data) {
    if (!data || !Array.isArray(data.songs)) {
        throw new Error('Invalid library file');
    }
    let imported = 0;
    let skipped = 0;
    for (const entry of data.songs) {
        if (!entry.originalText || !entry.filename) continue;
        const id = await addSong(entry.filename, entry.originalText);
        // Check if this was a new import (no existing state) and entry has state
        if (entry.state) {
            const existingState = await getSongState(id);
            // Only overwrite state if there's no existing state, or the import is newer
            if (!existingState || !existingState.updatedAt) {
                await saveSongState(id, entry.state);
                imported++;
            } else {
                skipped++;
            }
        } else {
            imported++;
        }
    }
    return { imported, skipped };
}

// ── Export / Import Setlist ─────────────────────────

export async function exportSetlist(setlistId) {
    const setlist = await getSetlist(setlistId);
    if (!setlist) throw new Error('Setlist not found');

    const songEntries = [];
    for (const songId of setlist.songIds) {
        const song = await getSong(songId);
        const state = await getSongState(songId);
        if (song) {
            songEntries.push({
                filename: song.filename,
                originalText: song.originalText,
                state: state ? {
                    transpose: state.transpose || 0,
                    annotation: state.annotation || '',
                    stave: state.stave || null,
                    staveTimeSig: state.staveTimeSig || null,
                    editedText: state.editedText || null
                } : null
            });
        }
    }

    return {
        version: 1,
        type: 'setlist',
        exportedAt: new Date().toISOString(),
        name: setlist.name,
        songs: songEntries
    };
}

export async function importSetlist(data) {
    if (!data || data.type !== 'setlist' || !Array.isArray(data.songs)) {
        throw new Error('Invalid setlist file');
    }
    const songIds = [];
    for (const entry of data.songs) {
        if (!entry.originalText || !entry.filename) continue;
        const id = await addSong(entry.filename, entry.originalText);
        if (entry.state) {
            const existingState = await getSongState(id);
            if (!existingState || !existingState.updatedAt) {
                await saveSongState(id, entry.state);
            }
        }
        songIds.push(id);
    }
    const setlist = {
        name: data.name || 'Imported Set',
        songIds,
        currentIndex: 0,
        createdAt: Date.now()
    };
    return saveSetlist(setlist);
}
