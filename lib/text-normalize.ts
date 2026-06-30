const LIGATURES: Record<string, string> = {
  œ: "oe",
  Œ: "oe",
  æ: "ae",
  Æ: "ae",
};

export function normalizeForCompare(input: string | null | undefined): string {
  if (input == null) return "";
  const withLigaturesReplaced = String(input).replace(
    /[œŒæÆ]/g,
    (c) => LIGATURES[c] ?? c,
  );
  return withLigaturesReplaced
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les marques diacritiques (combining marks)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
