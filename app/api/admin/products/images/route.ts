import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import path from "path";
import fs from "fs/promises";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/admin/products/images
 *
 * Upload d'une image de produit.
 * Sauvegarde dans /public/uploads/products/ (accessible publiquement pour la vitrine).
 * Retourne le chemin relatif à utiliser dans la base de données.
 *
 * Sécurité : réservé aux ADMIN
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("image") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
  }

  // Vérification du type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté. Accepté : JPG, PNG, WEBP." },
      { status: 400 }
    );
  }

  // Limite taille : 3 Mo par image
  if (file.size > 3 * 1024 * 1024) {
    return NextResponse.json(
      { error: "L'image ne doit pas dépasser 3 Mo." },
      { status: 400 }
    );
  }

  // Création du dossier de destination
  const uploadDir = path.join(process.cwd(), "public", "uploads", "products");
  await fs.mkdir(uploadDir, { recursive: true });

  // Nom de fichier unique
  const ext      = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const filename = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filepath = path.join(uploadDir, filename);

  // Écriture du fichier
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filepath, buffer);

  // Chemin public retourné
  const publicPath = `/uploads/products/${filename}`;

  return NextResponse.json({ path: publicPath }, { status: 201 });
}
