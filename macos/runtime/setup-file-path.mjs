import fs from 'node:fs';

export function setupFilePath(input, {argument = false, exists = fs.existsSync} = {}) {
  const invalid = () => { throw Error('OPENCLAW_SETUP_FILE'); };
  if (typeof input !== 'string' || !input.length || input.length > 32768 || /[\0\r\n]/.test(input)) invalid();
  // argv is already decoded by the launching shell. Never decode it twice.
  if (argument) return input;
  const text = input.trim();
  if (!text) invalid();
  // A pasted literal path wins, including literal quotes and backslashes.
  if (exists(text)) return text;
  let result = '', quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = ''; else result += c;
    } else if (c === '\\') {
      if (++i === text.length) invalid();
      const next = text[i];
      result += quote === '"' && !['$', '`', '"', '\\'].includes(next) ? '\\' + next : next;
    } else if (quote === '"') {
      if (c === '"') quote = ''; else result += c;
    } else if (c === "'" || c === '"') quote = c;
    else {
      if (/\s|[;&|<>`$]/.test(c)) invalid();
      result += c;
    }
  }
  if (quote || !result) invalid();
  return result;
}
