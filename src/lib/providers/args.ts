/**
 * Split a configured argument string the way a shell would — without a shell.
 *
 * Splitting on whitespace alone breaks the first time an operator points at a
 * path with a space in it, which on Windows is most of them. Quotes are
 * honoured so `--config "C:\Program Files\x.json"` survives; nothing else
 * about a shell is emulated, because none of it should be: the command is run
 * with `execFile`, so there is no expansion to worry about and no injection to
 * defend against.
 */
export function splitArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];

  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of raw.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) args.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current) args.push(current);

  return args;
}
