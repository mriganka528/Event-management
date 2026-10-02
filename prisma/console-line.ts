/**
 * Line splitting for the interactive console reader used by
 * `prisma/bootstrap-admin.ts`.
 *
 * Extracted so it can be unit-tested: the reader runs inside a CLI that talks to
 * the database, so testing it directly is not possible.
 *
 * WHY THE TERMINATOR MATTERS
 * --------------------------
 * A Windows console sends `\r\n` for a single Enter keypress, while a raw-mode
 * TTY (the password prompts) sends a bare `\r` and piped stdin sends a bare `\n`.
 * A reader that consumes only the first terminator character leaves the second
 * one in its buffer, and the *next* prompt then reads that stray newline as an
 * empty answer. That silently skipped the name field and pushed whatever was
 * typed next into the following question, so the whole terminator is consumed
 * here as a unit.
 */

export type SplitLine = { line: string; rest: string } | null;

/** Splits the first complete line off `buffer`, or returns null if there is none. */
export function splitLine(buffer: string): SplitLine {
  const match = buffer.match(/^[^\r\n]*(?:\r\n|\r|\n)/);
  if (!match) return null;
  const end = match[0].search(/\r|\n/);
  return { line: buffer.slice(0, end), rest: buffer.slice(match[0].length) };
}