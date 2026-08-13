export const ADMIN_THEME_COOKIE = "bj_admin_theme";

export type AdminTheme = "light" | "dark";

export function parseAdminTheme(value: string | null | undefined): AdminTheme {
  return value === "dark" ? "dark" : "light";
}

export function adminThemeBodyClass(theme: AdminTheme): string {
  return theme === "dark" ? "admin-dark" : "";
}
