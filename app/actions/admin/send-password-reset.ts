"use server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPasswordResetToken, sendPasswordResetEmail } from "@/lib/password-reset";

export async function sendAdminPasswordReset(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
    const token = await createPasswordResetToken(session.user.email!);
    await sendPasswordResetEmail(session.user.email!, token);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
