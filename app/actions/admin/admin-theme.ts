"use server";

import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ADMIN_THEME_COOKIE, parseAdminTheme, type AdminTheme } from "@/lib/admin-theme";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export async function setAdminTheme(
  theme: AdminTheme,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const normalized = parseAdminTheme(theme);
    const store = await cookies();
    store.set(ADMIN_THEME_COOKIE, normalized, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365 * 5,
      sameSite: "lax",
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
