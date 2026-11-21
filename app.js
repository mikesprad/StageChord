import { parseChordPro, readHeader, writeHeader, classifyLines } from './parser.js?v=20261016T2';
import { renderStave, openStaveEditor, transposeStaveNotes } from './stave.js?v=20261016T2';
import {
    addSong, addSongIfNew, getSong, getAllSongs, deleteSong,
    getSongState, saveSongState,
    saveSetlist, getSetlist, getAllSetlists, deleteSetlist,
    exportLibrary, importLibrary,
    exportSetlist, importSetlist,
    getDefaultLibrary, getAllLibraries, getLibrary, addLibrary, renameLibrary, deleteLibrary
} from './db.js?v=20261016T2';

// Updates are handled by the service worker + the update manager in index.html
// (cache-first, applied only when the user taps "Update Available"). There is no
// build-id self-check here: it could brick the app on a harmless version skew and
// is redundant now that the service worker serves one atomic version per session.

// Signal to non-module fallback scripts that the app module loaded successfully.
window.__stagechordAppReady = true;

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
let currentLibraryId = null; // ID of active library
let libraryPerSetlist = {}; // Map of setlistId -> libraryId, for restoring on switch
let autoScrollActive = false;
let chordEditMode = false;
let chordPopupOutsideClickHandler = null;
let deferredInstallPrompt = null;

const SESSION_KEY = 'stagechord_session';
const ACTIVE_LIBRARY_KEY = 'stagechord_active_library';
const INLINE_COMMENT_DIRECTIVE = 'sc-comment';

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

// Save lightweight reference to localStorage (just song IDs + position + library)
function saveSessionRef() {
    const data = {
        songIds: songs.map(s => s.songId),
        currentIndex,
        currentSetlistId,
        currentLibraryId,
        libraryPerSetlist: Object.assign({}, libraryPerSetlist)
    };
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(data));
        if (currentLibraryId) {
            localStorage.setItem(ACTIVE_LIBRARY_KEY, String(currentLibraryId));
        } else {
            localStorage.removeItem(ACTIVE_LIBRARY_KEY);
        }
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

async function ensureCurrentLibraryContext() {
    if (currentLibraryId) return currentLibraryId;

    let sessionData = null;
    const activeLibraryRaw = localStorage.getItem(ACTIVE_LIBRARY_KEY);
    if (activeLibraryRaw) {
        const activeLibraryId = Number.parseInt(activeLibraryRaw, 10);
        if (Number.isFinite(activeLibraryId) && activeLibraryId > 0) {
            const lib = await getLibrary(activeLibraryId);
            if (lib) {
                currentLibraryId = activeLibraryId;
            }
        }
    }

    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
        try {
            sessionData = JSON.parse(raw);
        } catch (_) {}
    }

    if (!currentLibraryId && sessionData && sessionData.currentLibraryId) {
        const lib = await getLibrary(sessionData.currentLibraryId);
        if (lib) {
            currentLibraryId = sessionData.currentLibraryId;
        }
    }

    if (!currentLibraryId) {
        const defLib = await getDefaultLibrary();
        currentLibraryId = defLib ? defLib.id : 1;
    }

    if (sessionData && sessionData.libraryPerSetlist && Object.keys(libraryPerSetlist).length === 0) {
        libraryPerSetlist = Object.assign({}, sessionData.libraryPerSetlist);
    }

    return currentLibraryId;
}

// Restore session from localStorage refs + IndexedDB data
async function restoreSession() {
    try {
        await ensureCurrentLibraryContext();

        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!Array.isArray(data.songIds) || data.songIds.length === 0) return false;

        const loaded = [];
        for (const id of data.songIds) {
            const songRecord = await getSong(id);
            if (!songRecord || songRecord.libraryId !== currentLibraryId) continue;
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
        if (currentSetlistId) {
            const set = await getSetlist(currentSetlistId);
            if (!set || set.libraryId !== currentLibraryId) {
                currentSetlistId = null;
            }
        }
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
// (Built with forEach rather than Object.fromEntries, which iOS 12.0 lacks.)
const enharmonicsByKey = {};
Object.keys(keyAccidentals).forEach((key) => {
    const base = flatKeys.has(key) ? [...flatNames] : [...sharpNames];
    if (key === 'Gb' || key === 'Cb') {
        base[11] = 'Cb';
    }
    if (key === 'Cb') {
        base[4] = 'Fb';
    }
    enharmonicsByKey[key] = base;
});

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

// ── Song key ─────────────────────────────────────────
// StageChord shows every key as a major key: a minor key is shown as its
// relative major (Am -> C, F#m -> A).

// "C", "F#", "Am", "Bbm" -> the major key's index (0 = C), or null if it isn't a key.
function parseKeyName(text) {
    const m = String(text || '').trim().match(/^([A-G][#b]?)(.*)$/);
    if (!m || noteEnharmonics[m[1]] === undefined) return null;
    const minor = /^\s*(m(?!aj)|minor)/.test(m[2]);
    return (noteEnharmonics[m[1]] + (minor ? 3 : 0)) % 12;
}

// Works out the key from the chords when the song has no {key:}: the major key
// whose chords (I ii iii IV V vi vii) fit best, favouring a song that starts or
// ends on its I or vi chord. Returns the key's index, or null if there are no chords.
function inferKeyFromChords(lines) {
    const chords = [];
    lines.forEach((tokens) => tokens.forEach((t) => {
        if (t.type !== 'chord') return;
        const m = t.value.split('/')[0].match(/^([A-G][#b]?)(.*)$/);
        if (!m || noteEnharmonics[m[1]] === undefined) return;
        chords.push({
            root: noteEnharmonics[m[1]],
            minor: /^m(?!aj)/.test(m[2]),
            dim: /^(dim|°|ø|m7b5)/.test(m[2])
        });
    }));
    if (!chords.length) return null;
    const first = chords[0];
    const last = chords[chords.length - 1];
    const degree = (c, fam) => (c.root - fam + 12) % 12;
    const isHome = (c, fam) => !c.dim && (c.minor ? degree(c, fam) === 9 : degree(c, fam) === 0);
    let best = null;
    for (let fam = 0; fam < 12; fam++) {
        let score = 0;
        chords.forEach((c) => {
            const d = degree(c, fam);
            if (c.dim ? d === 11 : c.minor ? [2, 4, 9].indexOf(d) >= 0 : [0, 5, 7].indexOf(d) >= 0) score++;
        });
        if (isHome(first, fam)) score += 1.5;
        if (isHome(last, fam)) score += 1;
        if (!best || score > best.score) best = { fam: fam, score: score };
    }
    return best.fam;
}

// The song's key, from {key:} or worked out from its chords, allowing for its
// transpose. originalKeyName / keyName are the original and transposed key names
// (also used to spell chords with the right sharps or flats). Null if no chords.
function songKeyInfo(song, parsed) {
    parsed = parsed || parseChordPro(song.text);
    let index = parsed.metadata.key ? parseKeyName(parsed.metadata.key) : null;
    const inferred = index === null;
    if (inferred) index = inferKeyFromChords(parsed.lines);
    if (index === null) return null;
    return {
        inferred: inferred,
        originalKeyName: getKeyNameForIndex(index),
        keyName: getKeyNameForIndex((index + (song.transpose || 0) + 12) % 12)
    };
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
const fontDecreaseBtn = document.getElementById('font-decrease-btn');
const fontIncreaseBtn = document.getElementById('font-increase-btn');
const addSongsToSetBtn = document.getElementById('menu-add-songs-to-set');

if (fontDecreaseBtn) fontDecreaseBtn.classList.add('annotate-btn');
if (fontIncreaseBtn) fontIncreaseBtn.classList.add('annotate-btn');

// ── iOS detection (before menu functions) ────────────
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const userAgent = navigator.userAgent;
const isIpadOSDesktopUA = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const isSafariEngine = /Safari/.test(userAgent) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(userAgent);
const safariVersionMatch = userAgent.match(/Version\/(\d+)\./);
const safariMajorVersion = safariVersionMatch ? parseInt(safariVersionMatch[1], 10) : null;
const isMacLikeSafari15 = /Macintosh/.test(userAgent) && isSafariEngine && safariMajorVersion === 15;
const isIOS = /iPad|iPhone|iPod/.test(userAgent) || isIpadOSDesktopUA || isMacLikeSafari15;
const iOSVersionMatch = userAgent.match(/OS (\d+)_/);
const iOSVersion = iOSVersionMatch ? parseInt(iOSVersionMatch[1], 10) : null;
const isOldIOS = isIOS && iOSVersion !== null && iOSVersion < 13;
const needsIOSFallback = isIOS && (iOSVersion === null || iOSVersion <= 15 || isMacLikeSafari15);

const FONT_SIZE_KEY = 'stagechord_font_size';
const MIN_FONT_SIZE = 0.8;
const MAX_FONT_SIZE = 1.6;
const FONT_SIZE_STEP = 0.1;
let songFontSize = parseFloat(localStorage.getItem(FONT_SIZE_KEY)) || 1;
let menuTouchActive = false;

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
    if (needsIOSFallback) {
        // On iOS 15, show full-page menu instead of slide-out
        const iosFallbackMenu = document.getElementById('ios-menu-fallback');
        if (iosFallbackMenu) iosFallbackMenu.classList.remove('hidden');
    } else {
        // Normal slide-out menu
        menuPanel.classList.remove('hidden');
        menuOverlay.classList.remove('hidden');
    }
}
function closeMenu() {
    if (needsIOSFallback) {
        const iosFallbackMenu = document.getElementById('ios-menu-fallback');
        if (iosFallbackMenu) iosFallbackMenu.classList.add('hidden');
    } else {
        menuPanel.classList.add('hidden');
        menuOverlay.classList.add('hidden');
    }
}
if (menuBtn) {
    menuBtn.addEventListener('touchstart', () => {
        menuTouchActive = true;
        openMenu();
    }, { passive: true });
    menuBtn.addEventListener('click', () => {
        if (menuTouchActive) {
            menuTouchActive = false;
            return;
        }
        openMenu();
    });
}
if (menuCloseBtn) {
    menuCloseBtn.addEventListener('touchstart', closeMenu, { passive: true });
    menuCloseBtn.addEventListener('click', closeMenu);
}
if (menuOverlay) {
    menuOverlay.addEventListener('touchstart', closeMenu, { passive: true });
    menuOverlay.addEventListener('click', closeMenu);
}

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
    closeMenu();
    fileInput.click();
});

if (addSongsToSetBtn) {
    addSongsToSetBtn.addEventListener('click', () => {
        closeMenu();
        openLibraryBrowser('set');
    });
}
if (document.getElementById('menu-manage-libraries')) {
    document.getElementById('menu-manage-libraries').addEventListener('click', () => {
        closeMenu();
        openManageLibrariesModal();
    });
}
if (document.getElementById('menu-delete-songs')) {
    document.getElementById('menu-delete-songs').addEventListener('click', () => {
        closeMenu();
        openLibraryBrowser('manage');
    });
}

if (fontDecreaseBtn) {
    fontDecreaseBtn.addEventListener('click', () => adjustFontSize(-FONT_SIZE_STEP));
}
if (fontIncreaseBtn) {
    fontIncreaseBtn.addEventListener('click', () => adjustFontSize(FONT_SIZE_STEP));
}

// "Check for Update" / "Update Available" is handled by the update manager in
// index.html (cache-first, user-controlled). No forced cache-clear or reload here.

function applyFontSize(size) {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
    songFontSize = clamped;
    document.documentElement.style.setProperty('--song-font-size', `${songFontSize.toFixed(2)}rem`);
    localStorage.setItem(FONT_SIZE_KEY, songFontSize.toString());
}

function adjustFontSize(delta) {
    applyFontSize(songFontSize + delta);
}

applyFontSize(songFontSize);

document.getElementById('menu-export-library').addEventListener('click', async () => {
    closeMenu();
    const data = await exportLibrary(currentLibraryId);
    downloadJSON(data, 'stagechord-bundle.json');
});

document.getElementById('menu-import-library').addEventListener('click', () => {
    closeMenu();
    document.getElementById('import-library-input').click();
});

// PWA install prompt - init app appearance
// On iOS show the button immediately (no beforeinstallprompt support)
if (isIOS && !isStandalone) {
    const installBtn = document.getElementById('menu-install-app');
    if (installBtn) installBtn.classList.remove('hidden');
}

if (isOldIOS) {
    document.body.classList.add('old-ios-menu');
}

// For iOS 15 and older, add fallback CSS class
if (needsIOSFallback) {
    document.body.classList.add('ios-fallback-mode');
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

// ── iOS 15 Fallback Menu Button Listeners ────────────
if (needsIOSFallback) {
    const iosMenuClose = document.getElementById('ios-menu-close-btn');
    if (iosMenuClose) {
        iosMenuClose.addEventListener('click', closeMenu);
    }

    // Wire iOS menu buttons to same handlers as regular menu
    const iosButtonMap = {
        'ios-menu-new-set': () => { closeMenu(); clearSet(); },
        'ios-menu-add-songs': () => { closeMenu(); fileInput.click(); },
        'ios-menu-add-songs-to-set': () => { closeMenu(); openLibraryBrowser('set'); },
        'ios-menu-manage-libraries': () => { closeMenu(); openManageLibrariesModal(); },
        'ios-menu-delete-songs': () => { closeMenu(); openLibraryBrowser('manage'); },
        'ios-menu-export-library': async () => { closeMenu(); const data = await exportLibrary(currentLibraryId); downloadJSON(data, 'stagechord-bundle.json'); },
        'ios-menu-import-library': () => { closeMenu(); importLibraryInput.click(); },
        'ios-menu-install-app': async () => { 
            closeMenu();
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                const result = await deferredInstallPrompt.userChoice;
                if (result.outcome === 'accepted') {
                    deferredInstallPrompt = null;
                    document.getElementById('ios-menu-install-app').classList.add('hidden');
                }
            } else {
                alert('To install StageChord:\n\niOS (Apple): Tap the Share button (⬆) then "Add to Home Screen"\n\nAndroid: Tap the browser menu (⋮) then "Add to Home screen"');
            }
        },
        'ios-menu-load-set': async () => { closeMenu(); if (await promptSaveCurrentSet()) openLoadSetModal(); },
        'ios-menu-save-set': () => { closeMenu(); openSaveSetModal(); },
        'ios-menu-import-set': async () => { closeMenu(); if (await promptSaveCurrentSet()) importSetInput.click(); },
        'ios-menu-share-set-link': async () => { closeMenu(); await shareCurrentSetAsLink(); },
        'ios-menu-share-set-file': async () => { closeMenu(); await shareCurrentSetAsFile(); },
    };

    for (const [id, handler] of Object.entries(iosButtonMap)) {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', handler);
        }
    }

    // Sync install button visibility with regular menu
    const syncInstallBtn = () => {
        const regularInstall = document.getElementById('menu-install-app');
        const iosInstall = document.getElementById('ios-menu-install-app');
        if (regularInstall && iosInstall) {
            if (regularInstall.classList.contains('hidden')) {
                iosInstall.classList.add('hidden');
            } else {
                iosInstall.classList.remove('hidden');
            }
        }
    };
    window.addEventListener('beforeinstallprompt', syncInstallBtn);
    window.addEventListener('appinstalled', syncInstallBtn);
}

fileInput.addEventListener('change', handleFiles);
prevBtn.addEventListener('click', () => navigate(-1));
nextBtn.addEventListener('click', () => navigate(1));

// ── Swipe left / right on the song to change song ────
// Works while Scroll is running. A swipe has to be long and mostly sideways, so
// scrolling or brushing the screen on stage doesn't change song. Ignored near the
// screen edges (iPhone "back" gesture), with two fingers (pinch), in Edit mode, and
// on a line that scrolls sideways itself.
const SWIPE_MIN_DISTANCE = 80;
const SWIPE_EDGE = 24;
let swipeStart = null;

function scrollsSideways(el) {
    for (; el && el !== songView; el = el.parentNode) {
        if (el.scrollWidth > el.clientWidth + 2) {
            const overflowX = window.getComputedStyle(el).overflowX;
            if (overflowX === 'auto' || overflowX === 'scroll') return true;
        }
    }
    return false;
}

function showSwipeToast(text) {
    let toast = document.getElementById('swipe-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'swipe-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('visible');
    clearTimeout(showSwipeToast.timer);
    showSwipeToast.timer = setTimeout(() => toast.classList.remove('visible'), 1200);
}

songView.addEventListener('touchstart', (e) => {
    swipeStart = null;
    if (e.touches.length !== 1 || chordEditMode) return;
    const t = e.touches[0];
    if (t.clientX < SWIPE_EDGE || t.clientX > window.innerWidth - SWIPE_EDGE) return;
    if (scrollsSideways(e.target)) return;
    swipeStart = { x: t.clientX, y: t.clientY, time: Date.now() };
}, { passive: true });

songView.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) swipeStart = null; // pinch zoom, not a swipe
}, { passive: true });

songView.addEventListener('touchend', (e) => {
    if (!swipeStart || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.x;
    const dy = t.clientY - swipeStart.y;
    const quick = Date.now() - swipeStart.time < 800;
    swipeStart = null;
    if (!quick || Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const delta = dx < 0 ? 1 : -1; // swipe left = next song
    const target = currentIndex + delta;
    if (target < 0 || target >= songs.length) return;
    navigate(delta);
    // Show the name of the song just moved to
    const title = parseChordPro(songs[currentIndex].text).metadata.title || songs[currentIndex].name.replace(/\.[^.]+$/, '');
    showSwipeToast(title);
}, { passive: true });
songOrderBtn.addEventListener('click', openSongOrderPanel);
songOrderDoneBtn.addEventListener('click', closeSongOrderPanel);
autoscrollBtn.addEventListener('click', toggleAutoScroll);
fileSelect.addEventListener('change', () => {
    currentIndex = fileSelect.selectedIndex;
    renderCurrent();
    saveSessionRef();
});

function songCount(n) {
    return n + (n === 1 ? ' song' : ' songs');
}

// What a library import did, in plain words.
function libraryImportMessage(result, libName) {
    const where = libName ? ` "${libName}" library` : ' your library';
    if (result.added === 0 && result.alreadyHad === 0) return 'No songs found in that file.';
    if (result.added === 0) return `No new songs. All ${songCount(result.alreadyHad)} are already in${where}.`;
    let msg = `Added ${songCount(result.added)} to${where}.`;
    if (result.alreadyHad > 0) {
        msg += ` ${songCount(result.alreadyHad)} ${result.alreadyHad === 1 ? 'was' : 'were'} already there.`;
    }
    return msg;
}

importLibraryInput.addEventListener('change', async () => {
    const file = importLibraryInput.files[0];
    if (!file) return;

    const existingSongs = await getAllSongs(currentLibraryId);
    if (existingSongs.length > 0) {
        const choice = prompt(
            `You have ${existingSongs.length} song(s) in this library.\n\n` +
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
            const data = await exportLibrary(currentLibraryId);
            downloadJSON(data, 'stagechord-bundle-backup.json');
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
        const result = await importLibrary(data, currentLibraryId);
        const lib = await getLibrary(currentLibraryId);
        alert(libraryImportMessage(result, lib ? lib.name : ''));
    } catch (e) {
        alert('Failed to import bundle: ' + e.message);
    }
    importLibraryInput.value = '';
});

importSetInput.addEventListener('change', async () => {
    const file = importSetInput.files[0];
    if (!file) return;
    try {
        const libraryId = await ensureCurrentLibraryContext();
        const text = await file.text();
        const data = JSON.parse(text);
        const setlist = await importSetlist(data, libraryId);
        await loadSetlistIntoView(setlist.id);
        alert(formatSetImportMessage('Imported set', setlist));
    } catch (e) {
        alert('Failed to import set: ' + e.message);
    }
    importSetInput.value = '';
});

function formatSetImportMessage(prefix, setlist) {
    const skipped = Number.isFinite(setlist.skipped) ? setlist.skipped : 0;
    let message = `${prefix} "${setlist.name}" with ${setlist.songIds.length} song(s), ${skipped} skipped.`;
    if (setlist.keysUpdated > 0) {
        message += `\n\nUpdated the key of ${setlist.keysUpdated} existing song(s) to match the set.`;
    }
    return message;
}

function clearSetUrlQueryParam() {
    const url = new URL(location.href);
    if (!url.searchParams.has('setUrl')) return;
    url.searchParams.delete('setUrl');
    const nextSearch = url.searchParams.toString();
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
    history.replaceState(null, '', nextUrl);
}

async function autoSaveDraftSetIfNeeded() {
    if (songs.length === 0 || currentSetlistId) return null;
    const libraryId = await ensureCurrentLibraryContext();
    const draftSet = {
        name: 'Draft Set',
        songIds: songs.map((s) => s.songId),
        currentIndex,
        libraryId,
        createdAt: Date.now()
    };
    const savedDraft = await saveSetlist(draftSet);
    currentSetlistId = savedDraft.id;
    saveSessionRef();
    return savedDraft.name;
}

// ── Import setlist from URL hash ─────────────────────
async function importFromUrlHash() {
    const hash = location.hash;
    let pendingLibraryIdRaw = localStorage.getItem('stagechord_pending_import_library_id');
    if (pendingLibraryIdRaw) {
        localStorage.removeItem('stagechord_pending_import_library_id');
    }

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
            // Prefer the library id written by help.html immediately before redirect.
            // Trust it directly without a DB round-trip so early-load timing issues
            // can't cause a silent fallback to Default.
            let libraryId = null;
            if (pendingLibraryIdRaw) {
                const candidateId = Number.parseInt(pendingLibraryIdRaw, 10);
                if (Number.isFinite(candidateId) && candidateId > 0) {
                    libraryId = candidateId;
                    currentLibraryId = candidateId;
                }
            }
            if (!libraryId) {
                libraryId = await ensureCurrentLibraryContext();
            }
            const resp = await fetch(libUrl);
            if (!resp.ok) throw new Error('Could not fetch bundle file');
            const data = await resp.json();
            const result = await importLibrary(data, libraryId);
            const lib = await getLibrary(libraryId);
            const libName = lib ? lib.name : 'Default';
            saveSessionRef();
            alert(libraryImportMessage(result, libName));
            return false; // still restore session normally
        } catch (e) {
            alert('Failed to import bundle: ' + e.message);
            return false;
        }
    }

    const setUrlParam = new URLSearchParams(location.search).get('setUrl');
    if (setUrlParam) {
        try {
            const trimmedSetUrl = String(setUrlParam).trim();
            if (!trimmedSetUrl) {
                throw new Error('Missing setUrl value');
            }
            const parsedSetUrl = new URL(trimmedSetUrl);
            if (parsedSetUrl.protocol !== 'https:') {
                throw new Error('setUrl must use https');
            }

            // If the user already had an unsaved set open, restore it first so we can
            // preserve it as a Draft Set before importing from link.
            if (songs.length === 0) {
                await restoreSession();
            }
            const draftName = await autoSaveDraftSetIfNeeded();
            const libraryId = await ensureCurrentLibraryContext();
            const resp = await fetch(parsedSetUrl.toString());
            if (!resp.ok) throw new Error('Could not fetch set file');

            let data;
            try {
                data = await resp.json();
            } catch (_) {
                throw new Error('Set file is not valid JSON');
            }

            const setlist = await importSetlist(data, libraryId);
            await loadSetlistIntoView(setlist.id);
            clearSetUrlQueryParam();

            let message = formatSetImportMessage('Imported set', setlist);
            if (draftName) {
                message = `Saved current set as "${draftName}" before import.\n\n${message}`;
            }
            alert(message);
            return true;
        } catch (e) {
            alert('Failed to import set from link: ' + e.message);
            return false;
        }
    }

    if (!hash.startsWith('#setlist=')) return false;
    const b64url = hash.slice('#setlist='.length);
    if (!b64url) return false;
    try {
        const libraryId = await ensureCurrentLibraryContext();
        const json = await decompressFromBase64url(b64url);
        const data = JSON.parse(json);
        const setlist = await importSetlist(data, libraryId);
        await loadSetlistIntoView(setlist.id);
        // Clean the hash so a reload doesn't re-import
        history.replaceState(null, '', location.pathname + location.search);
        alert(formatSetImportMessage('Imported shared set', setlist));
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
    // Always flush the resolved currentLibraryId back to localStorage so that
    // help.html (and any other page) can read the correct library from
    // stagechord_session without needing the user to have switched libraries.
    await ensureCurrentLibraryContext();
    saveSessionRef();

    if (restored) {
        populateSelect();
        fileSelect.selectedIndex = currentIndex;
        renderCurrent();
        updateNav();
    }
    await importPendingSong();
    // If running as an installed PWA with an empty library, let user know
    if (isStandalone) {
        const libraryId = await ensureCurrentLibraryContext();
        const allSongs = await getAllSongs(libraryId);
        if (allSongs.length === 0) {
            alert(
                'Your song library is empty.\n\n'
                + 'If you previously used StageChord in a browser, you can transfer your library:\n\n'
                + '1. In the browser: Menu → Export Bundle\n'
                + '2. In this app: Menu → Import Bundle'
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
        await addSongsToView(valid);
        fileInput.value = '';
    });
}

// Add songs ({ name, text }) to the current library and to the songs on screen.
// Returns the last song's { songId, isNew }.
async function addSongsToView(items) {
    let last = null;
    for (const { name, text } of items) {
        last = await addSongIfNew(name, text, currentLibraryId);
        const songId = last.id;
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
    return last;
}

// A song sent from the ChordPro converter (chordpro-converter.html, same site):
// add it to the current library and open it. If it's already there, just open it.
const PENDING_SONG_KEY = 'stagechord_pending_song';
async function importPendingSong() {
    let pending = null;
    try {
        const raw = localStorage.getItem(PENDING_SONG_KEY);
        if (!raw) return;
        localStorage.removeItem(PENDING_SONG_KEY);
        pending = JSON.parse(raw);
    } catch (_) {
        return;
    }
    if (!pending || typeof pending.text !== 'string' || !pending.text.trim()) return;
    const name = String(pending.filename || 'Untitled.chopro');
    try {
        const result = await addSongsToView([{ name: name, text: pending.text }]);
        const idx = songs.findIndex((s) => s.songId === result.id);
        if (idx >= 0) {
            currentIndex = idx;
            fileSelect.selectedIndex = currentIndex;
            renderCurrent();
            updateNav();
            saveSessionRef();
        }
        if (!result.isNew) alert('That song is already in this library, so it has been opened.');
    } catch (e) {
        alert('Could not add the song: ' + e.message);
    }
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
        upBtn.type = 'button';
        upBtn.textContent = '↑';
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', () => reorderSong(idx, -1));

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.textContent = '↓';
        downBtn.disabled = idx === songs.length - 1;
        downBtn.addEventListener('click', () => reorderSong(idx, 1));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-song';
        removeBtn.textContent = '🗑';
        removeBtn.title = 'Remove song from set';
        removeBtn.addEventListener('click', () => removeSongFromSet(idx));

        btnWrap.appendChild(upBtn);
        btnWrap.appendChild(downBtn);
        btnWrap.appendChild(removeBtn);
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

function removeSongFromSet(idx) {
    if (idx < 0 || idx >= songs.length) return;
    if (!confirm('Remove this song from the current set?')) return;
    songs.splice(idx, 1);
    if (songs.length === 0) {
        currentIndex = -1;
    } else if (currentIndex === idx) {
        currentIndex = Math.min(idx, songs.length - 1);
    } else if (currentIndex > idx) {
        currentIndex -= 1;
    }
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

function splitEditableSegments(text) {
    if (!text) return [];
    // Safari 15 doesn't support regex lookbehind, so use a compatible tokenizer.
    return text.match(/\S+\s*|\s+/g) || [];
}

function parseDirectiveLine(rawLine) {
    const trimmed = String(rawLine || '').trim();
    const match = trimmed.match(/^\{([^:}]+):\s*(.*?)\}$/);
    if (!match) return null;
    return {
        key: match[1].trim().toLowerCase(),
        value: match[2]
    };
}

function sanitizeInlineCommentText(text) {
    return String(text || '')
        .replace(/[{}]/g, '')
        .replace(/\r?\n+/g, ' / ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getSectionInlineCommentRange(song, headingRawLineIndex) {
    const lines = song.text.split(/\r?\n/);
    if (lines.length === 0) return { lines, indexes: [], firstIndex: -1, firstText: '' };

    const boundedIndex = Math.max(0, Math.min(headingRawLineIndex, lines.length - 1));
    const indexes = [];
    for (let i = boundedIndex + 1; i < lines.length; i++) {
        const directive = parseDirectiveLine(lines[i]);
        if (!directive || directive.key !== INLINE_COMMENT_DIRECTIVE) break;
        indexes.push(i);
    }

    const firstIndex = indexes.length > 0 ? indexes[0] : -1;
    const firstText = firstIndex >= 0
        ? ((parseDirectiveLine(lines[firstIndex]) || {}).value || '')
        : '';

    return { lines, indexes, firstIndex, firstText };
}

function upsertSectionInlineComment(song, headingRawLineIndex, commentText) {
    const comment = sanitizeInlineCommentText(commentText);
    if (!comment) return false;

    const info = getSectionInlineCommentRange(song, headingRawLineIndex);
    const { lines, indexes, firstIndex } = info;

    if (firstIndex >= 0) {
        lines[firstIndex] = `{${INLINE_COMMENT_DIRECTIVE}: ${comment}}`;
        // If multiple old comments exist, keep one canonical attached comment.
        for (let i = indexes.length - 1; i >= 1; i--) {
            lines.splice(indexes[i], 1);
        }
        song.text = lines.join('\n');
        return true;
    }

    const boundedIndex = Math.max(0, Math.min(headingRawLineIndex, lines.length - 1));
    const insertAt = boundedIndex + 1;
    lines.splice(insertAt, 0, `{${INLINE_COMMENT_DIRECTIVE}: ${comment}}`);
    song.text = lines.join('\n');
    return true;
}

function deleteSectionInlineComment(song, headingRawLineIndex) {
    const info = getSectionInlineCommentRange(song, headingRawLineIndex);
    if (info.indexes.length === 0) return false;
    const lines = info.lines;
    for (let i = info.indexes.length - 1; i >= 0; i--) {
        lines.splice(info.indexes[i], 1);
    }
    song.text = lines.join('\n');
    return true;
}

async function openSectionInlineCommentEditor(song, headingRawLineIndex) {
    const existing = document.getElementById('inline-comment-editor-overlay');
    if (existing) existing.remove();

    const info = getSectionInlineCommentRange(song, headingRawLineIndex);
    const hasExisting = info.firstIndex >= 0;

    const overlay = document.createElement('div');
    overlay.id = 'inline-comment-editor-overlay';

    const panel = document.createElement('div');
    panel.id = 'inline-comment-editor-panel';

    const title = document.createElement('div');
    title.className = 'inline-comment-editor-title';
    title.textContent = hasExisting
        ? 'Edit comment below section heading'
        : 'Add comment below section heading';

    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.placeholder = 'Type section comment...';
    textarea.value = hasExisting ? info.firstText : '';

    const btnRow = document.createElement('div');
    btnRow.className = 'inline-comment-editor-buttons';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
        const nextValue = String(textarea.value || '').trim();
        if (!nextValue) {
            if (hasExisting) {
                deleteSectionInlineComment(song, headingRawLineIndex);
                overlay.remove();
                await saveSongStateToDB(song);
                saveSessionRef();
                renderCurrent();
                return;
            }
            alert('Please enter a comment.');
            return;
        }

        if (!upsertSectionInlineComment(song, headingRawLineIndex, nextValue)) {
            alert('Please enter a comment.');
            return;
        }
        overlay.remove();
        await saveSongStateToDB(song);
        saveSessionRef();
        renderCurrent();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
        overlay.remove();
    });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(title);
    panel.appendChild(textarea);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    textarea.focus();
}

function detectSectionType(rawLine) {
    const trimmed = rawLine.trim();
    // Lines wrapped in curly brackets are directives, not headings.
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return null;
    // Bar lines are never headings, even with repeat marks: "||: [G] [C] :||".
    if (trimmed.startsWith('|')) return null;
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
    const lineInfo = classifyLines(song.text);
    const rawLines = lineInfo.lines;
    const lastSectionAnchors = {};
    const contentLines = rawLines.filter((line, i) => lineInfo.kinds[i] === 'content');
    
    // Original and transposed key (always major: Am is shown as C).
    const keyInfo = songKeyInfo(song, parsed);
    const hasKey = !!keyInfo;
    const inferredKey = hasKey && keyInfo.inferred;
    const originalKeyName = hasKey ? keyInfo.originalKeyName : 'C';
    const transposedKeyName = hasKey ? keyInfo.keyName : 'C';

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
            currentSongKey.appendChild(document.createTextNode(`${keyLabel}${transposedKeyName} `));
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
            tempoBtn.type = 'button';
            tempoBtn.className = 'tempo-btn';
            tempoBtn.textContent = `Tempo: ${parsed.metadata.tempo}`;
            tempoBtn.title = 'Click for tempo flash';
            tempoBtn.addEventListener('click', () => {
                const bpm = Number(parsed.metadata.tempo);
                if (!Number.isFinite(bpm) || bpm <= 0) return;
                flashTempoOnNav(bpm);
            });
            if (currentSongKey) currentSongKey.appendChild(tempoBtn);
        }
    }

    // Button group for +Comment, +Stave, Edit — on its own row
    const btnGroup = document.createElement('span');
    btnGroup.className = 'meta-btn-group';

    // Annotation button — always shown
    const annotateBtn = document.createElement('button');
    annotateBtn.textContent = song.annotation ? '✎ Memo' : '+Memo';
    annotateBtn.className = 'annotate-btn';
    annotateBtn.title = song.annotation ? 'Edit memo' : 'Add memo';
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
    const songMetaRow = document.getElementById('song-meta-row');
    const fontControls = document.getElementById('font-size-controls');
    if (songBtnRow) {
        if (fontControls && songMetaRow && songBtnRow.contains(fontControls)) {
            songMetaRow.appendChild(fontControls);
        }
        songBtnRow.innerHTML = '';
        songBtnRow.appendChild(btnGroup);
    }

    // "Edit info" (song name, artist, flow…) — always visible, at the end of the
    // title/key/tempo row. Created here rather than in index.html so it never
    // shows as a dead button if the app falls back on an old device.
    if (songMetaRow && songBtnRow) {
        let editInfoBtn = document.getElementById('edit-info-btn');
        if (!editInfoBtn) {
            editInfoBtn = document.createElement('button');
            editInfoBtn.id = 'edit-info-btn';
            editInfoBtn.type = 'button';
            editInfoBtn.className = 'annotate-btn';
            editInfoBtn.textContent = 'Edit info';
            editInfoBtn.title = 'Edit song name, artist and other song info';
            songMetaRow.insertBefore(editInfoBtn, songBtnRow);
        }
        editInfoBtn.onclick = () => openSongDetailsEditor(song, true);
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

    // Edit button (chords and lyrics; key and tempo are in Edit info)
    const editChordsBtn = document.createElement('button');
    editChordsBtn.textContent = chordEditMode ? '✓ Done' : '✎ Edit song';
    editChordsBtn.className = 'annotate-btn' + (chordEditMode ? ' active-edit' : '');
    editChordsBtn.title = 'Edit chords and lyrics';
    editChordsBtn.addEventListener('click', () => {
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
            if (!confirm('Reset all chord edits to original and remove all Comments?')) return;
            song.text = song.originalText;
            await saveSongStateToDB(song);
            renderCurrent();
        });
        btnGroup.appendChild(resetBtn);
    }

    // Keep font controls on the same row and style context as song action buttons.
    if (fontControls) {
        fontControls.classList.add('in-meta-btn-group');
        btnGroup.appendChild(fontControls);
    }

    // Show annotation box if annotation exists
    if (song.annotation) {
        const annoBox = document.createElement('div');
        annoBox.className = 'annotation-box';

        const label = document.createElement('strong');
        label.className = 'annotation-label';
        label.textContent = 'Memo:';

        const content = document.createElement('span');
        content.className = 'annotation-text';
        content.textContent = song.annotation;

        annoBox.appendChild(label);
        annoBox.appendChild(document.createTextNode(' '));
        annoBox.appendChild(content);
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
    let currentSectionHeadingRawLineIndex = -1;
    
    let parsedLineIndex = 0;
    let contentLineIndex = 0;

    rawLines.forEach((rawLine, rawLineIndex) => {
        if (lineInfo.kinds[rawLineIndex] !== 'content') {
            // Header metadata and other directives are hidden; only section comments show.
            const directive = lineInfo.directives[rawLineIndex];
            if (directive && directive.name === INLINE_COMMENT_DIRECTIVE) {
                const commentDiv = document.createElement('div');
                commentDiv.className = 'flow-comment-box';

                const commentLabel = document.createElement('strong');
                commentLabel.className = 'flow-comment-label';
                commentLabel.textContent = 'Comment:';

                const commentText = document.createElement('span');
                commentText.className = 'flow-comment-text';
                commentText.textContent = directive.value;

                commentDiv.appendChild(commentLabel);
                commentDiv.appendChild(document.createTextNode(' '));
                commentDiv.appendChild(commentText);
                if (chordEditMode && currentSectionHeadingRawLineIndex >= 0) {
                    const sectionHeadingIndexForComment = currentSectionHeadingRawLineIndex;
                    commentDiv.classList.add('flow-comment-target');
                    commentDiv.title = 'Edit comment below section';
                    commentDiv.addEventListener('click', (event) => {
                        event.stopPropagation();
                        openSectionInlineCommentEditor(song, sectionHeadingIndexForComment);
                    });
                }
                songView.appendChild(commentDiv);
                lastWasEmpty = false;
                previousRenderedType = 'comment';
            }
            return;
        }

        const lineTokens = parsed.lines[parsedLineIndex] || [];
        const lineIndex = contentLineIndex;
        parsedLineIndex++;
        contentLineIndex++;

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
            currentSectionHeadingRawLineIndex = rawLineIndex;
            if (chordEditMode) {
                sectionDiv.classList.add('section-comment-target');
                sectionDiv.title = 'Add comment below section';
                sectionDiv.addEventListener('click', (event) => {
                    event.stopPropagation();
                    openSectionInlineCommentEditor(song, rawLineIndex);
                });
            }
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
                const words = splitEditableSegments(fullText);
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
                    const words = splitEditableSegments(pair.text);
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

// Key and tempo have their own fields at the top of Edit info (the key allows
// for transposition), so they don't appear as plain info rows.
const DETAILS_MANAGED_KEYS = ['key', 'tempo'];

// Song name + header metadata editor. Plain DOM overlay (no <dialog>) so it works
// on old iPads. Changes are stored as an edit (editedText); Reset reverts them.
function openSongDetailsEditor(song, focusTitle) {
    const existing = document.getElementById('song-details-overlay');
    if (existing) existing.remove();

    const header = readHeader(song.text);
    const entries = header.entries.map((e) => Object.assign({}, e));
    let titleEntry = null;
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].key.toLowerCase() === 'title') { titleEntry = entries[i]; break; }
    }
    if (!titleEntry) {
        titleEntry = { key: 'title', value: '', hasColon: true, isNew: true };
        entries.unshift(titleEntry);
    }

    const overlay = document.createElement('div');
    overlay.id = 'song-details-overlay';
    const panel = document.createElement('div');
    panel.id = 'song-details-panel';

    const heading = document.createElement('div');
    heading.className = 'inline-comment-editor-title';
    heading.textContent = 'Song info';
    panel.appendChild(heading);

    const titleLabel = document.createElement('label');
    titleLabel.className = 'song-details-label';
    titleLabel.textContent = 'Song name';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.id = 'song-details-title';
    titleInput.value = titleEntry.value || (parseChordPro(song.text).metadata.title ? '' : song.name.replace(/\.[^.]+$/, ''));
    titleLabel.appendChild(titleInput);
    panel.appendChild(titleLabel);

    // Key and tempo, working as they did in Edit mode.
    const shownKey = displayedKey(song);
    const keyTempoRow = document.createElement('div');
    keyTempoRow.className = 'song-details-keytempo';
    const keyLabel = document.createElement('label');
    keyLabel.className = 'song-details-label';
    keyLabel.textContent = 'Key';
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.id = 'song-details-key';
    keyInput.setAttribute('autocapitalize', 'off');
    keyInput.setAttribute('autocorrect', 'off');
    keyInput.placeholder = shownKey.name || 'e.g. G';
    keyInput.value = shownKey.explicit ? shownKey.name : '';
    keyLabel.appendChild(keyInput);
    const tempoLabel = document.createElement('label');
    tempoLabel.className = 'song-details-label';
    tempoLabel.textContent = 'Tempo';
    const tempoInput = document.createElement('input');
    tempoInput.type = 'number';
    tempoInput.id = 'song-details-tempo';
    tempoInput.min = 20;
    tempoInput.max = 300;
    tempoInput.placeholder = 'bpm';
    tempoInput.value = parseChordPro(song.text).metadata.tempo || '';
    tempoLabel.appendChild(tempoInput);
    keyTempoRow.appendChild(keyLabel);
    keyTempoRow.appendChild(tempoLabel);
    panel.appendChild(keyTempoRow);
    const keyNote = document.createElement('div');
    keyNote.className = 'song-details-note';
    keyNote.textContent = 'The key the chords on screen are in. Changing it doesn’t change the chords.';
    panel.appendChild(keyNote);

    const rowsBox = document.createElement('div');
    rowsBox.className = 'song-details-rows';
    panel.appendChild(rowsBox);

    const rows = [];
    function addRow(entry) {
        const row = document.createElement('div');
        row.className = 'song-details-row';
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'song-details-key';
        keyInput.placeholder = 'e.g. artist';
        keyInput.value = entry.key;
        keyInput.setAttribute('autocapitalize', 'off');
        keyInput.setAttribute('autocorrect', 'off');
        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'song-details-value';
        valueInput.placeholder = 'e.g. Elevation Worship';
        valueInput.value = entry.value;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'song-details-remove';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Remove';
        const record = { entry: entry, row: row, keyInput: keyInput, valueInput: valueInput, removed: false };
        removeBtn.addEventListener('click', () => {
            record.removed = true;
            if (row.parentNode) row.parentNode.removeChild(row);
        });
        row.appendChild(keyInput);
        row.appendChild(valueInput);
        row.appendChild(removeBtn);
        rowsBox.appendChild(row);
        rows.push(record);
        return record;
    }

    entries.forEach((entry) => {
        if (entry === titleEntry) return;
        if (DETAILS_MANAGED_KEYS.indexOf(entry.key.toLowerCase()) >= 0) return;
        addRow(entry);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'song-details-add';
    addBtn.textContent = '+ Add song info';
    addBtn.addEventListener('click', () => {
        const entry = { key: '', value: '', hasColon: true, isNew: true };
        entries.push(entry);
        addRow(entry).keyInput.focus();
    });
    panel.appendChild(addBtn);

    const btnRow = document.createElement('div');
    btnRow.className = 'inline-comment-editor-buttons';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
        titleEntry.value = titleInput.value;
        rows.forEach((r) => {
            r.entry.key = r.keyInput.value;
            r.entry.value = r.valueInput.value;
            r.entry.removed = r.removed;
        });
        const next = entries.filter((e) => {
            if (e.removed) return false;
            if (e.isNew && !String(e.value || '').trim()) return false;
            return true;
        });
        const before = song.text;
        song.text = writeHeader(song.text, next);
        applyKeyTempo(song, keyInput.value, tempoInput.value);
        overlay.remove();
        if (song.text === before) return;
        await saveSongStateToDB(song);
        saveSessionRef();
        populateSelect();
        fileSelect.selectedIndex = currentIndex;
        renderCurrent();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    if (focusTitle) titleInput.focus();
}

// The key as shown on screen (the file's key plus the song's transpose).
// explicit is false when there's no {key:} and it was worked out from the chords.
function displayedKey(song) {
    const info = songKeyInfo(song);
    if (!info) return { name: '', explicit: false };
    return { name: info.keyName, explicit: !info.inferred };
}

// Apply the Key and Tempo fields from Edit info to song.text. The key typed is
// the key as shown on screen, so it's stored relative to the song's transpose:
// it relabels the song and never moves the chords. A blank key is left alone;
// a blank tempo removes it. Returns true if the text changed.
function applyKeyTempo(song, keyValue, tempoValue) {
    let changed = false;

    if (keyValue !== null) {
        const newKey = String(keyValue).trim();
        if (newKey) {
            // Typing a minor key stores its relative major ("Am" -> C).
            const typed = parseKeyName(newKey);
            if (typed !== null) {
                const storedIndex = (typed - (song.transpose || 0) + 12) % 12;
                const existing = parseKeyName(parseChordPro(song.text).metadata.key);
                // Keep the existing key's text unless it's a different key.
                if (existing !== storedIndex) {
                    if (updateSongMetadata(song, 'key', getKeyNameForIndex(storedIndex))) changed = true;
                }
            }
        }
    }

    if (tempoValue !== null) {
        const val = String(tempoValue).trim();
        if (val && !isNaN(val) && val >= 20 && val <= 300) {
            if (updateSongMetadata(song, 'tempo', val)) changed = true;
        } else if (!val) {
            // If cleared, remove tempo directive
            if (removeSongMetadata(song, 'tempo')) changed = true;
        }
    }
    return changed;
}

// Update or insert a metadata directive in the song text (e.g. {key: G}, {tempo: 120})
// Set a header metadata value ({key: G}). Returns true if the text changed.
// Only the header block is rewritten; unchanged lines keep their exact text.
function updateSongMetadata(song, directive, value) {
    const header = readHeader(song.text);
    const name = directive.toLowerCase();
    const want = String(value).trim();
    let entry = null;
    for (let i = 0; i < header.entries.length; i++) {
        if (header.entries[i].key.toLowerCase() === name) { entry = header.entries[i]; break; }
    }
    if (entry) {
        if (entry.value === want) return false;
        entry.value = want;
    } else {
        header.entries.push({ key: directive, value: want, hasColon: true });
    }
    const next = writeHeader(song.text, header.entries);
    if (next === song.text) return false;
    song.text = next;
    return true;
}

// Remove a metadata directive (header entries and any `{key: ...}` lines further
// down). Returns true if the text changed.
function removeSongMetadata(song, directive) {
    const name = directive.toLowerCase();
    const header = readHeader(song.text);
    const kept = header.entries.filter((e) => e.key.toLowerCase() !== name);
    let text = kept.length === header.entries.length ? song.text : writeHeader(song.text, kept);
    const info = classifyLines(text);
    const lines = info.lines.filter((line, i) => !(info.kinds[i] === 'directive' && info.directives[i].name === name));
    if (lines.length !== info.lines.length) {
        text = lines.join(info.header.eol);
    }
    if (text === song.text) return false;
    song.text = text;
    return true;
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
    const kinds = classifyLines(song.text).kinds;
    let contentLineCount = -1;
    let actualLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (kinds[i] !== 'content') continue;
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
    textarea.placeholder = 'Add a memo for this song...';
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
    if (!navRow || !Number.isFinite(bpm) || bpm <= 0) return;

    // If already flashing, stop it
    if (tempoFlashInterval) {
        stopTempoFlash();
        return;
    }

    const intervalMs = 60000 / bpm;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

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

// ── Manage Libraries Modal ──────────────────────────

const manageLibrariesModal = document.getElementById('manage-libraries-modal');
const manageLibrariesModalClose = document.getElementById('manage-libraries-modal-close');
const manageLibrariesModalOverlay = document.getElementById('manage-libraries-modal-overlay');
const manageLibrariesNewName = document.getElementById('manage-libraries-new-name');
const manageLibrariesAddBtn = document.getElementById('manage-libraries-add');
const manageLibrariesList = document.getElementById('manage-libraries-list');

function closeManageLibrariesModal() {
    manageLibrariesModal.classList.add('hidden');
}

manageLibrariesModalClose.addEventListener('click', closeManageLibrariesModal);
manageLibrariesModalOverlay.addEventListener('click', closeManageLibrariesModal);

async function switchToLibrary(libraryId) {
    if (currentLibraryId === libraryId) return;

    // Save the last set used with the old library if applicable
    if (currentSetlistId && currentLibraryId) {
        libraryPerSetlist[currentSetlistId] = currentLibraryId;
    }

    currentLibraryId = libraryId;

    // Try to restore the last used set for this library
    currentSetlistId = null;
    for (const [setId, libId] of Object.entries(libraryPerSetlist)) {
        if (libId === libraryId) {
            const set = await getSetlist(Number(setId));
            if (set && set.libraryId === libraryId) {
                currentSetlistId = Number(setId);
                break;
            }
        }
    }

    clearSet();
    saveSessionRef();

    // Optionally restore a set for the new library
    if (currentSetlistId) {
        await loadSetlistIntoView(currentSetlistId);
    }

    populateSelect();
    renderCurrent();
    updateNav();
}

async function openManageLibrariesModal() {
    manageLibrariesList.innerHTML = '';
    manageLibrariesNewName.value = '';
    const libs = await getAllLibraries();
    
    for (const lib of libs) {
        const item = document.createElement('div');
        item.className = 'library-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '0.5rem 0.2rem';
        item.style.borderBottom = '1px solid #f0f0f0';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = lib.name;
        nameSpan.style.flex = '1';
        nameSpan.style.fontSize = '0.95rem';

        if (currentLibraryId === lib.id) {
            const checkmark = document.createElement('span');
            checkmark.textContent = '✓';
            checkmark.style.color = '#2f7d6c';
            checkmark.style.fontWeight = 'bold';
            checkmark.style.marginRight = '0.45rem';
            item.appendChild(checkmark);
            item.style.backgroundColor = '#f0f0f0';
        }

        const btnWrap = document.createElement('div');
        btnWrap.className = 'library-item-buttons';
        btnWrap.style.display = 'flex';
        btnWrap.style.gap = '0.25rem';
        btnWrap.style.flexShrink = '0';

        // Rename button (not for Default library)
        if (!lib.isDefault) {
            const renameBtn = document.createElement('button');
            renameBtn.textContent = '✎';
            renameBtn.title = 'Rename library';
            renameBtn.style.background = 'none';
            renameBtn.style.border = 'none';
            renameBtn.style.color = '#2f7d6c';
            renameBtn.style.cursor = 'pointer';
            renameBtn.style.fontSize = '0.9rem';
            renameBtn.style.padding = '0.2rem 0.4rem';
            renameBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                const newName = prompt(`Rename library "${lib.name}" to:`, lib.name);
                if (newName && newName.trim()) {
                    try {
                        await renameLibrary(lib.id, newName);
                        openManageLibrariesModal();
                    } catch (e) {
                        alert('Error renaming library: ' + e.message);
                    }
                }
            });
            btnWrap.appendChild(renameBtn);
        }

        // Delete button (not for Default library)
        if (!lib.isDefault) {
            const delBtn = document.createElement('button');
            delBtn.textContent = '✕';
            delBtn.title = 'Delete library';
            delBtn.style.background = 'none';
            delBtn.style.border = 'none';
            delBtn.style.color = '#c00';
            delBtn.style.cursor = 'pointer';
            delBtn.style.fontSize = '0.9rem';
            delBtn.style.padding = '0.2rem 0.4rem';
            delBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!confirm(`Delete library "${lib.name}"? Songs and sets will be moved to Default.`)) return;
                try {
                    await deleteLibrary(lib.id);
                    if (currentLibraryId === lib.id) {
                        const defLib = await getDefaultLibrary();
                        currentLibraryId = defLib.id;
                        clearSet();
                        saveSessionRef();
                    }
                    openManageLibrariesModal();
                } catch (e) {
                    alert('Error deleting library: ' + e.message);
                }
            });
            btnWrap.appendChild(delBtn);
        }

        item.appendChild(nameSpan);
        item.appendChild(btnWrap);
        item.addEventListener('click', async () => {
            if (currentLibraryId === lib.id) {
                closeManageLibrariesModal();
                return;
            }
            if (!(await promptSaveCurrentSet())) return;
            await switchToLibrary(lib.id);
            closeManageLibrariesModal();
        });
        item.addEventListener('mouseenter', () => {
            if (currentLibraryId !== lib.id) {
                item.style.backgroundColor = '#f5f5f5';
            }
        });
        item.addEventListener('mouseleave', () => {
            if (currentLibraryId !== lib.id) {
                item.style.backgroundColor = '';
            }
        });
        manageLibrariesList.appendChild(item);
    }

    manageLibrariesModal.classList.remove('hidden');
}

manageLibrariesAddBtn.addEventListener('click', async () => {
    const name = manageLibrariesNewName.value.trim();
    if (!name) {
        alert('Please enter a library name');
        return;
    }
    if (name.length > 17) {
        alert('Library name must be 17 characters or less');
        return;
    }
    try {
        await addLibrary(name);
        openManageLibrariesModal();
    } catch (e) {
        alert('Error creating library: ' + e.message);
    }
});

// ── Library Browser Modal ────────────────────────────

const libraryModal = document.getElementById('library-modal');
const libraryModalClose = document.getElementById('library-modal-close');
const libraryModalOverlay = document.getElementById('library-modal-overlay');
const libraryModalHeader = document.getElementById('library-modal-header');
const libraryModalTitle = libraryModalHeader ? libraryModalHeader.querySelector('span') : null;
const librarySongList = document.getElementById('library-song-list');
const libraryModalActions = document.getElementById('library-modal-actions');
const libraryAddSelected = document.getElementById('library-add-selected');

function closeLibraryModal() {
    libraryModal.classList.add('hidden');
}
libraryModalClose.addEventListener('click', closeLibraryModal);
libraryModalOverlay.addEventListener('click', closeLibraryModal);

function setLibraryDoneButtonsDisabled(disabled) {
    if (libraryAddSelected) {
        libraryAddSelected.disabled = disabled;
    }
}

function setLibraryDoneButtonsVisible(isSetMode) {
    if (libraryModalActions) {
        libraryModalActions.style.display = isSetMode ? 'block' : 'none';
    }
}

async function applyLibrarySelectionAndClose() {
    const checkboxes = Array.from(librarySongList.querySelectorAll('input[type="checkbox"]'));
    const selectedIds = checkboxes.filter(cb => cb.checked).map(cb => Number(cb.value));
    const currentSongId = songs[currentIndex] ? songs[currentIndex].songId : undefined;
    const songMap = new Map(songs.map((song) => [song.songId, song]));
    const updatedSongs = [];

    for (const songId of selectedIds) {
        if (songMap.has(songId)) {
            updatedSongs.push(songMap.get(songId));
        } else {
            const songRecord = await getSong(songId);
            if (!songRecord) continue;
            const state = await getSongState(songId) || {};
            updatedSongs.push({
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
    }

    songs = updatedSongs;
    if (songs.length === 0) {
        currentIndex = -1;
    } else {
        const existingIndex = songs.findIndex((s) => s.songId === currentSongId);
        currentIndex = existingIndex !== -1 ? existingIndex : 0;
    }

    populateSelect();
    if (currentIndex >= 0) {
        fileSelect.selectedIndex = currentIndex;
    }
    renderCurrent();
    updateNav();
    saveSessionRef();
    closeLibraryModal();
}

async function onLibraryDoneClick() {
    try {
        setLibraryDoneButtonsDisabled(true);
        await applyLibrarySelectionAndClose();
    } finally {
        setLibraryDoneButtonsDisabled(false);
    }
}

async function openLibraryBrowser(mode = 'set') {
    const isManageMode = mode === 'manage';
    const allSongs = await getAllSongs(currentLibraryId);
    // Titles come from the edited text when the song has been edited (e.g. renamed).
    const songTitles = {};
    await Promise.all(allSongs.map(async (song) => {
        let text = song.originalText;
        try {
            const state = await getSongState(song.id);
            if (state && state.editedText) text = state.editedText;
        } catch (_) {}
        songTitles[song.id] = parseChordPro(text).metadata.title || song.filename.replace(/\.[^.]+$/, '');
    }));
    allSongs.sort((a, b) => songTitles[a.id].localeCompare(songTitles[b.id]));
    librarySongList.innerHTML = '';
    libraryModal.dataset.mode = mode;
    if (libraryModalTitle) {
        const lib = currentLibraryId ? await getLibrary(currentLibraryId) : null;
        const libName = currentLibraryId ? (lib ? lib.name : undefined) : 'Unknown';
        libraryModalTitle.textContent = isManageMode 
            ? `Manage Library (${libName})` 
            : 'Add Songs to Set';
    }
    setLibraryDoneButtonsVisible(!isManageMode);

    if (allSongs.length === 0) {
        const emptyMessage = isManageMode
            ? 'No songs in this library yet. Use "Add Songs to Library" to import ChordPro files.'
            : 'No songs in this library yet. Use "Add Songs to Library" to import ChordPro files.';
        librarySongList.innerHTML = `<div class="empty-message">${emptyMessage}</div>`;
        libraryModal.classList.remove('hidden');
        return;
    }

    allSongs.forEach((song) => {
        const title = songTitles[song.id];

        const item = document.createElement('div');
        item.className = 'library-song-item';

        let cb = null;
        if (!isManageMode) {
            cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = song.id;
            cb.checked = songs.some(s => s.songId === song.id);
            cb.id = `library-song-${song.id}`;
        }

        const titleElement = document.createElement(cb ? 'label' : 'span');
        titleElement.textContent = title;
        if (cb) {
            titleElement.htmlFor = cb.id;
            item.appendChild(cb);
        }
        item.appendChild(titleElement);

        if (isManageMode) {
            const delBtn = document.createElement('button');
            delBtn.className = 'lib-delete-btn';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete from library';
            delBtn.addEventListener('click', async () => {
                if (!confirm(`Delete "${title}" from library?`)) return;
                await deleteSong(song.id);
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
            item.appendChild(delBtn);
        }

        librarySongList.appendChild(item);
    });

    libraryModal.classList.remove('hidden');
}

libraryAddSelected.addEventListener('click', onLibraryDoneClick);

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
    const libraryId = await ensureCurrentLibraryContext();
    const setlists = await getAllSetlists(libraryId);
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
    if (setlist.libraryId !== currentLibraryId) return;

    songs = [];
    for (const songId of setlist.songIds) {
        const songRecord = await getSong(songId);
        if (!songRecord || songRecord.libraryId !== currentLibraryId) continue;
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
    const libraryId = await ensureCurrentLibraryContext();
    const setlist = {
        name,
        songIds: songs.map(s => s.songId),
        currentIndex,
        libraryId,
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

    const libraryId = await ensureCurrentLibraryContext();
    let preferredName = '';
    if (currentSetlistId) {
        const existingSetlist = await getSetlist(currentSetlistId);
        preferredName = existingSetlist && existingSetlist.name ? String(existingSetlist.name).trim() : '';
    }
    if (!preferredName) {
        const inputName = prompt('Enter a set name for sharing:', 'Shared Set');
        if (inputName === null) return null;
        preferredName = String(inputName).trim();
        if (!preferredName) {
            alert('Set name is required for sharing.');
            return null;
        }
    }

    const songIds = songs.map(s => s.songId);
    const tempSetlist = {
        name: preferredName,
        songIds,
        currentIndex,
        libraryId,
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
