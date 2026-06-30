/**
 * Format une date ISO en texte relatif (fr-FR), version compacte Ardoise.
 * Ex: "auj.", "1j", "3j", "29 juin", "29 juin 2025".
 */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const msPerDay = 86_400_000;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / msPerDay);
  if (diffDays === 0) return "auj.";
  if (diffDays >= 1 && diffDays < 7) return `${diffDays}j`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("fr-FR", sameYear
    ? { day: "2-digit", month: "short" }
    : { day: "2-digit", month: "short", year: "numeric" });
}
