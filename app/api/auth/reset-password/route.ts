import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();
    if (!token || !password || password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return NextResponse.json({ error: "Mot de passe invalide : 8 caractères min., 1 majuscule et 1 chiffre requis." }, { status: 400 });
    }
    const record = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!record || record.used || record.expiresAt < new Date()) {
      return NextResponse.json({ error: "Lien invalide ou expiré." }, { status: 400 });
    }
    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { email: record.email }, data: { password: hashed } });
    await prisma.passwordResetToken.update({ where: { token }, data: { used: true } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[reset-password]", e);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
