// ChordPro parsing. Kept to plain ES2015 (no optional chaining, no regex
// lookbehind, no named groups) so it parses on old iPads.

// How far an unclosed `{` in the header may run onto following lines looking
// for its `}` before we treat it as an unclosed single-line directive.
var MULTILINE_DIRECTIVE_LIMIT = 12;

function splitLines(text) {
  return String(text == null ? '' : text).split(/\r?\n/);
}

function lineEnding(text) {
  return String(text == null ? '' : text).indexOf('\r\n') >= 0 ? '\r\n' : '\n';
}

// "key: value" (the text inside the braces) -> { key, value, hasColon }.
function parseDirectiveInner(inner) {
  var colon = inner.indexOf(':');
  if (colon < 0) {
    return { key: inner.trim(), value: '', hasColon: false };
  }
  return {
    key: inner.slice(0, colon).trim(),
    value: inner.slice(colon + 1).trim(),
    hasColon: true
  };
}

// Directives written back to back, e.g. "{title: A}{key: G}". A missing final
// `}` is tolerated: the rest of the text is taken as the directive.
function parseDirectiveText(text) {
  var found = [];
  var pos = 0;
  while (pos < text.length && text.charAt(pos) === '{') {
    var close = text.indexOf('}', pos + 1);
    var inner = close < 0 ? text.slice(pos + 1) : text.slice(pos + 1, close);
    found.push(parseDirectiveInner(inner));
    if (close < 0) break;
    pos = close + 1;
    while (pos < text.length && /\s/.test(text.charAt(pos))) pos++;
  }
  return found;
}

// Lines start..end-1 that make up the header directive opening at `start`.
// A `{` with no `}` on its line may continue onto later lines until one holds
// the `}`. We give up (and treat the opening line alone as an unclosed
// directive) at a blank line, a new `{`, a chord line or the limit, so one stray
// `{` can never swallow the song.
function directiveSpan(lines, start) {
  if (lines[start].indexOf('}') >= 0) return start + 1;
  var last = Math.min(lines.length, start + 1 + MULTILINE_DIRECTIVE_LIMIT);
  for (var k = start + 1; k < last; k++) {
    var t = lines[k].trim();
    if (t === '' || t.charAt(0) === '{' || t.indexOf('[') >= 0) break;
    if (t.indexOf('}') >= 0) return k + 1;
  }
  return start + 1;
}

// The metadata block at the top of the file: every line starting with `{`
// (closed or not, single or multi-line), plus blank lines between them, up to
// the first lyric or section line.
// Returns { lines, eol, bodyStart, entries }. Each entry is
// { key, value, hasColon, raw, origKey, origValue }; `raw` holds the entry's
// original lines when it had them to itself, so unchanged entries are written
// back exactly as they were.
export function readHeader(text) {
  var lines = splitLines(text);
  var entries = [];
  var bodyStart = 0;
  var i = 0;
  while (i < lines.length) {
    var t = lines[i].trim();
    if (t === '') {
      var j = i;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && lines[j].trim().charAt(0) === '{') {
        i = j;
        continue;
      }
      break;
    }
    if (t.charAt(0) !== '{') break;

    var end = directiveSpan(lines, i);
    var parts = [];
    for (var p = i; p < end; p++) parts.push(lines[p].trim());
    var found = parseDirectiveText(parts.join(' '));
    var raw = found.length === 1 ? lines.slice(i, end) : null;
    for (var f = 0; f < found.length; f++) {
      var d = found[f];
      if (end - i > 1) d.value = d.value.replace(/\s+/g, ' ');
      entries.push({
        key: d.key,
        value: d.value,
        hasColon: d.hasColon,
        raw: raw,
        origKey: d.key,
        origValue: d.value
      });
    }
    i = end;
    bodyStart = end;
  }
  return { lines: lines, eol: lineEnding(text), bodyStart: bodyStart, entries: entries };
}

function cleanKey(key) {
  return String(key == null ? '' : key).replace(/[{}:]/g, '').trim().replace(/\s+/g, '_');
}

function cleanValue(value) {
  return String(value == null ? '' : value).replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function formatDirective(key, value, hasColon) {
  if (value) return '{' + key + ': ' + value + '}';
  return hasColon ? '{' + key + ':}' : '{' + key + '}';
}

// Replace the header block with `entries` (as returned by readHeader, edited,
// reordered, removed or added to). Unchanged entries keep their original lines;
// changed or new ones are written as single-line `{key: value}`. The song body
// and the file's line endings are left as they were.
export function writeHeader(text, entries) {
  var header = readHeader(text);
  var out = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var key = cleanKey(e.key);
    if (!key) continue;
    var value = cleanValue(e.value);
    if (e.raw && key === e.origKey && value === cleanValue(e.origValue)) {
      for (var r = 0; r < e.raw.length; r++) out.push(e.raw[r]);
    } else {
      out.push(formatDirective(key, value, e.hasColon !== false));
    }
  }
  return out.concat(header.lines.slice(header.bodyStart)).join(header.eol);
}

// Line-by-line view of a song, shared by the parser, the renderer and the
// editors so they always agree on which lines are lyrics.
// kinds[i] is 'header' (metadata block, hidden), 'directive' (a `{...}` line
// further down) or 'content'. directives[i] is { name, value } for directive
// lines, with name lower-cased.
export function classifyLines(text) {
  var header = readHeader(text);
  var lines = header.lines;
  var kinds = [];
  var directives = [];
  for (var i = 0; i < lines.length; i++) {
    if (i < header.bodyStart) {
      kinds.push('header');
      directives.push(null);
      continue;
    }
    var t = lines[i].trim();
    if (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') {
      var d = parseDirectiveInner(t.slice(1, -1));
      kinds.push('directive');
      directives.push({ name: d.key.toLowerCase(), value: d.value });
    } else {
      kinds.push('content');
      directives.push(null);
    }
  }
  return { lines: lines, kinds: kinds, directives: directives, header: header };
}

// Beats per minute from a {tempo} value, ignoring words around the number:
// "68", "68 BPM", "68bpm", "Bpm: 68" -> 68. NaN when there's no number.
export function tempoBpm(value) {
  const m = String(value == null ? '' : value).match(/\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : NaN;
}

export function parseChordPro(text) {
  var info = classifyLines(text);
  var metadata = {};
  var result = [];
  var tokenRegex = /\[(.*?)\]/g;

  for (var i = 0; i < info.lines.length; i++) {
    var line = info.lines[i];
    var kind = info.kinds[i];
    if (kind === 'directive') {
      var d = info.directives[i];
      if (d.name && d.value) metadata[d.name] = d.value;
      continue;
    }
    if (kind === 'header') continue;

    var tokens = [];
    var lastIndex = 0;
    var match;
    tokenRegex.lastIndex = 0;
    while ((match = tokenRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: 'text', value: line.slice(lastIndex, match.index) });
      }
      tokens.push({ type: 'chord', value: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < line.length) {
      tokens.push({ type: 'text', value: line.slice(lastIndex) });
    }
    result.push(tokens);
  }

  // Header metadata wins over directives further down; the first of a repeated
  // header key wins.
  var entries = info.header.entries;
  for (var e = entries.length - 1; e >= 0; e--) {
    var name = entries[e].key.toLowerCase();
    if (name && entries[e].value) metadata[name] = entries[e].value;
  }

  return { metadata: metadata, lines: result };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseChordPro, readHeader, writeHeader, classifyLines, tempoBpm };
}
