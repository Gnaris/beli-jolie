import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateUserStatus } from "@/app/actions/admin/updateUserStatus";
import DeleteUserButton from "@/components/admin/users/DeleteUserButton";
import ClientDiscountForm from "@/components/admin/users/ClientDiscountForm";
import VatVerificationCard from "@/components/admin/users/VatVerificationCard";
import CartModal from "@/components/admin/users/CartModal";
import OrdersModal from "@/components/admin/users/OrdersModal";
import type { UserStatus } from "@prisma/client";

const STATUS_CONFIG: Record<UserStatus, { label: string; className: string }> = {
  PENDING:  { label: "En attente",  className: "badge badge-warning" },
  APPROVED: { label: "Approuvé",    className: "badge badge-success" },
  REJECTED: { label: "Rejeté",      className: "badge badge-error" },
};

const DISCOUNT_MODE_LABELS: Record<string, string> = {
  PERMANENT:  "Permanente",
  THRESHOLD:  "Sous conditions",
  NEXT_ORDER: "Prochaine commande",
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

  const statusCfg = STATUS_CONFIG[user.status];

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
    const v = item.variant;
    const p = Number(v.unitPrice);
    const isPk = v.saleType === "PACK";
    return sum + (isPk ? p * (v.packQuantity ?? 1) * item.quantity : p * item.quantity);
  }, 0);

  // Serialize cart items for client modal
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

  // Serialize orders for client modal
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
    <div className="space-y-6">

      {/* ── Fil d'Ariane ── */}
      <nav className="flex items-center gap-2 text-sm font-body text-text-muted" aria-label="Fil d'Ariane">
        <Link href="/admin" className="hover:text-text-primary transition-colors">Dashboard</Link>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <Link href="/admin/utilisateurs" className="hover:text-text-primary transition-colors">Clients</Link>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="text-text-primary font-medium">{user.firstName} {user.lastName}</span>
      </nav>

      {/* ── En-tête principal ── */}
      <div className="card overflow-hidden">
        <div className="p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center shrink-0">
              <span className="text-xl font-heading font-bold text-accent">
                {user.firstName.charAt(0)}{user.lastName.charAt(0)}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-heading font-bold text-text-primary">
                  {user.firstName} {user.lastName}
                </h1>
                <span className={statusCfg.className}>{statusCfg.label}</span>
              </div>
              <p className="text-sm font-body text-text-secondary mt-0.5">
                {user.company} — Inscrit le {formattedDate}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {user.status === "PENDING" && (
              <>
                <form action={updateUserStatus.bind(null, user.id, "APPROVED")}>
                  <button type="submit" className="btn-primary text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    Approuver
                  </button>
                </form>
                <form action={updateUserStatus.bind(null, user.id, "REJECTED")}>
                  <button type="submit" className="btn-danger text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    Rejeter
                  </button>
                </form>
              </>
            )}
            {user.status === "APPROVED" && (
              <form action={updateUserStatus.bind(null, user.id, "REJECTED")}>
                <button type="submit" className="btn-danger text-sm">Révoquer</button>
              </form>
            )}
            {user.status === "REJECTED" && (
              <form action={updateUserStatus.bind(null, user.id, "APPROVED")}>
                <button type="submit" className="btn-primary text-sm">Approuver</button>
              </form>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="border-t border-border bg-bg-secondary grid grid-cols-2 sm:grid-cols-4 divide-x divide-border">
          <div className="px-5 py-3 text-center">
            <p className="text-lg font-heading font-bold text-text-primary">{totalOrders}</p>
            <p className="text-xs font-body text-text-muted">Commande{totalOrders !== 1 ? "s" : ""}</p>
          </div>
          <div className="px-5 py-3 text-center">
            <p className="text-lg font-heading font-bold text-text-primary">{totalSpent.toFixed(2)} €</p>
            <p className="text-xs font-body text-text-muted">Total dépensé</p>
          </div>
          <div className="px-5 py-3 text-center">
            <p className="text-lg font-heading font-bold text-text-primary">{cartItemCount}</p>
            <p className="text-xs font-body text-text-muted">Au panier</p>
          </div>
          <div className="px-5 py-3 text-center">
            {user.discountType ? (
              <>
                <p className="text-lg font-heading font-bold text-accent">
                  {user.discountType === "PERCENT"
                    ? `-${Number(user.discountValue)}%`
                    : `-${Number(user.discountValue).toFixed(2)} €`}
                </p>
                <p className="text-xs font-body text-text-muted">
                  {DISCOUNT_MODE_LABELS[user.discountMode ?? "PERMANENT"]}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-heading font-bold text-text-muted">—</p>
                <p className="text-xs font-body text-text-muted">Pas de remise</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Deux colonnes ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ═══ COLONNE GAUCHE : Identité (7/12) ═══ */}
        <div className="lg:col-span-7 space-y-6">

          {/* Informations */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
              <h2 className="font-heading text-base font-semibold text-text-primary">Coordonnées</h2>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {[
                  { label: "Prénom",    value: user.firstName },
                  { label: "Nom",       value: user.lastName },
                  { label: "Société",   value: user.company },
                  { label: "Email",     value: user.email },
                  { label: "Téléphone", value: user.phone },
                  { label: "SIRET",     value: user.siret, mono: true },
                  { label: "N° TVA",    value: user.vatNumber ?? "—", mono: true },
                ].map(({ label, value, mono }) => (
                  <div key={label}>
                    <p className="text-xs font-body font-semibold text-text-muted uppercase tracking-wider">{label}</p>
                    <p className={`text-sm text-text-primary mt-0.5 ${mono ? "font-mono" : "font-body"}`}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Kbis */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                <h2 className="font-heading text-base font-semibold text-text-primary">Extrait Kbis</h2>
              </div>
              {user.kbisPath && (
                <a href={kbisApiUrl} download={kbisFilename} className="btn-ghost text-xs py-1.5 px-3">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Télécharger
                </a>
              )}
            </div>
            <div className="p-4 min-h-48">
              {user.kbisPath ? (
                isPdf ? (
                  <iframe src={kbisApiUrl} title="Extrait Kbis" className="w-full h-80 border-0 rounded-lg" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={kbisApiUrl} alt={`Kbis de ${user.company}`} className="w-full h-auto max-h-80 object-contain rounded-lg" />
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <svg className="w-10 h-10 text-text-muted/50 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="text-sm text-text-muted font-body">Aucun Kbis fourni</p>
                </div>
              )}
            </div>
          </div>

          {/* VIES */}
          <VatVerificationCard
            vatNumber={user.vatNumber}
            userId={user.id}
            savedVies={{
              viesValid: user.viesValid ?? null,
              viesName: user.viesName ?? null,
              viesAddress: user.viesAddress ?? null,
              viesRequestDate: user.viesRequestDate ?? null,
              viesError: user.viesError ?? null,
            }}
          />

          {/* Message d'inscription */}
          {user.registrationMessage && (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                <h2 className="font-heading text-base font-semibold text-text-primary">Message d&apos;inscription</h2>
              </div>
              <div className="p-5">
                <p className="text-sm text-text-primary font-body whitespace-pre-wrap leading-relaxed">
                  {user.registrationMessage}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ═══ COLONNE DROITE : Commercial (5/12) ═══ */}
        <div className="lg:col-span-5 space-y-6">

          {/* Remise commerciale */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" /></svg>
                <h2 className="font-heading text-base font-semibold text-text-primary">Remise commerciale</h2>
              </div>
            </div>
            <ClientDiscountForm
              userId={user.id}
              initialDiscountType={user.discountType ?? null}
              initialDiscountValue={user.discountValue != null ? Number(user.discountValue) : null}
              initialDiscountMode={user.discountMode ?? null}
              initialDiscountMinAmount={user.discountMinAmount != null ? Number(user.discountMinAmount) : null}
              initialDiscountMinQuantity={user.discountMinQuantity ?? null}
              initialFreeShipping={user.freeShipping}
              initialShippingDiscountType={user.shippingDiscountType ?? null}
              initialShippingDiscountValue={user.shippingDiscountValue != null ? Number(user.shippingDiscountValue) : null}
            />
          </div>

          {/* Panier — résumé + bouton modal */}
          <CartModal items={cartItemsSerialized} cartTotal={cartTotal} />

          {/* Commandes — résumé + bouton modal */}
          <OrdersModal orders={ordersSerialized} />
        </div>
      </div>

      {/* ── Zone dangereuse ── */}
      <div className="card p-5 border-red-200/50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-body font-medium text-text-primary">Supprimer ce client</p>
            <p className="text-xs font-body text-text-muted mt-0.5">
              Action irréversible — toutes les données seront effacées.
            </p>
          </div>
          <DeleteUserButton userId={user.id} userName={`${user.firstName} ${user.lastName}`} />
        </div>
      </div>
    </div>
  );
}
