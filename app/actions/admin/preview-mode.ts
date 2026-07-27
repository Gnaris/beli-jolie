"use server";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";

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
  // Pas de redirect() serveur : même en pointant l'absolue vers le host
  // courant, Next.js gardait la navigation en "soft" (RSC) et resservait
  // parfois le cache Router du domaine BJ (issyma affichait la home BJ).
  // Le client fait un full reload via window.location.href — symétrique à
  // disableAdminPreview.
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
