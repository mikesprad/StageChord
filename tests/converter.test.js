// The converter's core (chordpro-converter.html, between the CORE markers):
// song info from the header, footers removed, and never a made-up key.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'chordpro-converter.html'), 'utf8');
const core = html.slice(html.indexOf('// ===== CORE START'), html.indexOf('// ===== CORE END'));
// eslint-disable-next-line no-new-func
const { convert, buildChordPro, titleCase, pdfToText } = new Function(core + '; return { convert, buildChordPro, titleCase, pdfToText };')();

function chordPro(text, numbersKey) {
  const conv = convert(text, { numbersKey: numbersKey || 'C' });
  return { conv, out: buildChordPro(conv, titleCase(conv.meta.title || 'Untitled'), conv.meta.artist) };
}

// Made-up song laid out like a church chart PDF: writers, title, then key/BPM/time on one line.
const CHART = [
  'Writers: Ann Example, Bob Sample',
  'HARBOUR LIGHTS',
  '',
  'Key: Ab BPM: 75 Time: 4/4',
  'Verse 1:',
  '     Ab',
  'Ropes on the bollard',
  '    Db',
  'Salt on the wind',
  'Somebody singing',
  '',
  'CCLI #1234567',
  '',
  '© 2025 Example Music Publishing,',
  'Sample Songs Ltd. All rights reserved. Used by permission.',
  '',
  '--- Page 2 ---',
  'Writers: Ann Example, Bob Sample',
  'HARBOUR LIGHTS',
  'Key: Ab BPM: 75 Time: 4/4',
  'Verse 1:',
  '     1',
  'Ropes on the bollard',
  '    4',
  'Salt on the wind',
  'Somebody singing',
  '© 2025 Example Music Publishing,',
  'Sample Songs Ltd. All rights reserved. Used by permission.'
].join('\n');

describe('converter: song info and footers', () => {
  const { conv, out } = chordPro(CHART);

  it('reads title, writers, key, tempo and time from the top of the sheet', () => {
    expect(out).toMatch(/^\{title: Harbour Lights\}$/m);
    expect(out).toMatch(/^\{composer: Ann Example, Bob Sample\}$/m);
    expect(out).toMatch(/^\{key: Ab\}$/m);
    expect(out).toMatch(/^\{tempo: 75\}$/m);
    expect(out).toMatch(/^\{time: 4\/4\}$/m);
  });

  it('moves CCLI and copyright into song info and keeps them out of the lyrics', () => {
    expect(out).toMatch(/^\{meta: ccli 1234567\}$/m);
    expect(conv.meta.copyright).toBe('© 2025 Example Music Publishing, Sample Songs Ltd. All rights reserved. Used by permission.');
    const body = conv.body.join('\n');
    expect(body).not.toMatch(/CCLI|©|rights reserved|Writers|HARBOUR LIGHTS|Page 2/);
  });

  it('keeps a repeated page and flags it', () => {
    expect(conv.repeatPages).toEqual([2]);
    expect(conv.body.filter((l) => l === 'Verse 1:').length).toBe(2);
  });

  it('converts a number page in the sheet\'s key, not C', () => {
    expect(conv.body.filter((l) => l === 'Ropes [Ab]on the bollard').length).toBe(2);
    expect(conv.body.filter((l) => l === 'Salt [Db]on the wind').length).toBe(2);
  });
});

describe('converter: key', () => {
  it('writes no key when the sheet has none', () => {
    const { out } = chordPro('Verse 1:\nG        C\nRopes on the bollard\nD     G\nSalt on the wind');
    expect(out).not.toMatch(/\{key:/);
  });

  it('uses C for a number chart with no key on the sheet', () => {
    const { out } = chordPro('Verse 1:\n1        4\nRopes on the bollard\n5     1\nSalt on the wind');
    expect(out).toMatch(/^\{key: C\}$/m);
    expect(out).toContain('[C]Ropes on [F]the bollard');
  });

  it('reads "Key - Ab | Tempo - 75 | Time - 4/4"', () => {
    const { conv } = chordPro('Key - Ab | Tempo - 75 | Time - 4/4\n\nVerse 1:\nAb\nRopes on the bollard');
    expect(conv.meta).toMatchObject({ key: 'Ab', tempo: '75', time: '4/4' });
  });
});

describe('converter: title', () => {
  it('does not take the first lyric as the title when the sheet starts with lyrics', () => {
    const { conv } = chordPro('Ropes on the bollard\nSalt on the wind\nG        C\nSomebody singing');
    expect(conv.meta.title).toBe('');
  });
});

describe('converter: repeat marks', () => {
  it('keeps |: and :| where they were', () => {
    // A number chart (two number lines) in E
    const { conv } = chordPro('Key: E\nRiff:\n||: 1 1 1 1 :||\nVerse:\n1      4\nRopes on the bollard');
    expect(conv.body).toContain('||: [E] [E] [E] [E] :||');
  });

  it('keeps repeat marks touching chords, and a repeat count after', () => {
    const { conv } = chordPro('Intro:\n|:Em C | G D:| x2');
    expect(conv.body).toContain('|: [Em] [C] | [G] [D] :| x2');
  });

  it('leaves ordinary bar lines as before', () => {
    const { conv } = chordPro('Intro:\nEm   C   G   D  x2');
    expect(conv.body).toContain('| [Em] [C] [G] [D] | x2');
  });
});

describe('converter: key box', () => {
  const NUMBERS = 'Key: Ab\nVerse:\n1        4\nRopes on the bollard\n5     1\nSalt on the wind';

  it('a key typed in the box wins, and number charts use it', () => {
    const conv = convert(NUMBERS, { key: 'G' });
    const out = buildChordPro(conv, 'T', '');
    expect(out).toMatch(/^\{key: G\}$/m);
    expect(out).toContain('[G]Ropes on [C]the bollard');
  });

  it('an emptied key box means no key', () => {
    const conv = convert('Key: Ab\nVerse:\nAb\nRopes on the bollard', { key: '' });
    expect(buildChordPro(conv, 'T', '')).not.toMatch(/\{key:/);
  });
});

describe('converter: title from the first line', () => {
  it('takes a title line followed straight by chords', () => {
    const { conv } = chordPro('Harbour Lights\nEm              C\nHarbour lights on the water tonight\nG          D\nHarbour lights on the water');
    expect(conv.meta.title).toBe('Harbour Lights');
    expect(conv.body.join('\n')).not.toMatch(/^Harbour Lights$/m);
  });
});

describe('converter: keys are always major', () => {
  it('a minor key on the sheet becomes its relative major', () => {
    expect(chordPro('Key: Am\n\nVerse:\nAm\nRopes on the bollard').conv.meta.key).toBe('C');
    expect(chordPro('Key: F#m\n\nVerse:\nF#m\nRopes on the bollard').conv.meta.key).toBe('A');
    expect(chordPro('Key: Bbm\n\nVerse:\nBbm\nRopes on the bollard').conv.meta.key).toBe('Db');
  });

  it('a minor key typed in the box becomes its relative major', () => {
    const conv = convert('Verse:\nAm\nRopes on the bollard', { key: 'Em' });
    expect(buildChordPro(conv, 'T', '')).toMatch(/^\{key: G\}$/m);
  });
});

describe('converter: PDF layout', () => {
  // Large print: chords 24pt above their lyric (20pt text), lyric split where the chord lands.
  const page = {
    width: 595,
    items: [
      { str: 'Am', x: 184.3, y: 309.8, w: 33.8, h: 20 },
      { str: 'G', x: 338.4, y: 309.8, w: 16.3, h: 20 },
      { str: 'Mary, did you', x: 54, y: 285.7, w: 124.5, h: 20 },
      { str: 'know that your b', x: 184.3, y: 285.7, w: 154.1, h: 20 },
      { str: 'aby boy', x: 338.4, y: 285.7, w: 73.6, h: 20 }
    ]
  };

  it('pairs chords with the lyric below in large print, keeping them where the PDF puts them', () => {
    const { conv } = chordPro(pdfToText([page]).text);
    expect(conv.body).toContain('Mary, did you [Am]know that your b[G]aby boy');
  });
});

describe('converter: SongSelect-style header without labels', () => {
  const SHEET = [
    'Harbour Lights',
    'Ann Example | Bob Sample | Cat Writer',
    '(based on the recording by The Example Band | original key: B)',
    'Key - G | Tempo - 139 | Time - 4/4',
    'CHORUS',
    'Em7         D7sus',
    'Ropes on the bollard',
    'TURNAROUND',
    '| G/B C2 . . | D Em7 . . |'
  ].join('\n');
  const { conv } = chordPro(SHEET);

  it('reads title, writers given as "Name | Name" and the artist', () => {
    expect(conv.meta).toMatchObject({ title: 'Harbour Lights', composer: 'Ann Example, Bob Sample, Cat Writer', artist: 'The Example Band', key: 'G' });
    expect(conv.body.join('\n')).not.toMatch(/Ann Example|based on/);
  });

  it('recognises chords like D7sus and keeps bar lines and beat dots', () => {
    expect(conv.body).toContain('[Em7]Ropes on the [D7sus]bollard');
    expect(conv.body).toContain('| [G/B] [C2] . . | [D] [Em7] . . |');
  });
});

describe('converter: split words', () => {
  it('leaves words split into syllables as written', () => {
    const chords = ' '.repeat(11) + 'G' + ' '.repeat(14) + 'C';   // over "har" and "lone"
    const { conv } = chordPro('CCLI Song # 1234567\nVerse:\n' + chords + '\nAll to the har - bour a - lone');
    expect(conv.body).toContain('All to the [G]har - bour a - [C]lone');
  });
});

describe('converter: wrapped bar lines', () => {
  it('puts a bar line wrapped onto the next line back on one line', () => {
    const { conv } = chordPro('Instrumental:\n||: G/B C2 . . | D Em7 . . |\nD Em7 . . |\n| G/B C2 . . | Am7 |\nD7sus :||');
    expect(conv.body).toEqual([
      'Instrumental:',
      '||: [G/B] [C2] . . | [D] [Em7] . . | [D] [Em7] . . |',
      '| [G/B] [C2] . . | [Am7] | [D7sus] :||'
    ]);
  });

  it('starts a wrapped half with a bar when there is no line to join it to', () => {
    const { conv } = chordPro('Instrumental:\nD Em7 . . |');
    expect(conv.body).toContain('| [D] [Em7] . . |');
  });
});

describe('converter: footers', () => {
  it('a footer stored letter by letter is not cut in half as if it were two columns', () => {
    const footer = 'Note: Reproduction of this sheet music requires a licence. Please report all copies.';
    const items = [{ str: 'Ropes on the bollard', x: 50, y: 700, w: 120, h: 10 }];
    for (let k = 0; k < footer.length; k++) items.push({ str: footer[k], x: 50 + k * 5.5, y: 60, w: 5, h: 8 });
    const { text } = pdfToText([{ width: 595, items }]);
    expect(text.split('\n')).toContain(footer);
  });

  it('reads a CCLI number and copyright on the same line', () => {
    const { conv } = chordPro('Verse:\nG\nRopes on the bollard\n\nCCLI #1234567 © 2025 Example Music,\nSample Songs Ltd. All rights reserved.');
    expect(conv.meta.ccli).toBe('1234567');
    expect(conv.meta.copyright).toBe('© 2025 Example Music, Sample Songs Ltd. All rights reserved.');
    expect(conv.body.join('\n')).not.toMatch(/CCLI|©/);
  });
});

describe('converter: PDF ligatures', () => {
  // Unmapped fi/fl/ff glyphs come through as NUL
  const fix = (line) => pdfToText([{ width: 595, items: [{ str: line, x: 50, y: 700, w: 200, h: 10 }] }]).text.trim();
  it('spells ff words with ff', () => {
    expect(fix('o\u0000er su\u0000erings shaking o\u0000')).toBe('offer sufferings shaking off');
  });
  it('reads "…\u0000ed" as fied, also after a syllable split', () => {
    expect(fix('cruci\u0000ed magni - \u0000ed')).toBe('crucified magni - fied');
  });
  it('keeps the fi/fl guesses for other words', () => {
    expect(fix('\u0000re \u0000ame \u0000ll over\u0000ow \u0000ed')).toBe('fire flame fill overflow fled');
  });
});

describe('converter: bracketed passing chords', () => {
  it('writes number and letter chords in brackets as plain chords', () => {
    const { conv } = chordPro('Key - G\nVerse:\n1 4 (5/7)\n3m7 (6m)\n1            (5(4)/7)\nRopes on the bollard\nChorus:\nG    (Em)\nSalt on the wind');
    expect(conv.body).toContain('| [G] [C] [D/F#] |');
    expect(conv.body).toContain('| [Bm7] [Em] |');
    expect(conv.body).toContain('[G]Ropes on the [D(4)/F#]bollard');
    expect(conv.body).toContain('[G]Salt [Em]on the wind');
  });
  it('leaves other bracketed words alone', () => {
    const { conv } = chordPro('Key - G\nVerse:\n1 4\n5 1\nRopes on the bollard (x2)');
    expect(conv.body.join('\n')).toContain('(x2)');
  });
});

describe('converter: header variants', () => {
  it('two-column PDF: a short title stays above the wide writers line', () => {
    const items = [
      { str: 'Harbour Lights', x: 40, y: 794, w: 80, h: 15 },
      { str: 'Ann Example | Bob Sample | Cat Writer | Dan Author | Eve Composer', x: 40, y: 781, w: 300, h: 7 },
      { str: 'Key - E | Tempo - 63 | Time - 4/4', x: 40, y: 760, w: 140, h: 8 }
    ];
    for (let k = 0; k < 10; k++) {
      items.push({ str: 'Left line ' + k, x: 40, y: 720 - k * 14, w: 100, h: 9 });
      items.push({ str: 'Right line ' + k, x: 320, y: 720 - k * 14, w: 100, h: 9 });
    }
    const { text, columns } = pdfToText([{ width: 595, items }]);
    expect(columns).toBe(2);
    expect(text.split('\n').slice(0, 3)).toEqual(['Harbour Lights', 'Ann Example | Bob Sample | Cat Writer | Dan Author | Eve Composer', 'Key - E | Tempo - 63 | Time - 4/4']);
  });
  it('"Original Key: E" and a lone "4/4" in the header', () => {
    const { conv } = chordPro('Original Key: E\nHarbour Lights\n      4/4\n\nVERSE 1\n5\nRopes on the bollard\n1\nSalt on the wind');
    expect(conv.meta).toMatchObject({ title: 'Harbour Lights', key: 'E', time: '4/4' });
    expect(conv.body).toContain('[B]Ropes on the bollard');
    expect(conv.body.join('\n')).not.toMatch(/Original|4\/4/);
  });
  it('a plain key beats the original key', () => {
    const { conv } = chordPro('Original Key: E\nKey - D\nHarbour Lights\n\nVERSE 1\n1\nRopes on the bollard\n5\nSalt on the wind');
    expect(conv.meta.key).toBe('D');
    expect(conv.body).toContain('[D]Ropes on the bollard');
  });
});
