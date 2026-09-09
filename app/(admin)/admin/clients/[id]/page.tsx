import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UserStatusActions from "@/components/admin/users/UserStatusActions";
import DeleteUserButton from "@/components/admin/users/DeleteUserButton";
import ClientDiscountsPanel from "@/components/admin/users/ClientDiscountsPanel";
import VerifyViesInline from "@/components/admin/users/VerifyViesInline";
import VatExemptionHeaderToggle from "@/components/admin/users/VatExemptionHeaderToggle";
import ClientCartPanel from "@/components/admin/users/ClientCartPanel";
import ClientOrdersPanel from "@/components/admin/users/ClientOrdersPanel";
import ClientDetailTabs from "@/components/admin/users/ClientDetailTabs";
import AutoRefresh from "@/components/admin/users/AutoRefresh";
import AdminNewsletterToggle from "@/components/admin/users/AdminNewsletterToggle";
import { getCountry } from "@/lib/vat";
import { isOnline } from "@/lib/online-status";
import type { UserStatus } from "@prisma/client";

// Le badge « En ligne » doit refléter le `lastSeenAt` à la seconde
export const dynamic = "force-dynamic";

const STATUS_CONFIG: Record<UserStatus, { label: string; className: string }> = {
  PENDING:  { label: "En attente",  className: "badge badge-warning" },
  APPROVED: { label: "Approuvé",    className: "badge badge-success" },
  REJECTED: { label: "Rejeté",      className: "badge badge-error" },
};

const DISCOUNT_MODE_LABEL: Record<string, string> = {
  PERMANENT:  "Permanente",
  THRESHOLD:  "Sous conditions",
  NEXT_ORDER: "Prochaine cmd",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { firstName: true, lastName: true },
  });
  return {
    title: user
      ? `${user.firstName} ${user.lastName} — Admin`
      : "Dossier client — Admin",
  };
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;

  const [user, cart, orders] = await Promise.all([
    prisma.user.findUnique({ where: { id } }),
    prisma.cart.findUnique({
      where: { userId: id },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: { select: { name: true, reference: true } },
                color:   { select: { name: true, hex: true } },
                variantSizes: { include: { size: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    prisma.order.findMany({
      where: { userId: id },
      include: {
        _count: { select: { items: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Cart images
  const cartImagePairs = (cart?.items ?? [])
    .filter((item) => item.variant.colorId != null)
    .map((item) => ({
      productId: item.variant.productId,
      colorId:   item.variant.colorId!,
    }));
  const cartColorImages = cartImagePairs.length > 0
    ? await prisma.productColorImage.findMany({
        where: {
          OR: cartImagePairs.map(({ productId, colorId }) => ({ productId, colorId })),
        },
        orderBy: { order: "asc" },
      })
    : [];
  const cartImageMap = new Map<string, string>();
  for (const img of cartColorImages) {
    const key = `${img.productId}::${img.colorId}`;
    if (!cartImageMap.has(key)) cartImageMap.set(key, img.path);
  }

  if (!user || user.role === "ADMIN") notFound();

  const validatorAdmin = user.vatValidatedBy
    ? await prisma.user.findUnique({
        where: { id: user.vatValidatedBy },
        select: { firstName: true, lastName: true, email: true },
      })
    : null;
  const validatedByLabel = validatorAdmin
    ? `${validatorAdmin.firstName} ${validatorAdmin.lastName}`.trim() || validatorAdmin.email
    : null;
  const userCountryName = getCountry(user.addressCountry)?.name ?? user.addressCountry ?? null;
  const fullAddress = [
    user.addressStreet,
    user.addressComplement,
    [user.addressZip, user.addressCity].filter(Boolean).join(" "),
    userCountryName,
  ]
    .filter(Boolean)
    .join(" — ");

  const statusCfg = STATUS_CONFIG[user.status];
  const userIsOnline = isOnline(user.lastSeenAt);

  const kbisFilename = user.kbisPath?.split("/").pop() ?? "";
  const kbisApiUrl  = `/api/admin/kbis/${kbisFilename}`;
  const kbisExt     = kbisFilename.split(".").pop()?.toLowerCase() ?? "";
  const isPdf       = kbisExt === "pdf";

  const formattedDate = new Date(user.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  const totalOrders = orders.length;
  const totalSpent = orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((s, o) => s + Number(o.totalTTC), 0);
  const cartItemCount = cart?.items.length ?? 0;
  const cartTotal = (cart?.items ?? []).reduce((sum, item) => {
    return sum + Number(item.variant.unitPrice) * item.quantity;
  }, 0);

  const discountSummary = (() => {
    if (user.discountType && user.discountValue != null) {
      const sign = user.discountType === "PERCENT" ? "%" : "€";
      const mode = DISCOUNT_MODE_LABEL[user.discountMode ?? "PERMANENT"];
      return { value: `−${Number(user.discountValue)} ${sign}`, hint: mode };
    }
    return { value: "—", hint: "Pas de remise" };
  })();

  // Panier serialize
  const cartItemsSerialized = (cart?.items ?? []).map((item) => {
    const v = item.variant;
    return {
      id: item.id,
      productName: v.product.name,
      productRef: v.product.reference,
      colorName: v.color?.name ?? null,
      colorHex: v.color?.hex ?? null,
      saleType: v.saleType,
      packQuantity: v.packQuantity,
      unitPrice: Number(v.unitPrice),
      quantity: item.quantity,
      sizes: v.variantSizes.map((vs: { size: { name: string }; quantity: number }) => ({
        name: vs.size.name,
        quantity: vs.quantity,
      })),
      imagePath: cartImageMap.get(`${v.productId}::${v.colorId}`) ?? null,
    };
  });

  // Orders serialize
  const ordersSerialized = orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    itemCount: order._count.items,
    subtotalHT: Number(order.subtotalHT),
    tvaAmount: Number(order.tvaAmount),
    totalTTC: Number(order.totalTTC),
    carrierName: order.carrierName,
    carrierPrice: Number(order.carrierPrice),
    clientDiscountAmt: Number(order.clientDiscountAmt ?? 0),
    clientDiscountType: order.clientDiscountType,
    clientDiscountValue: order.clientDiscountValue != null ? Number(order.clientDiscountValue) : null,
    clientFreeShipping: order.clientFreeShipping,
    shipFirstName: order.shipFirstName,
    shipLastName: order.shipLastName,
    shipCompany: order.shipCompany,
    shipAddress1: order.shipAddress1,
    shipAddress2: order.shipAddress2,
    shipZipCode: order.shipZipCode,
    shipCity: order.shipCity,
    shipCountry: order.shipCountry,
    items: order.items.map((oi) => ({
      id: oi.id,
      productName: oi.productName,
      productRef: oi.productRef,
      colorName: oi.colorName,
      saleType: oi.saleType,
      packQty: oi.packQty,
      sizesJson: oi.sizesJson,
      unitPrice: Number(oi.unitPrice),
      quantity: oi.quantity,
      lineTotal: Number(oi.lineTotal),
      imagePath: oi.imagePath,
    })),
  }));

  const lastOrderDate = orders.length > 0
    ? new Date(orders[0].createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })
    : null;
  const avgBasket = orders.length > 0 ? totalSpent / orders.filter((o) => o.status !== "CANCELLED").length : 0;

  // ═══════════════════════ PANELS ═══════════════════════

  const dashboardPanel = (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Commandes" value={totalOrders.toString()}
          hint={lastOrderDate ? `Dernière le ${lastOrderDate}` : "Aucune"} />
        <KpiCard label="Dépensé" value={`${totalSpent.toFixed(0)} €`}
          hint={avgBasket > 0 ? `Panier moyen ${avgBasket.toFixed(0)} €` : "—"} />
        <KpiCard label="Panier actuel" value={cartItemCount.toString()}
          hint={cartItemCount > 0 ? `${cartTotal.toFixed(0)} € en attente` : "Vide"} />
        <KpiCard label="Remise" value={discountSummary.value} hint={discountSummary.hint} />
      </div>

      {/* Coordonnées (2/3) + Kbis (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-heading text-lg font-bold text-text-primary">Coordonnées</h2>
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-3">Contact</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-6">
            <MiniField label="Prénom" value={user.firstName} />
            <MiniField label="Nom" value={user.lastName} />
            <div className="sm:col-span-2"><MiniField label="Email" value={user.email} /></div>
            <MiniField label="Téléphone" value={user.phone} />
            <MiniField label="Société" value={user.company} />
          </div>

          <div className="h-px bg-border mb-6" />

          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-3">Entreprise</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <MiniField label="SIRET" value={user.siret || "—"} mono />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1">N° TVA intra</p>
              <VerifyViesInline
                vatNumber={user.vatNumber}
                userId={user.id}
                initial={{
                  viesValid: user.viesValid ?? null,
                  viesName: user.viesName ?? null,
                  viesAddress: user.viesAddress ?? null,
                  viesRequestDate: user.viesRequestDate ?? null,
                  viesError: user.viesError ?? null,
                }}
              />
            </div>
            <div className="sm:col-span-2"><MiniField label="Adresse" value={fullAddress || "—"} /></div>
          </div>
        </div>

        {/* Kbis */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-lg font-bold text-text-primary">Extrait Kbis</h2>
            {user.kbisPath && (
              <a
                href={kbisApiUrl}
                download={kbisFilename}
                className="text-xs text-text-muted hover:text-text-primary inline-flex items-center gap-1 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Télécharger
              </a>
            )}
          </div>
          {user.kbisPath ? (
            isPdf ? (
              <iframe src={kbisApiUrl} title="Extrait Kbis" className="w-full h-64 border border-border rounded-xl" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={kbisApiUrl} alt={`Kbis de ${user.company}`} className="w-full h-auto max-h-64 object-contain rounded-xl border border-border" />
            )
          ) : (
            <div className="rounded-xl bg-bg-tertiary border border-border flex items-center justify-center h-64">
              <div className="text-center">
                <svg className="w-8 h-8 text-text-muted mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="text-xs text-text-muted">Aucun Kbis fourni</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Message d'inscription */}
      {user.registrationMessage && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-lg font-bold text-text-primary">Message d&apos;inscription</h2>
            <span className="badge badge-neutral text-[11px]">À l&apos;inscription</span>
          </div>
          <div className="rounded-xl bg-bg-tertiary border border-border p-4">
            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{user.registrationMessage}</p>
          </div>
        </div>
      )}

      {/* Communications marketing */}
      <div className="card p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-bold text-text-primary">Communications marketing</h2>
            <p className="text-sm text-text-secondary mt-0.5">Newsletter, promos et relances de panier abandonné</p>
          </div>
          <AdminNewsletterToggle userId={user.id} initial={user.acceptsNewsletter} />
        </div>
        <p className="text-[11px] text-text-muted mt-3 leading-relaxed">
          RGPD — cette case couvre la newsletter, les promotions et les relances de panier abandonné. Désinscription verbale par téléphone : basculer ci-dessus.
        </p>
      </div>

      {/* Zone dangereuse */}
      <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center">
              <svg className="w-5 h-5 text-rose-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3v.008m-9.75-4.005a11.955 11.955 0 019.75-8.995 11.955 11.955 0 019.75 8.995 11.955 11.955 0 01-19.5 0z" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-semibold text-rose-900">Supprimer ce client</p>
              <p className="text-xs text-rose-800 mt-0.5">Action irréversible — toutes les données (commandes, panier, messages…) seront effacées.</p>
            </div>
          </div>
          <DeleteUserButton userId={user.id} userName={`${user.firstName} ${user.lastName}`} />
        </div>
      </div>
    </div>
  );

  const cartPanel = (
    <ClientCartPanel items={cartItemsSerialized} cartTotal={cartTotal} />
  );

  const marketingPanel = (
    <ClientDiscountsPanel
      userId={user.id}
      initialDiscountType={user.discountType ?? null}
      initialDiscountValue={user.discountValue != null ? Number(user.discountValue) : null}
      initialDiscountMode={user.discountMode ?? null}
      initialDiscountMinAmount={user.discountMinAmount != null ? Number(user.discountMinAmount) : null}
      initialDiscountMinQuantity={user.discountMinQuantity ?? null}
      initialFreeShipping={user.freeShipping}
      initialFreeShippingMaxPrice={user.freeShippingMaxPrice != null ? Number(user.freeShippingMaxPrice) : null}
      initialShippingDiscountType={user.shippingDiscountType ?? null}
      initialShippingDiscountValue={user.shippingDiscountValue != null ? Number(user.shippingDiscountValue) : null}
      initialShippingDiscountMode={user.shippingDiscountMode ?? null}
      initialShippingDiscountMinAmount={user.shippingDiscountMinAmount != null ? Number(user.shippingDiscountMinAmount) : null}
      initialShippingDiscountMinQuantity={user.shippingDiscountMinQuantity ?? null}
    />
  );

  const ordersPanel = (
    <ClientOrdersPanel orders={ordersSerialized} />
  );

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={10_000} />

      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-xs text-text-muted" aria-label="Fil d'Ariane">
        <Link href="/admin" className="hover:text-text-primary transition-colors">Admin</Link>
        <span>/</span>
        <Link href="/admin/clients" className="hover:text-text-primary transition-colors">Clients</Link>
        <span>/</span>
        <span className="text-text-primary font-medium">{user.firstName} {user.lastName}</span>
      </nav>

      {/* ═══════════════════════ HEADER CLIENT (minimal) ═══════════════════════ */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 rounded-full bg-bg-tertiary border border-border flex items-center justify-center shrink-0">
            <span className="font-heading text-lg font-bold text-text-primary">
              {user.firstName.charAt(0)}{user.lastName.charAt(0)}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary leading-tight m-0 break-words">
              {user.firstName} {user.lastName}
            </h1>
            <div className="flex items-center gap-2 text-sm text-text-secondary mt-1 flex-wrap">
              <span className="text-text-primary font-medium">{user.company}</span>
              <span className="text-text-muted">·</span>
              <span className="text-text-muted">Cliente depuis le {formattedDate}</span>
              {userIsOnline && (
                <>
                  <span className="text-text-muted">·</span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    En ligne
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <span className={statusCfg.className}>{statusCfg.label}</span>
          <VatExemptionHeaderToggle
            userId={user.id}
            initialExempt={user.vatExempt}
            validatedAt={user.vatValidatedAt}
            validatedByLabel={validatedByLabel}
            countryCode={user.addressCountry}
          />
          <UserStatusActions userId={user.id} status={user.status} />
        </div>
      </div>

      {/* ═══════════════════════ TABS ═══════════════════════ */}
      <ClientDetailTabs
        cartCount={cartItemCount}
        ordersCount={totalOrders}
        dashboardPanel={dashboardPanel}
        cartPanel={cartPanel}
        marketingPanel={marketingPanel}
        ordersPanel={ordersPanel}
      />
    </div>
  );
}

// ─── Primitives locales ─────────────────────────────────────────────────

function MiniField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1">{label}</p>
      <p className={`text-sm text-text-primary ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-3">{label}</p>
      <p className="text-2xl sm:text-3xl font-semibold text-text-primary tabular-nums leading-none tracking-tight break-all">
        {value}
      </p>
      <p className="text-xs text-text-muted mt-2">{hint}</p>
    </div>
  );
}
