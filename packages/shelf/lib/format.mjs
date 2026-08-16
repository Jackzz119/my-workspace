export function charWidth(ch) {
  const code = ch.codePointAt(0);
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) return 2;
  return 1;
}

export function wrap(text, maxWidth) {
  const lines = [];
  let line = "";
  let lineW = 0;
  for (const ch of text) {
    if (ch === "\n") {
      lines.push(line);
      line = "";
      lineW = 0;
      continue;
    }
    const w = charWidth(ch);
    if (lineW + w > maxWidth) {
      const lastSp = line.lastIndexOf(" ");
      if (lastSp > 0 && lastSp >= line.length - 24) {
        lines.push(line.slice(0, lastSp));
        const carry = line.slice(lastSp + 1);
        line = carry + ch;
        lineW = [...line].reduce((s, c) => s + charWidth(c), 0);
      } else {
        lines.push(line);
        line = ch === " " ? "" : ch;
        lineW = ch === " " ? 0 : w;
      }
    } else {
      line += ch;
      lineW += w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function termWidth() {
  return Math.max(40, Math.min(process.stdout.columns || 80, 100));
}