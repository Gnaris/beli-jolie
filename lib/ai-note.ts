const AI_MARK_REGEX = /Complété par l'IA le \d{2}\/\d{2}\/\d{4}/;

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function buildAiNotePrefix(now: Date = new Date()): string {
  const dd = pad2(now.getDate());
  const mm = pad2(now.getMonth() + 1);
  const yyyy = now.getFullYear();
  return `Complété par l'IA le ${dd}/${mm}/${yyyy}`;
}

export function containsAiCompletionMark(note: string | null | undefined): boolean {
  if (!note) return false;
  return AI_MARK_REGEX.test(note);
}

export function prependAiNote(
  previous: string | null | undefined,
  now: Date = new Date(),
): string {
  const prefix = buildAiNotePrefix(now);
  const prev = previous?.trim() ?? "";
  if (prev.startsWith(prefix)) return prev; // ne pas dupliquer
  if (!prev) return prefix;
  return `${prefix}\n---\n${prev}`;
}
