import { parseChordPro } from './parser.js?v=20260310T2';
import { renderStave, openStaveEditor, transposeStaveNotes } from './stave.js?v=20260310T2';
import {
    addSong, getSong, getAllSongs, deleteSong,
    getSongState, saveSongState,
    saveSetlist, getSetlist, getAllSetlists, deleteSetlist,
    exportLibrary, importLibrary,
    exportSetlist, importSetlist
} from './db.js?v=20260310T2';

const notesPreferred = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const sharpKeys = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'C#']);
const flatKeys = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']);
const keyAccidentals = {
    'C': 0,
    'G': 1,
    'D': 2,
    'A': 3,
    'E': 4,
    'B': 5,
    'F#': 6,
    'C#': 7,
    'F': -1,
    'Bb': -2,
    'Eb': -3,
    'Ab': -4,
    'Db': -5,
    'Gb': -6,
    'Cb': -7
};

// Current set: array of { songId, text, name, transpose, annotation, stave, staveTimeSig }
let songs = [];
let currentIndex = -1;
let currentSetlistId = null; // ID of loaded setlist (null = unsaved)
let autoScrollActive = false;
let chordEditMode = false;
let chordPopupOutsideClickHandler = null;
let deferredInstallPrompt = null;

const SESSION_KEY = 'stagechord_session';

function clearSet() {
    songs = [];
    currentIndex = -1;
    currentSetlistId = null;
    chordEditMode = false;
    dismissChordPopup();
    stopTempoFlash();
    saveSessionRef();
    fileSelect.innerHTML = '';
    songView.innerHTML = '';
    if (currentSongTitle) currentSongTitle.textContent = '';
    if (currentSongKey) currentSongKey.innerHTML = '';
    const songBtnRow = document.getElementById('song-btn-row');
    if (songBtnRow) songBtnRow.innerHTML = '';
    sectionJumps.innerHTML = '';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    if (autoScrollActive) stopAutoScroll();
}

// Save lightweight reference to localStorage (just song IDs + position)
function saveSessionRef() {
    const data = {
        songIds: songs.map(s => s.songId),
        currentIndex,
        currentSetlistId
    };
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (_) {}
}

// Save current song's state to IndexedDB
async function saveSongStateToDB(song) {
    if (!song || !song.songId) return;
    // Only store editedText if it differs from original
    const editedText = (song.text !== song.originalText) ? song.text : null;
    await saveSongState(song.songId, {
        transpose: song.transpose || 0,
        annotation: song.annotation || '',
        stave: song.stave || null,
        staveTimeSig: song.staveTimeSig || null,
        editedText
    });
}

// Restore session from localStorage refs + IndexedDB data
async function restoreSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!Array.isArray(data.songIds) || data.songIds.length === 0) return false;

        const loaded = [];
        for (const id of data.songIds) {
            const songRecord = await getSong(id);
            if (!songRecord) continue;
            const state = await getSongState(id) || {};
            loaded.push({
                songId: id,
                name: songRecord.filename,
                originalText: songRecord.originalText,
                text: state.editedText || songRecord.originalText,
                transpose: state.transpose || 0,
                annotation: state.annotation || '',
                stave: state.stave || null,
                staveTimeSig: state.staveTimeSig || null,
            });
        }
        if (loaded.length === 0) return false;
        songs = loaded;
        currentIndex = typeof data.currentIndex === 'number' ? data.currentIndex : 0;
        if (currentIndex < 0 || currentIndex >= songs.length) currentIndex = 0;
        currentSetlistId = data.currentSetlistId || null;
        return true;
    } catch (_) {
        return false;
    }
}

let autoScrollRafId;
let lastAutoScrollAt = 0;
let autoScrollPauseTimeout;

// Map all note enharmonics to their chromatic position (0-11)
const noteEnharmonics = {
    'C': 0, 'B#': 0,
    'C#': 1, 'Db': 1,
    'D': 2, 'C##': 2,
    'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4,
    'F': 5, 'E#': 5,
    'F#': 6, 'Gb': 6,
    'G': 7, 'F##': 7,
    'G#': 8, 'Ab': 8,
    'A': 9, 'G##': 9,
    'A#': 10, 'Bb': 10,
    'B': 11, 'Cb': 11
};

// Map chromatic index (0-11) to the preferred note name in each key
const enharmonicsByKey = Object.fromEntries(
    Object.keys(keyAccidentals).map((key) => {
        const base = flatKeys.has(key) ? [...flatNames] : [...sharpNames];
        if (key === 'Gb' || key === 'Cb') {
            base[11] = 'Cb';
        }
        if (key === 'Cb') {
            base[4] = 'Fb';
        }
        return [key, base];
    })
);

function getKeyNameForIndex(chromaIndex) {
    const candidates = Object.keys(keyAccidentals)
        .filter((key) => noteEnharmonics[key] === chromaIndex);

    if (candidates.length === 0) {
        return notesPreferred[chromaIndex];
    }

    return candidates.reduce((best, candidate) => {
        const bestAcc = Math.abs(keyAccidentals[best]);
        const candAcc = Math.abs(keyAccidentals[candidate]);
        if (candAcc < bestAcc) return candidate;
        if (candAcc > bestAcc) return best;
        return keyAccidentals[candidate] < keyAccidentals[best] ? candidate : best;
    });
}

// Get the appropriate enharmonic spelling for a note based on target key
function getEnharmonicSpellingForKey(chromaIndex, targetKeyName) {
    const spellings = enharmonicsByKey[targetKeyName] || enharmonicsByKey['C'];
    return spellings[chromaIndex];
}

function transposeChord(chord, semitones, targetKeyName) {
    const slashIndex = chord.indexOf('/');
    if (slashIndex !== -1) {
        const leftPart = chord.slice(0, slashIndex);
        const rightPart = chord.slice(slashIndex + 1);
        const left = transposeChordCore(leftPart, semitones, targetKeyName);
        const right = transposeChordCore(rightPart, semitones, targetKeyName);
        return `${left}/${right}`;
    }

    return transposeChordCore(chord, semitones, targetKeyName);
}

function transposeChordCore(chord, semitones, targetKeyName) {
    const match = chord.match(/^([A-G][#b]?)(.*)$/);
    if (!match) return chord;
    const root = match[1];
    const suffix = match[2];
    const index = noteEnharmonics[root];
    if (index === undefined) return chord;
    const newIndex = (index + semitones + 12) % 12;

    if (targetKeyName !== undefined) {
        return getEnharmonicSpellingForKey(newIndex, targetKeyName) + suffix;
    }

    return notesPreferred[newIndex] + suffix;
}

const fileInput = document.getElementById('file-input');
const fileSelect = document.getElementById('file-select');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const songOrderBtn = document.getElementById('song-order-btn');
const songOrderDoneBtn = document.getElementById('song-order-done-btn');
const songOrderCollapsed = document.getElementById('song-order-collapsed');
const songOrderExpanded = document.getElementById('song-order-expanded');
const songReorderList = document.getElementById('song-reorder-list');
const autoscrollBtn = document.getElementById('autoscroll-btn');
const sectionJumps = document.getElementById('section-jumps');
const songView = document.getElementById('song-view');
const currentSongTitle = document.getElementById('current-song-title');
const currentSongKey = document.getElementById('current-song-key');
const headerTitle = document.querySelector('header h1');
const headerBar = document.querySelector('header');
const buildColor = '#2f7d6c';

// Menu elements
const menuBtn = document.getElementById('menu-btn');
const menuOverlay = document.getElementById('menu-overlay');
const menuPanel = document.getElementById('menu-panel');
const menuCloseBtn = document.getElementById('menu-close-btn');
const importLibraryInput = document.getElementById('import-library-input');
const importSetInput = document.getElementById('import-set-input');

const sectionButtonConfig = [
    { key: 'verse', label: 'V' },
    { key: 'chorus', label: 'Ch' },
    { key: 'bridge', label: 'Br' },
    { key: 'riff', label: 'Riff' },
    { key: 'end', label: 'End' },
    { key: 'tag', label: 'Tag' }
];

// Edit these aliases to control which heading labels map to each jump button.
const sectionAliasPatterns = {
    verse: [/^verse\d*$/, /^v\d*$/],
    chorus: [/^chorus\d*$/, /^ch\d*$/, /^c\d*$/],
    bridge: [/^bridge$/, /^br$/],
    riff: [/^riff$/, /^instrumental$/],
    end: [/^end$/, /^ending$/, /^outro$/, /^lasttime$/],
    tag: [/^tag$/]
};

if (headerTitle) {
    headerTitle.textContent = 'StageChord';
}

if (headerBar) {
    headerBar.style.backgroundColor = buildColor;
}

// ── Menu open/close ──────────────────────────────────
function openMenu() {
    menuPanel.classList.remove('hidden');
    menuOverlay.classList.remove('hidden');
}
function closeMenu() {
    menuPanel.classList.add('hidden');
    menuOverlay.classList.add('hidden');
}
menuBtn.addEventListener('click', openMenu);
menuCloseBtn.addEventListener('click', closeMenu);
menuOverlay.addEventListener('click', closeMenu);

// Prompt user to save current set before a destructive action.
// Returns true if the user wants to proceed, false to cancel.
async function promptSaveCurrentSet() {
    if (songs.length === 0) return true; // nothing to lose
    const choice = confirm(
        'You have songs in your current set. Do you want to save it first?\n\n' +
        'OK = Save first, then continue\n' +
        'Cancel = Continue without saving'
    );
    if (choice) {
        // Open save modal and wait for it to complete
        return new Promise((resolve) => {
            openSaveSetModal(() => resolve(true), () => resolve(true));
        });
    }
    return true; // user chose to continue without saving
}

// ── Menu actions ─────────────────────────────────────
document.getElementById('menu-new-set').addEventListener('click', () => {
    closeMenu();
    clearSet();
});

document.getElementById('menu-add-songs').addEventListener('click', () => {
    fileInput.click();
    closeMenu();
});

document.getElementById('menu-browse-library').addEventListener('click', () => {
    closeMenu();
    openLibraryBrowser();
});

document.getElementById('menu-export-library').addEventListener('click', async () => {
    closeMenu();
    const data = await exportLibrary();
    downloadJSON(data, 'stagechord-library.json');
});

document.getElementById('menu-import-library').addEventListener('click', () => {
    closeMenu();
    importLibraryInput.click();
});

// PWA install prompt
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

// On iOS show the button immediately (no beforeinstallprompt support)
if (isIOS && !isStandalone) {
    const installBtn = document.getElementById('menu-install-app');
    if (installBtn) installBtn.classList.remove('hidden');
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installBtn = document.getElementById('menu-install-app');
    if (installBtn) installBtn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const installBtn = document.getElementById('menu-install-app');
    if (installBtn) installBtn.classList.add('hidden');
});

document.getElementById('menu-install-app').addEventListener('click', async () => {
    closeMenu();
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const result = await deferredInstallPrompt.userChoice;
        if (result.outcome === 'accepted') {
            deferredInstallPrompt = null;
            document.getElementById('menu-install-app').classList.add('hidden');
        }
    } else {
        // Fallback instructions for iOS / Android
        alert('To install StageChord:\n\n'
            + 'iOS (Apple): Tap the Share button (⬆) then "Add to Home Screen"\n\n'
            + 'Android: Tap the browser menu (⋮) then "Add to Home screen"');
    }
});

document.getElementById('menu-load-set').addEventListener('click', async () => {
    closeMenu();
    if (await promptSaveCurrentSet()) openLoadSetModal();
});

document.getElementById('menu-save-set').addEventListener('click', () => {
    closeMenu();
    openSaveSetModal();
});

document.getElementById('menu-import-set').addEventListener('click', async () => {
    closeMenu();
    if (await promptSaveCurrentSet()) importSetInput.click();
});

document.getElementById('menu-share-set-link').addEventListener('click', async () => {
    closeMenu();
    await shareCurrentSetAsLink();
});

document.getElementById('menu-share-set-file').addEventListener('click', async () => {
    closeMenu();
    await shareCurrentSetAsFile();
});

fileInput.addEventListener('change', handleFiles);
prevBtn.addEventListener('click', () => navigate(-1));
nextBtn.addEventListener('click', () => navigate(1));
songOrderBtn.addEventListener('click', openSongOrderPanel);
songOrderDoneBtn.addEventListener('click', closeSongOrderPanel);
autoscrollBtn.addEventListener('click', toggleAutoScroll);
fileSelect.addEventListener('change', () => {
    currentIndex = fileSelect.selectedIndex;
    renderCurrent();
    saveSessionRef();
});

importLibraryInput.addEventListener('change', async () => {
    const file = importLibraryInput.files[0];
    if (!file) return;

    const existingSongs = await getAllSongs();
    if (existingSongs.length > 0) {
        const choice = prompt(
            `You have ${existingSongs.length} song(s) in your library.\n\n` +
            'Type one of:\n' +
            '  ADD — add imported songs alongside existing\n' +
            '  REPLACE — clear library and replace with import\n' +
            '  EXPORT — export current library first, then add\n' +
            '  CANCEL — do nothing\n\n' +
            'Your choice:'
        );
        if (!choice) { importLibraryInput.value = ''; return; }
        const c = choice.trim().toUpperCase();
        if (c === 'CANCEL') { importLibraryInput.value = ''; return; }
        if (c === 'EXPORT') {
            const data = await exportLibrary();
            downloadJSON(data, 'stagechord-library-backup.json');
            // Continue with ADD after exporting
        }
        if (c === 'REPLACE') {
            for (const song of existingSongs) {
                await deleteSong(song.id);
            }
            // Remove any set songs that were deleted
            songs = songs.filter(s => existingSongs.every(es => es.id !== s.songId));
            if (songs.length === 0) currentIndex = -1;
        }
        if (c !== 'ADD' && c !== 'REPLACE' && c !== 'EXPORT') {
            importLibraryInput.value = '';
            return;
        }
    }

    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await importLibrary(data);
        alert(`Imported ${result.imported} song(s), ${result.skipped} skipped.`);
    } catch (e) {
        alert('Failed to import library: ' + e.message);
    }
    importLibraryInput.value = '';
});

importSetInput.addEventListener('change', async () => {
    const file = importSetInput.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const setlist = await importSetlist(data);
        await loadSetlistIntoView(setlist.id);
        alert(`Imported set "${setlist.name}" with ${setlist.songIds.length} song(s).`);
    } catch (e) {
        alert('Failed to import set: ' + e.message);
    }
    importSetInput.value = '';
});

// ── Import setlist from URL hash ─────────────────────
async function importFromUrlHash() {
    const hash = location.hash;

    // Handle song library import from Songs & Help page (localStorage or hash fallback)
    let libUrl = localStorage.getItem('stagechord_pending_import');
    if (libUrl) {
        localStorage.removeItem('stagechord_pending_import');
    } else if (hash.startsWith('#importlib=')) {
        libUrl = decodeURIComponent(hash.slice('#importlib='.length));
        history.replaceState(null, '', location.pathname + location.search);
    }
    if (libUrl) {
        try {
            const resp = await fetch(libUrl);
            if (!resp.ok) throw new Error('Could not fetch library file');
            const data = await resp.json();
            const result = await importLibrary(data);
            alert(`Imported ${result.imported} song(s), ${result.skipped} skipped.`);
            return false; // still restore session normally
        } catch (e) {
            alert('Failed to import song library: ' + e.message);
            return false;
        }
    }

    if (!hash.startsWith('#setlist=')) return false;
    const b64url = hash.slice('#setlist='.length);
    if (!b64url) return false;
    try {
        const json = await decompressFromBase64url(b64url);
        const data = JSON.parse(json);
        const setlist = await importSetlist(data);
        await loadSetlistIntoView(setlist.id);
        // Clean the hash so a reload doesn't re-import
        history.replaceState(null, '', location.pathname + location.search);
        return true;
    } catch (e) {
        alert('Failed to import shared set: ' + e.message);
        return false;
    }
}

// Restore previous session on load
importFromUrlHash().then(imported => {
    if (imported) {
        populateSelect();
        fileSelect.selectedIndex = currentIndex;
        renderCurrent();
        updateNav();
        return;
    }
    return restoreSession();
}).then(async (restored) => {
    if (restored) {
        populateSelect();
        fileSelect.selectedIndex = currentIndex;
        renderCurrent();
        updateNav();
    }
    // If running as an installed PWA with an empty library, let user know
    if (isStandalone) {
        const allSongs = await getAllSongs();
        if (allSongs.length === 0) {
            alert(
                'Your song library is empty.\n\n'
                + 'If you previously used StageChord in a browser, you can transfer your library:\n\n'
                + '1. In the browser: Menu → Export Library\n'
                + '2. In this app: Menu → Import Library'
            );
        }
    }
});

// ── Screen Wake Lock ─────────────────────────────────
let wakeLock = null;

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => { wakeLock = null; });
        } catch (_) { /* permission denied or not supported */ }
    }
}

requestWakeLock();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});

function handleUserScrollIntent(event) {
    if (!autoScrollActive) return;
    if (event && autoscrollBtn && autoscrollBtn.contains(event.target)) {
        return;
    }
    pauseAutoScroll();
}

window.addEventListener('wheel', handleUserScrollIntent, { passive: true });
window.addEventListener('touchmove', handleUserScrollIntent, { passive: true });
window.addEventListener('keydown', handleUserScrollIntent);
document.addEventListener('mousedown', (event) => {
    if (!autoScrollActive) return;
    const scrollbarStart = document.documentElement.clientWidth;
    if (event.clientX >= scrollbarStart) {
        pauseAutoScroll();
    }
});
window.addEventListener('scroll', () => {
    if (!autoScrollActive) return;
    if (Date.now() - lastAutoScrollAt > 50) {
        pauseAutoScroll();
    }
}, { passive: true });

function handleFiles() {
    const files = Array.from(fileInput.files);
    const promises = files.map((file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
                const text = reader.result;
                if (/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 512))) {
                    resolve(null);
                    return;
                }
                resolve({ name: file.name, text });
            };
            reader.readAsText(file);
        });
    });
    Promise.all(promises).then(async (results) => {
        const valid = results.filter(Boolean);
        if (valid.length === 0) return;
        for (const { name, text } of valid) {
            const songId = await addSong(name, text);
            // Only add to set if not already in set
            if (!songs.some(s => s.songId === songId)) {
                const state = await getSongState(songId) || {};
                songs.push({
                    songId,
                    name,
                    originalText: text,
                    text: state.editedText || text,
                    transpose: state.transpose || 0,
                    annotation: state.annotation || '',
                    stave: state.stave || null,
                    staveTimeSig: state.staveTimeSig || null,
                });
            }
        }
        if (currentIndex < 0) currentIndex = 0;
        populateSelect();
        fileSelect.selectedIndex = currentIndex;
        renderCurrent();
        updateNav();
        saveSessionRef();
        fileInput.value = '';
    });
}

function populateSelect() {
    fileSelect.innerHTML = '';
    songs.forEach((song, idx) => {
        const option = document.createElement('option');
        const parsed = parseChordPro(song.text);
        const title = parsed.metadata.title || song.name.replace(/\.[^.]+$/, '');
        option.textContent = title.slice(0, 25);
        option.value = idx;
        fileSelect.appendChild(option);
    });
}

function updateNav() {
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= songs.length - 1;
}

function navigate(delta) {
    currentIndex = Math.min(Math.max(0, currentIndex + delta), songs.length - 1);
    fileSelect.selectedIndex = currentIndex;
    renderCurrent();
    updateNav();
    requestAnimationFrame(() => window.scrollTo(0, 0));
}

function openSongOrderPanel() {
    songOrderCollapsed.classList.add('hidden');
    songOrderExpanded.classList.remove('hidden');
    renderReorderList();
}

function closeSongOrderPanel() {
    songOrderExpanded.classList.add('hidden');
    songOrderCollapsed.classList.remove('hidden');
    populateSelect();
    fileSelect.selectedIndex = currentIndex;
    renderCurrent();
    updateNav();
    saveSessionRef();
}

function renderReorderList() {
    songReorderList.innerHTML = '';
    songs.forEach((song, idx) => {
        const li = document.createElement('li');
        const parsed = parseChordPro(song.text);
        const title = parsed.metadata.title || song.name.replace(/\.[^.]+$/, '');

        const titleSpan = document.createElement('span');
        titleSpan.className = 'reorder-song-title';
        titleSpan.textContent = title;

        const btnWrap = document.createElement('span');
        btnWrap.className = 'reorder-btn-wrap';

        const upBtn = document.createElement('button');
        upBtn.textContent = '↑';
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', () => reorderSong(idx, -1));

        const downBtn = document.createElement('button');
        downBtn.textContent = '↓';
        downBtn.disabled = idx === songs.length - 1;
        downBtn.addEventListener('click', () => reorderSong(idx, 1));

        btnWrap.appendChild(upBtn);
        btnWrap.appendChild(downBtn);
        li.appendChild(titleSpan);
        li.appendChild(btnWrap);
        songReorderList.appendChild(li);
    });
}

function reorderSong(idx, delta) {
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= songs.length) return;
    [songs[idx], songs[newIdx]] = [songs[newIdx], songs[idx]];
    // Keep currentIndex tracking the same song
    if (currentIndex === idx) currentIndex = newIdx;
    else if (currentIndex === newIdx) currentIndex = idx;
    renderReorderList();
}

async function transpose(semitones) {
    if (currentIndex >= 0 && currentIndex < songs.length) {
        songs[currentIndex].transpose = (songs[currentIndex].transpose + semitones + 12) % 12;
        renderCurrent();
        await saveSongStateToDB(songs[currentIndex]);
        saveSessionRef();
    }
}

function detectSectionType(rawLine) {
    const trimmed = rawLine.trim();
    // Lines wrapped in curly brackets are directives, not headings.
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return null;
    // Ignore colons that only appear inside square brackets (chords).
    const withoutBrackets = trimmed.replace(/\[[^\]]*\]/g, '');
    if (!withoutBrackets.includes(':')) return null;

    // Extract the label before the first colon (outside brackets).
    const colonIndex = withoutBrackets.indexOf(':');
    const label = withoutBrackets.slice(0, colonIndex).trim();
    if (!label) return null;

    const token = label.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [sectionKey, patterns] of Object.entries(sectionAliasPatterns)) {
        if (patterns.some((pattern) => pattern.test(token))) {
            return sectionKey;
        }
    }
    return 'generic-section';
}

function renderSectionButtons(lastSectionAnchors) {
    if (!sectionJumps) return;
    sectionJumps.innerHTML = '';

    sectionButtonConfig.forEach(({ key, label }) => {
        const target = lastSectionAnchors[key];
        if (!target) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            if (autoScrollActive) stopAutoScroll();
            // Jump to the line before the section heading so it's visible
            const jumpTarget = target.previousElementSibling || target;
            const y = jumpTarget.getBoundingClientRect().top + window.pageYOffset - 12;
            window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
        });
        sectionJumps.appendChild(btn);
    });
}

function renderCurrent() {
    if (currentIndex < 0 || currentIndex >= songs.length) return;
    dismissChordPopup();
    stopTempoFlash();
    const editTip = document.getElementById('edit-tip');
    if (editTip) editTip.classList.toggle('hidden', !chordEditMode);
    const song = songs[currentIndex];
    if (!song.transpose) song.transpose = 0;
    songView.innerHTML = '';
    if (currentSongTitle) currentSongTitle.textContent = '';
    if (currentSongKey) currentSongKey.innerHTML = '';
    const parsed = parseChordPro(song.text);
    const rawLines = song.text.split(/\r?\n/);
    const lastSectionAnchors = {};
    const contentLines = rawLines.filter((line) => {
        const trimmed = line.trim();
        return !(trimmed.startsWith('{') && trimmed.endsWith('}'));
    });
    
    // Get original key and determine transposed key
    let originalKeyIndex = 0; // Default to C
    let transposedKeyIndex = 0;
    let originalKeyName = 'C';
    let transposedKeyName = 'C';
    let hasKey = false;
    let inferredKey = false;

    if (parsed.metadata.key) {
        const keyNote = parsed.metadata.key.match(/^([A-G][#b]?)/)?.[1] || 'C';
        originalKeyIndex = noteEnharmonics[keyNote] !== undefined ? noteEnharmonics[keyNote] : 0;
        originalKeyName = keyNote;
        hasKey = true;
    } else {
        for (const lineTokens of parsed.lines) {
            const chordToken = lineTokens.find((token) => token.type === 'chord');
            if (!chordToken) continue;
            const keyNote = chordToken.value.match(/^([A-G][#b]?)/)?.[1];
            if (keyNote && noteEnharmonics[keyNote] !== undefined) {
                originalKeyIndex = noteEnharmonics[keyNote];
                originalKeyName = keyNote;
                inferredKey = true;
                hasKey = true;
                break;
            }
        }
    }

    if (hasKey) {
        transposedKeyIndex = (originalKeyIndex + song.transpose + 12) % 12;
        transposedKeyName = getKeyNameForIndex(transposedKeyIndex);
    }
    
    // Display metadata
    if (parsed.metadata.title) {
        if (currentSongTitle) {
            currentSongTitle.textContent = parsed.metadata.title;
        }
    } else if (currentSongTitle) {
        currentSongTitle.textContent = song.name.replace(/\.[^.]+$/, '');
    }

    if (hasKey) {
        const keyLabel = inferredKey ? 'Key (inferred): ' : 'Key: ';
        if (currentSongKey) {
            currentSongKey.appendChild(document.createTextNode(`${keyLabel}${transposeChord(originalKeyName, song.transpose, transposedKeyName)} `));
        }
        
        const downBtn = document.createElement('button');
        downBtn.textContent = '-';
        downBtn.addEventListener('click', () => transpose(-1));
        if (currentSongKey) currentSongKey.appendChild(downBtn);
        
        const upBtn = document.createElement('button');
        upBtn.textContent = '+';
        upBtn.addEventListener('click', () => transpose(1));
        if (currentSongKey) currentSongKey.appendChild(upBtn);

        if (parsed.metadata.tempo) {
            const tempoBtn = document.createElement('button');
            tempoBtn.className = 'tempo-btn';
            tempoBtn.textContent = `Tempo: ${parsed.metadata.tempo}`;
            tempoBtn.title = 'Click for tempo flash';
            tempoBtn.addEventListener('click', () => {
                flashTempoOnNav(parseInt(parsed.metadata.tempo, 10));
            });
            if (currentSongKey) currentSongKey.appendChild(tempoBtn);
        }
    }

    // Button group for +Comment, +Stave, Edit — on its own row
    const btnGroup = document.createElement('span');
    btnGroup.className = 'meta-btn-group';

    // Annotation button — always shown
    const annotateBtn = document.createElement('button');
    annotateBtn.textContent = song.annotation ? '✎ Comment' : '+Comment';
    annotateBtn.className = 'annotate-btn';
    annotateBtn.title = song.annotation ? 'Edit annotation' : 'Add annotation';
    annotateBtn.addEventListener('click', () => {
        showAnnotationEditor(song);
    });
    btnGroup.appendChild(annotateBtn);

    // Stave button
    const staveBtn = document.createElement('button');
    staveBtn.textContent = song.stave ? '✎ Stave' : '+Stave';
    staveBtn.className = 'annotate-btn';
    staveBtn.title = song.stave ? 'Edit stave' : 'Add a stave';
    const songBtnRow = document.getElementById('song-btn-row');
    if (songBtnRow) {
        songBtnRow.innerHTML = '';
        songBtnRow.appendChild(btnGroup);
    }
    staveBtn.addEventListener('click', async () => {
        const editorNotes = song.stave && song.transpose
            ? transposeStaveNotes(song.stave, song.transpose, transposedKeyName)
            : (song.stave || null);
        const result = await openStaveEditor(editorNotes, { keyName: hasKey ? transposedKeyName : null, timeSig: song.staveTimeSig || '4/4' });
        if (result !== undefined) {
            song.stave = result.notes && song.transpose
                ? transposeStaveNotes(result.notes, -song.transpose, originalKeyName)
                : result.notes;
            song.staveTimeSig = result.timeSig;
        }
        await saveSongStateToDB(song);
        renderCurrent();
    });
    btnGroup.appendChild(staveBtn);

    // Edit button (chords, key, tempo)
    const editChordsBtn = document.createElement('button');
    editChordsBtn.textContent = chordEditMode ? '✓ Done' : '✎ Edit';
    editChordsBtn.className = 'annotate-btn' + (chordEditMode ? ' active-edit' : '');
    editChordsBtn.title = 'Edit chords, key and tempo';
    editChordsBtn.addEventListener('click', () => {
        // If leaving edit mode, save key/tempo from input fields
        if (chordEditMode) {
            saveEditMetaFields(song);
        }
        chordEditMode = !chordEditMode;
        dismissChordPopup();
        const editTip = document.getElementById('edit-tip');
        if (editTip) editTip.classList.toggle('hidden', !chordEditMode);
        renderCurrent();
    });
    btnGroup.appendChild(editChordsBtn);

    // Reset button — only show in edit mode if text differs from original
    if (chordEditMode && song.text !== song.originalText) {
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.className = 'annotate-btn reset-btn';
        resetBtn.title = 'Revert all chord edits';
        resetBtn.addEventListener('click', async () => {
            if (!confirm('Reset all chord edits to original?')) return;
            song.text = song.originalText;
            await saveSongStateToDB(song);
            renderCurrent();
        });
        btnGroup.appendChild(resetBtn);
    }

    // Key/Tempo editor — shown as first line in song view when in edit mode
    if (chordEditMode) {
        const editRow = document.createElement('div');
        editRow.className = 'edit-meta-row';

        // Key editor — blank for inferred keys so user can write the correct one
        const keyLabel = document.createElement('label');
        keyLabel.textContent = 'Key: ';
        keyLabel.className = 'edit-meta-label';
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'edit-meta-input';
        keyInput.id = 'edit-key-input';
        keyInput.placeholder = hasKey ? transposedKeyName : 'e.g. G';
        // Only pre-fill if key is explicitly set in the file (not inferred)
        keyInput.value = (hasKey && !inferredKey) ? transposedKeyName : '';
        keyInput.size = 4;
        keyInput.addEventListener('change', () => {
            saveEditMetaFields(song);
        });
        keyLabel.appendChild(keyInput);
        editRow.appendChild(keyLabel);

        // Tempo editor
        const tempoLabel = document.createElement('label');
        tempoLabel.textContent = 'Tempo: ';
        tempoLabel.className = 'edit-meta-label';
        const tempoInput = document.createElement('input');
        tempoInput.type = 'number';
        tempoInput.className = 'edit-meta-input';
        tempoInput.id = 'edit-tempo-input';
        tempoInput.placeholder = parsed.metadata.tempo || 'bpm';
        tempoInput.value = parsed.metadata.tempo || '';
        tempoInput.min = 20;
        tempoInput.max = 300;
        tempoInput.size = 5;
        tempoInput.addEventListener('change', () => {
            saveEditMetaFields(song);
        });
        tempoLabel.appendChild(tempoInput);
        editRow.appendChild(tempoLabel);

        songView.appendChild(editRow);
    }

    // Show annotation box if annotation exists
    if (song.annotation) {
        const annoBox = document.createElement('div');
        annoBox.className = 'annotation-box';
        annoBox.textContent = song.annotation;
        songView.prepend(annoBox);
    }

    // Show saved stave if it exists
    if (song.stave && song.stave.length > 0) {
        const staveContainer = document.createElement('div');
        staveContainer.className = 'stave-display';
        staveContainer.title = 'Tap to edit stave';
        staveContainer.addEventListener('click', async () => {
            const editorNotes = song.transpose
                ? transposeStaveNotes(song.stave, song.transpose, transposedKeyName)
                : song.stave;
            const result = await openStaveEditor(editorNotes, { keyName: hasKey ? transposedKeyName : null, timeSig: song.staveTimeSig || '4/4' });
            if (result !== undefined) {
                song.stave = result.notes && song.transpose
                    ? transposeStaveNotes(result.notes, -song.transpose, originalKeyName)
                    : result.notes;
                song.staveTimeSig = result.timeSig;
            }
            await saveSongStateToDB(song);
            renderCurrent();
        });
        songView.prepend(staveContainer);
        const displayNotes = song.transpose ? transposeStaveNotes(song.stave, song.transpose, transposedKeyName) : song.stave;
        renderStave(staveContainer, displayNotes, transposedKeyName, song.staveTimeSig || '4/4');
    }
    
    // Track spacing between rendered lines so blank lines don't stack up.
    let lastWasEmpty = false;
    let previousRenderedType = null;
    
    parsed.lines.forEach((lineTokens, lineIndex) => {
        const rawLine = contentLines[lineIndex] || '';
        const isEmptyLine = rawLine.trim() === '';
        const nextRawLine = contentLines[lineIndex + 1] || '';
        const nextIsHeading = Boolean(detectSectionType(nextRawLine));
        
        // Keep at most one empty line, and never keep one directly before a heading.
        if (isEmptyLine && (lastWasEmpty || nextIsHeading)) {
            return;
        }
        lastWasEmpty = isEmptyLine;
        if (isEmptyLine) {
            previousRenderedType = 'empty';
        }
        
        const sectionType = detectSectionType(rawLine);
        if (sectionType) {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'lyric-line section-heading';
            if (previousRenderedType === 'bar') {
                sectionDiv.classList.add('tight-top');
            }
            sectionDiv.textContent = rawLine;
            songView.appendChild(sectionDiv);
            lastSectionAnchors[sectionType] = sectionDiv;
            previousRenderedType = 'section';
            return;
        }

        if (rawLine.trim().startsWith('|')) {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'chord-line';
            if (chordEditMode) {
                // Render bar line with editable chord spans
                let chordCount = 0;
                const parts = rawLine.split(/(\[[^\]]+\])/);
                parts.forEach(part => {
                    const chordMatch = part.match(/^\[([^\]]+)\]$/);
                    if (chordMatch) {
                        const ci = chordCount++;
                        const chordSpan = document.createElement('span');
                        chordSpan.className = 'chord-editable bar-chord';
                        chordSpan.textContent = transposeChord(chordMatch[1], song.transpose, transposedKeyName);
                        chordSpan.addEventListener('click', (e) => {
                            e.stopPropagation();
                            showChordPopup(e, song, lineIndex, ci, chordMatch[1], parsed, transposedKeyName);
                        });
                        lineDiv.appendChild(chordSpan);
                    } else {
                        lineDiv.appendChild(document.createTextNode(part));
                    }
                });
            } else {
                lineDiv.textContent = rawLine.replace(/\[([^\]]+)\]/g, (_, chord) => (
                    transposeChord(chord, song.transpose, transposedKeyName)
                ));
            }
            songView.appendChild(lineDiv);
            previousRenderedType = 'bar';
            return;
        }

        const hasChords = lineTokens.some(t => t.type === 'chord');
        if (!hasChords) {
            const lyricLine = document.createElement('div');
            lyricLine.className = 'lyric-line';
            if (chordEditMode) {
                const fullText = lineTokens.map(t => t.value).join('');
                const words = fullText.split(/(?<=\s)(?=\S)/);
                let offset = 0;
                words.forEach(word => {
                    if (!word) return;
                    const wordSpan = document.createElement('span');
                    wordSpan.className = 'edit-target';
                    wordSpan.textContent = word;
                    const off = offset;
                    wordSpan.addEventListener('click', (e) => {
                        showChordPopup(e, song, lineIndex, null, null, parsed, transposedKeyName, off);
                    });
                    lyricLine.appendChild(wordSpan);
                    offset += word.length;
                });
            } else {
                lyricLine.textContent = lineTokens.map(t => t.value).join('');
            }
            songView.appendChild(lyricLine);
        } else {
            // Group tokens into chord-text pairs so each chord sits
            // directly above its lyric segment in an inline-block column.
            const pairs = [];
            let ti = 0;
            let chordCount = 0;
            while (ti < lineTokens.length) {
                if (lineTokens[ti].type === 'chord') {
                    const chord = lineTokens[ti].value;
                    const ci = chordCount++;
                    ti++;
                    if (ti < lineTokens.length && lineTokens[ti].type === 'text') {
                        pairs.push({ chord, text: lineTokens[ti].value, chordIdx: ci });
                        ti++;
                    } else {
                        pairs.push({ chord, text: '', chordIdx: ci });
                    }
                } else {
                    pairs.push({ chord: null, text: lineTokens[ti].value, chordIdx: null });
                    ti++;
                }
            }

            const lineContainer = document.createElement('div');
            lineContainer.className = 'chord-lyric-line';
            let textOffset = 0;
            pairs.forEach(pair => {
                const pairTextOffset = textOffset;
                const wrapper = document.createElement('span');
                wrapper.className = 'chord-lyric-pair';

                const chordSpan = document.createElement('span');
                chordSpan.className = 'chord';
                if (pair.chord) {
                    chordSpan.textContent = transposeChord(pair.chord, song.transpose, transposedKeyName);
                    if (chordEditMode) {
                        chordSpan.classList.add('chord-editable');
                        chordSpan.addEventListener('click', (e) => {
                            e.stopPropagation();
                            showChordPopup(e, song, lineIndex, pair.chordIdx, pair.chord, parsed, transposedKeyName);
                        });
                    }
                }

                const lyricSpan = document.createElement('span');
                lyricSpan.className = 'lyric';
                if (chordEditMode && pair.text) {
                    const words = pair.text.split(/(?<=\s)(?=\S)/);
                    let segOffset = pairTextOffset;
                    words.forEach((word, wi) => {
                        if (!word) return;
                        const wordSpan = document.createElement('span');
                        wordSpan.textContent = word;
                        if (!pair.chord || wi > 0) {
                            wordSpan.className = 'edit-target';
                            const off = segOffset;
                            wordSpan.addEventListener('click', (e) => {
                                e.stopPropagation();
                                showChordPopup(e, song, lineIndex, null, null, parsed, transposedKeyName, off);
                            });
                        }
                        lyricSpan.appendChild(wordSpan);
                        segOffset += word.length;
                    });
                } else {
                    lyricSpan.textContent = pair.text;
                }

                wrapper.appendChild(chordSpan);
                wrapper.appendChild(lyricSpan);
                lineContainer.appendChild(wrapper);
                textOffset += pair.text.length;
            });
            songView.appendChild(lineContainer);
        }
        previousRenderedType = 'content';
    });

    renderSectionButtons(lastSectionAnchors);
}

// ── Chord Edit Popup ─────────────────────────────────────

function dismissChordPopup() {
    const existing = document.getElementById('chord-popup');
    if (existing) existing.remove();
    if (chordPopupOutsideClickHandler) {
        document.removeEventListener('click', chordPopupOutsideClickHandler);
        chordPopupOutsideClickHandler = null;
    }
}

// Save key/tempo from edit input fields into song text
function saveEditMetaFields(song) {
    const keyInput = document.getElementById('edit-key-input');
    const tempoInput = document.getElementById('edit-tempo-input');
    let changed = false;

    if (keyInput) {
        const newKey = keyInput.value.trim();
        if (newKey) {
            const keyMatch = newKey.match(/^([A-G][#b]?)/);
            if (keyMatch) {
                const displayKey = keyMatch[1];
                const displayIndex = noteEnharmonics[displayKey];
                if (displayIndex !== undefined) {
                    const storedIndex = (displayIndex - (song.transpose || 0) + 12) % 12;
                    const storedKeyName = getKeyNameForIndex(storedIndex);
                    updateSongMetadata(song, 'key', storedKeyName);
                    changed = true;
                }
            }
        }
    }

    if (tempoInput) {
        const val = tempoInput.value.trim();
        if (val && !isNaN(val) && val >= 20 && val <= 300) {
            updateSongMetadata(song, 'tempo', val);
            changed = true;
        } else if (!val) {
            // If cleared, remove tempo directive
            const parsed = parseChordPro(song.text);
            if (parsed.metadata.tempo) {
                removeSongMetadata(song, 'tempo');
                changed = true;
            }
        }
    }

    if (changed) {
        saveSongStateToDB(song);
    }
}

// Update or insert a metadata directive in the song text (e.g. {key: G}, {tempo: 120})
function updateSongMetadata(song, directive, value) {
    const lines = song.text.split(/\r?\n/);
    const regex = new RegExp(`^\\{${directive}:\\s*.+?\\}$`, 'i');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i].trim())) {
            lines[i] = `{${directive}: ${value}}`;
            found = true;
            break;
        }
    }
    if (!found) {
        // Insert after last metadata line at top, or at very top
        let insertAt = 0;
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();
            if (t.startsWith('{') && t.endsWith('}')) {
                insertAt = i + 1;
            } else {
                break;
            }
        }
        lines.splice(insertAt, 0, `{${directive}: ${value}}`);
    }
    song.text = lines.join('\n');
}

// Remove a metadata directive from the song text
function removeSongMetadata(song, directive) {
    const lines = song.text.split(/\r?\n/);
    const regex = new RegExp(`^\\{${directive}:\\s*.+?\\}$`, 'i');
    song.text = lines.filter(l => !regex.test(l.trim())).join('\n');
}

function extractSongChords(parsed, transpose, keyName) {
    const seen = new Set();
    const chords = [];
    for (const lineTokens of parsed.lines) {
        for (const token of lineTokens) {
            if (token.type === 'chord') {
                const transposed = transposeChord(token.value, transpose, keyName);
                if (!seen.has(transposed)) {
                    seen.add(transposed);
                    chords.push(transposed);
                }
            }
        }
    }
    return chords;
}

function modifySongText(song, lineIndex, chordIdx, action, newChordValue, textOffset) {
    // Work on the raw text lines, applying edits to the correct chord
    const lines = song.text.split(/\r?\n/);

    // Map lineIndex (content lines, excluding metadata) to actual line index
    let contentLineCount = -1;
    let actualLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) continue;
        contentLineCount++;
        if (contentLineCount === lineIndex) {
            actualLineIdx = i;
            break;
        }
    }
    if (actualLineIdx < 0) return;

    let line = lines[actualLineIdx];

    if (action === 'delete' && chordIdx !== null) {
        // Remove the nth chord bracket from this line
        let count = 0;
        line = line.replace(/\[[^\]]*\]/g, (match) => {
            if (count++ === chordIdx) return '';
            return match;
        });
    } else if (action === 'change' && chordIdx !== null && newChordValue) {
        // Replace the nth chord bracket's content
        let count = 0;
        line = line.replace(/\[[^\]]*\]/g, (match) => {
            if (count++ === chordIdx) return `[${newChordValue}]`;
            return match;
        });
    } else if (action === 'insert' && newChordValue) {
        if (typeof textOffset === 'number' && textOffset > 0) {
            // Insert chord at the text position corresponding to textOffset
            let tCount = 0;
            let rawPos = 0;
            let inBracket = false;
            while (rawPos < line.length) {
                if (line[rawPos] === '[') { inBracket = true; rawPos++; continue; }
                if (line[rawPos] === ']') { inBracket = false; rawPos++; continue; }
                if (!inBracket) {
                    if (tCount === textOffset) break;
                    tCount++;
                }
                rawPos++;
            }
            line = line.slice(0, rawPos) + `[${newChordValue}]` + line.slice(rawPos);
        } else {
            // Insert at the beginning of the line
            const leadingSpaces = line.match(/^(\s*)/)[0];
            line = leadingSpaces + `[${newChordValue}]` + line.slice(leadingSpaces.length);
        }
    }

    lines[actualLineIdx] = line;
    song.text = lines.join('\n');
}

function showChordPopup(event, song, lineIndex, chordIdx, originalChord, parsed, transposedKeyName, textOffset) {
    dismissChordPopup();

    const popup = document.createElement('div');
    popup.id = 'chord-popup';

    // Collect all unique chords in the song (transposed to display key)
    const songChords = extractSongChords(parsed, song.transpose, transposedKeyName);

    const isEdit = chordIdx !== null;
    const headerText = isEdit ? 'Change chord' : 'Add chord';

    const header = document.createElement('div');
    header.className = 'chord-popup-header';
    header.textContent = headerText;
    popup.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'chord-popup-grid';

    songChords.forEach(chord => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = chord;
        btn.addEventListener('click', async () => {
            // Reverse-transpose the chosen chord back to original key for storage
            const originalKeyChord = transposeChord(chord, -song.transpose, null);
            if (isEdit) {
                modifySongText(song, lineIndex, chordIdx, 'change', originalKeyChord);
            } else {
                modifySongText(song, lineIndex, chordIdx, 'insert', originalKeyChord, textOffset);
            }
            dismissChordPopup();
            await saveSongStateToDB(song);
            renderCurrent();
        });
        grid.appendChild(btn);
    });
    popup.appendChild(grid);

    // Custom chord input
    const customRow = document.createElement('div');
    customRow.className = 'chord-popup-custom';
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Custom chord...';
    customInput.maxLength = 12;
    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.textContent = 'Add';
    customBtn.addEventListener('click', async () => {
        const val = customInput.value.trim();
        if (!val) return;
        const originalKeyChord = transposeChord(val, -song.transpose, null);
        if (isEdit) {
            modifySongText(song, lineIndex, chordIdx, 'change', originalKeyChord);
        } else {
            modifySongText(song, lineIndex, chordIdx, 'insert', originalKeyChord, textOffset);
        }
        dismissChordPopup();
        await saveSongStateToDB(song);
        renderCurrent();
    });
    customRow.appendChild(customInput);
    customRow.appendChild(customBtn);
    popup.appendChild(customRow);

    // Delete button (only for existing chords)
    if (isEdit) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'chord-popup-delete';
        delBtn.textContent = 'Delete Chord';
        delBtn.addEventListener('click', async () => {
            modifySongText(song, lineIndex, chordIdx, 'delete', null);
            dismissChordPopup();
            await saveSongStateToDB(song);
            renderCurrent();
        });
        popup.appendChild(delBtn);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'chord-popup-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', dismissChordPopup);
    popup.appendChild(closeBtn);

    // Position near the click
    document.body.appendChild(popup);
    const rect = event.target.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 4;
    // Keep within viewport
    if (left + popupRect.width > window.innerWidth) {
        left = window.innerWidth - popupRect.width - 8;
    }
    if (left < 4) left = 4;
    // If would go below viewport, show above
    if (top + popupRect.height > window.scrollY + window.innerHeight) {
        top = rect.top + window.scrollY - popupRect.height - 4;
    }
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    // Dismiss on outside click
    setTimeout(() => {
        chordPopupOutsideClickHandler = function(e) {
            if (!popup.contains(e.target)) {
                dismissChordPopup();
            }
        };
        document.addEventListener('click', chordPopupOutsideClickHandler);
    }, 0);
}

function showAnnotationEditor(song) {
    // Remove any existing editor
    const existing = document.getElementById('annotation-editor');
    if (existing) { existing.remove(); return; }

    const editor = document.createElement('div');
    editor.id = 'annotation-editor';

    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.placeholder = 'Add a note for this song...';
    textarea.value = song.annotation || '';

    const btnRow = document.createElement('div');
    btnRow.className = 'annotation-editor-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
        song.annotation = textarea.value.trim() || '';
        editor.remove();
        renderCurrent();
        await saveSongStateToDB(song);
        saveSessionRef();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { editor.remove(); });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    editor.appendChild(textarea);
    editor.appendChild(btnRow);
    songView.prepend(editor);
    textarea.focus();
}

function toggleAutoScroll() {
    if (autoScrollActive) {
        stopAutoScroll();
    } else {
        startAutoScroll();
    }
}

function startAutoScroll() {
    if (autoScrollActive) return;
    
    autoScrollActive = true;
    autoscrollBtn.textContent = 'Stop';
    autoscrollBtn.style.backgroundColor = '#ff6b6b';
    
    resumeAutoScroll();
}

function resumeAutoScroll() {
    if (!autoScrollActive) return;
    if (autoScrollPauseTimeout) {
        clearTimeout(autoScrollPauseTimeout);
        autoScrollPauseTimeout = null;
    }
    if (autoScrollRafId) {
        cancelAnimationFrame(autoScrollRafId);
        autoScrollRafId = undefined;
    }

    const scrollDuration = 180000;
    const startPosition = window.pageYOffset;
    const endPosition = document.body.scrollHeight - window.innerHeight;
    const distance = endPosition - startPosition;
    
    if (distance <= 0) {
        stopAutoScroll();
        return;
    }
    
    const startTime = performance.now();
    
    function scrollStep(timestamp) {
        const elapsed = timestamp - startTime;
        const currentEndPosition = document.body.scrollHeight - window.innerHeight;
        const currentDistance = currentEndPosition - startPosition;
        const currentPosition = startPosition + (currentDistance * (elapsed / scrollDuration));
        lastAutoScrollAt = Date.now();
        
        if (currentPosition >= currentEndPosition) {
            window.scrollTo(0, currentEndPosition);
            stopAutoScroll();
            return;
        }
        
        window.scrollTo(0, currentPosition);
        autoScrollRafId = requestAnimationFrame(scrollStep);
    }

    autoScrollRafId = requestAnimationFrame(scrollStep);
}

function pauseAutoScroll() {
    if (autoScrollRafId) {
        cancelAnimationFrame(autoScrollRafId);
        autoScrollRafId = undefined;
    }
    if (autoScrollPauseTimeout) {
        clearTimeout(autoScrollPauseTimeout);
    }
    autoScrollPauseTimeout = setTimeout(() => {
        autoScrollPauseTimeout = null;
        resumeAutoScroll();
    }, 2000);
}

function stopAutoScroll() {
    autoScrollActive = false;
    if (autoScrollRafId) {
        cancelAnimationFrame(autoScrollRafId);
        autoScrollRafId = undefined;
    }
    if (autoScrollPauseTimeout) {
        clearTimeout(autoScrollPauseTimeout);
        autoScrollPauseTimeout = null;
    }
    autoscrollBtn.textContent = 'Scroll';
    autoscrollBtn.style.backgroundColor = '';
}

// ── Tempo flash on nav bar ───────────────────────────
let tempoFlashInterval = null;

function flashTempoOnNav(bpm) {
    const navRow = document.getElementById('sticky-nav-row');
    if (!navRow || !bpm || bpm <= 0) return;

    // If already flashing, stop it
    if (tempoFlashInterval) {
        stopTempoFlash();
        return;
    }

    const intervalMs = 60000 / bpm;
    const flashDuration = Math.min(100, intervalMs * 0.3);
    tempoFlashInterval = setInterval(() => {
        navRow.style.backgroundColor = '#ffe082';
        setTimeout(() => {
            navRow.style.backgroundColor = '';
        }, flashDuration);
    }, intervalMs);
}

function stopTempoFlash() {
    if (tempoFlashInterval) {
        clearInterval(tempoFlashInterval);
        tempoFlashInterval = null;
        const navRow = document.getElementById('sticky-nav-row');
        if (navRow) navRow.style.backgroundColor = '';
    }
}

// ── Usage tracking (silent) ──────────────────────────
(function trackUsage() {
    try {
        const img = new Image();
        img.src = 'https://spradbery.com/stagechord/ping.gif?t=' + encodeURIComponent(Date.now());
    } catch (_) { /* silently ignore */ }
})();

// ── Helper: download JSON as file ────────────────────

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Library Browser Modal ────────────────────────────

const libraryModal = document.getElementById('library-modal');
const libraryModalClose = document.getElementById('library-modal-close');
const libraryModalOverlay = document.getElementById('library-modal-overlay');
const librarySongList = document.getElementById('library-song-list');
const libraryAddSelected = document.getElementById('library-add-selected');

function closeLibraryModal() {
    libraryModal.classList.add('hidden');
}
libraryModalClose.addEventListener('click', closeLibraryModal);
libraryModalOverlay.addEventListener('click', closeLibraryModal);

async function openLibraryBrowser() {
    const allSongs = await getAllSongs();
    allSongs.sort((a, b) => {
        const titleA = parseChordPro(a.originalText).metadata.title || a.filename.replace(/\.[^.]+$/, '');
        const titleB = parseChordPro(b.originalText).metadata.title || b.filename.replace(/\.[^.]+$/, '');
        return titleA.localeCompare(titleB);
    });
    librarySongList.innerHTML = '';

    if (allSongs.length === 0) {
        librarySongList.innerHTML = '<div class="empty-message">No songs in library yet. Use "Add Songs to Library" to import ChordPro files.</div>';
        libraryModal.classList.remove('hidden');
        return;
    }

    allSongs.forEach((song) => {
        const parsed = parseChordPro(song.originalText);
        const title = parsed.metadata.title || song.filename.replace(/\.[^.]+$/, '');

        const item = document.createElement('div');
        item.className = 'library-song-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = song.id;
        // Pre-check if already in current set
        if (songs.some(s => s.songId === song.id)) {
            cb.checked = true;
            cb.disabled = true;
        }

        const label = document.createElement('label');
        label.textContent = title;
        label.addEventListener('click', () => { if (!cb.disabled) cb.checked = !cb.checked; });

        const delBtn = document.createElement('button');
        delBtn.className = 'lib-delete-btn';
        delBtn.textContent = '✕';
        delBtn.title = 'Delete from library';
        delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete "${title}" from library?`)) return;
            await deleteSong(song.id);
            // Remove from current set if present
            const setIdx = songs.findIndex(s => s.songId === song.id);
            if (setIdx !== -1) {
                songs.splice(setIdx, 1);
                if (currentIndex >= songs.length) currentIndex = songs.length - 1;
                populateSelect();
                if (currentIndex >= 0) {
                    fileSelect.selectedIndex = currentIndex;
                    renderCurrent();
                } else {
                    songView.innerHTML = '';
                    if (currentSongTitle) currentSongTitle.textContent = '';
                    if (currentSongKey) currentSongKey.innerHTML = '';
                }
                updateNav();
                saveSessionRef();
            }
            item.remove();
        });

        item.appendChild(cb);
        item.appendChild(label);
        item.appendChild(delBtn);
        librarySongList.appendChild(item);
    });

    libraryModal.classList.remove('hidden');
}

libraryAddSelected.addEventListener('click', async () => {
    const checkboxes = librarySongList.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)');
    for (const cb of checkboxes) {
        const songId = Number(cb.value);
        if (songs.some(s => s.songId === songId)) continue;
        const songRecord = await getSong(songId);
        if (!songRecord) continue;
        const state = await getSongState(songId) || {};
        songs.push({
            songId,
            name: songRecord.filename,
            originalText: songRecord.originalText,
            text: state.editedText || songRecord.originalText,
            transpose: state.transpose || 0,
            annotation: state.annotation || '',
            stave: state.stave || null,
            staveTimeSig: state.staveTimeSig || null,
        });
    }
    if (currentIndex < 0 && songs.length > 0) currentIndex = 0;
    populateSelect();
    fileSelect.selectedIndex = currentIndex;
    renderCurrent();
    updateNav();
    saveSessionRef();
    closeLibraryModal();
});

// ── Load Set Modal ───────────────────────────────────

const loadsetModal = document.getElementById('loadset-modal');
const loadsetModalClose = document.getElementById('loadset-modal-close');
const loadsetModalOverlay = document.getElementById('loadset-modal-overlay');
const loadsetList = document.getElementById('loadset-list');

function closeLoadSetModal() {
    loadsetModal.classList.add('hidden');
}
loadsetModalClose.addEventListener('click', closeLoadSetModal);
loadsetModalOverlay.addEventListener('click', closeLoadSetModal);

async function openLoadSetModal() {
    const setlists = await getAllSetlists();
    loadsetList.innerHTML = '';

    if (setlists.length === 0) {
        loadsetList.innerHTML = '<div class="empty-message">No saved sets. Use "Save Set" to save the current set.</div>';
        loadsetModal.classList.remove('hidden');
        return;
    }

    setlists.forEach((setlist) => {
        const item = document.createElement('div');
        item.className = 'setlist-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'setlist-item-name';
        nameSpan.textContent = setlist.name;

        const countSpan = document.createElement('span');
        countSpan.className = 'setlist-item-count';
        countSpan.textContent = `${setlist.songIds.length} songs`;

        const delBtn = document.createElement('button');
        delBtn.className = 'setlist-delete-btn';
        delBtn.textContent = '✕';
        delBtn.title = 'Delete set';
        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete set "${setlist.name}"?`)) return;
            await deleteSetlist(setlist.id);
            if (currentSetlistId === setlist.id) currentSetlistId = null;
            item.remove();
        });

        item.addEventListener('click', async () => {
            await loadSetlistIntoView(setlist.id);
            closeLoadSetModal();
        });

        item.appendChild(nameSpan);
        item.appendChild(countSpan);
        item.appendChild(delBtn);
        loadsetList.appendChild(item);
    });

    loadsetModal.classList.remove('hidden');
}

async function loadSetlistIntoView(setlistId) {
    const setlist = await getSetlist(setlistId);
    if (!setlist) return;

    songs = [];
    for (const songId of setlist.songIds) {
        const songRecord = await getSong(songId);
        if (!songRecord) continue;
        const state = await getSongState(songId) || {};
        songs.push({
            songId,
            name: songRecord.filename,
            originalText: songRecord.originalText,
            text: state.editedText || songRecord.originalText,
            transpose: state.transpose || 0,
            annotation: state.annotation || '',
            stave: state.stave || null,
            staveTimeSig: state.staveTimeSig || null,
        });
    }
    currentIndex = setlist.currentIndex || 0;
    if (currentIndex >= songs.length) currentIndex = Math.max(0, songs.length - 1);
    currentSetlistId = setlist.id;
    populateSelect();
    fileSelect.selectedIndex = currentIndex;
    renderCurrent();
    updateNav();
    saveSessionRef();
}

// ── Save Set Modal ───────────────────────────────────

const savesetModal = document.getElementById('saveset-modal');
const savesetModalClose = document.getElementById('saveset-modal-close');
const savesetModalOverlay = document.getElementById('saveset-modal-overlay');
const savesetName = document.getElementById('saveset-name');
const savesetConfirm = document.getElementById('saveset-confirm');

let _saveSetOnSave = null;
let _saveSetOnCancel = null;

function closeSaveSetModal() {
    savesetModal.classList.add('hidden');
    if (_saveSetOnCancel) { _saveSetOnCancel(); }
    _saveSetOnSave = null;
    _saveSetOnCancel = null;
}
savesetModalClose.addEventListener('click', closeSaveSetModal);
savesetModalOverlay.addEventListener('click', closeSaveSetModal);

function openSaveSetModal(onSave, onCancel) {
    _saveSetOnSave = onSave || null;
    _saveSetOnCancel = onCancel || null;
    if (songs.length === 0) {
        alert('No songs in current set to save.');
        if (onCancel) onCancel();
        return;
    }
    savesetName.value = '';
    savesetModal.classList.remove('hidden');
    savesetName.focus();
}

savesetConfirm.addEventListener('click', async () => {
    const name = savesetName.value.trim();
    if (!name) {
        alert('Please enter a set name.');
        return;
    }
    const setlist = {
        name,
        songIds: songs.map(s => s.songId),
        currentIndex,
        createdAt: Date.now()
    };
    if (currentSetlistId) {
        setlist.id = currentSetlistId;
    }
    const saved = await saveSetlist(setlist);
    currentSetlistId = saved.id;
    saveSessionRef();
    savesetModal.classList.add('hidden');
    if (_saveSetOnSave) { _saveSetOnSave(); }
    _saveSetOnSave = null;
    _saveSetOnCancel = null;
});

// ── Share Set ────────────────────────────────────────

async function buildSetlistExportData() {
    if (songs.length === 0) {
        alert('No songs in current set to share.');
        return null;
    }
    const songIds = songs.map(s => s.songId);
    const tempSetlist = {
        name: 'Shared Set',
        songIds,
        currentIndex,
        createdAt: Date.now()
    };
    if (currentSetlistId) {
        tempSetlist.id = currentSetlistId;
    }
    const saved = await saveSetlist(tempSetlist);
    currentSetlistId = saved.id;
    return exportSetlist(saved.id);
}

async function compressToBase64url(jsonStr) {
    const encoder = new TextEncoder();
    const input = encoder.encode(jsonStr);
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(input);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const compressed = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { compressed.set(c, offset); offset += c.length; }
    // base64url (no padding)
    let b64 = btoa(String.fromCharCode(...compressed));
    b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return b64;
}

async function decompressFromBase64url(b64url) {
    // Restore standard base64
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const decompressed = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { decompressed.set(c, offset); offset += c.length; }
    return new TextDecoder().decode(decompressed);
}

async function shareCurrentSetAsLink() {
    const data = await buildSetlistExportData();
    if (!data) return;
    const json = JSON.stringify(data);
    const compressed = await compressToBase64url(json);
    const url = `${location.origin}${location.pathname}#setlist=${compressed}`;

    // Warn if URL is too long for reliable sharing
    if (url.length > 3000) {
        const proceed = confirm(
            `This link is ${url.length.toLocaleString()} characters — too long for most messaging apps.\n\n` +
            `It may get truncated and fail to import.\n\n` +
            `Use "Share Set as File" instead for reliable sharing.\n\n` +
            `Share the link anyway?`
        );
        if (!proceed) return;
    }

    // Try native share with the URL first
    if (navigator.share) {
        try {
            await navigator.share({ title: data.name || 'Shared Set', url });
            return;
        } catch (_) { /* cancelled or failed — fall through to clipboard */ }
    }
    // Fallback: copy to clipboard
    try {
        await navigator.clipboard.writeText(url);
        alert('Link copied to clipboard.');
    } catch (_) {
        // Final fallback: show it in a prompt
        prompt('Copy this link:', url);
    }
}

async function shareCurrentSetAsFile() {
    const data = await buildSetlistExportData();
    if (!data) return;

    if (navigator.share && navigator.canShare) {
        const file = new File(
            [JSON.stringify(data, null, 2)],
            `${data.name || 'set'}.stagechord.json`,
            { type: 'application/json' }
        );
        const shareData = { files: [file] };
        if (navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
                return;
            } catch (_) {
                // User cancelled or share failed — fall through to download
            }
        }
    }
    downloadJSON(data, `${data.name || 'set'}.stagechord.json`);
}
