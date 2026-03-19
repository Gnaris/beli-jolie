import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const wb = XLSX.utils.book_new();

  const sampleData = [
    // ── Produit simple : 1 couleur, UNIT uniquement ──
    {
      reference: "BJ-001",
      name: "Collier Étoile",
      description: "Collier fin avec pendentif étoile",
      category: "Colliers",
      sub_categories: "Sautoir",
      color: "Doré",
      sale_type: "UNIT",
      unit_price: 12.50,
      pack_qty: "",
      stock: 200,
      weight_g: 30,
      is_primary: "true",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "étoile,fin,tendance",
      composition: "Acier inoxydable:100",
      similar_refs: "BJ-002,BJ-003",
    },
    // ── Produit multi-variantes : couleur Doré en UNIT ──
    {
      reference: "BJ-002",
      name: "Bracelet Jonc Classique",
      description: "Bracelet jonc ajustable, finition polie",
      category: "Bracelets",
      sub_categories: "Jonc,Ajustable",
      color: "Doré",
      sale_type: "UNIT",
      unit_price: 8.99,
      pack_qty: "",
      stock: 500,
      weight_g: 45,
      is_primary: "true",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "jonc,classique,ajustable",
      composition: "Acier inoxydable:85,Or:15",
      similar_refs: "BJ-001,BJ-003",
    },
    // ── Même produit : couleur Doré en PACK ──
    {
      reference: "BJ-002",
      name: "Bracelet Jonc Classique",
      description: "",
      category: "",
      sub_categories: "",
      color: "Doré",
      sale_type: "PACK",
      unit_price: 7.50,
      pack_qty: 12,
      stock: 100,
      weight_g: 45,
      is_primary: "",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "",
      composition: "",
      similar_refs: "",
    },
    // ── Même produit : couleur Argenté en UNIT ──
    {
      reference: "BJ-002",
      name: "Bracelet Jonc Classique",
      description: "",
      category: "",
      sub_categories: "",
      color: "Argenté",
      sale_type: "UNIT",
      unit_price: 8.99,
      pack_qty: "",
      stock: 300,
      weight_g: 45,
      is_primary: "",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "",
      composition: "",
      similar_refs: "",
    },
    // ── Même produit : couleur Argenté en PACK ──
    {
      reference: "BJ-002",
      name: "Bracelet Jonc Classique",
      description: "",
      category: "",
      sub_categories: "",
      color: "Argenté",
      sale_type: "PACK",
      unit_price: 7.50,
      pack_qty: 12,
      stock: 80,
      weight_g: 45,
      is_primary: "",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "",
      composition: "",
      similar_refs: "",
    },
    // ── Même produit : couleur Or Rose en UNIT ──
    {
      reference: "BJ-002",
      name: "Bracelet Jonc Classique",
      description: "",
      category: "",
      sub_categories: "",
      color: "Or Rose",
      sale_type: "UNIT",
      unit_price: 9.99,
      pack_qty: "",
      stock: 200,
      weight_g: 45,
      is_primary: "",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "",
      composition: "",
      similar_refs: "",
    },
    // ── Produit avec variante multi-couleurs ──
    {
      reference: "BJ-003",
      name: "Bague Trio",
      description: "Bague tricolore empilable",
      category: "Bagues",
      sub_categories: "",
      color: "Doré/Argenté/Or Rose",
      sale_type: "UNIT",
      unit_price: 6.50,
      pack_qty: "",
      stock: 150,
      weight_g: 15,
      is_primary: "true",
      discount_type: "",
      discount_value: "",
      size: "17",
      tags: "trio,empilable",
      composition: "",
      similar_refs: "BJ-002",
    },
    // ── Même produit : PACK de la variante multi-couleurs ──
    {
      reference: "BJ-003",
      name: "Bague Trio",
      description: "",
      category: "",
      sub_categories: "",
      color: "Doré/Argenté/Or Rose",
      sale_type: "PACK",
      unit_price: 5.50,
      pack_qty: 24,
      stock: 40,
      weight_g: 15,
      is_primary: "",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "",
      composition: "",
      similar_refs: "",
    },
    // ── Produit avec remise ──
    {
      reference: "BJ-004",
      name: "Boucles Créoles",
      description: "",
      category: "Boucles d'oreilles",
      sub_categories: "",
      color: "Doré",
      sale_type: "UNIT",
      unit_price: 5.99,
      pack_qty: "",
      stock: 800,
      weight_g: 20,
      is_primary: "true",
      discount_type: "PERCENT",
      discount_value: 10,
      size: "",
      tags: "créoles",
      composition: "Acier inoxydable:100",
      similar_refs: "BJ-002,BJ-003",
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);

  ws["!cols"] = [
    { wch: 12 }, { wch: 25 }, { wch: 35 }, { wch: 18 },
    { wch: 20 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 25 },
    { wch: 30 }, { wch: 20 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Produits");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template-produits.xlsx"',
    },
  });
}
