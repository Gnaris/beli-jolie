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
import VatExemptionToggle from "@/components/admin/users/VatExemptionToggle";
import ClientCartPanel from "@/components/admin/users/ClientCartPanel";
import ClientOrdersPanel from "@/components/admin/users/ClientOrdersPanel";
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
  const totalSpent = orders.reduce((s, o) => s + Number(o.totalTTC), 0);
  const cartItemCount = cart?.items.length ?? 0;
  const cartTotal = (cart?.items ?? []).reduce((sum, item) => {
    return sum + Number(item.variant.unitPrice) * item.quantity;
  }, 0);

  // Résumé remise pour le KPI
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

  return (
    <div className="space-y-8">
      <AutoRefresh intervalMs={10_000} />

      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-2 text-sm text-text-muted" aria-label="Fil d'Ariane">
        <Link href="/admin" className="hover:text-text-primary transition-colors">Dashboard</Link>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <Link href="/admin/utilisateurs" className="hover:text-text-primary transition-colors">Clients</Link>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="text-text-primary font-medium">{user.firstName} {user.lastName}</span>
      </nav>

      {/* ═══════════════════════ HERO CLIENT ═══════════════════════ */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:p-6 flex flex-col lg:flex-row lg:items-start justify-between gap-4 sm:gap-6">
          <div className="flex items-start gap-4 sm:gap-5 min-w-0">
            <div className="w-14 h-14 sm:w-[72px] sm:h-[72px] rounded-2xl sm:rounded-[22px] bg-bg-tertiary border border-border flex items-center justify-center shrink-0">
              <span className="font-heading text-xl sm:text-[26px] font-bold text-text-primary">
                {user.firstName.charAt(0)}{user.lastName.charAt(0)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="font-heading text-xl sm:text-2xl font-bold text-text-primary m-0 break-words">
                  {user.firstName} {user.lastName}
                </h1>
                <span className={statusCfg.className}>{statusCfg.label}</span>
                {userIsOnline && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold"
                    title="Ce client est actuellement sur le site"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    En ligne
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-text-secondary break-words">
                <span className="font-medium text-text-primary">{user.company}</span>
                <span className="text-text-muted"> · Inscrit·e le {formattedDate}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <UserStatusActions userId={user.id} status={user.status} />
          </div>
        </div>

        {/* KPI bento */}
        <div className="border-t border-border p-3 sm:p-4 grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <KpiBento
            label="Commandes passées"
            value={totalOrders.toString()}
            icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /></svg>}
          />
          <KpiBento
            label="Total dépensé"
            value={`${totalSpent.toFixed(0)} €`}
            icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>}
          />
          <KpiBento
            label="Articles au panier"
            value={cartItemCount.toString()}
            icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272" /></svg>}
          />
          <KpiBento
            label={discountSummary.hint}
            value={discountSummary.value}
            icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /></svg>}
          />
        </div>
      </div>

      {/* ═══════════════════════ SECTION 1 : FICHE ENTREPRISE ═══════════════════════ */}
      <section>
        <SectionTitle title="Fiche entreprise" hint="identité, documents, message" />

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-6">

          {/* Coordonnées (8/12 sur xl, pleine largeur en dessous) */}
          <div className="card overflow-hidden xl:col-span-8">
            <CardHeader
              title="Coordonnées"
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>}
            />
            <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
              {/* Contact */}
              <div>
                <SubsectionTitle>Contact</SubsectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 sm:gap-x-6 gap-y-3 sm:gap-y-4">
                  <Field label="Prénom" value={user.firstName} />
                  <Field label="Nom" value={user.lastName} />
                  <Field label="Société" value={user.company} />
                  <Field label="Téléphone" value={user.phone} />
                  <div className="sm:col-span-2">
                    <Field label="Email" value={user.email} />
                  </div>
                </div>
              </div>

              <div className="border-t border-border-light -mx-6" />

              {/* Entreprise + VIES inline */}
              <div>
                <SubsectionTitle>Entreprise</SubsectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 sm:gap-x-6 gap-y-3 sm:gap-y-4">
                  <Field label="SIRET" value={user.siret || "—"} mono />
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
                  <div className="sm:col-span-2">
                    <Field label="Adresse" value={fullAddress || "—"} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Kbis (4/12 sur xl, pleine largeur en dessous) */}
          <div className="card overflow-hidden xl:col-span-4">
            <CardHeader
              title="Extrait Kbis"
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>}
              action={
                user.kbisPath ? (
                  <a href={kbisApiUrl} download={kbisFilename} className="btn-ghost text-xs py-1.5 px-3">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    Télécharger
                  </a>
                ) : null
              }
            />
            <div className="p-4">
              {user.kbisPath ? (
                isPdf ? (
                  <iframe src={kbisApiUrl} title="Extrait Kbis" className="w-full h-56 border-0 rounded-lg" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={kbisApiUrl} alt={`Kbis de ${user.company}`} className="w-full h-auto max-h-56 object-contain rounded-lg" />
                )
              ) : (
                <div className="rounded-xl bg-bg-tertiary border border-border flex items-center justify-center h-56">
                  <div className="text-center">
                    <div className="w-10 h-10 rounded-full bg-bg-secondary flex items-center justify-center mx-auto mb-2">
                      <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <p className="text-xs text-text-muted">Aucun Kbis fourni</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Message d'inscription (full width) */}
        {user.registrationMessage && (
          <div className="card overflow-hidden mt-6">
            <CardHeader
              title="Message d'inscription"
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>}
              badge={<span className="badge badge-neutral text-[11px]">À l&apos;inscription</span>}
            />
            <div className="p-5">
              <div className="rounded-xl bg-bg-tertiary border border-border p-4">
                <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{user.registrationMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Communications marketing (newsletter opt-in / opt-out) */}
        <div className="card overflow-hidden mt-6">
          <CardHeader
            title="Communications marketing"
            icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>}
            badge={
              <span className={user.acceptsNewsletter ? "badge badge-success text-[11px]" : "badge badge-neutral text-[11px]"}>
                {user.acceptsNewsletter ? "Abonné(e)" : "Désinscrit(e)"}
              </span>
            }
          />
          <div className="p-5">
            <AdminNewsletterToggle userId={user.id} initial={user.acceptsNewsletter} />
            <p className="text-[11px] text-text-muted mt-3 leading-relaxed">
              RGPD — cette case couvre la newsletter, les promotions et les relances de panier abandonné. Désinscription verbale par téléphone : basculer ci-dessus.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SECTION 2 : COMMERCE ═══════════════════════ */}
      <section>
        <SectionTitle title="Commerce" hint="remises appliquées à ce client" />

        <ClientDiscountsPanel
          userId={user.id}
          initialDiscountType={user.discountType ?? null}
          initialDiscountValue={user.discountValue != null ? Number(user.discountValue) : null}
          initialDiscountMode={user.discountMode ?? null}
          initialDiscountMinAmount={user.discountMinAmount != null ? Number(user.discountMinAmount) : null}
          initialDiscountMinQuantity={user.discountMinQuantity ?? null}
          initialFreeShipping={user.freeShipping}
          initialShippingDiscountType={user.shippingDiscountType ?? null}
          initialShippingDiscountValue={user.shippingDiscountValue != null ? Number(user.shippingDiscountValue) : null}
          initialShippingDiscountMode={user.shippingDiscountMode ?? null}
          initialShippingDiscountMinAmount={user.shippingDiscountMinAmount != null ? Number(user.shippingDiscountMinAmount) : null}
          initialShippingDiscountMinQuantity={user.shippingDiscountMinQuantity ?? null}
        />

        <div className="mt-6">
          <VatExemptionToggle
            userId={user.id}
            initialExempt={user.vatExempt}
            validatedAt={user.vatValidatedAt}
            validatedByLabel={validatedByLabel}
            countryCode={user.addressCountry}
          />
        </div>
      </section>

      {/* ═══════════════════════ SECTION 3 : ACTIVITÉ ═══════════════════════ */}
      <section>
        <SectionTitle title="Activité" hint="panier en cours & historique des commandes" />

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-6">
          <div className="xl:col-span-5">
            <ClientCartPanel items={cartItemsSerialized} cartTotal={cartTotal} />
          </div>
          <div className="xl:col-span-7">
            <ClientOrdersPanel orders={ordersSerialized} />
          </div>
        </div>
      </section>

      {/* ═══════════════════════ ZONE DANGEREUSE ═══════════════════════ */}
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
}

// ─── Primitives locales ─────────────────────────────────────────────────

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <span className="w-1 h-5 rounded-full bg-text-primary shrink-0" />
      <h2 className="font-heading text-base sm:text-lg font-bold text-text-primary m-0">{title}</h2>
      {hint && <span className="text-xs text-text-muted hidden sm:inline">· {hint}</span>}
    </div>
  );
}

function CardHeader({
  title, icon, action, badge,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 border-b border-border bg-bg-secondary flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-primary shrink-0">{icon}</span>
        <h3 className="font-heading text-sm font-semibold text-text-primary truncate">{title}</h3>
      </div>
      {(action || badge) && (
        <div className="flex items-center gap-2 shrink-0">
          {badge}
          {action}
        </div>
      )}
    </div>
  );
}

function SubsectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-0.5 h-3 rounded-full bg-border-strong" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{children}</span>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1">{label}</p>
      <p className={`text-sm text-text-primary ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function KpiBento({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-3 sm:p-4 rounded-xl border border-border bg-bg-primary">
      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-primary mb-2">
        {icon}
      </div>
      <p className="font-heading text-lg sm:text-2xl font-bold text-text-primary tabular-nums leading-none break-all">{value}</p>
      <p className="text-[10px] sm:text-[11px] text-text-muted mt-1 leading-tight">{label}</p>
    </div>
  );
}
