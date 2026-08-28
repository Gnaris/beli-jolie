import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkLoginLockout } from "@/lib/security";
import {
  createLoginOtp,
  getResendCooldownRemaining,
  sendLoginOtpEmail,
  OTP_TTL_MS,
} from "@/lib/login-otp";

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Adresse email invalide." },
      { status: 400 }
    );
  }

  const { email } = parsed.data;

  const lockoutMessage = await checkLoginLockout(email);
  if (lockoutMessage) {
    return NextResponse.json({ error: lockoutMessage }, { status: 429 });
  }

  const cooldownRemaining = await getResendCooldownRemaining(email);
  if (cooldownRemaining > 0) {
    const seconds = Math.ceil(cooldownRemaining / 1000);
    return NextResponse.json(
      {
        error: `Merci de patienter ${seconds} seconde${seconds > 1 ? "s" : ""} avant de demander un nouveau code.`,
        retryAfterMs: cooldownRemaining,
      },
      { status: 429 }
    );
  }

  // Réponse générique — on envoie le code à tout compte CLIENT existant, quel
  // que soit son statut (PENDING/APPROVED/REJECTED). Un compte révoqué garde
  // le droit de se connecter pour consulter la boutique ; la restriction porte
  // uniquement sur les prix et la commande (cf. `canSeePrices()`).
  const user = await prisma.user.findFirst({
    where: { email },
    select: { role: true },
  });

  const eligible = !!user && user.role === "CLIENT";

  if (eligible) {
    try {
      const code = await createLoginOtp(email);
      await sendLoginOtpEmail(email, code);
    } catch (err) {
      logger.error("[login-otp] Échec création/envoi du code", { err, email });
      return NextResponse.json(
        { error: "Impossible d'envoyer le code pour le moment. Réessayez dans quelques instants." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    expiresInMs: OTP_TTL_MS,
  });
}
