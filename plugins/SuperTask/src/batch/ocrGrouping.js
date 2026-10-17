const BULLET = /^\s*(?:[-*•◦▪☐□]\s*|\[(?: |x|X)\]\s*|\d+[.)]\s+)/;
const hasBullet = line => BULLET.test(String(line));

function groupOcrText(value, mode = 'lines', {explicitSplit = false} = {}) {
  const text = String(value);
  const records = (text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || []).map(raw => {
    const ending = raw.match(/(?:\r\n|\n|\r)$/)?.[0] || '';
    return {text: ending ? raw.slice(0, -ending.length) : raw, ending};
  });
  if (explicitSplit) return records.filter(line => line.text.trim()).map(line => ({sourceText: line.text}));
  const groups = [];
  const blocks = [];
  let block = [];
  for (const line of records) {
    if (!line.text.trim()) {if (block.length) blocks.push(block); block = [];}
    else block.push(line);
  }
  if (block.length) blocks.push(block);
  const textOf = lines => lines.map((line, index) => line.text + (index < lines.length - 1 ? line.ending : '')).join('');
  for (const lines of blocks) {
    if (!lines.length) continue;
    if (mode === 'paragraphs' && !lines.some(line => hasBullet(line.text))) {
      groups.push({sourceText: textOf(lines)});
      continue;
    }
    let current = [];
    const flush = () => {if (current.length) groups.push({sourceText: textOf(current)}); current = [];};
    for (const line of lines) {
      if (hasBullet(line.text)) {flush(); current = [line]; continue;}
      if (/^\s+\S/.test(line.text) && current.length) {current.push(line); continue;}
      flush(); current = [line];
    }
    flush();
  }
  return groups;
}

module.exports = {groupOcrText, hasBullet};
