import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as ExcelJS from "exceljs";

// ── Design tokens ──
const COLORS = {
  dark: "1A1A1A",
  white: "FFFFFF",
  surface: "F7F7F8",
  border: "E5E5E5",
  green: "22C55E",
  greenLight: "DCFCE7",
  amber: "F59E0B",
  blue: "3B82F6",
  grayMed: "6B7280",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  PROCESSING: "En préparation",
  SHIPPED: "Expédiée",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: "En attente",
  paid: "Payé",
  failed: "Échoué",
};

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const q = searchParams.get("q");

  // Build where clause matching the page filters
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo + "T23:59:59.999Z") } : {}),
    };
  }
  if (q) {
    where.OR = [
      { orderNumber: { contains: q } },
      { clientCompany: { contains: q } },
      { clientEmail: { contains: q } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      orderNumber: true,
      createdAt: true,
      clientCompany: true,
      clientEmail: true,
      status: true,
      subtotalHT: true,
      tvaAmount: true,
      totalTTC: true,
      paymentStatus: true,
      carrierName: true,
      eeTrackingId: true,
    },
  });

  // ── Build workbook ──
  const wb = new ExcelJS.Workbook();
  wb.creator = "Admin";
  wb.created = new Date();

  const ws = wb.addWorksheet("Commandes", {
    properties: { tabColor: { argb: COLORS.dark } },
    views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
  });

  // Column definitions
  const columns: { header: string; key: string; width: number }[] = [
    { header: "N° Commande", key: "orderNumber", width: 22 },
    { header: "Date", key: "date", width: 14 },
    { header: "Client (entreprise)", key: "clientCompany", width: 28 },
    { header: "Email", key: "clientEmail", width: 30 },
    { header: "Statut", key: "status", width: 16 },
    { header: "Montant HT", key: "subtotalHT", width: 14 },
    { header: "TVA", key: "tvaAmount", width: 12 },
    { header: "Montant TTC", key: "totalTTC", width: 14 },
    { header: "Mode paiement", key: "paymentStatus", width: 16 },
    { header: "Transporteur", key: "carrierName", width: 20 },
    { header: "N° Suivi", key: "trackingId", width: 22 },
  ];

  ws.columns = columns;

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: COLORS.white },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.dark },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.dark } },
      bottom: { style: "medium", color: { argb: COLORS.dark } },
      left: { style: "thin", color: { argb: COLORS.dark } },
      right: { style: "thin", color: { argb: COLORS.dark } },
    };
  });

  // Data rows
  const borderThin: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: COLORS.border } },
    bottom: { style: "thin", color: { argb: COLORS.border } },
    left: { style: "thin", color: { argb: COLORS.border } },
    right: { style: "thin", color: { argb: COLORS.border } },
  };

  for (const order of orders) {
    const row = ws.addRow({
      orderNumber: order.orderNumber,
      date: new Date(order.createdAt).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      clientCompany: order.clientCompany,
      clientEmail: order.clientEmail,
      status: STATUS_LABELS[order.status] ?? order.status,
      subtotalHT: Number(order.subtotalHT),
      tvaAmount: Number(order.tvaAmount),
      totalTTC: Number(order.totalTTC),
      paymentStatus: PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus,
      carrierName: order.carrierName,
      trackingId: order.eeTrackingId ?? "",
    });

    const isEven = row.number % 2 === 0;
    row.height = 22;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: "Calibri", size: 10, color: { argb: COLORS.dark } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? COLORS.surface : COLORS.white },
      };
      cell.border = borderThin;
      cell.alignment = { vertical: "middle" };

      // Number formatting for currency columns
      if ([6, 7, 8].includes(colNumber)) {
        cell.numFmt = '#,##0.00 "€"';
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }

      // Center date, status, payment
      if ([2, 5, 9].includes(colNumber)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  }

  // Auto-filter
  if (orders.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  // Generate buffer
  const buffer = await wb.xlsx.writeBuffer();

  const dateStr = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="commandes-${dateStr}.xlsx"`,
    },
  });
}
