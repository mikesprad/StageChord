const { parseChordPro } = require('../parser.js');

describe('parseChordPro', () => {
  it('returns empty array for empty string', () => {
    const result = parseChordPro('');
    expect(result.lines).toEqual([[]]);
    expect(result.metadata).toEqual({});
  });

  it('parses line with no chords', () => {
    const result = parseChordPro('Hello world');
    expect(result.lines).toEqual([[{ type: 'text', value: 'Hello world' }]]);
    expect(result.metadata).toEqual({});
  });

  it('parses single chord', () => {
    const result = parseChordPro('[C]Hello');
    expect(result.lines).toEqual([
      [
        { type: 'chord', value: 'C' },
        { type: 'text', value: 'Hello' }
      ]
    ]);
    expect(result.metadata).toEqual({});
  });

  it('parses chords embedded', () => {
    const result = parseChordPro('I [G]see the [D]light');
    expect(result.lines).toEqual([
      [
        { type: 'text', value: 'I ' },
        { type: 'chord', value: 'G' },
        { type: 'text', value: 'see the ' },
        { type: 'chord', value: 'D' },
        { type: 'text', value: 'light' }
      ]
    ]);
    expect(result.metadata).toEqual({});
  });

  it('handles adjacent chords', () => {
    const result = parseChordPro('[C][G]Hello');
    expect(result.lines).toEqual([
      [
        { type: 'chord', value: 'C' },
        { type: 'chord', value: 'G' },
        { type: 'text', value: 'Hello' }
      ]
    ]);
    expect(result.metadata).toEqual({});
  });

  it('parses metadata', () => {
    const result = parseChordPro('{title: My Song}\n{key: C}\n[C]Hello');
    expect(result.metadata).toEqual({ title: 'My Song', key: 'C' });
    expect(result.lines).toEqual([
      [
        { type: 'chord', value: 'C' },
        { type: 'text', value: 'Hello' }
      ]
    ]);
  });
});

const { readHeader, writeHeader, classifyLines } = require('../parser.js');

describe('header metadata', () => {
  const song = '{title: Do It Again}\r\n{key: G}\r\n{flow: Intro V1 Ch}\r\n\r\nV1:\r\n[G]Hello';

  it('hides every header line, closed or not', () => {
    const text = '{title: A}\n{flow: Intro V1\n\n[G]Hello';
    const parsed = parseChordPro(text);
    expect(parsed.metadata.title).toBe('A');
    expect(parsed.lines.map((l) => l.map((t) => t.value).join(''))).toEqual(['', 'GHello']);
  });

  it('reads a directive spread over several lines', () => {
    const text = '{title: A}\n{flow: Intro\nV1 Ch\nV2 Ch}\n\nV1:\n[G]Hi';
    const parsed = parseChordPro(text);
    expect(parsed.metadata.flow).toBe('Intro V1 Ch V2 Ch');
    expect(parsed.lines.length).toBe(3);
  });

  it('does not let an unclosed { swallow lyrics', () => {
    const parsed = parseChordPro('{flow: Intro V1\nIntro:\n| [C] /// |');
    expect(parsed.lines.length).toBe(2);
  });

  it('keeps lyrics aligned past directives without a colon', () => {
    const info = classifyLines('{title: A}\nV1:\n{soc}\n[G]Hi');
    expect(info.kinds).toEqual(['header', 'content', 'directive', 'content']);
    expect(parseChordPro('{title: A}\nV1:\n{soc}\n[G]Hi').lines.length).toBe(2);
  });

  it('handles spaced and empty keys', () => {
    const h = readHeader('{Flow : V1}\n{flow:}\n{soc}\nx');
    expect(h.entries.map((e) => [e.key, e.value, e.hasColon])).toEqual([
      ['Flow', 'V1', true], ['flow', '', true], ['soc', '', false]
    ]);
  });

  it('writes back unchanged text exactly', () => {
    const h = readHeader(song);
    expect(writeHeader(song, h.entries)).toBe(song);
  });

  it('edits, adds and removes entries, keeping body and line endings', () => {
    const h = readHeader(song);
    h.entries[0].value = 'Renamed';
    const entries = h.entries.filter((e) => e.key !== 'flow');
    entries.push({ key: 'artist', value: 'Someone' });
    expect(writeHeader(song, entries)).toBe('{title: Renamed}\r\n{key: G}\r\n{artist: Someone}\r\n\r\nV1:\r\n[G]Hello');
  });

  it('normalises an edited multi-line directive onto one line', () => {
    const text = '{flow: Intro\nV1}\nV1:\nHi';
    const h = readHeader(text);
    h.entries[0].value = 'Intro V1 Ch';
    expect(writeHeader(text, h.entries)).toBe('{flow: Intro V1 Ch}\nV1:\nHi');
  });

  it('strips braces and line breaks from typed values', () => {
    expect(writeHeader('x', [{ key: 'my key', value: 'a}\nb{' }])).toBe('{my_key: a b}\nx');
  });
});

describe('tempoBpm', () => {
  const { tempoBpm } = require('../parser.js');
  it('takes the number and ignores BPM in any case', () => {
    expect(tempoBpm('68')).toBe(68);
    expect(tempoBpm('68 BPM')).toBe(68);
    expect(tempoBpm('68bpm')).toBe(68);
    expect(tempoBpm('Bpm: 72')).toBe(72);
    expect(tempoBpm(' 120 ')).toBe(120);
  });
  it('gives NaN when there is no number', () => {
    expect(tempoBpm('fast')).toBeNaN();
    expect(tempoBpm('')).toBeNaN();
    expect(tempoBpm(undefined)).toBeNaN();
  });
});
