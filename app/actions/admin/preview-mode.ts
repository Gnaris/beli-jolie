"use server";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";

export async function enableAdminPreview() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
  const cookieStore = await cookies();
  cookieStore.set("bj_admin_preview", "1", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 heures
  });
  // Redirect absolu vers le host courant : sur issyma.fr, "/" résolu comme
  // path relatif peut être ré-ancré sur NEXTAUTH_URL (beliandjolie.com) selon
  // le mode de rendu → l'admin issyma se retrouve sur beliandjolie.com/.
  const baseUrl = await getCurrentTenantBaseUrl();
  redirect(`${baseUrl}/`);
}

export async function disableAdminPreview() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
  const cookieStore = await cookies();
  cookieStore.delete("bj_admin_preview");
  // Pas de redirect() ici : la navigation RSC depuis une route localisée
  // (/fr/…) vers /admin (non localisée) laisse le layout locale monté et
  // affiche une page blanche jusqu'au refresh (observé sur issyma). Le client
  // fait un full reload via window.location.href.
}
