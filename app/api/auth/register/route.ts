import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { uploadFile, kbisDir, clientDocumentsDir, slugify } from "@/lib/storage";
import { getCurrentTenantSlug, requireCurrentTenant } from "@/lib/tenant";
import { registerBaseSchema } from "@/lib/validations/auth";
import {
  notifyNewClientRegistration,
  notifyClientAccountApproved,
  notifyClientAccountRejected,
} from "@/lib/notifications";
import { checkRegistrationSpam, logRegistration, getClientIp } from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { emitAdminEvent } from "@/lib/admin-events";
import { checkVies } from "@/lib/vies";
import { checkSiret } from "@/lib/siret";
import { getCompanyZone } from "@/lib/vat";
import { getRegistrationRules } from "@/app/actions/admin/registration-rules";
import { decideRegistrationStatus } from "@/lib/registration-rules";
import { checkWhatsappNumberFireAndForget } from "@/lib/whatsapp-check";
import { tenantALS } from "@/lib/tenant-als";
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

    // Validation Zod (format uniquement — la contrainte « SIRET/TVA
    // obligatoire selon zone » est appliquée plus bas via les règles
    // SiteConfig[registration_rules] configurables dans l'admin).
    const validation = registerBaseSchema.safeParse(rawData);
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

    // ── Règles d'inscription (SiteConfig) ─────────────────────────────────
    // L'admin peut configurer, par zone (FR / UE / International), si le
    // numéro fiscal est obligatoire ou optionnel, s'il est vérifié en ligne
    // (annuaire-entreprises ou VIES), et quelle décision prendre selon le
    // résultat (approuver, laisser en attente, refuser).
    //
    // Zone FR : le client peut fournir SIRET ET/OU TVA. Un seul suffit à
    // être « renseigné ». Si vérif auto activée, au moins un valide suffit.
    const rules = await getRegistrationRules().catch(() => null);

    const trimmedVat = data.vatNumber?.trim() || null;
    const trimmedBrn = data.businessRegistrationNumber?.trim() || null;

    const siretProvided = !!normalizedSiret;
    const vatProvided = !!trimmedVat;
    const brnProvided = !!trimmedBrn;
    const kbisAttached = !!kbisPath; // KBIS = pièce jointe uploadée plus haut

    // Vérifications externes synchrones : on interroge annuaire-entreprises
    // et VIES en parallèle quand autoVerify est activé pour le champ ET
    // que le client a fourni une valeur. Pour FR, les deux appels tournent
    // en parallèle sans se bloquer.
    let siretVerifiedValid: boolean | null = null;
    let vatVerifiedValid: boolean | null = null;
    let viesSnapshot: Awaited<ReturnType<typeof checkVies>> | null = null;

    if (rules) {
      const siretRule =
        zone === "FR" ? rules.fr.siret : null;
      const vatRule =
        zone === "FR" ? rules.fr.vat :
        zone === "EU" ? rules.eu.vat :
        null;

      const siretWillVerify = siretRule?.autoVerify && siretProvided && normalizedSiret;
      const vatWillVerify = vatRule?.autoVerify && vatProvided && trimmedVat;

      if (siretWillVerify || vatWillVerify) {
        try {
          const [siretRes, viesRes] = await Promise.all([
            siretWillVerify ? checkSiret(normalizedSiret!) : Promise.resolve(null),
            vatWillVerify ? checkVies(trimmedVat!) : Promise.resolve(null),
          ]);
          if (siretRes) {
            // Erreur de service (timeout, 500, abort) → serviceError posé.
            // Dans ce cas on laisse verifiedValid à null pour que la
            // décision tombe en PENDING (voir decideField).
            if (siretRes.serviceError) {
              siretVerifiedValid = null;
            } else {
              siretVerifiedValid = siretRes.found && siretRes.activeStatus === "active";
            }
          }
          if (viesRes) {
            viesSnapshot = viesRes;
            if (viesRes.serviceError) {
              vatVerifiedValid = null;
            } else {
              vatVerifiedValid = viesRes.valid;
            }
          }
        } catch (err) {
          // Exception non prévue (crash réseau, parsing JSON…) : on laisse
          // les deux verifiedValid à null → la décision tombera en PENDING.
          logger.error("[Register] Vérification auto échouée", { error: err, zone });
        }
      }
    }

    // Décision basée sur les règles — ou PENDING par défaut si pas de règles.
    const decision = rules
      ? decideRegistrationStatus(zone, rules, {
          siret: { provided: siretProvided, verifiedValid: siretVerifiedValid },
          vat: { provided: vatProvided, verifiedValid: vatVerifiedValid },
          brn: { provided: brnProvided, verifiedValid: null },
          kbisAttached,
        })
      : { kind: "status" as const, status: "PENDING" as const };

    // Pré-check structurel : un champ obligatoire est absent → on refuse
    // avant la création du compte avec un message listant les champs manquants.
    if (decision.kind === "missingFiscalRejected") {
      const list = decision.missingFields.join(" et ");
      return NextResponse.json(
        { error: `${list} ${decision.missingFields.length > 1 ? "sont obligatoires" : "est obligatoire"} pour votre zone.` },
        { status: 400 }
      );
    }

    const resolvedStatus: "APPROVED" | "PENDING" | "REJECTED" = decision.status;
    const serviceErrored = decision.serviceErrored === true;

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
        businessRegistrationNumber: trimmedBrn,
        vatNumber:                  trimmedVat,
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
        status:                     resolvedStatus,
        // Si on a déjà interrogé VIES de manière synchrone, on persiste le
        // résultat pour éviter un 2ᵉ appel en fire-and-forget.
        viesValid:                  viesSnapshot?.valid ?? null,
        viesName:                   viesSnapshot?.name ?? null,
        viesAddress:                viesSnapshot?.address ?? null,
        viesRequestDate:            viesSnapshot?.requestDate ?? null,
        viesError:                  viesSnapshot?.serviceError ?? null,
      },
    });

    // ── Vérification VIES (fire-and-forget) ──────────────────────────────
    // On ne refait pas d'appel si on vient de le faire en synchrone au-dessus.
    if (newUser.vatNumber && !viesSnapshot) {
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

    // ── Notifications liées au statut auto-décidé ────────────────────────
    // Transitions normalement portées par updateUserStatus() quand l'admin
    // valide/refuse à la main — ici on les rejoue car la décision est auto.
    if (resolvedStatus === "APPROVED") {
      notifyClientAccountApproved({
        email: newUser.email,
        firstName: newUser.firstName,
      }).catch((err) =>
        logger.error("[Register] Email approbation auto échoué", { error: err }),
      );
      // Déclenche la vérif WhatsApp en arrière-plan (comme à l'approbation
      // manuelle). Détaché du contexte requête → wrap tenantALS.
      if (newUser.phone) {
        try {
          const tenant = await requireCurrentTenant();
          const phone = newUser.phone;
          const uid = newUser.id;
          void tenantALS.run(tenant.id, () =>
            checkWhatsappNumberFireAndForget(tenant.id, tenant.slug, phone, uid),
          );
        } catch (err) {
          logger.error("[Register] WhatsApp auto-check échoué", { error: err });
        }
      }
    } else if (resolvedStatus === "REJECTED") {
      notifyClientAccountRejected({
        email: newUser.email,
        firstName: newUser.firstName,
      }).catch((err) =>
        logger.error("[Register] Email refus auto échoué", { error: err }),
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

    // Push temps réel vers /admin/clients ouvert dans un onglet admin
    emitAdminEvent({ type: "CLIENT_NEW", userId: newUser.id });

    const message = resolvedStatus === "APPROVED"
      ? "Votre compte a été approuvé immédiatement. Vous pouvez dès maintenant vous connecter."
      : serviceErrored
        ? "Le service de vérification est momentanément indisponible. Un administrateur examinera votre dossier dès que possible."
        : "Votre demande d'accès a bien été enregistrée. Notre équipe va examiner votre dossier et vous contactera par email.";

    // Le client a besoin du statut + zone pour afficher l'overlay de
    // vérification avec le bon libellé (SIRET pour FR, TVA pour UE,…).
    // `serviceErrored` permet d'afficher un message dédié « service down ».
    return NextResponse.json({
      message,
      status: resolvedStatus,
      zone,
      companyName: viesSnapshot?.name ?? null,
      serviceErrored,
    }, { status: 201 });
  } catch (error) {
    // Prisma P2000 : valeur trop longue pour la colonne cible.
    // Cas typique : un champ Zod .max(2000) mais colonne SQL restée en
    // VARCHAR(191). On renvoie un 400 clair plutôt que le 500 générique.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2000"
    ) {
      const column = (error.meta as { column_name?: string } | undefined)?.column_name;
      const label = column ? (FIELD_LABELS[column] ?? column) : "un champ";
      logger.error("[POST /api/auth/register] Valeur trop longue", { column, error });
      return NextResponse.json(
        { error: `Le champ « ${label} » est trop long. Raccourcissez le texte puis renvoyez votre demande.` },
        { status: 400 }
      );
    }
    logger.error("[POST /api/auth/register]", { error });
    return NextResponse.json(
      { error: "Une erreur serveur est survenue. Veuillez réessayer." },
      { status: 500 }
    );
  }
}

// Libellés lisibles pour les colonnes User exposées à l'utilisateur.
// Utilisé quand Prisma renvoie une erreur P2000 avec un `column_name`.
const FIELD_LABELS: Record<string, string> = {
  registrationMessage: "Message à notre équipe",
  addressStreet: "Adresse",
  addressComplement: "Complément d'adresse",
  addressCity: "Ville",
  company: "Société",
  firstName: "Prénom",
  lastName: "Nom",
  email: "E-mail",
  phone: "Téléphone",
  siret: "SIRET",
  vatNumber: "N° TVA intra",
};
