import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentTenant } from "@/lib/tenant";
import { countryName } from "@/lib/countries";

const API_KEY = "kebab";
const ALLOWED_TENANT_SLUG = "beliandjolie";
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

// Filtre `?status=` : slug URL-friendly → { status, isIncomplete? }
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
  const provided = request.headers.get("x-api-key") ?? "";
  return provided === API_KEY;
}

async function checkTenant(): Promise<boolean> {
  const tenant = await getCurrentTenant();
  return tenant?.slug === ALLOWED_TENANT_SLUG;
}

function absoluteUrl(request: NextRequest, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const origin = new URL(request.url).origin;
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
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
      color: { select: { name: true, hex: true, patternImage: true } },
      variantSizes: {
        orderBy: { size: { position: "asc" as const } },
        include: { size: { select: { name: true } } },
      },
    },
  },
  colorImages: {
    orderBy: { order: "asc" as const },
    select: { colorId: true, path: true, order: true },
  },
} as const;

function shapeProduct(
  request: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any,
) {
  const firstImageByColorId = new Map<string, string>();
  for (const img of p.colorImages ?? []) {
    if (!firstImageByColorId.has(img.colorId)) {
      firstImageByColorId.set(img.colorId, img.path);
    }
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
      colorId: string;
      name: string;
      hex: string | null;
      imageUrl: string | null;
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
      // Color.patternImage prioritaire sur hex + première image de la couleur
      const rawImage = v.color?.patternImage ?? firstImageByColorId.get(v.colorId) ?? null;
      colorsMap.set(v.colorId, {
        colorId: v.colorId,
        name: v.color?.name ?? "",
        hex: v.color?.hex ?? null,
        imageUrl: absoluteUrl(request, rawImage),
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

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const perPageRaw = parseInt(searchParams.get("perPage") ?? String(PER_PAGE), 10);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, isNaN(perPageRaw) ? PER_PAGE : perPageRaw));
  const reference = searchParams.get("reference")?.trim() ?? "";
  const statusFilterRaw = searchParams.get("status")?.trim().toLowerCase() ?? "";
  const statusFilter = STATUS_FILTER_MAP[statusFilterRaw];

  const where = {
    ...(reference && { reference }),
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

  const shaped = products.map((p) => shapeProduct(request, p));

  return NextResponse.json({
    page,
    perPage,
    total,
    hasMore: page * perPage < total,
    products: shaped,
  });
}
