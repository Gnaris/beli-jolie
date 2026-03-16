"use server";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  redirect("/");
}

export async function disableAdminPreview() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
  const cookieStore = await cookies();
  cookieStore.delete("bj_admin_preview");
  redirect("/admin");
}
