/**
 * POST /api/admin/microstore/qr
 *
 * Génère un nouveau `code` de scan Microstore + le rend en QR code (dataURL).
 * Le client (page /admin/parametres/microstore) affiche le QR et poll
 * /api/admin/microstore/poll avec ce même `code`.
 *
 * Le code n'est PAS persisté côté serveur : c'est le client qui le passe à
 * chaque poll (paramètre `code`). Ça évite d'avoir à gérer un état côté
 * serveur pour un flow qui dure ~1min.
 */

import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireAdmin } from "@/lib/auth-helpers";
import { generateMicrostoreScanCode } from "@/lib/microstore-auth";

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const { code, qrPayload, timestamp } = generateMicrostoreScanCode();
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  return NextResponse.json({ code, qrDataUrl, timestamp });
}
