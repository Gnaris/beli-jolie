export function stripLocaleFromCallbackUrl(
  rawCallbackUrl: string,
  locales: readonly string[],
): string {
  if (!rawCallbackUrl) return "/";
  const localePattern = new RegExp(`^/(${locales.join("|")})(?=/|$)`);
  const stripped = rawCallbackUrl.replace(localePattern, "");
  return stripped || "/";
}
