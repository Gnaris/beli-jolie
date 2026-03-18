import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations/auth";
import { notifyNewClientRegistration } from "@/lib/notifications";
import { cookies } from "next/headers";

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
      password:            formData.get("password") as string,
      confirmPassword:     formData.get("confirmPassword") as string,
      registrationMessage: (formData.get("registrationMessage") as string | null) || undefined,
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

    // Vérification unicité de l'email
    const existingEmail = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase().trim() },
    });
    if (existingEmail) {
      return NextResponse.json(
        { error: "Un compte existe déjà avec cet email." },
        { status: 409 }
      );
    }

    // Vérification unicité du SIRET
    const existingSiret = await prisma.user.findUnique({
      where: { siret: data.siret },
    });
    if (existingSiret) {
      return NextResponse.json(
        { error: "Un compte existe déjà avec ce numéro SIRET." },
        { status: 409 }
      );
    }

    // ── Gestion du fichier Kbis (optionnel) ──────────────────────────
    const kbisFile = formData.get("kbis") as File | null;
    let kbisPath: string | null = null;

    if (kbisFile && kbisFile.size > 0) {
      // Vérification du type de fichier (PDF ou image)
      const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
      if (!allowedTypes.includes(kbisFile.type)) {
        return NextResponse.json(
          { error: "Le Kbis doit être au format PDF, JPG ou PNG." },
          { status: 400 }
        );
      }

      // Limite de taille : 5 Mo
      const MAX_SIZE = 5 * 1024 * 1024;
      if (kbisFile.size > MAX_SIZE) {
        return NextResponse.json(
          { error: "Le fichier Kbis ne doit pas dépasser 5 Mo." },
          { status: 400 }
        );
      }

      // Création du dossier de stockage si nécessaire
      const uploadDir = path.join(process.cwd(), "private", "uploads", "kbis");
      await fs.mkdir(uploadDir, { recursive: true });

      // Nom de fichier sécurisé et unique
      const ext = kbisFile.name.split(".").pop()?.toLowerCase() ?? "pdf";
      const safeSiret = data.siret.replace(/\D/g, "");
      const timestamp = Date.now();
      const filename = `kbis_${safeSiret}_${timestamp}.${ext}`;
      const filepath = path.join(uploadDir, filename);

      // Écriture du fichier sur le disque
      const buffer = Buffer.from(await kbisFile.arrayBuffer());
      await fs.writeFile(filepath, buffer);

      // Chemin relatif stocké en base (ne jamais exposer le chemin absolu)
      kbisPath = `private/uploads/kbis/${filename}`;
    }

    // ── Vérification code d'accès invité ──────────────────────────────
    const cookieStore = await cookies();
    const accessCodeCookie = cookieStore.get("bj_access_code")?.value;
    let autoApproved = false;

    if (accessCodeCookie) {
      const accessCode = await prisma.accessCode.findUnique({
        where: { code: accessCodeCookie },
      });
      if (
        accessCode &&
        accessCode.isActive &&
        !accessCode.usedBy &&
        new Date() <= accessCode.expiresAt
      ) {
        autoApproved = true;
      }
    }

    // ── Création de l'utilisateur ──────────────────────────────────────

    // Hash du mot de passe (12 rounds = bon équilibre sécurité/performance)
    const hashedPassword = await bcrypt.hash(data.password, 12);

    const newUser = await prisma.user.create({
      data: {
        email:               data.email.toLowerCase().trim(),
        password:            hashedPassword,
        firstName:           data.firstName.trim(),
        lastName:            data.lastName.trim(),
        company:             data.company.trim(),
        phone:               data.phone.trim(),
        siret:               data.siret.trim(),
        vatNumber:           data.vatNumber?.trim() || null,
        kbisPath,
        registrationMessage: data.registrationMessage?.trim() || null,
        role:                "CLIENT",
        status:              autoApproved ? "APPROVED" : "PENDING",
      },
    });

    // ── Marquer le code d'accès comme utilisé ──────────────────────────
    if (autoApproved && accessCodeCookie) {
      await prisma.accessCode.update({
        where: { code: accessCodeCookie },
        data: {
          usedBy: newUser.id,
          usedByName: `${newUser.firstName} ${newUser.lastName}`,
          usedAt: new Date(),
        },
      });
    }

    // Notification admin (email + Kbis en pièce jointe si fourni) — non bloquant
    notifyNewClientRegistration({
      firstName:           newUser.firstName,
      lastName:            newUser.lastName,
      company:             newUser.company,
      email:               newUser.email,
      phone:               newUser.phone,
      siret:               newUser.siret,
      kbisPath:            newUser.kbisPath ?? undefined,
      registrationMessage: newUser.registrationMessage ?? undefined,
    }).catch((err) =>
      console.error("[POST /api/auth/register] Notification échouée :", err)
    );

    const message = autoApproved
      ? "Votre compte a été créé et activé automatiquement. Vous pouvez vous connecter dès maintenant."
      : "Votre demande d'accès a bien été enregistrée. Notre équipe va examiner votre dossier et vous contactera par email.";

    const response = NextResponse.json({ message, autoApproved }, { status: 201 });

    // Supprimer le cookie access code après inscription
    if (autoApproved) {
      response.cookies.set("bj_access_code", "", { maxAge: 0, path: "/" });
    }

    return response;
  } catch (error) {
    console.error("[POST /api/auth/register]", error);
    return NextResponse.json(
      { error: "Une erreur serveur est survenue. Veuillez réessayer." },
      { status: 500 }
    );
  }
}
