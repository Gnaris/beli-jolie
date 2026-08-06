import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentTenant } from "@/lib/tenant";
import { countryName } from "@/lib/countries";

const API_KEY = "kebab";
const ALLOWED_TENANT_SLUG = "beliandjolie";
const PUBLIC_ORIGIN = "https://beliandjolie.com";
const PER_PAGE = 50;
const MAX_PER_PAGE = 200;

type ProductStatusFr =
  | "En ligne"
  | "Hors ligne"
  | "Brouillon"
  | "Archivé"
  | "En synchronisation";

function toStatusFr(status: string, isIncomplete: boolean): ProductStatusFr {
  if (status === "ONLINE") return "En ligne";
  if (status === "OFFLINE" && isIncomplete) return "Brouillon";
  if (status === "OFFLINE") return "Hors ligne";
  if (status === "ARCHIVED") return "Archivé";
  return "En synchronisation";
}

const STATUS_FILTER_MAP: Record<
  string,
  { status?: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING"; isIncomplete?: boolean }
> = {
  "en-ligne": { status: "ONLINE" },
  "hors-ligne": { status: "OFFLINE", isIncomplete: false },
  brouillon: { status: "OFFLINE", isIncomplete: true },
  archive: { status: "ARCHIVED" },
  synchronisation: { status: "SYNCING" },
};

const UNAUTHORIZED = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const NOT_FOUND = NextResponse.json({ error: "Not found" }, { status: 404 });

function checkAuth(request: NextRequest): boolean {
  return (request.headers.get("x-api-key") ?? "") === API_KEY;
}

async function checkTenant(): Promise<boolean> {
  const tenant = await getCurrentTenant();
  return tenant?.slug === ALLOWED_TENANT_SLUG;
}

// Toutes les images sont servies sur beliandjolie.com peu importe d'où on
// appelle l'API (évite les liens localhost:3000 en dev).
function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${PUBLIC_ORIGIN}${path.startsWith("/") ? "" : "/"}${path}`;
}

const productInclude = {
  category: { select: { name: true } },
  subCategories: { select: { name: true } },
  compositions: {
    include: { composition: { select: { name: true } } },
  },
  colors: {
    where: { disabled: false },
    orderBy: { isPrimary: "desc" as const },
    include: {
      color: { select: { name: true } },
      variantSizes: {
        orderBy: { size: { position: "asc" as const } },
        include: { size: { select: { name: true } } },
      },
    },
  },
  colorImages: {
    orderBy: { order: "asc" as const },
    select: { colorId: true, path: true },
  },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeProduct(p: any) {
  const imagesByColorId = new Map<string, string[]>();
  for (const img of p.colorImages ?? []) {
    if (!imagesByColorId.has(img.colorId)) imagesByColorId.set(img.colorId, []);
    imagesByColorId.get(img.colorId)!.push(img.path);
  }

  const dimensions = {
    length: p.dimensionLength ?? null,
    width: p.dimensionWidth ?? null,
    height: p.dimensionHeight ?? null,
    diameter: p.dimensionDiameter ?? null,
    circumference: p.dimensionCircumference ?? null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const composition = (p.compositions ?? []).map((c: any) => ({
    name: c.composition?.name ?? "",
    percent: c.percentage,
  }));

  const colorsMap = new Map<
    string,
    {
      name: string;
      imageUrls: string[];
      variants: {
        sku: string | null;
        saleType: "UNIT" | "PACK";
        packQuantity: number | null;
        price: number;
        stock: number;
        weightKg: number;
        sizes: { name: string; quantity: number }[];
      }[];
    }
  >();

  for (const v of p.colors ?? []) {
    if (!v.colorId) continue;
    if (!colorsMap.has(v.colorId)) {
      const paths = imagesByColorId.get(v.colorId) ?? [];
      colorsMap.set(v.colorId, {
        name: v.color?.name ?? "",
        imageUrls: paths.map((p) => absoluteUrl(p)!).filter(Boolean),
        variants: [],
      });
    }
    colorsMap.get(v.colorId)!.variants.push({
      sku: v.sku ?? null,
      saleType: v.saleType,
      packQuantity: v.packQuantity ?? null,
      price: Number(v.unitPrice),
      stock: v.stock ?? 0,
      weightKg: v.weight,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sizes: (v.variantSizes ?? []).map((vs: any) => ({
        name: vs.size?.name ?? "",
        quantity: vs.quantity,
      })),
    });
  }

  return {
    reference: p.reference,
    status: toStatusFr(p.status, p.isIncomplete ?? false),
    name: p.name,
    description: p.description,
    category: p.category?.name ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subCategories: (p.subCategories ?? []).map((s: any) => s.name),
    manufacturingCountry: countryName(p.countryIsoCode) || null,
    dimensions,
    composition,
    colors: [...colorsMap.values()],
  };
}

export async function GET(request: NextRequest) {
  if (!(await checkTenant())) return NOT_FOUND;
  if (!checkAuth(request)) return UNAUTHORIZED;

  // Recherche par référence via header : renvoie 1 seul produit (ou 404).
  const refFromHeader = request.headers.get("x-product-reference")?.trim() ?? "";
  if (refFromHeader) {
    const product = await prisma.product.findFirst({
      where: { reference: refFromHeader },
      include: productInclude,
    });
    if (!product) return NOT_FOUND;
    return NextResponse.json({ product: shapeProduct(product) });
  }

  // Sinon : liste paginée, avec filtre statut optionnel.
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const perPageRaw = parseInt(searchParams.get("perPage") ?? String(PER_PAGE), 10);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, isNaN(perPageRaw) ? PER_PAGE : perPageRaw));
  const statusFilterRaw = searchParams.get("status")?.trim().toLowerCase() ?? "";
  const statusFilter = STATUS_FILTER_MAP[statusFilterRaw];

  const where = {
    ...(statusFilter?.status && { status: statusFilter.status }),
    ...(statusFilter?.isIncomplete !== undefined && { isIncomplete: statusFilter.isIncomplete }),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: productInclude,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return NextResponse.json({
    page,
    perPage,
    total,
    totalPages,
    hasMore: page < totalPages,
    products: products.map(shapeProduct),
  });
}
