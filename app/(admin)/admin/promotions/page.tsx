import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getPromotions } from "@/app/actions/admin/promotions";
import { effectivePromotionStatus } from "@/lib/promotion-status";
import PromotionsList from "./PromotionsList";

export const metadata: Metadata = { title: "Promotions — Admin" };

// ─── Tuile KPI (bento) ─────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, icon, accent = "neutral", pulse = false,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ReactNode;
  accent?: "neutral" | "dark";
  pulse?: boolean;
}) {
  const iconWrap = accent === "dark"
    ? "bg-bg-dark text-white border border-bg-dark"
    : "bg-bg-secondary text-text-primary border border-border";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-bg-primary p-4 sm:p-5 shadow-sm before:content-[''] before:absolute before:-top-10 before:-right-10 before:w-28 before:h-28 before:rounded-full before:blur-3xl before:bg-slate-300/25">
      <div className="relative flex items-start justify-between mb-3">
        <p className="text-[10px] sm:text-[11px] font-body font-bold uppercase tracking-[0.14em] text-text-muted">{label}</p>
        <span className={`inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl ${iconWrap}`}>
          {icon}
        </span>
      </div>
      <p className="relative font-heading text-2xl sm:text-3xl font-bold tabular-nums leading-none text-text-primary flex items-center gap-2">
        {pulse && value > 0 && (
          <span className="relative inline-flex w-2.5 h-2.5">
            <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
            <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500" />
          </span>
        )}
        {value}
      </p>
      <p className="relative text-[11px] sm:text-xs font-body text-text-muted mt-1.5">{sub}</p>
    </div>
  );
}

export default async function AdminPromotionsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const promotions = await getPromotions();
  const now = new Date();

  // Sérialise les Decimals + prépare les statuts pour la couche client
  const serialized = promotions.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    code: p.code,
    discountKind: p.discountKind,
    discountValue: Number(p.discountValue),
    minOrderAmount: p.minOrderAmount != null ? Number(p.minOrderAmount) : null,
    maxUses: p.maxUses,
    maxUsesPerUser: p.maxUsesPerUser,
    stackable: p.stackable,
    appliesToAll: p.appliesToAll,
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt ? p.endsAt.toISOString() : null,
    isActive: p.isActive,
    currentUses: p.currentUses,
    usageCount: p._count.usages,
  }));

  const statuses = promotions.map((p) => effectivePromotionStatus({
    isActive: p.isActive,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    maxUses: p.maxUses,
    currentUses: p.currentUses,
  }, now));

  const activeCount    = statuses.filter((s) => s === "ACTIVE").length;
  const scheduledCount = statuses.filter((s) => s === "SCHEDULED").length;
  const expiredCount   = statuses.filter((s) => s === "EXPIRED" || s === "EXHAUSTED" || s === "INACTIVE").length;
  const codeCount      = promotions.filter((p) => p.type === "CODE" && p.isActive).length;
  const autoCount      = promotions.filter((p) => p.type === "AUTO" && p.isActive).length;

  // Utilisations sur les 30 derniers jours (via _count.usages : on n'a pas la date, on prend le total actuel comme approx)
  // TODO: filtrer sur PromotionUsage.createdAt >= now-30d si besoin d'une valeur exacte
  const totalUsesThisMonth = promotions.reduce((sum, p) => sum + p._count.usages, 0);

  return (
    <div className="space-y-6">
      {/* ══════════════════════ HERO ══════════════════════ */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full blur-3xl bg-slate-300/25 pointer-events-none" />
        <div className="absolute -bottom-24 left-1/4 w-72 h-72 rounded-full blur-3xl bg-zinc-200/50 pointer-events-none" />

        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-text-primary shadow-[0_0_0_3px_rgba(24,24,27,0.14)]" />
                Promotions &amp; remises
              </span>
              <h1 className="page-title mt-4">Promotions</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Codes promo, remises automatiques et livraison offerte — pilotez toutes vos réductions au même endroit.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/admin/promotions/nouveau"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-br from-text-primary to-text-secondary text-white text-sm font-body font-semibold shadow-md hover:opacity-95 transition-opacity"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Nouvelle promotion
              </Link>
            </div>
          </div>

          {/* KPI BENTO */}
          <div className="relative mt-6 sm:mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              label="Promotions actives"
              value={activeCount}
              sub="Utilisables par vos clients"
              accent="dark"
              pulse
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m19 5-14 14"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
                </svg>
              }
            />
            <KpiTile
              label="Codes promo"
              value={codeCount}
              sub="Saisis par le client au panier"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>
                </svg>
              }
            />
            <KpiTile
              label="Remises auto"
              value={autoCount}
              sub="Appliquées automatiquement"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
              }
            />
            <KpiTile
              label="Utilisations totales"
              value={totalUsesThisMonth}
              sub="Cumulées sur toutes les promotions"
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18"/><path d="M18 12v5M14 8v9M10 12v5M6 16v1"/>
                </svg>
              }
            />
          </div>
        </div>
      </section>

      <PromotionsList
        promotions={serialized}
        counts={{
          all: promotions.length,
          active: activeCount,
          scheduled: scheduledCount,
          expired: expiredCount,
        }}
      />
    </div>
  );
}
