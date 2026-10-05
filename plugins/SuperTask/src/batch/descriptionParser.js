const MAX_SOURCE_ROW_LENGTH = 8000;
const MAX_TRANSCRIPTION_LENGTH = MAX_SOURCE_ROW_LENGTH * 100;

function stripBullet(line) {
  return String(line).trim().replace(/^(?:-\s+|[*•◦▪☐□]\s*|\[(?: |x|X)\]\s*|\d+[.)]\s+)/, '').trim();
}

function isRangeSeparator(left, right) {
  const month = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
  const weekday = String.raw`(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)`;
  const date = String.raw`(?:\d{1,4}(?:[/-]\d{1,2}){1,2}|${month}(?:\s+\d{1,2})?(?:,?\s+\d{4})?|${weekday})`;
  const number = String.raw`[+-]?\d+(?:\.\d+)?(?:\s*(?:%|[a-z]{1,8}))?`;
  const leftOperand = new RegExp(`(?:^|\\s)(?:${date}|${number})$`, 'i');
  const rightOperand = new RegExp(`^\\s*(?:${date}|${number})(?:$|\\s)`, 'i');
  return leftOperand.test(left) && rightOperand.test(right);
}

function splitTitleDescription(value) {
  const text = stripBullet(String(value ?? '').trim());
  if (text.length > MAX_SOURCE_ROW_LENGTH) {
    throw new Error('A transcription row is too long to review.');
  }
  // Requiring whitespace on both sides preserves hyphenated words and ordinary minus signs.
  const separator = /\s+([-–—])\s+/g;
  let match;
  let cursor = 0, quote = '';
  while ((match = separator.exec(text))) {
    while (cursor < match.index) {
      const char = text[cursor];
      if (quote) {
        if (char === quote && text[cursor - 1] !== '\\') quote = '';
      } else if (char === '"') quote = '"';
      else if (char === '“') quote = '”';
      else if (char === '‘') quote = '’';
      else if (char === "'" && !/[\p{L}\p{N}]/u.test(text[cursor - 1] || '') && /[\p{L}\p{N}]/u.test(text[cursor + 1] || '')) quote = "'";
      cursor++;
    }
    const insideQuote = !!quote;
    cursor = separator.lastIndex;
    if (insideQuote) continue;
    const title = text.slice(0, match.index).trim();
    const description = text.slice(separator.lastIndex).trim();
    if (!title || !description || isRangeSeparator(title, description)) {
      continue;
    }
    return {content: title, description, split: true};
  }
  return {content: text, description: '', split: false};
}

module.exports = {MAX_SOURCE_ROW_LENGTH, MAX_TRANSCRIPTION_LENGTH, stripBullet, splitTitleDescription};
