import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "bj_visitor_id";
const ONE_YEAR = 60 * 60 * 24 * 365;

function todayKey(): string {
  // Format YYYY-MM-DD basé sur le fuseau du serveur (suffisant pour des
  // statistiques journalières — pas besoin d'UTC strict).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function randomId(): string {
  // 24 octets aléatoires en base64url, suffisant comme identifiant anonyme stable
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;
    const isAuthenticated = !!userId;

    // Visitor ID : userId si connecté, sinon cookie (créé s'il n'existe pas).
    const cookieVal = req.cookies.get(COOKIE_NAME)?.value ?? "";
    const visitorId = isAuthenticated
      ? `u:${userId}`
      : (cookieVal && cookieVal.length >= 8 ? cookieVal : `a:${randomId()}`);

    const date = todayKey();

    // upsert idempotent : si déjà compté aujourd'hui, on ne fait rien.
    await prisma.visit.upsert({
      where:  { visitorId_date: { visitorId, date } },
      create: { visitorId, date, isAuthenticated },
      update: {}, // idempotence : aucune modification sur ré-appel
    });

    const res = NextResponse.json({ ok: true });

    // Pose le cookie anonyme si l'utilisateur n'est pas connecté et n'en a pas
    if (!isAuthenticated && (!cookieVal || cookieVal.length < 8)) {
      res.cookies.set(COOKIE_NAME, visitorId.replace(/^a:/, ""), {
        httpOnly: true,
        sameSite: "lax",
        secure:   process.env.NODE_ENV === "production",
        path:     "/",
        maxAge:   ONE_YEAR,
      });
    }

    return res;
  } catch (err) {
    logger.warn("track-visit failed", { err: String(err) });
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
