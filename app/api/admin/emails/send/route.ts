import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { getCachedShopName, getCachedGmailConfig } from "@/lib/cached-data";

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MB total
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const gmailCfg = await getCachedGmailConfig();
  const GMAIL_USER = gmailCfg.gmailUser || process.env.GMAIL_USER;
  const GMAIL_PASSWORD = gmailCfg.gmailPassword || process.env.GMAIL_APP_PASSWORD;
  if (!GMAIL_USER || !GMAIL_PASSWORD) {
    return NextResponse.json(
      { error: "Configuration email manquante — configurer dans Paramètres > Notifications email" },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData();
    const toEmail = formData.get("toEmail") as string;
    const toName = formData.get("toName") as string | null;
    const userId = formData.get("userId") as string | null;
    const subject = formData.get("subject") as string;
    const htmlBody = formData.get("htmlBody") as string;

    if (!toEmail || !subject || !htmlBody) {
      return NextResponse.json(
        { error: "Champs requis : toEmail, subject, htmlBody" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(toEmail)) {
      return NextResponse.json({ error: "Adresse email invalide" }, { status: 400 });
    }

    // Process attachments
    const attachmentFiles = formData.getAll("attachments") as File[];
    const savedAttachments: { filename: string; path: string; size: number }[] = [];
    const nodemailerAttachments: { filename: string; path: string }[] = [];
    let totalSize = 0;

    const uploadDir = path.join(process.cwd(), "private/uploads/email-attachments");
    await fs.mkdir(uploadDir, { recursive: true });

    for (const file of attachmentFiles) {
      if (!(file instanceof File) || file.size === 0) continue;

      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: `Type de fichier non autorisé : ${file.name}` },
          { status: 400 }
        );
      }

      if (file.size > MAX_ATTACHMENT_SIZE) {
        return NextResponse.json(
          { error: `Fichier trop volumineux (max 10 Mo) : ${file.name}` },
          { status: 400 }
        );
      }

      totalSize += file.size;
      if (totalSize > MAX_TOTAL_SIZE) {
        return NextResponse.json(
          { error: "Taille totale des pièces jointes trop élevée (max 25 Mo)" },
          { status: 400 }
        );
      }

      const ext = path.extname(file.name) || ".bin";
      const uniqueName = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(uploadDir, uniqueName);

      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(filePath, buffer);

      savedAttachments.push({
        filename: file.name,
        path: `private/uploads/email-attachments/${uniqueName}`,
        size: file.size,
      });

      nodemailerAttachments.push({
        filename: file.name,
        path: filePath,
      });
    }

    // Build email HTML with shop name signature
    const shopName = await getCachedShopName();
    const fullHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
        ${htmlBody}
        <hr style="border:none;border-top:1px solid #E5E5E5;margin:32px 0 16px;" />
        <p style="color:#94A3B8;font-size:12px;">
          ${shopName} — Grossiste B2B
        </p>
      </div>
    `;

    // Send email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
    });

    await transporter.sendMail({
      from: `"${shopName}" <${GMAIL_USER}>`,
      to: toName ? `"${toName}" <${toEmail}>` : toEmail,
      subject,
      html: fullHtml,
      attachments: nodemailerAttachments,
    });

    // Save to database
    await prisma.sentEmail.create({
      data: {
        toEmail,
        toName,
        userId: userId || null,
        subject,
        htmlBody,
        attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
        adminId: session.user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[email/send] Erreur:", err);
    return NextResponse.json(
      { error: "Erreur lors de l'envoi de l'email" },
      { status: 500 }
    );
  }
}
