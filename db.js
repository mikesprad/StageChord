// db.js — IndexedDB storage for StageChord
// Stores: songs (library), songState (user changes), setlists

const DB_NAME = 'stagechord';
const DB_VERSION = 2;
const DEFAULT_LIBRARY_ID = 1;
const LIBRARY_NAME_LIMIT = 17;

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            const tx = e.target.transaction;

            if (!db.objectStoreNames.contains('songs')) {
                const songStore = db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
                songStore.createIndex('filename', 'filename', { unique: false });
                songStore.createIndex('contentHash', 'contentHash', { unique: false });
                songStore.createIndex('libraryId', 'libraryId', { unique: false });
                songStore.createIndex('libraryContentHash', ['libraryId', 'contentHash'], { unique: false });
            } else {
                const songStore = tx.objectStore('songs');
                if (!songStore.indexNames.contains('libraryId')) {
                    songStore.createIndex('libraryId', 'libraryId', { unique: false });
                }
                if (!songStore.indexNames.contains('libraryContentHash')) {
                    songStore.createIndex('libraryContentHash', ['libraryId', 'contentHash'], { unique: false });
                }
            }

            if (!db.objectStoreNames.contains('songState')) {
                const stateStore = db.createObjectStore('songState', { keyPath: 'songId' });
                stateStore.createIndex('songId', 'songId', { unique: true });
            }

            if (!db.objectStoreNames.contains('setlists')) {
                const setStore = db.createObjectStore('setlists', { keyPath: 'id', autoIncrement: true });
                setStore.createIndex('libraryId', 'libraryId', { unique: false });
            } else {
                const setStore = tx.objectStore('setlists');
                if (!setStore.indexNames.contains('libraryId')) {
                    setStore.createIndex('libraryId', 'libraryId', { unique: false });
                }
            }

            if (!db.objectStoreNames.contains('libraries')) {
                const libStore = db.createObjectStore('libraries', { keyPath: 'id', autoIncrement: true });
                libStore.createIndex('lowerName', 'lowerName', { unique: true });
                libStore.createIndex('isDefault', 'isDefault', { unique: false });
            }

            if (e.oldVersion < 2) {
                const libStore = tx.objectStore('libraries');
                libStore.put({
                    id: DEFAULT_LIBRARY_ID,
                    name: 'Default',
                    lowerName: 'default',
                    isDefault: true,
                    createdAt: Date.now()
                });

                const songStore = tx.objectStore('songs');
                songStore.openCursor().onsuccess = (evt) => {
                    const cursor = evt.target.result;
                    if (!cursor) return;
                    const row = cursor.value;
                    if (!row.libraryId) {
                        row.libraryId = DEFAULT_LIBRARY_ID;
                        cursor.update(row);
                    }
                    cursor.continue();
                };

                const setStore = tx.objectStore('setlists');
                setStore.openCursor().onsuccess = (evt) => {
                    const cursor = evt.target.result;
                    if (!cursor) return;
                    const row = cursor.value;
                    if (!row.libraryId) {
                        row.libraryId = DEFAULT_LIBRARY_ID;
                        cursor.update(row);
                    }
                    cursor.continue();
                };
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

function requestToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function normalizeLibraryName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
}

function normalizeLibraryLower(name) {
    return normalizeLibraryName(name).toLowerCase();
}

function validateLibraryName(name) {
    const normalized = normalizeLibraryName(name);
    if (!normalized) {
        throw new Error('Library name is required');
    }
    if (normalized.length > LIBRARY_NAME_LIMIT) {
        throw new Error(`Library name must be ${LIBRARY_NAME_LIMIT} characters or less`);
    }
    return normalized;
}

function normalizeSetlistName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
}

async function getUniqueSetlistName(baseName, libraryId, excludeSetlistId = null) {
    const cleanBase = normalizeSetlistName(baseName) || 'Imported Set';
    const setlists = await getAllSetlists(libraryId);
    const usedNames = new Set(
        setlists
            .filter((s) => !excludeSetlistId || s.id !== excludeSetlistId)
            .map((s) => normalizeSetlistName(s.name).toLowerCase())
    );

    if (!usedNames.has(cleanBase.toLowerCase())) {
        return cleanBase;
    }

    let suffix = 1;
    while (usedNames.has(`${cleanBase} (${suffix})`.toLowerCase())) {
        suffix += 1;
    }
    return `${cleanBase} (${suffix})`;
}

export async function getDefaultLibrary() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('libraries', 'readonly');
        const idx = tx.objectStore('libraries').index('isDefault');
        const req = idx.get(true);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function getDefaultLibraryId() {
    const def = await getDefaultLibrary();
    if (def && def.id) return def.id;
    return DEFAULT_LIBRARY_ID;
}

export async function getAllLibraries() {
    const db = await openDB();
    const libs = await new Promise((resolve, reject) => {
        const tx = db.transaction('libraries', 'readonly');
        const req = tx.objectStore('libraries').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
    libs.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return a.name.localeCompare(b.name);
    });
    return libs;
}

export async function getLibrary(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('libraries', 'readonly');
        const req = tx.objectStore('libraries').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function addLibrary(name) {
    const db = await openDB();
    const clean = validateLibraryName(name);
    const lowerName = normalizeLibraryLower(clean);

    return new Promise((resolve, reject) => {
        const tx = db.transaction('libraries', 'readwrite');
        const store = tx.objectStore('libraries');
        const idx = store.index('lowerName');
        const checkReq = idx.get(lowerName);

        checkReq.onsuccess = () => {
            if (checkReq.result) {
                reject(new Error('Library name already exists'));
                return;
            }
            const addReq = store.add({
                name: clean,
                lowerName,
                isDefault: false,
                createdAt: Date.now()
            });
            addReq.onsuccess = () => resolve(addReq.result);
            addReq.onerror = () => reject(addReq.error);
        };
        checkReq.onerror = () => reject(checkReq.error);
    });
}

export async function renameLibrary(libraryId, name) {
    const db = await openDB();
    const clean = validateLibraryName(name);
    const lowerName = normalizeLibraryLower(clean);

    return new Promise((resolve, reject) => {
        const tx = db.transaction('libraries', 'readwrite');
        const store = tx.objectStore('libraries');
        const getReq = store.get(libraryId);

        getReq.onsuccess = () => {
            const lib = getReq.result;
            if (!lib) {
                reject(new Error('Library not found'));
                return;
            }
            if (lib.isDefault) {
                reject(new Error('Default library cannot be renamed'));
                return;
            }

            const idx = store.index('lowerName');
            const dupReq = idx.get(lowerName);
            dupReq.onsuccess = () => {
                if (dupReq.result && dupReq.result.id !== lib.id) {
                    reject(new Error('Library name already exists'));
                    return;
                }
                lib.name = clean;
                lib.lowerName = lowerName;
                lib.updatedAt = Date.now();
                const putReq = store.put(lib);
                putReq.onsuccess = () => resolve(lib);
                putReq.onerror = () => reject(putReq.error);
            };
            dupReq.onerror = () => reject(dupReq.error);
        };

        getReq.onerror = () => reject(getReq.error);
    });
}

export async function deleteLibrary(libraryId) {
    const db = await openDB();
    const defaultLibraryId = await getDefaultLibraryId();
    if (!libraryId || libraryId === defaultLibraryId) {
        throw new Error('Default library cannot be deleted');
    }

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['libraries', 'songs', 'setlists'], 'readwrite');
        const libStore = tx.objectStore('libraries');
        const songStore = tx.objectStore('songs');
        const setStore = tx.objectStore('setlists');
        const songIdx = songStore.index('libraryId');
        const setIdx = setStore.index('libraryId');

        let movedSongs = 0;
        let movedSets = 0;

        const libReq = libStore.get(libraryId);
        libReq.onsuccess = () => {
            const lib = libReq.result;
            if (!lib) {
                reject(new Error('Library not found'));
                return;
            }
            if (lib.isDefault) {
                reject(new Error('Default library cannot be deleted'));
                return;
            }

            const songsReq = songIdx.getAll(libraryId);
            songsReq.onsuccess = () => {
                const rows = songsReq.result || [];
                for (const row of rows) {
                    row.libraryId = defaultLibraryId;
                    songStore.put(row);
                    movedSongs++;
                }
            };
            songsReq.onerror = () => reject(songsReq.error);

            const setsReq = setIdx.getAll(libraryId);
            setsReq.onsuccess = () => {
                const rows = setsReq.result || [];
                for (const row of rows) {
                    row.libraryId = defaultLibraryId;
                    setStore.put(row);
                    movedSets++;
                }
            };
            setsReq.onerror = () => reject(setsReq.error);

            libStore.delete(libraryId);
        };
        libReq.onerror = () => reject(libReq.error);

        tx.oncomplete = () => resolve({ movedSongs, movedSets, defaultLibraryId });
        tx.onerror = () => reject(tx.error);
    });
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

export async function addSong(filename, originalText, libraryId = DEFAULT_LIBRARY_ID) {
    const db = await openDB();
    const hash = hashText(originalText);

    // Check for duplicate by content hash within this library
    const existing = await new Promise((resolve, reject) => {
        const tx = db.transaction('songs', 'readonly');
        const idx = tx.objectStore('songs').index('libraryContentHash');
        const req = idx.getAll([libraryId, hash]);
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
            libraryId,
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

export async function getAllSongs(libraryId = null) {
    const db = await openDB();
    if (!libraryId) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('songs', 'readonly');
            const req = tx.objectStore('songs').getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction('songs', 'readonly');
        const idx = tx.objectStore('songs').index('libraryId');
        const req = idx.getAll(libraryId);
        req.onsuccess = () => resolve(req.result || []);
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
    if (!setlist.libraryId) {
        setlist.libraryId = await getDefaultLibraryId();
    }
    const normalizedName = normalizeSetlistName(setlist.name);
    setlist.name = normalizedName || 'Untitled Set';
    if (!setlist.id) {
        setlist.name = await getUniqueSetlistName(setlist.name, setlist.libraryId);
    }
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

export async function getAllSetlists(libraryId = null) {
    const db = await openDB();
    if (!libraryId) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('setlists', 'readonly');
            const req = tx.objectStore('setlists').getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction('setlists', 'readonly');
        const idx = tx.objectStore('setlists').index('libraryId');
        const req = idx.getAll(libraryId);
        req.onsuccess = () => resolve(req.result || []);
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

export async function exportLibrary(libraryId = DEFAULT_LIBRARY_ID) {
    const songs = await getAllSongs(libraryId);
    const library = await getLibrary(libraryId);
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
        version: 2,
        type: 'bundle',
        libraryName: library ? library.name : 'Library',
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

export async function importLibrary(data, libraryId = DEFAULT_LIBRARY_ID) {
    // Accept bundle objects (any version metadata) or plain arrays of songs.
    let songs = null;
    if (Array.isArray(data)) {
        songs = data;
    } else if (data && Array.isArray(data.songs)) {
        songs = data.songs;
    } else if (data && data.bundle && Array.isArray(data.bundle.songs)) {
        songs = data.bundle.songs;
    }
    if (!songs) {
        throw new Error('Invalid bundle file: expected a songs array');
    }

    let imported = 0;
    let skipped = 0;
    for (const entry of songs) {
        if (!entry) continue;
        const filename = entry.filename || entry.name || 'Imported Song.chopro';
        const originalText = entry.originalText || entry.text || null;
        if (!originalText) continue;

        const id = await addSong(filename, originalText, libraryId);
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
    const setName = normalizeSetlistName(setlist.name);
    if (!setName) {
        throw new Error('Set name is required. Save the set with a name before sharing.');
    }

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
        version: 2,
        type: 'setlist',
        exportedAt: new Date().toISOString(),
        name: setName,
        songs: songEntries
    };
}

export async function importSetlist(data, libraryId = DEFAULT_LIBRARY_ID) {
    const setType = data && data.type;
    if (!data || !Array.isArray(data.songs) || (setType !== 'setlist' && setType !== 'stagechordset')) {
        throw new Error('Invalid setlist file');
    }

    const songIds = [];
    let imported = 0;
    let skipped = 0;

    for (const entry of data.songs) {
        if (!entry || typeof entry !== 'object') {
            skipped++;
            continue;
        }

        const filename = String(entry.filename || '').trim();
        const originalText = typeof entry.originalText === 'string' ? entry.originalText : '';
        if (!filename || !originalText) {
            skipped++;
            continue;
        }

        try {
            const id = await addSong(filename, originalText, libraryId);
            if (entry.state && typeof entry.state === 'object') {
                try {
                    const existingState = await getSongState(id);
                    if (!existingState || !existingState.updatedAt) {
                        await saveSongState(id, entry.state);
                    }
                } catch (_) {
                    // Keep importing other songs if song state cannot be applied.
                }
            }
            songIds.push(id);
            imported++;
        } catch (_) {
            skipped++;
        }
    }

    if (songIds.length === 0) {
        throw new Error('No valid songs found in set file');
    }

    const setlist = {
        name: normalizeSetlistName(data.name) || 'Imported Set',
        libraryId,
        songIds,
        currentIndex: 0,
        createdAt: Date.now()
    };
    const saved = await saveSetlist(setlist);
    saved.imported = imported;
    saved.skipped = skipped;
    return saved;
}
