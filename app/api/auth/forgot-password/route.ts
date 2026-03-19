import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPasswordResetToken, sendPasswordResetEmail } from "@/lib/password-reset";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Email requis." }, { status: 400 });
    }
    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    // On répond toujours avec succès (sécurité anti-enumeration)
    if (user) {
      const token = await createPasswordResetToken(user.email);
      await sendPasswordResetEmail(user.email, token);
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[forgot-password]", e);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
