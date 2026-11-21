// The converter's core (chordpro-converter.html, between the CORE markers):
// song info from the header, footers removed, and never a made-up key.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'chordpro-converter.html'), 'utf8');
const core = html.slice(html.indexOf('// ===== CORE START'), html.indexOf('// ===== CORE END'));
// eslint-disable-next-line no-new-func
const { convert, buildChordPro, titleCase } = new Function(core + '; return { convert, buildChordPro, titleCase };')();

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
