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
