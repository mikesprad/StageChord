export function parseChordPro(text) {
  const lines = text.split(/\r?\n/);
  const metadata = {};
  const result = [];
  const tokenRegex = /\[(.*?)\]/g;
  const metaRegex = /\{([^:]+):\s*(.+?)\}/;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const match = metaRegex.exec(trimmed);
      if (match) {
        metadata[match[1].toLowerCase()] = match[2];
      }
    } else {
      const tokens = [];
      let lastIndex = 0;
      let match;
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
  }
  return { metadata, lines: result };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseChordPro };
}
