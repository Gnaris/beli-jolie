import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { uploadFile, kbisDir, clientDocumentsDir, slugify } from "@/lib/storage";
import { getCurrentTenantSlug } from "@/lib/tenant";
import { registerSchema } from "@/lib/validations/auth";
import { notifyNewClientRegistration } from "@/lib/notifications";
import { checkRegistrationSpam, logRegistration, getClientIp } from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { checkVies } from "@/lib/vies";
import { getCompanyZone } from "@/lib/vat";
import {
  sanitizeImage,
  assertPdfSafe,
  isImageMime,
  isPdfMime,
  isDocxMime,
  IMAGE_MIME_WHITELIST,
  DOCUMENT_MIME_WHITELIST,
  DOCUMENT_EXTENSION_WHITELIST,
} from "@/lib/upload-security";

/**
 * POST /api/auth/register
 *
 * Inscription d'un nouveau professionnel BtoB
 * Reçoit un FormData avec les champs texte + le fichier Kbis
 *
 * Flux :
 * 1. Validation des champs (Zod)
 * 2. Vérification unicité email + SIRET
 * 3. Sauvegarde du fichier Kbis dans /public/uploads/kbis/
 * 4. Hash du mot de passe (bcrypt, 12 rounds)
 * 5. Création de l'utilisateur en base (statut PENDING)
 */
export async function POST(request: NextRequest) {
  // Rate limit : 3 req/min par IP (complément au cooldown 3h anti-spam)
  const rateLimited = checkRateLimit(request, "auth-register", 3, 60_000);
  if (rateLimited) return rateLimited;

  // Peut être null si la requête n'a pas traversé le middleware tenant
  // (contexte de test unitaire, appel direct sans host mappé). Dans ce cas
  // on retombe sur le layout legacy sans préfixe boutique.
  const tenantSlug = (await getCurrentTenantSlug()) ?? undefined;

  try {
    const formData = await request.formData();

    // Extraction des champs texte
    const rawData = {
      firstName:           formData.get("firstName") as string,
      lastName:            formData.get("lastName") as string,
      company:             formData.get("company") as string,
      email:               formData.get("email") as string,
      phone:               formData.get("phone") as string,
      siret:               formData.get("siret") as string,
      vatNumber:           (formData.get("vatNumber") as string | null) || undefined,
      businessRegistrationNumber:
        (formData.get("businessRegistrationNumber") as string | null) || undefined,
      addressStreet:       formData.get("addressStreet") as string,
      addressComplement:   (formData.get("addressComplement") as string | null) || undefined,
      addressZip:          formData.get("addressZip") as string,
      addressCity:         formData.get("addressCity") as string,
      addressCountry:      ((formData.get("addressCountry") as string) ?? "").toUpperCase(),
      password:            formData.get("password") as string,
      confirmPassword:     formData.get("confirmPassword") as string,
      registrationMessage: (formData.get("registrationMessage") as string | null) || undefined,
      // Checkboxes : FormData renvoie "true"/"false" (chaîne). Zod attend un booléen.
      acceptsTerms:        formData.get("acceptsTerms") === "true",
      acceptsNewsletter:   formData.get("acceptsNewsletter") === "true",
    };

    // Validation Zod
    const validation = registerSchema.safeParse(rawData);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const data = validation.data;

    // SIRET facultatif : normalisé en `null` si vide (les clients étrangers
    // n'ont pas de SIRET). Un tenant peut alors héberger plusieurs comptes
    // sans SIRET grâce au NULL — le @@unique composite Postgres/MySQL
    // autorise plusieurs NULL.
    const normalizedSiret = data.siret?.trim() ? data.siret.trim() : null;

    // Vérification unicité de l'email
    const existingEmail = await prisma.user.findFirst({
      where: { email: data.email.toLowerCase().trim() },
    });
    if (existingEmail) {
      return NextResponse.json(
        { error: "Un compte existe déjà avec cet email." },
        { status: 409 }
      );
    }

    // Vérification unicité du SIRET (uniquement s'il est renseigné)
    if (normalizedSiret) {
      const existingSiret = await prisma.user.findFirst({
        where: { siret: normalizedSiret },
      });
      if (existingSiret) {
        return NextResponse.json(
          { error: "Un compte existe déjà avec ce numéro SIRET." },
          { status: 409 }
        );
      }
    }

    // ── Anti-spam : cooldown 3h par IP/phone/siret/email ─────────────
    const clientIp = getClientIp(request.headers);
    const spamError = await checkRegistrationSpam(
      clientIp,
      data.email,
      data.phone,
      normalizedSiret,
    );
    if (spamError) {
      return NextResponse.json({ error: spamError }, { status: 429 });
    }

    // ── Sécurité fichiers upload ────────────────────────────────────
    // Images  : re-encodage complet via Sharp (purge EXIF + payloads).
    // PDF     : magic bytes + refus des actions auto (/JavaScript, /Launch…).
    // DOCX    : magic bytes ZIP + refus .doc (format binaire à macros).
    //
    // Voir lib/upload-security.ts pour le détail des règles.
    const MAX_FILE_SIZE = 5 * 1024 * 1024;

    async function processUpload(
      file: File,
      allowedMimes: readonly string[],
      allowedExtensions: readonly string[],
      errorPrefix: string,
    ): Promise<{ buffer: Buffer; mime: string; extension: string }> {
      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`${errorPrefix} ne doit pas dépasser 5 Mo.`);
      }
      if (!allowedMimes.includes(file.type)) {
        throw new Error(`Format non autorisé pour ${errorPrefix}.`);
      }
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!allowedExtensions.includes(ext)) {
        throw new Error(`Extension non autorisée pour ${errorPrefix}.`);
      }
      const rawBuffer = Buffer.from(await file.arrayBuffer());

      if (isImageMime(file.type)) {
        // Sharp re-encode : purge de tout payload malveillant + validation
        // que le contenu est bien une vraie image (pas un polyglot).
        const sanitized = await sanitizeImage(rawBuffer, file.type);
        return { buffer: sanitized.buffer, mime: sanitized.mime, extension: sanitized.extension };
      }
      if (isPdfMime(file.type)) {
        assertPdfSafe(rawBuffer);
        return { buffer: rawBuffer, mime: "application/pdf", extension: "pdf" };
      }
      if (isDocxMime(file.type)) {
        // DOCX = ZIP OOXML, header `PK\x03\x04`.
        if (rawBuffer.length < 4 || rawBuffer[0] !== 0x50 || rawBuffer[1] !== 0x4B
          || rawBuffer[2] !== 0x03 || rawBuffer[3] !== 0x04) {
          throw new Error(`${errorPrefix} : le contenu ne correspond pas à un fichier .docx.`);
        }
        return { buffer: rawBuffer, mime: file.type, extension: "docx" };
      }
      throw new Error(`Format non traité pour ${errorPrefix}.`);
    }

    // Fallback sur l'email quand le SIRET est absent (client hors France).
    const safeSiret = normalizedSiret
      ? slugify(normalizedSiret.replace(/\D/g, ""))
      : slugify(data.email.toLowerCase().trim());
    const timestamp = Date.now();

    // Zone administrative pour décider quel justificatif est obligatoire.
    const zone = getCompanyZone(data.addressCountry);

    // ── Gestion du fichier Kbis (obligatoire zone FR + DOM-TOM) ──────
    const kbisFile = formData.get("kbis") as File | null;
    let kbisPath: string | null = null;

    if (kbisFile && kbisFile.size > 0) {
      try {
        const { buffer, mime, extension } = await processUpload(
          kbisFile,
          IMAGE_MIME_WHITELIST.concat("application/pdf" as never) as readonly string[],
          ["pdf", "jpg", "jpeg", "png", "webp"],
          "le Kbis",
        );
        const dir = kbisDir(safeSiret, tenantSlug);
        const key = `${dir}/kbis-${timestamp}.${extension}`;
        await uploadFile(key, buffer, mime);
        kbisPath = key;
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Fichier Kbis invalide." },
          { status: 400 }
        );
      }
    }

    // ── Gestion du justificatif d'entreprise ─────────────────────────
    const docFile = formData.get("document") as File | null;
    let documentPath: string | null = null;

    if (docFile && docFile.size > 0) {
      try {
        const { buffer, mime, extension } = await processUpload(
          docFile,
          DOCUMENT_MIME_WHITELIST as readonly string[],
          DOCUMENT_EXTENSION_WHITELIST as readonly string[],
          "le justificatif",
        );
        const docDir = clientDocumentsDir(safeSiret, tenantSlug);
        const docKey = `${docDir}/document-${timestamp}.${extension}`;
        await uploadFile(docKey, buffer, mime);
        documentPath = docKey;
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Fichier justificatif invalide." },
          { status: 400 }
        );
      }
    }

    // ── Vérification du justificatif obligatoire hors UE ─────────────
    // Le Kbis reste facultatif pour la France : l'admin peut réclamer
    // la pièce par email si le dossier arrive incomplet.
    if (zone === "WORLD" && !documentPath) {
      return NextResponse.json(
        { error: "Un justificatif d'entreprise est obligatoire pour les sociétés hors Union européenne." },
        { status: 400 }
      );
    }

    // ── Création de l'utilisateur ──────────────────────────────────────

    // Hash du mot de passe (12 rounds = bon équilibre sécurité/performance)
    const hashedPassword = await bcrypt.hash(data.password, 12);

    const newUser = await prisma.user.create({
      data: {
        email:                      data.email.toLowerCase().trim(),
        password:                   hashedPassword,
        firstName:                  data.firstName?.trim() || "",
        lastName:                   data.lastName?.trim() || "",
        company:                    data.company.trim(),
        phone:                      data.phone.trim(),
        siret:                      normalizedSiret,
        businessRegistrationNumber: data.businessRegistrationNumber?.trim() || null,
        vatNumber:                  data.vatNumber?.trim() || null,
        addressStreet:              data.addressStreet.trim(),
        addressComplement:          data.addressComplement?.trim() || null,
        addressZip:                 data.addressZip.trim(),
        addressCity:                data.addressCity.trim(),
        addressCountry:             data.addressCountry.toUpperCase(),
        kbisPath,
        documentPath,
        registrationMessage:        data.registrationMessage?.trim() || null,
        acceptsNewsletter:          data.acceptsNewsletter ?? false,
        role:                       "CLIENT",
        status:                     "PENDING",
      },
    });

    // ── Vérification VIES (fire-and-forget) ──────────────────────────────
    if (newUser.vatNumber) {
      checkVies(newUser.vatNumber)
        .then((vies) =>
          prisma.user.update({
            where: { id: newUser.id },
            data: {
              viesValid: vies.valid,
              viesName: vies.name,
              viesAddress: vies.address,
              viesRequestDate: vies.requestDate,
              viesError: vies.serviceError ?? null,
            },
          })
        )
        .catch((err) =>
          logger.error("[Register] VIES check failed", { error: err })
        );
    }

    // ── Log anti-spam (cooldown 3h) ─────────────────────────────────────
    await logRegistration(clientIp, data.email, data.phone, normalizedSiret, data.company);

    // Notification admin (email + Kbis en pièce jointe si fourni) — non bloquant
    notifyNewClientRegistration({
      firstName:           newUser.firstName,
      lastName:            newUser.lastName,
      company:             newUser.company,
      email:               newUser.email,
      phone:               newUser.phone,
      siret:               newUser.siret ?? null,
      kbisPath:            newUser.kbisPath ?? undefined,
      documentPath:        newUser.documentPath ?? undefined,
      registrationMessage: newUser.registrationMessage ?? undefined,
    }).catch((err) =>
      logger.error("[POST /api/auth/register] Notification échouée", { error: err })
    );

    revalidateTag("users", "default");

    const message = "Votre demande d'accès a bien été enregistrée. Notre équipe va examiner votre dossier et vous contactera par email.";

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    logger.error("[POST /api/auth/register]", { error });
    return NextResponse.json(
      { error: "Une erreur serveur est survenue. Veuillez réessayer." },
      { status: 500 }
    );
  }
}
