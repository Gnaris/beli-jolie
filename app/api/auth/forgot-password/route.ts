import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPasswordResetToken, sendPasswordResetEmail } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const { success } = rateLimit(`forgot-password:${ip}`, 3, 60 * 60 * 1000);
    if (!success) {
      return NextResponse.json({ error: "Trop de tentatives. Réessayez plus tard." }, { status: 429 });
    }
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
    logger.error("[forgot-password] Server error", { detail: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
