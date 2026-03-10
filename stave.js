// Stave editor module — uses VexFlow 4 loaded from CDN
const VexPromise = import('https://esm.sh/vexflow@4.2.5').then(m => m.default || m);

const NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ACCIDENTALS = [
    { key: '#', label: '♯', title: 'Sharp' },
    { key: 'b', label: '♭', title: 'Flat' },
    { key: 'n', label: '♮', title: 'Natural' },
];

// Major scale intervals in semitones from root
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

// Build major scale note names starting from a given key
function getMajorScaleNotes(keyName) {
    if (!keyName) return NOTE_NAMES.map(n => ({ name: n, accidental: '' }));
    const rootMatch = keyName.match(/^([A-G])([#b]?)$/);
    if (!rootMatch) return NOTE_NAMES.map(n => ({ name: n, accidental: '' }));
    const rootLetter = rootMatch[1];
    const rootAcc = rootMatch[2];
    const useFlats = rootAcc === 'b' || ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'].includes(keyName);
    const table = useFlats ? CHROMATIC_FLAT : CHROMATIC;
    const rootIndex = table.indexOf(keyName) !== -1 ? table.indexOf(keyName) : CHROMATIC.indexOf(rootLetter);
    return MAJOR_SCALE_INTERVALS.map(interval => {
        const idx = (rootIndex + interval) % 12;
        const fullName = table[idx];
        const letter = fullName.charAt(0);
        const acc = fullName.length > 1 ? fullName.charAt(1) : '';
        return { name: letter, accidental: acc, label: fullName };
    });
}
const NOTE_SVG = {
    // Semibreve (whole note): open oval, no stem
    w: `<svg width="12" height="20" viewBox="0 0 16 28"><ellipse cx="8" cy="14" rx="6" ry="4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
    // Minim (half note): open oval with stem
    h: `<svg width="10" height="20" viewBox="0 0 14 28"><ellipse cx="7" cy="22" rx="5" ry="3.5" fill="none" stroke="currentColor" stroke-width="1.2" transform="rotate(-20,7,22)"/><line x1="12" y1="22" x2="12" y2="2" stroke="currentColor" stroke-width="1.2"/></svg>`,
    // Crotchet (quarter note): filled oval with stem
    q: `<svg width="10" height="20" viewBox="0 0 14 28"><ellipse cx="7" cy="22" rx="5" ry="3.5" fill="currentColor" transform="rotate(-20,7,22)"/><line x1="12" y1="22" x2="12" y2="2" stroke="currentColor" stroke-width="1.2"/></svg>`,
    // Quaver (eighth note): filled oval, stem, one flag
    '8': `<svg width="12" height="20" viewBox="0 0 18 28"><ellipse cx="7" cy="22" rx="5" ry="3.5" fill="currentColor" transform="rotate(-20,7,22)"/><line x1="12" y1="22" x2="12" y2="2" stroke="currentColor" stroke-width="1.2"/><path d="M12,2 Q16,4 16.5,10 Q15,7 12,8.5" fill="currentColor"/></svg>`,
    // Semiquaver (sixteenth note): filled oval, stem, two flags
    '16': `<svg width="12" height="20" viewBox="0 0 18 28"><ellipse cx="7" cy="22" rx="5" ry="3.5" fill="currentColor" transform="rotate(-20,7,22)"/><line x1="12" y1="22" x2="12" y2="2" stroke="currentColor" stroke-width="1.2"/><path d="M12,2 Q16,4 16.5,10 Q15,7 12,8.5" fill="currentColor"/><path d="M12,7.5 Q16,9.5 16.5,15.5 Q15,12.5 12,14" fill="currentColor"/></svg>`,
    // Quarter rest: from Wikimedia Commons (CC), path by Marmelad/Vinne2
    rest: `<svg width="8" height="20" viewBox="13 5 12 30"><g fill="#000" fill-rule="evenodd" transform="matrix(1.8,0,0,1.8,-901.748,-121.074)"><path d="m512.254,71.019c-0.137,0.058-0.219,0.258-0.156,0.398 0.019,0.02 0.218,0.258 0.418,0.52 0.457,0.515 0.535,0.637 0.636,0.875 0.399,0.816 0.18,1.855-0.519,2.512-0.059,0.078-0.317,0.296-0.559,0.476-0.695,0.598-1.015,0.938-1.133,1.238-0.043,0.079-0.043,0.157-0.043,0.278-0.019,0.277 0,0.301 0.821,1.254 1.113,1.336 1.91,2.273 1.972,2.332l0.059,0.058-0.078-0.039c-1.098-0.457-2.332-0.676-2.75-0.476-0.141,0.058-0.223,0.14-0.281,0.277-0.161,0.34-0.118,0.84 0.121,1.574 0.218,0.66 0.656,1.535 1.093,2.192 0.18,0.281 0.52,0.718 0.559,0.738 0.059,0.059 0.141,0.039 0.199,0 0.059-0.078 0.059-0.141-0.058-0.277-0.418-0.598-0.617-1.836-0.379-2.493 0.097-0.296 0.219-0.457 0.437-0.558 0.578-0.258 1.856,0.062 2.391,0.597 0.039,0.04 0.121,0.122 0.16,0.141 0.141,0.059 0.34-0.019 0.399-0.16 0.082-0.141 0.039-0.238-0.141-0.457-0.336-0.399-1.352-1.594-1.492-1.774-0.36-0.418-0.52-0.816-0.559-1.316-0.019-0.637 0.238-1.312 0.719-1.754 0.058-0.078 0.316-0.297 0.555-0.476 0.738-0.618 1.039-0.957 1.156-1.278 0.082-0.258 0.043-0.496-0.137-0.715-0.062-0.058-0.758-0.918-1.574-1.894-1.117-1.313-1.516-1.793-1.574-1.813-0.082-0.019-0.18-0.019-0.262,0.02z"/></g></svg>`,
};

const DURATIONS = [
    { key: 'w', title: 'Semibreve (whole)' },
    { key: 'h', title: 'Minim (half)' },
    { key: 'q', title: 'Crotchet (quarter)' },
    { key: '8', title: 'Quaver (eighth)' },
    { key: '16', title: 'Semiquaver (sixteenth)' },
];

const TIME_SIGS = [
    { key: '4/4', beats: 4, beatValue: 4 },
    { key: '6/8', beats: 6, beatValue: 8 },
];

const KEY_SIG_MAP = {
    'C': 'C', 'G': 'G', 'D': 'D', 'A': 'A', 'E': 'E', 'B': 'B',
    'F#': 'F#', 'C#': 'C#',
    'F': 'F', 'Bb': 'Bb', 'Eb': 'Eb', 'Ab': 'Ab', 'Db': 'Db', 'Gb': 'Gb', 'Cb': 'Cb'
};

// Returns a map of letter → accidental for notes implied by a key signature.
// e.g. 'D' → { F: '#', C: '#' }, 'Bb' → { B: 'b', E: 'b' }
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const SHARP_KEY_COUNT = { 'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7 };
const FLAT_KEY_COUNT = { 'F': 1, 'Bb': 2, 'Eb': 3, 'Ab': 4, 'Db': 5, 'Gb': 6, 'Cb': 7 };

function getKeySignatureAccidentals(keyName) {
    if (!keyName) return {};
    if (keyName in SHARP_KEY_COUNT) {
        const count = SHARP_KEY_COUNT[keyName];
        const acc = {};
        for (let i = 0; i < count; i++) acc[SHARP_ORDER[i]] = '#';
        return acc;
    }
    if (keyName in FLAT_KEY_COUNT) {
        const count = FLAT_KEY_COUNT[keyName];
        const acc = {};
        for (let i = 0; i < count; i++) acc[FLAT_ORDER[i]] = 'b';
        return acc;
    }
    return {};
}

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHROMATIC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

let Vex = null;

async function ensureVex() {
    if (!Vex) Vex = await VexPromise;
    return Vex;
}

function pitchToChromatic(pitchStr) {
    const match = pitchStr.match(/^([A-Ga-g][#b]?)\/(\d)$/);
    if (!match) return null;
    let name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    const octave = parseInt(match[2]);
    let idx = CHROMATIC.indexOf(name);
    if (idx === -1) idx = CHROMATIC_FLAT.indexOf(name);
    if (idx === -1) return null;
    return { index: idx, octave };
}

function chromaticToPitch(index, octave, targetKeyName) {
    const useFlats = targetKeyName && (targetKeyName in FLAT_KEY_COUNT ||
        ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'].includes(targetKeyName));
    const table = useFlats ? CHROMATIC_FLAT : CHROMATIC;
    return `${table[index]}/${octave}`;
}

export function transposeStaveNotes(noteData, semitones, targetKeyName) {
    if (!noteData || semitones === 0) return noteData;
    return noteData.map(n => {
        if (n.rest || n.barline) return { ...n };
        const parsed = pitchToChromatic(n.pitch);
        if (!parsed) return { ...n };
        let newIndex = (parsed.index + semitones + 12) % 12;
        let newOctave = parsed.octave;
        const rawIndex = parsed.index + semitones;
        if (rawIndex >= 12) newOctave += Math.floor(rawIndex / 12);
        else if (rawIndex < 0) newOctave += Math.floor(rawIndex / 12);
        return { ...n, pitch: chromaticToPitch(newIndex, newOctave, targetKeyName) };
    });
}

function buildVfNotes(noteData, StaveNote, Accidental, Dot, BarNote, keyName) {
    const keySigAcc = getKeySignatureAccidentals(keyName);
    return noteData.map(n => {
        if (n.barline) {
            return new BarNote();
        }
        const dur = n.dotted ? n.duration + 'd' : n.duration;
        if (n.rest) {
            const restNote = new StaveNote({ keys: ['b/4'], duration: dur + 'r' });
            if (n.dotted) Dot.buildAndAttach([restNote]);
            return restNote;
        }
        const vfNote = new StaveNote({ keys: [n.pitch], duration: dur });
        if (n.dotted) Dot.buildAndAttach([vfNote]);
        const noteName = n.pitch.split('/')[0];
        const letter = noteName.charAt(0).toUpperCase();
        const noteAcc = noteName.length > 1 ? noteName.slice(1) : '';
        const keySigForLetter = keySigAcc[letter] || '';

        if (noteAcc === keySigForLetter) {
            // Accidental matches key signature — show natural if explicitly requested
            if (n.natural) vfNote.addModifier(new Accidental('n'));
        } else if (noteAcc) {
            // Note has an accidental not in the key sig — show it
            vfNote.addModifier(new Accidental(noteAcc));
        } else if (keySigForLetter) {
            // Note is natural but key sig says it should be sharp/flat — show natural
            vfNote.addModifier(new Accidental('n'));
        }
        return vfNote;
    });
}

/**
 * Render a read-only stave into the given container element.
 * noteData: array of { pitch: 'C/4', duration: 'q', rest: false }
 */
export async function renderStave(container, noteData, keyName, timeSig) {
    const isEmpty = !noteData || noteData.length === 0;
    const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Accidental, Dot, StaveTie, BarNote } = await ensureVex();

    container.innerHTML = '';
    const noteCount = isEmpty ? 0 : noteData.filter(n => !n.barline).length;
    const barCount = isEmpty ? 0 : noteData.filter(n => n.barline).length;
    // Account for key signature width (each accidental ~10px)
    const keySigCount = keyName ? (SHARP_KEY_COUNT[keyName] || FLAT_KEY_COUNT[keyName] || 0) : 0;
    const keySigWidth = keySigCount * 10;
    // Use tighter spacing when many notes, wider when few
    const noteSpacing = noteCount > 12 ? 35 : 50;
    const width = Math.max(320, noteCount * noteSpacing + barCount * 20 + 120 + keySigWidth);
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(width, 130);
    const context = renderer.getContext();

    const stave = new Stave(10, 15, width - 20);
    stave.addClef('treble');
    if (keyName && KEY_SIG_MAP[keyName]) {
        stave.addKeySignature(KEY_SIG_MAP[keyName]);
    }
    if (timeSig) stave.addTimeSignature(timeSig);
    stave.setContext(context).draw();

    if (isEmpty) return;

    // If any note falls below A3, shift all notes up an octave
    let renderNotes = noteData;
    const belowThreshold = noteData.some(n => {
        if (n.rest || n.barline) return false;
        const parsed = pitchToChromatic(n.pitch);
        if (!parsed) return false;
        return parsed.octave < 3 || (parsed.octave === 3 && parsed.index < 9);
    });
    if (belowThreshold) {
        renderNotes = noteData.map(n => {
            if (n.rest || n.barline) return n;
            const parsed = pitchToChromatic(n.pitch);
            if (!parsed) return n;
            return { ...n, pitch: chromaticToPitch(parsed.index, parsed.octave + 1, keyName) };
        });
    }

    const vfNotes = buildVfNotes(renderNotes, StaveNote, Accidental, Dot, BarNote, keyName);

    // Auto-beam — filter out barlines for beam generation
    const beamableNotes = vfNotes.filter((_, i) => !renderNotes[i].barline);
    const tsInfo = TIME_SIGS.find(t => t.key === timeSig);
    const beamGroups = Beam.generateBeams(beamableNotes, {
        groups: tsInfo && tsInfo.key === '6/8'
            ? [new Vex.Fraction(3, 8)]
            : undefined
    });

    const voice = new Voice({ num_beats: noteData.length, beat_value: 1 }).setMode(Voice.Mode.SOFT);
    voice.addTickables(vfNotes);
    new Formatter().joinVoices([voice]).format([voice], width - 120 - keySigWidth);
    voice.draw(context, stave);
    beamGroups.forEach(b => b.setContext(context).draw());

    // Draw ties between consecutive non-barline notes with tie flag
    const noteIndices = renderNotes.reduce((acc, n, i) => { if (!n.barline) acc.push(i); return acc; }, []);
    for (let j = 0; j < noteIndices.length - 1; j++) {
        const i = noteIndices[j];
        const next = noteIndices[j + 1];
        if (renderNotes[i].tie && !renderNotes[i].rest && !renderNotes[next].rest) {
            const tie = new StaveTie({ first_note: vfNotes[i], last_note: vfNotes[next] });
            tie.setContext(context).draw();
        }
    }
}

/**
 * Open the stave editor UI.
 * Returns a promise that resolves with noteData array on save, or null on cancel.
 */
export async function openStaveEditor(existingNoteData, options) {
    const keyName = options?.keyName || null;
    const existingTimeSig = options?.timeSig || '4/4';

    // Pre-load VexFlow so the preview renders immediately
    await ensureVex();

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'stave-editor-overlay';

        const panel = document.createElement('div');
        panel.className = 'stave-editor-panel';

        // Preview area
        const preview = document.createElement('div');
        preview.className = 'stave-preview';
        panel.appendChild(preview);

        // Deep copy so cancel can revert
        const originalNotes = existingNoteData ? JSON.parse(JSON.stringify(existingNoteData)) : null;
        let notes = existingNoteData ? JSON.parse(JSON.stringify(existingNoteData)) : [];
        let selectedDuration = 'q';
        let selectedAccidental = '';
        let selectedOctave = 4;
        let selectedTimeSig = existingTimeSig;

        function refreshPreview() {
            renderStave(preview, notes.length > 0 ? notes : null, keyName, selectedTimeSig).then(() => {
                preview.scrollLeft = preview.scrollWidth;
            });
        }

        // Time signature buttons
        const tsRow = document.createElement('div');
        tsRow.className = 'stave-btn-row';

        const tsButtons = {};
        TIME_SIGS.forEach(ts => {
            const btn = document.createElement('button');
            btn.textContent = ts.key;
            btn.className = 'stave-btn' + (ts.key === selectedTimeSig ? ' active' : '');
            btn.addEventListener('click', () => {
                selectedTimeSig = ts.key;
                Object.values(tsButtons).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                refreshPreview();
            });
            tsButtons[ts.key] = btn;
            tsRow.appendChild(btn);
        });
        panel.appendChild(tsRow);

        // Duration buttons
        const durRow = document.createElement('div');
        durRow.className = 'stave-btn-row';

        const durButtons = {};
        DURATIONS.forEach(d => {
            const btn = document.createElement('button');
            btn.innerHTML = NOTE_SVG[d.key];
            btn.title = d.title;
            btn.className = 'stave-btn' + (d.key === selectedDuration ? ' active' : '');
            btn.addEventListener('click', () => {
                selectedDuration = d.key;
                Object.values(durButtons).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            durButtons[d.key] = btn;
            durRow.appendChild(btn);
        });

        let dottedOn = false;
        const dotBtn = document.createElement('button');
        dotBtn.textContent = '·';
        dotBtn.title = 'Dotted note (1.5× duration)';
        dotBtn.className = 'stave-btn';
        dotBtn.addEventListener('click', () => {
            dottedOn = !dottedOn;
            dotBtn.classList.toggle('active', dottedOn);
        });
        durRow.appendChild(dotBtn);

        const tieBtn = document.createElement('button');
        tieBtn.textContent = '⌣';
        tieBtn.title = 'Tie to next note';
        tieBtn.className = 'stave-btn';
        tieBtn.addEventListener('click', () => {
            if (notes.length > 0 && !notes[notes.length - 1].rest) {
                notes[notes.length - 1].tie = !notes[notes.length - 1].tie;
                refreshPreview();
            }
        });
        durRow.appendChild(tieBtn);

        panel.appendChild(durRow);

        // Accidental buttons
        const accRow = document.createElement('div');
        accRow.className = 'stave-btn-row';

        const accButtons = {};
        ACCIDENTALS.forEach(a => {
            const btn = document.createElement('button');
            btn.textContent = a.label;
            btn.title = a.title;
            btn.className = 'stave-btn';
            btn.addEventListener('click', () => {
                if (selectedAccidental === a.key) {
                    selectedAccidental = '';
                    btn.classList.remove('active');
                } else {
                    selectedAccidental = a.key;
                    Object.values(accButtons).forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            });
            accButtons[a.key] = btn;
            accRow.appendChild(btn);
        });
        panel.appendChild(accRow);

        // Octave buttons on accidental row after a spacer
        const octSpacer = document.createElement('span');
        octSpacer.style.width = '12px';
        octSpacer.style.display = 'inline-block';
        accRow.appendChild(octSpacer);

        const octDown = document.createElement('button');
        octDown.textContent = '8vb';
        octDown.title = 'Octave down';
        octDown.className = 'stave-btn';
        octDown.addEventListener('click', () => {
            if (selectedOctave > 3) selectedOctave--;
        });
        accRow.appendChild(octDown);

        const octUp = document.createElement('button');
        octUp.textContent = '8va';
        octUp.title = 'Octave up';
        octUp.className = 'stave-btn';
        octUp.addEventListener('click', () => {
            if (selectedOctave < 6) selectedOctave++;
        });
        accRow.appendChild(octUp);

        // Barline button after octave buttons with spacer
        const barSpacer = document.createElement('span');
        barSpacer.style.width = '12px';
        barSpacer.style.display = 'inline-block';
        accRow.appendChild(barSpacer);

        const barBtn = document.createElement('button');
        barBtn.textContent = '|';
        barBtn.title = 'Barline';
        barBtn.className = 'stave-btn note-btn';
        barBtn.addEventListener('click', () => {
            notes.push({ barline: true });
            refreshPreview();
        });
        accRow.appendChild(barBtn);

        // Note name buttons — scale-aware based on key
        const noteRow = document.createElement('div');
        noteRow.className = 'stave-btn-row';

        const scaleNotes = getMajorScaleNotes(keyName);
        scaleNotes.forEach(({ name, accidental, label }) => {
            const btn = document.createElement('button');
            btn.textContent = label || name;
            btn.className = 'stave-btn note-btn';
            btn.addEventListener('click', () => {
                let pitchName;
                if (selectedAccidental === 'n') {
                    // Natural: use just the letter, no accidental
                    pitchName = name;
                } else if (selectedAccidental) {
                    // Explicit sharp/flat selected
                    pitchName = name + selectedAccidental;
                } else {
                    // Default: use the scale note's accidental
                    pitchName = name + accidental;
                }
                const forceNatural = selectedAccidental === 'n';
                notes.push({ pitch: `${pitchName}/${selectedOctave}`, duration: selectedDuration, rest: false, dotted: dottedOn, natural: forceNatural || undefined });
                // Auto-deselect accidental after inserting a note
                selectedAccidental = '';
                Object.values(accButtons).forEach(b => b.classList.remove('active'));
                refreshPreview();
            });
            noteRow.appendChild(btn);
        });

        // Rest button at end of note row
        const restBtn = document.createElement('button');
        restBtn.innerHTML = NOTE_SVG.rest;
        restBtn.title = 'Rest';
        restBtn.className = 'stave-btn note-btn';
        restBtn.addEventListener('click', () => {
            notes.push({ pitch: 'b/4', duration: selectedDuration, rest: true, dotted: dottedOn });
            refreshPreview();
        });
        noteRow.appendChild(restBtn);

        panel.appendChild(noteRow);

        // Delete / Clear / Save / Cancel row
        const actionRow = document.createElement('div');
        actionRow.className = 'stave-btn-row stave-actions';

        const delBtn = document.createElement('button');
        delBtn.textContent = '← Del';
        delBtn.className = 'stave-btn';
        delBtn.addEventListener('click', () => {
            if (notes.length > 0) {
                notes.pop();
                refreshPreview();
            }
        });
        actionRow.appendChild(delBtn);

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.className = 'stave-btn';
        clearBtn.addEventListener('click', () => {
            notes = [];
            refreshPreview();
        });
        actionRow.appendChild(clearBtn);

        const actionSpacer = document.createElement('span');
        actionSpacer.style.flex = '1';
        actionRow.appendChild(actionSpacer);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.className = 'stave-btn save-btn';
        saveBtn.addEventListener('click', () => {
            overlay.remove();
            resolve({ notes: notes.length > 0 ? notes : null, timeSig: selectedTimeSig });
        });
        actionRow.appendChild(saveBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'stave-btn cancel-btn';
        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve({ notes: originalNotes, timeSig: existingTimeSig });
        });
        actionRow.appendChild(cancelBtn);

        panel.appendChild(actionRow);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        refreshPreview();
    });
}
