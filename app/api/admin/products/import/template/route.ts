import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as XLSX from "xlsx";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Build sample Excel workbook
  const wb = XLSX.utils.book_new();

  const sampleData = [
    {
      reference: "REF001",
      name: "Bracelet Doré",
      description: "Description du produit (optionnel)",
      category: "Bracelets",
      color: "Doré",
      sale_type: "UNIT",
      unit_price: 25.99,
      pack_qty: "",
      stock: 100,
      weight_g: 50,
      is_primary: "true",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "bijou,bracelet,doré",
      composition: "Acier inoxydable:85,Or:15",
    },
    {
      reference: "REF001",
      name: "Bracelet Doré",
      description: "Description du produit (optionnel)",
      category: "Bracelets",
      color: "Argenté",
      sale_type: "UNIT",
      unit_price: 22.99,
      pack_qty: "",
      stock: 80,
      weight_g: 50,
      is_primary: "false",
      discount_type: "",
      discount_value: "",
      size: "",
      tags: "bijou,bracelet",
      composition: "Acier inoxydable:100",
    },
    {
      reference: "REF002",
      name: "Collier Pack",
      description: "Collier vendu par lot",
      category: "Colliers",
      color: "Or Rose",
      sale_type: "PACK",
      unit_price: 18.0,
      pack_qty: 12,
      stock: 240,
      weight_g: 30,
      is_primary: "true",
      discount_type: "PERCENT",
      discount_value: 10,
      size: "",
      tags: "collier,pack",
      composition: "Acier:80,Or:20",
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);

  // Set column widths
  ws["!cols"] = [
    { wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 15 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
    { wch: 14 }, { wch: 10 }, { wch: 25 }, { wch: 30 },
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
