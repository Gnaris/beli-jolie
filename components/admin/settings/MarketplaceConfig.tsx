"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  updatePfsCredentials, validatePfsCredentials, togglePfsEnabled,
  updateAnkorstoreCredentials, validateAnkorstoreCredentials, toggleAnkorstoreEnabled,
  updateEfashionCredentials, validateEfashionCredentials, toggleEfashionEnabled,
  updateFaireCredentials, validateFaireCredentials, toggleFaireEnabled,
  toggleMicrostoreEnabled,
  updateMarketplaceMarkup,
  loadPfsBrands, updatePfsBrand,
  updatePfsOutOfStockConfig,
} from "@/app/actions/admin/site-config";
import { applyMarketplaceMarkup, applyFaireMarkupWithClamp } from "@/lib/marketplace-pricing-shared";
import { MarkupRow, type MarkupState } from "@/components/admin/settings/MarkupRow";
import { MARKETPLACES_BRAND, brandGradient, type MarketplaceKey } from "@/lib/marketplaces-brand";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import MicrostoreConnectCard from "@/components/admin/settings/MicrostoreConnectCard";

interface MarketplaceStats {
  published: number;
  toSync: number;
  lastSyncAt: string | null;
}

export type PfsOutOfStockProductAction = "archived" | "deleted" | "draft";

export interface PfsOutOfStockUiConfig {
  deactivateVariant: boolean;
  productAction: PfsOutOfStockProductAction;
}

interface Props {
  hasPfsConfig: boolean;
  pfsEnabled: boolean;
  pfsBrand: { id: string; name: string } | null;
  pfsOutOfStock: PfsOutOfStockUiConfig;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  hasMicrostoreConfig: boolean;
  microstoreEnabled: boolean;
  microstoreExpiresAtIso: string | null;
  stats: {
    pfs: MarketplaceStats;
    ankorstore: MarketplaceStats;
    efashion: MarketplaceStats;
    faire: MarketplaceStats;
  };
  markupSettings: {
    pfs: MarkupState;
    ankorstoreWholesale: MarkupState;
    ankorstoreRetail: MarkupState;
    ankorstoreVatRate: number;
    efashion: MarkupState;
    microstore: MarkupState;
    faireWholesale: MarkupState;
    faireRetail: MarkupState;
  };
}

// ─── Petits utilitaires ────────────────────────────────────────────────────
function formatRelative(iso: string | null): string {
  if (!iso) return "jamais";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "à l'instant";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `il y a ${mo} mois`;
  return `il y a ${Math.floor(mo / 12)} an${mo >= 24 ? "s" : ""}`;
}

function formatEUR(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ─── Icônes (inline SVG) ───────────────────────────────────────────────────
const Icons = {
  Bolt: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
  ),
  Box: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><path d="M3.27 6.96L12 12.01l8.73-5.05" /><path d="M12 22.08V12" /></svg>
  ),
  Refresh: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>
  ),
  Clock: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
  ),
  Plug: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 7V2M15 7V2M5 11h14a2 2 0 012 2v0a2 2 0 01-2 2h-2v3a4 4 0 01-4 4h-2a4 4 0 01-4-4v-3H5a2 2 0 01-2-2v0a2 2 0 012-2z" /></svg>
  ),
  Settings: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
  ),
  Check: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
  ),
  X: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
  ),
  Pencil: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
  ),
  Loader: ({ className }: { className?: string }) => (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
  ),
  Tag: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><circle cx="7" cy="7" r="1" /></svg>
  ),
  Calculator: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="16" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="8" y2="18" /><line x1="12" y1="18" x2="12" y2="18" /><line x1="16" y1="18" x2="16" y2="18" /></svg>
  ),
  Sparkles: ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2zM5 14l.75 2.25L8 17l-2.25.75L5 20l-.75-2.25L2 17l2.25-.75L5 14zM19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75L19 14z" /></svg>
  ),
};

// ─── Composants partagés ───────────────────────────────────────────────────
function Logo({ brandKey }: { brandKey: MarketplaceKey }) {
  const b = MARKETPLACES_BRAND[brandKey];
  return (
    <div
      className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-base shadow-sm shrink-0"
      style={{ background: brandGradient(b), color: b.onPrimary, letterSpacing: "-0.02em" }}
    >
      {b.monogram}
    </div>
  );
}

function StatusDot({ kind }: { kind: "ok" | "warn" | "off" | "checking" }) {
  const map = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    off: "bg-gray-300",
    checking: "bg-amber-500 animate-pulse",
  };
  return <span className={`w-2 h-2 rounded-full ${map[kind]} shrink-0`} />;
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
      <div className="relative">
        <input type="checkbox" className="sr-only peer" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <div className={`w-10 h-6 rounded-full border transition-colors ${checked ? "bg-emerald-500 border-emerald-500" : "bg-gray-200 border-gray-200"}`} />
        <div className={`absolute top-[3px] left-[3px] w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : ""}`} />
      </div>
      <span className="font-body text-xs font-medium text-text-secondary">{label}</span>
    </label>
  );
}

// ─── Bandeau Cockpit (KPIs globaux) ────────────────────────────────────────
function CockpitStrip({
  activeCount, totalCount, totalPublished, totalToSync, lastSyncAt,
}: {
  activeCount: number; totalCount: number; totalPublished: number; totalToSync: number; lastSyncAt: string | null;
}) {
  const tiles: { label: string; value: string; sub?: string; icon: React.ReactNode; accent: string }[] = [
    {
      label: "Marketplaces actives",
      value: `${activeCount} / ${totalCount}`,
      sub: activeCount === totalCount ? "Tout est branché" : `${totalCount - activeCount} en pause`,
      icon: <Icons.Plug className="w-5 h-5" />,
      accent: "text-emerald-600",
    },
    {
      label: "Produits publiés",
      value: totalPublished.toLocaleString("fr-FR"),
      sub: "toutes marketplaces confondues",
      icon: <Icons.Box className="w-5 h-5" />,
      accent: "text-text-primary",
    },
    {
      label: "En attente de sync",
      value: totalToSync.toLocaleString("fr-FR"),
      sub: totalToSync === 0 ? "Tout est à jour" : "à propager côté marketplaces",
      icon: <Icons.Refresh className="w-5 h-5" />,
      accent: totalToSync > 0 ? "text-amber-600" : "text-text-muted",
    },
    {
      label: "Dernière mise à jour",
      value: formatRelative(lastSyncAt),
      sub: lastSyncAt ? new Date(lastSyncAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—",
      icon: <Icons.Clock className="w-5 h-5" />,
      accent: "text-text-primary",
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-bg-primary shadow-sm">
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{ background: "radial-gradient(circle at 0% 0%, #1A1A1A 0%, transparent 50%), radial-gradient(circle at 100% 100%, #1A1A1A 0%, transparent 50%)" }}
      />
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-5">
          <Icons.Sparkles className="w-4 h-4 text-amber-500" />
          <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Cockpit marketplaces
          </h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {tiles.map((t, i) => (
            <div key={i} className="rounded-2xl bg-bg-secondary/60 border border-border-light p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-body text-[11px] font-medium uppercase tracking-wider text-text-muted leading-tight">
                  {t.label}
                </span>
                <span className={`${t.accent}`}>{t.icon}</span>
              </div>
              <div className={`font-heading text-2xl sm:text-3xl font-semibold ${t.accent} leading-none mb-1.5`}>
                {t.value}
              </div>
              {t.sub && (
                <div className="font-body text-[11px] text-text-muted truncate">{t.sub}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Carte marketplace ─────────────────────────────────────────────────────
interface MarketplaceCardProps {
  brandKey: Exclude<MarketplaceKey, "microstore">;
  hasConfig: boolean;
  status: "ok" | "warn" | "off" | "checking";
  enabled: boolean;
  enabledControl?: { onToggle: (v: boolean) => void; toggling: boolean };
  stats: MarketplaceStats;
  previewHT: number;
  previewLines: { label: string; value: string; muted?: boolean }[];
  badge?: { text: string; tone: "ok" | "warn" | "info" | "muted" };
  extraNote?: string;
  onOpenSettings: () => void;
}

function MarketplaceCard({
  brandKey, hasConfig, status, enabled, enabledControl, stats, previewLines, badge, extraNote, onOpenSettings,
}: MarketplaceCardProps) {
  const brand = MARKETPLACES_BRAND[brandKey];
  const isLive = hasConfig && enabled && status === "ok";
  const isDormant = !isLive;

  const statusLabel = {
    ok: enabled ? "Active" : "Connectée · en pause",
    warn: "Identifiants à vérifier",
    off: "Non configurée",
    checking: "Vérification…",
  }[status];

  const badgeToneClass = badge ? ({
    ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
    muted: "bg-gray-50 text-gray-600 border-gray-200",
  }[badge.tone]) : "";

  return (
    <div
      className={`group relative overflow-hidden rounded-3xl border border-border bg-bg-primary shadow-sm transition-all hover:shadow-md ${
        isDormant ? "opacity-[0.92]" : ""
      }`}
    >
      {/* ── Header brandé ─────────────────────────────────────────────── */}
      <div
        className="relative p-5 overflow-hidden"
        style={{
          background: isLive ? brandGradient(brand) : "linear-gradient(135deg, #2A2A2D 0%, #4B5563 100%)",
          color: brand.onPrimary,
        }}
      >
        {/* Texture subtile */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }} />

        <div className="relative flex items-start gap-4">
          <Logo brandKey={brandKey} />
          <div className="flex-1 min-w-0">
            <h3 className="font-heading text-base font-semibold leading-tight mb-0.5 truncate" style={{ color: brand.onPrimary }}>
              {brand.name}
            </h3>
            <p className="font-body text-[12px] opacity-80 truncate" style={{ color: brand.onPrimary }}>
              {brand.tagline}
            </p>
            <div className="flex items-center gap-2 mt-2.5">
              <StatusDot kind={status} />
              <span className="font-body text-[11px] font-medium uppercase tracking-wider opacity-90" style={{ color: brand.onPrimary }}>
                {statusLabel}
              </span>
            </div>
          </div>

          {enabledControl && hasConfig && (
            <div
              className="shrink-0 rounded-full bg-black/20 backdrop-blur-sm px-3 py-1.5 ring-1 ring-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <Toggle
                checked={enabled}
                disabled={enabledControl.toggling}
                onChange={enabledControl.onToggle}
                label={enabled ? "ON" : "OFF"}
              />
            </div>
          )}
        </div>

        {badge && (
          <div className={`relative inline-flex items-center gap-1.5 mt-3 px-2.5 py-1 rounded-full text-[10.5px] font-semibold uppercase tracking-wider border ${badgeToneClass}`}>
            {badge.text}
          </div>
        )}
      </div>

      {/* ── KPIs tuiles ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 divide-x divide-border-light border-b border-border-light">
        <KpiTile label="Publiés" value={stats.published.toLocaleString("fr-FR")} icon={<Icons.Box className="w-3.5 h-3.5" />} />
        <KpiTile
          label="À synchroniser"
          value={stats.toSync.toLocaleString("fr-FR")}
          icon={<Icons.Refresh className="w-3.5 h-3.5" />}
          accent={stats.toSync > 0 ? "text-amber-600" : undefined}
        />
        <KpiTile label="Dernière sync" value={formatRelative(stats.lastSyncAt)} icon={<Icons.Clock className="w-3.5 h-3.5" />} small />
      </div>

      {/* ── Calculette aperçu prix ─────────────────────────────────────── */}
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icons.Calculator className="w-3.5 h-3.5 text-text-muted" />
          <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Aperçu prix
          </p>
        </div>
        <div className="space-y-2 mb-1">
          {previewLines.map((line, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <span className={`font-body text-[12.5px] ${line.muted ? "text-text-muted" : "text-text-secondary"}`}>
                {line.label}
              </span>
              <span className={`font-heading text-sm font-semibold tabular-nums ${line.muted ? "text-text-muted" : "text-text-primary"}`}>
                {line.value}
              </span>
            </div>
          ))}
        </div>
        {extraNote && (
          <p className="mt-3 text-[11px] text-text-muted leading-snug font-body italic">{extraNote}</p>
        )}
      </div>

      {/* ── Action ouvrir réglages ─────────────────────────────────────── */}
      <div className="px-5 pb-5">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-border bg-bg-primary text-text-primary text-sm font-body font-medium hover:bg-bg-secondary hover:border-border-dark transition-all"
        >
          <Icons.Settings className="w-4 h-4" />
          Identifiants &amp; réglages
        </button>
      </div>
    </div>
  );
}

function KpiTile({ label, value, icon, accent, small }: { label: string; value: string; icon: React.ReactNode; accent?: string; small?: boolean }) {
  return (
    <div className="p-4 text-center">
      <div className="flex items-center justify-center gap-1.5 text-text-muted mb-1.5">
        {icon}
        <span className="font-body text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className={`font-heading ${small ? "text-[13px]" : "text-xl"} font-semibold leading-none ${accent ?? "text-text-primary"}`}>
        {value}
      </div>
    </div>
  );
}

// ─── Slide-over drawer ─────────────────────────────────────────────────────
function Drawer({ open, onClose, brandKey, children }: { open: boolean; onClose: () => void; brandKey: MarketplaceKey | null; children: React.ReactNode }) {
  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = original; };
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !brandKey) return null;
  const brand = MARKETPLACES_BRAND[brandKey];

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-[fadeIn_120ms_ease-out]"
        onClick={onClose}
      />
      <div
        className="absolute top-0 right-0 h-full w-full sm:max-w-[520px] bg-bg-primary shadow-2xl flex flex-col animate-[slideInRight_240ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div
          className="relative px-6 py-5 overflow-hidden shrink-0"
          style={{ background: brandGradient(brand), color: brand.onPrimary }}
        >
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "16px 16px",
          }} />
          <div className="relative flex items-center gap-4">
            <Logo brandKey={brandKey} />
            <div className="flex-1 min-w-0">
              <p className="font-body text-[10.5px] font-semibold uppercase tracking-[0.18em] opacity-75" style={{ color: brand.onPrimary }}>
                Réglages
              </p>
              <h2 className="font-heading text-lg font-semibold truncate" style={{ color: brand.onPrimary }}>
                {brand.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
              aria-label="Fermer"
            >
              <span style={{ color: brand.onPrimary }} className="inline-flex"><Icons.X className="w-4 h-4" /></span>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </div>
  );
}

// ─── Bloc réglages : section au sein du drawer ────────────────────────────
function DrawerSection({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="px-6 py-5 border-b border-border-light last:border-b-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-text-muted">{icon}</span>
        <h3 className="font-heading text-[13px] font-semibold uppercase tracking-wider text-text-secondary">{title}</h3>
      </div>
      {subtitle && <p className="font-body text-xs text-text-muted mb-4">{subtitle}</p>}
      {!subtitle && <div className="h-2" />}
      {children}
    </section>
  );
}

// ─── Forme d'édition des identifiants (réutilisée par drawer) ─────────────
function CredentialBlock({
  hasConfig, editing, setEditing, status, fields, validating, saving, onValidate, onSave, canSave,
}: {
  hasConfig: boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
  status: "none" | "valid" | "invalid" | "checking";
  fields: React.ReactNode;
  validating: boolean;
  saving: boolean;
  onValidate: () => void;
  onSave: () => void;
  canSave: boolean;
}) {
  if (!editing && hasConfig) {
    return (
      <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-bg-secondary/60 border border-border-light">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="flex-1 font-body text-sm text-text-secondary">Identifiants enregistrés et chiffrés.</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-body font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <Icons.Pencil className="w-3.5 h-3.5" />
          Modifier
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fields}
      {status === "invalid" && (
        <p className="font-body text-xs text-error flex items-center gap-1.5">
          <Icons.X className="w-3.5 h-3.5" /> Identifiants refusés par le service.
        </p>
      )}
      {status === "valid" && (
        <p className="font-body text-xs text-emerald-700 flex items-center gap-1.5">
          <Icons.Check className="w-3.5 h-3.5" /> Connexion validée — vous pouvez enregistrer.
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onValidate}
          disabled={validating || saving}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border text-xs font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
        >
          {validating ? <><Icons.Loader className="w-3.5 h-3.5" /> Vérification…</> : <><Icons.Check className="w-3.5 h-3.5" /> Tester</>}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !canSave || status !== "valid"}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {saving ? <><Icons.Loader className="w-3.5 h-3.5" /> Enregistrement…</> : "Enregistrer"}
        </button>
        {hasConfig && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving || validating}
            className="inline-flex items-center gap-1 h-9 px-3 text-xs font-body text-text-muted hover:text-text-primary transition-colors"
          >
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange, placeholder, disabled, hint }: {
  label: string; type: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className="font-body text-[11px] font-medium text-text-secondary mb-1.5 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className="w-full h-10 px-3.5 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow disabled:opacity-50"
      />
      {hint && <p className="mt-1.5 font-body text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
export default function MarketplaceConfig({
  hasPfsConfig,
  pfsEnabled: initialPfsEnabled,
  pfsBrand: initialPfsBrand,
  pfsOutOfStock: initialPfsOutOfStock,
  hasAnkorstoreConfig,
  ankorstoreEnabled: initialAnkorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled: initialEfashionEnabled,
  hasFaireConfig,
  faireEnabled: initialFaireEnabled,
  hasMicrostoreConfig,
  microstoreEnabled: initialMicrostoreEnabled,
  microstoreExpiresAtIso,
  stats,
  markupSettings,
}: Props) {
  // ── PFS state ──────────────────────────────────────────────────────────────
  const [pfsEmail, setPfsEmail] = useState("");
  const [pfsPassword, setPfsPassword] = useState("");
  const [pfsStatus, setPfsStatus] = useState<"none" | "valid" | "invalid" | "checking">(hasPfsConfig ? "valid" : "none");
  const [pfsEditing, setPfsEditing] = useState(!hasPfsConfig);
  const [isSavingPfs, startSavingPfs] = useTransition();
  const [isValidatingPfs, startValidatingPfs] = useTransition();
  const [pfsMarkup, setPfsMarkup] = useState<MarkupState>(markupSettings.pfs);
  const [pfsEnabled, setPfsEnabled] = useState(initialPfsEnabled);
  const [isTogglingPfs, startTogglingPfs] = useTransition();

  // PFS out-of-stock behavior
  const [pfsOosDeactivate, setPfsOosDeactivate] = useState<boolean>(initialPfsOutOfStock.deactivateVariant);
  const [pfsOosAction, setPfsOosAction] = useState<PfsOutOfStockProductAction>(initialPfsOutOfStock.productAction);
  const [isSavingPfsOos, startSavingPfsOos] = useTransition();

  // PFS brand
  const [pfsBrand, setPfsBrand] = useState<{ id: string; name: string } | null>(initialPfsBrand);
  const [brandList, setBrandList] = useState<{ id: string; name: string; logoUrl: string | null }[] | null>(null);
  const [brandListError, setBrandListError] = useState<string | null>(null);
  const [isLoadingBrands, startLoadingBrands] = useTransition();
  const [isSavingBrand, startSavingBrand] = useTransition();
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);

  // ── Ankorstore state ────────────────────────────────────────────────────────
  const [ankClientId, setAnkClientId] = useState("");
  const [ankClientSecret, setAnkClientSecret] = useState("");
  const [ankStatus, setAnkStatus] = useState<"none" | "valid" | "invalid" | "checking">(hasAnkorstoreConfig ? "valid" : "none");
  const [ankEditing, setAnkEditing] = useState(!hasAnkorstoreConfig);
  const [isSavingAnk, startSavingAnk] = useTransition();
  const [isValidatingAnk, startValidatingAnk] = useTransition();
  const [isTogglingAnk, startTogglingAnk] = useTransition();
  const [ankEnabled, setAnkEnabled] = useState(initialAnkorstoreEnabled);
  const [ankWholesale, setAnkWholesale] = useState<MarkupState>(markupSettings.ankorstoreWholesale);
  const [ankRetail, setAnkRetail] = useState<MarkupState>(markupSettings.ankorstoreRetail);
  const [ankVat, setAnkVat] = useState<number>(markupSettings.ankorstoreVatRate);

  // ── eFashion state ──────────────────────────────────────────────────────────
  const [efaEmail, setEfaEmail] = useState("");
  const [efaPassword, setEfaPassword] = useState("");
  const [efaStatus, setEfaStatus] = useState<"none" | "valid" | "invalid" | "checking">(hasEfashionConfig ? "valid" : "none");
  const [efaEditing, setEfaEditing] = useState(!hasEfashionConfig);
  const [isSavingEfa, startSavingEfa] = useTransition();
  const [isValidatingEfa, startValidatingEfa] = useTransition();
  const [isTogglingEfa, startTogglingEfa] = useTransition();
  const [efaEnabled, setEfaEnabled] = useState(initialEfashionEnabled);
  const [efaMarkup, setEfaMarkup] = useState<MarkupState>(markupSettings.efashion);
  const [efaVendor, setEfaVendor] = useState<{ id: number; name: string } | null>(null);

  // ── Faire state ─────────────────────────────────────────────────────────────
  const [faiKey, setFaiKey] = useState("");
  const [faiStatus, setFaiStatus] = useState<"none" | "valid" | "invalid" | "checking">(hasFaireConfig ? "valid" : "none");
  const [faiEditing, setFaiEditing] = useState(!hasFaireConfig);
  const [isSavingFai, startSavingFai] = useTransition();
  const [isValidatingFai, startValidatingFai] = useTransition();
  const [isTogglingFai, startTogglingFai] = useTransition();
  const [faiEnabled, setFaiEnabled] = useState(initialFaireEnabled);
  const [faiWholesale, setFaiWholesale] = useState<MarkupState>(markupSettings.faireWholesale);
  const [faiRetail, setFaiRetail] = useState<MarkupState>(markupSettings.faireRetail);

  // ── Microstore ──────────────────────────────────────────────────────────────
  const [microMarkup, setMicroMarkup] = useState<MarkupState>(markupSettings.microstore);
  const [microEnabled, setMicroEnabled] = useState(initialMicrostoreEnabled);
  const [isTogglingMicro, startTogglingMicro] = useTransition();

  // ── Shared ──────────────────────────────────────────────────────────────────
  const [isSavingMarkup, startSavingMarkup] = useTransition();
  const [drawerKey, setDrawerKey] = useState<MarketplaceKey | null>(null);
  const [previewHT, setPreviewHT] = useState<number>(5);
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  // Bookmarklet Microstore : quand l'URL contient #mc_import=…, on doit ouvrir
  // le tiroir Microstore pour que <MicrostoreConnectCard> se monte et consomme
  // le fragment (sinon le token reste dans l'URL et la vignette reste "Non
  // connecté").
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.startsWith("#mc_import=")) {
      setDrawerKey("microstore");
    }
  }, []);

  // ── Calculs aperçu prix ─────────────────────────────────────────────────────
  const previews = useMemo(() => {
    const pfsP = applyMarketplaceMarkup(previewHT, pfsMarkup);
    const ankW = applyMarketplaceMarkup(previewHT, ankWholesale);
    const ankR = applyMarketplaceMarkup(previewHT, ankRetail);
    const ankRttc = ankR * (1 + (ankVat || 0) / 100);
    const faiPair = applyFaireMarkupWithClamp(previewHT, faiWholesale, faiRetail);
    const efaP = applyMarketplaceMarkup(previewHT, efaMarkup);
    const microP = applyMarketplaceMarkup(previewHT, microMarkup);
    return {
      pfs: [
        { label: `${formatEUR(previewHT)} HT en boutique`, value: "↓", muted: true },
        { label: "Prix HT envoyé à PFS", value: formatEUR(pfsP) },
      ],
      ankorstore: [
        { label: `${formatEUR(previewHT)} HT en boutique`, value: "↓", muted: true },
        { label: "Prix de gros HT", value: formatEUR(ankW) },
        { label: `Public TTC (TVA ${ankVat}%)`, value: formatEUR(ankRttc) },
      ],
      faire: [
        { label: `${formatEUR(previewHT)} HT en boutique`, value: "↓", muted: true },
        { label: "Prix de gros HT", value: formatEUR(faiPair.wholesale) },
        { label: "Public conseillé HT", value: formatEUR(faiPair.retail) },
      ],
      efashion: [
        { label: `${formatEUR(previewHT)} HT en boutique`, value: "↓", muted: true },
        { label: "Prix de gros HT envoyé", value: formatEUR(efaP) },
      ],
      microstore: [
        { label: `${formatEUR(previewHT)} HT en boutique`, value: "↓" },
        { label: "Prix Excel exporté", value: formatEUR(microP) },
      ],
    };
  }, [previewHT, pfsMarkup, ankWholesale, ankRetail, ankVat, faiWholesale, faiRetail, efaMarkup, microMarkup]);

  // ── Cockpit stats ───────────────────────────────────────────────────────────
  const cockpit = useMemo(() => {
    const activeFlags = [
      hasPfsConfig && !!pfsBrand && pfsEnabled,
      hasAnkorstoreConfig && ankEnabled,
      hasFaireConfig && faiEnabled,
      hasEfashionConfig && efaEnabled,
      hasMicrostoreConfig && microEnabled,
    ];
    // Microstore ne publie pas de produits : on ne l'inclut pas dans les
    // compteurs "Publiés / À synchroniser / Dernière sync".
    const totalPublished = stats.pfs.published + stats.ankorstore.published + stats.efashion.published + stats.faire.published;
    const totalToSync = stats.pfs.toSync + stats.ankorstore.toSync + stats.efashion.toSync + stats.faire.toSync;
    const lastSyncs = [stats.pfs.lastSyncAt, stats.ankorstore.lastSyncAt, stats.efashion.lastSyncAt, stats.faire.lastSyncAt].filter((x): x is string => !!x);
    const lastSyncAt = lastSyncs.length > 0 ? lastSyncs.sort().at(-1)! : null;
    return {
      activeCount: activeFlags.filter(Boolean).length,
      totalCount: activeFlags.length,
      totalPublished,
      totalToSync,
      lastSyncAt,
    };
  }, [hasPfsConfig, pfsBrand, pfsEnabled, hasAnkorstoreConfig, ankEnabled, hasFaireConfig, faiEnabled, hasEfashionConfig, efaEnabled, hasMicrostoreConfig, microEnabled, stats]);

  // ── PFS brand picker ────────────────────────────────────────────────────────
  function openBrandPicker() {
    setBrandPickerOpen(true);
    setBrandListError(null);
    startLoadingBrands(async () => {
      const res = await loadPfsBrands();
      if (res.success && res.brands) setBrandList(res.brands);
      else setBrandListError(res.error ?? "Impossible de charger les marques.");
    });
  }
  function handlePickBrand(brand: { id: string; name: string }) {
    showLoading();
    startSavingBrand(async () => {
      try {
        const res = await updatePfsBrand(brand);
        if (res.success) {
          setPfsBrand(brand);
          setBrandPickerOpen(false);
          toast.success("Marque PFS enregistrée", `« ${brand.name} » est maintenant utilisée.`);
        } else {
          toast.error("Erreur", res.error ?? "Impossible d'enregistrer la marque.");
        }
      } finally { hideLoading(); }
    });
  }

  // ── PFS handlers ────────────────────────────────────────────────────────────
  function handlePfsValidate() {
    if (!pfsEmail.trim() || !pfsPassword.trim()) return;
    showLoading();
    startValidatingPfs(async () => {
      try {
        setPfsStatus("checking");
        const r = await validatePfsCredentials({ email: pfsEmail.trim(), password: pfsPassword.trim() });
        if (r.valid) { setPfsStatus("valid"); toast.success("Connexion réussie", "Identifiants PFS valides."); }
        else { setPfsStatus("invalid"); toast.error("Connexion échouée", r.error ?? "Identifiants invalides."); }
      } finally { hideLoading(); }
    });
  }
  function handlePfsSave() {
    showLoading();
    startSavingPfs(async () => {
      try {
        const r = await updatePfsCredentials({ email: pfsEmail.trim(), password: pfsPassword.trim() });
        if (r.success) { toast.success("Enregistré", "Identifiants PFS sauvegardés."); setPfsEditing(false); setPfsEmail(""); setPfsPassword(""); }
        else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
      } finally { hideLoading(); }
    });
  }
  function handlePfsOosSave() {
    showLoading();
    startSavingPfsOos(async () => {
      try {
        const r = await updatePfsOutOfStockConfig({
          deactivateVariant: pfsOosDeactivate,
          productAction: pfsOosAction,
        });
        if (r.success) toast.success("Enregistré", "Comportement en rupture mis à jour.");
        else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
      } finally { hideLoading(); }
    });
  }

  function handlePfsToggle(v: boolean) {
    startTogglingPfs(async () => {
      const r = await togglePfsEnabled(v);
      if (r.success) { setPfsEnabled(v); toast.success(v ? "Paris Fashion Shop activé" : "Paris Fashion Shop en pause", v ? "La sync est de nouveau active." : "Plus de propagation vers PFS."); }
      else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
    });
  }

  // ── Ankorstore handlers ─────────────────────────────────────────────────────
  function handleAnkValidate() {
    if (!ankClientId.trim() || !ankClientSecret.trim()) return;
    showLoading();
    startValidatingAnk(async () => {
      try {
        setAnkStatus("checking");
        const r = await validateAnkorstoreCredentials({ clientId: ankClientId.trim(), clientSecret: ankClientSecret.trim() });
        if (r.valid) { setAnkStatus("valid"); toast.success("Connexion réussie", "Identifiants Ankorstore valides."); }
        else { setAnkStatus("invalid"); toast.error("Connexion échouée", r.error ?? "Identifiants invalides."); }
      } finally { hideLoading(); }
    });
  }
  function handleAnkSave() {
    showLoading();
    startSavingAnk(async () => {
      try {
        const r = await updateAnkorstoreCredentials({ clientId: ankClientId.trim(), clientSecret: ankClientSecret.trim() });
        if (r.success) { toast.success("Enregistré", "Identifiants Ankorstore sauvegardés."); setAnkEditing(false); setAnkClientId(""); setAnkClientSecret(""); }
        else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
      } finally { hideLoading(); }
    });
  }
  function handleAnkToggle(v: boolean) {
    startTogglingAnk(async () => {
      const r = await toggleAnkorstoreEnabled(v);
      if (r.success) { setAnkEnabled(v); toast.success(v ? "Ankorstore activé" : "Ankorstore en pause", v ? "La sync est de nouveau active." : "Plus de propagation vers Ankorstore."); }
      else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
    });
  }

  // ── eFashion handlers ───────────────────────────────────────────────────────
  function handleEfaValidate() {
    if (!efaEmail.trim() || !efaPassword.trim()) return;
    showLoading();
    startValidatingEfa(async () => {
      try {
        setEfaStatus("checking"); setEfaVendor(null);
        const r = await validateEfashionCredentials({ email: efaEmail.trim(), password: efaPassword.trim() });
        if (r.valid) { setEfaStatus("valid"); if (r.vendor) setEfaVendor(r.vendor); toast.success("Connexion réussie", r.vendor ? `Bienvenue ${r.vendor.name} (vendeur n°${r.vendor.id}).` : "Identifiants eFashion valides."); }
        else { setEfaStatus("invalid"); toast.error("Connexion échouée", r.error ?? "Identifiants invalides."); }
      } finally { hideLoading(); }
    });
  }
  function handleEfaSave() {
    showLoading();
    startSavingEfa(async () => {
      try {
        const r = await updateEfashionCredentials({ email: efaEmail.trim(), password: efaPassword.trim() });
        if (r.success) { toast.success("Enregistré", "Identifiants eFashion sauvegardés."); setEfaEditing(false); setEfaEmail(""); setEfaPassword(""); }
        else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
      } finally { hideLoading(); }
    });
  }
  function handleEfaToggle(v: boolean) {
    startTogglingEfa(async () => {
      const r = await toggleEfashionEnabled(v);
      if (r.success) { setEfaEnabled(v); toast.success(v ? "eFashion activé" : "eFashion en pause", v ? "La sync est de nouveau active." : "Plus de propagation vers eFashion."); }
      else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
    });
  }

  // ── Faire handlers ──────────────────────────────────────────────────────────
  function handleFaiValidate() {
    if (!faiKey.trim()) return;
    showLoading();
    startValidatingFai(async () => {
      try {
        setFaiStatus("checking");
        const r = await validateFaireCredentials({ apiKey: faiKey.trim() });
        if (r.valid) { setFaiStatus("valid"); toast.success("Connexion réussie", "Clé API Faire valide."); }
        else { setFaiStatus("invalid"); toast.error("Connexion échouée", r.error ?? "Clé invalide."); }
      } finally { hideLoading(); }
    });
  }
  function handleFaiSave() {
    showLoading();
    startSavingFai(async () => {
      try {
        const r = await updateFaireCredentials({ apiKey: faiKey.trim() });
        if (r.success) { toast.success("Enregistré", "Clé Faire sauvegardée."); setFaiEditing(false); setFaiKey(""); }
        else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
      } finally { hideLoading(); }
    });
  }
  function handleFaiToggle(v: boolean) {
    startTogglingFai(async () => {
      const r = await toggleFaireEnabled(v);
      if (r.success) { setFaiEnabled(v); toast.success(v ? "Faire activé" : "Faire en pause", v ? "La sync est de nouveau active." : "Plus de propagation vers Faire."); }
      else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
    });
  }

  // ── Microstore handlers ─────────────────────────────────────────────────────
  function handleMicroToggle(v: boolean) {
    startTogglingMicro(async () => {
      const r = await toggleMicrostoreEnabled(v);
      if (r.success) { setMicroEnabled(v); toast.success(v ? "Microstore activé" : "Microstore en pause", v ? "L'import de commandes est de nouveau disponible." : "Bouton d'import masqué (la session reste enregistrée)."); }
      else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
    });
  }

  // ── Sauvegarde markup global ───────────────────────────────────────────────
  function handleSaveMarkup() {
    showLoading();
    startSavingMarkup(async () => {
      try {
        const r = await updateMarketplaceMarkup({
          pfs: pfsMarkup,
          ankorstoreWholesale: ankWholesale,
          ankorstoreRetail: ankRetail,
          ankorstoreVatRate: ankVat,
          efashion: efaMarkup,
          microstore: microMarkup,
          faireWholesale: faiWholesale,
          faireRetail: faiRetail,
        });
        if (r.success) toast.success("Enregistré", "Réglages prix sauvegardés.");
        else toast.error("Erreur", r.error ?? "Une erreur est survenue.");
      } finally { hideLoading(); }
    });
  }

  // ── Helpers status par marketplace ─────────────────────────────────────────
  function pfsCardStatus(): "ok" | "warn" | "off" | "checking" {
    if (pfsStatus === "checking") return "checking";
    if (!hasPfsConfig) return "off";
    if (pfsStatus === "invalid") return "warn";
    if (!pfsBrand) return "warn";
    return "ok";
  }
  function simpleStatus(has: boolean, st: typeof pfsStatus): "ok" | "warn" | "off" | "checking" {
    if (st === "checking") return "checking";
    if (!has) return "off";
    if (st === "invalid") return "warn";
    return "ok";
  }

  const rows: {
    brandKey: MarketplaceKey;
    subtitle: string;
    status: "ok" | "warn" | "off" | "checking";
    enabled: boolean;
    stats: MarketplaceStats;
    onOpenSettings: () => void;
    ctaLabel: string;
    /**
     * Marketplace sans publish automatique (Microstore : import commandes
     * seulement). Les colonnes stats "En ligne / À sync / Dernière sync"
     * s'affichent en "—" au lieu de 0.
     */
    noSyncStats?: boolean;
    /** Contrôle du toggle ON/OFF (absent si marketplace non configurée). */
    enabledControl?: {
      checked: boolean;
      toggling: boolean;
      onToggle: (v: boolean) => void;
    };
  }[] = [
    {
      brandKey: "pfs",
      subtitle: pfsBrand
        ? (pfsEnabled ? `Marque · ${pfsBrand.name}` : "Désactivé")
        : hasPfsConfig ? "Marque à choisir" : "Non configuré",
      status: pfsCardStatus(),
      enabled: hasPfsConfig && !!pfsBrand && pfsEnabled,
      stats: stats.pfs,
      onOpenSettings: () => setDrawerKey("pfs"),
      ctaLabel: hasPfsConfig ? "Réglages" : "Configurer",
      enabledControl: hasPfsConfig
        ? { checked: pfsEnabled, toggling: isTogglingPfs, onToggle: handlePfsToggle }
        : undefined,
    },
    {
      brandKey: "ankorstore",
      subtitle: hasAnkorstoreConfig ? (ankEnabled ? "Callback async" : "Désactivé") : "Non configuré",
      status: simpleStatus(hasAnkorstoreConfig, ankStatus),
      enabled: hasAnkorstoreConfig && ankEnabled,
      stats: stats.ankorstore,
      onOpenSettings: () => setDrawerKey("ankorstore"),
      ctaLabel: hasAnkorstoreConfig ? "Réglages" : "Configurer",
      enabledControl: hasAnkorstoreConfig
        ? { checked: ankEnabled, toggling: isTogglingAnk, onToggle: handleAnkToggle }
        : undefined,
    },
    {
      brandKey: "efashion",
      subtitle: hasEfashionConfig ? (efaEnabled ? (efaVendor ? `Vendeur · ${efaVendor.name}` : "GraphQL") : "Désactivé") : "Non configuré",
      status: simpleStatus(hasEfashionConfig, efaStatus),
      enabled: hasEfashionConfig && efaEnabled,
      stats: stats.efashion,
      onOpenSettings: () => setDrawerKey("efashion"),
      ctaLabel: hasEfashionConfig ? "Réglages" : "Configurer",
      enabledControl: hasEfashionConfig
        ? { checked: efaEnabled, toggling: isTogglingEfa, onToggle: handleEfaToggle }
        : undefined,
    },
    {
      brandKey: "faire",
      subtitle: hasFaireConfig ? (faiEnabled ? "Marketplace B2B" : "Désactivé") : "Non configuré",
      status: simpleStatus(hasFaireConfig, faiStatus),
      enabled: hasFaireConfig && faiEnabled,
      stats: stats.faire,
      onOpenSettings: () => setDrawerKey("faire"),
      ctaLabel: hasFaireConfig ? "Réglages" : "Configurer",
      enabledControl: hasFaireConfig
        ? { checked: faiEnabled, toggling: isTogglingFai, onToggle: handleFaiToggle }
        : undefined,
    },
    {
      brandKey: "microstore",
      subtitle: hasMicrostoreConfig
        ? (microEnabled ? "Import commandes · QR" : "Désactivé")
        : "Non connecté",
      status: hasMicrostoreConfig ? "ok" : "off",
      enabled: hasMicrostoreConfig && microEnabled,
      stats: { published: 0, toSync: 0, lastSyncAt: null },
      noSyncStats: true,
      onOpenSettings: () => setDrawerKey("microstore"),
      ctaLabel: hasMicrostoreConfig ? "Réglages" : "Connecter",
      enabledControl: hasMicrostoreConfig
        ? { checked: microEnabled, toggling: isTogglingMicro, onToggle: handleMicroToggle }
        : undefined,
    },
  ];

  const statusBadge = (status: "ok" | "warn" | "off" | "checking", enabled: boolean) => {
    if (status === "off") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-tertiary text-text-secondary text-xs px-2.5 py-1 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          Non configuré
        </span>
      );
    }
    if (status === "checking") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 text-xs px-2.5 py-1 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          Vérification
        </span>
      );
    }
    if (status === "warn") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 text-xs px-2.5 py-1 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          À vérifier
        </span>
      );
    }
    if (!enabled) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-tertiary text-text-secondary text-xs px-2.5 py-1 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          Désactivé
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Actif
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* ── Tableau marketplaces ────────────────────────────────────────── */}
      <div className="rounded-3xl border border-border bg-bg-primary p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Icons.Box className="w-4 h-4 text-text-muted" />
          <h3 className="font-heading text-[13px] font-semibold uppercase tracking-wider text-text-secondary">
            Vos marketplaces
          </h3>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-hidden rounded-2xl border border-border-light">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary text-[11px] uppercase tracking-wider text-text-secondary">
              <tr>
                <th className="py-3 pl-5 pr-3 text-left font-semibold">Marketplace</th>
                <th className="py-3 px-3 text-left font-semibold">Statut</th>
                <th className="py-3 px-3 text-center font-semibold">Actif</th>
                <th className="py-3 px-3 text-right font-semibold">En ligne</th>
                <th className="py-3 px-3 text-right font-semibold">À synchroniser</th>
                <th className="py-3 px-3 text-right font-semibold">Dernière sync</th>
                <th className="py-3 pl-3 pr-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light bg-bg-primary">
              {rows.map((row) => {
                const dimmed = row.status === "off" || !row.enabled;
                return (
                  <tr
                    key={row.brandKey}
                    className={`hover:bg-bg-secondary/60 transition-colors ${dimmed ? "opacity-70" : ""}`}
                  >
                    <td className="py-4 pl-5 pr-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="scale-75 origin-left -my-2">
                          <Logo brandKey={row.brandKey} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-body text-sm font-semibold text-text-primary truncate">
                            {MARKETPLACES_BRAND[row.brandKey].name}
                          </div>
                          <div className="font-body text-[11px] text-text-muted truncate">
                            {row.subtitle}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-3">{statusBadge(row.status, row.enabled)}</td>
                    <td className="py-4 px-3">
                      {row.enabledControl ? (
                        <div className="flex justify-center">
                          <Toggle
                            checked={row.enabledControl.checked}
                            disabled={row.enabledControl.toggling}
                            onChange={row.enabledControl.onToggle}
                            label={row.enabledControl.checked ? "ON" : "OFF"}
                          />
                        </div>
                      ) : (
                        <div className="text-center font-body text-[11px] text-text-muted">—</div>
                      )}
                    </td>
                    <td className="py-4 px-3 text-right tabular-nums font-body text-sm font-semibold text-text-primary">
                      {row.status === "off" || row.noSyncStats ? "—" : row.stats.published.toLocaleString("fr-FR")}
                    </td>
                    <td className="py-4 px-3 text-right tabular-nums font-body text-sm">
                      {row.status === "off" || row.noSyncStats || row.stats.toSync === 0 ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <span className="text-amber-700 font-medium">{row.stats.toSync}</span>
                      )}
                    </td>
                    <td className="py-4 px-3 text-right font-body text-xs text-text-muted">
                      {row.noSyncStats ? "—" : formatRelative(row.stats.lastSyncAt)}
                    </td>
                    <td className="py-4 pl-3 pr-5 text-right">
                      <button
                        type="button"
                        onClick={row.onOpenSettings}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-xs font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors"
                      >
                        <Icons.Settings className="w-3.5 h-3.5" />
                        {row.ctaLabel}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {rows.map((row) => {
            const dimmed = row.status === "off" || !row.enabled;
            return (
              <div
                key={row.brandKey}
                role="button"
                tabIndex={0}
                onClick={row.onOpenSettings}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.onOpenSettings(); } }}
                className={`w-full rounded-2xl border border-border-light bg-bg-primary p-4 text-left cursor-pointer hover:bg-bg-secondary/60 transition-colors ${dimmed ? "opacity-70" : ""}`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="scale-75 origin-left -my-2">
                    <Logo brandKey={row.brandKey} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-body text-sm font-semibold text-text-primary truncate">
                      {MARKETPLACES_BRAND[row.brandKey].name}
                    </div>
                    <div className="font-body text-[11px] text-text-muted truncate">{row.subtitle}</div>
                  </div>
                  {row.enabledControl && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Toggle
                        checked={row.enabledControl.checked}
                        disabled={row.enabledControl.toggling}
                        onChange={row.enabledControl.onToggle}
                        label={row.enabledControl.checked ? "ON" : "OFF"}
                      />
                    </div>
                  )}
                  {statusBadge(row.status, row.enabled)}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-bg-secondary/50 py-2">
                    <div className="font-heading text-base font-semibold tabular-nums text-text-primary">
                      {row.status === "off" || row.noSyncStats ? "—" : row.stats.published.toLocaleString("fr-FR")}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">En ligne</div>
                  </div>
                  <div className="rounded-lg bg-bg-secondary/50 py-2">
                    <div className={`font-heading text-base font-semibold tabular-nums ${!row.noSyncStats && row.stats.toSync > 0 ? "text-amber-700" : "text-text-muted"}`}>
                      {row.status === "off" || row.noSyncStats ? "—" : row.stats.toSync || "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">À sync</div>
                  </div>
                  <div className="rounded-lg bg-bg-secondary/50 py-2">
                    <div className="font-body text-[11px] text-text-primary leading-tight pt-1">
                      {row.noSyncStats ? "—" : formatRelative(row.stats.lastSyncAt)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-text-muted mt-0.5">Sync</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Aperçu prix HT (accordéon replié par défaut) ────────────────── */}
      <details className="group rounded-2xl border border-border bg-bg-primary shadow-sm">
        <summary className="cursor-pointer list-none px-5 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-bg-secondary/40 rounded-2xl">
          <div className="flex items-center gap-2.5">
            <Icons.Calculator className="w-4 h-4 text-text-muted" />
            <span className="font-heading text-[13px] font-semibold uppercase tracking-wider text-text-secondary">
              Aperçu prix HT
            </span>
            <span className="font-body text-xs text-text-muted">
              — voir comment un prix devient sur chaque marketplace
            </span>
          </div>
          <span className="font-body text-[11px] text-text-muted uppercase tracking-wider group-open:hidden">Déplier</span>
          <span className="font-body text-[11px] text-text-muted uppercase tracking-wider hidden group-open:inline">Replier</span>
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step="0.5"
                value={previewHT}
                onChange={(e) => setPreviewHT(Math.max(0, Number(e.target.value) || 0))}
                className="w-28 h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-base font-heading font-semibold focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow tabular-nums"
              />
              <span className="font-body text-sm text-text-secondary">€ HT en boutique</span>
            </div>
            <button
              type="button"
              onClick={handleSaveMarkup}
              disabled={isSavingMarkup}
              className="ml-auto shrink-0 inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 shadow-sm"
            >
              {isSavingMarkup ? <><Icons.Loader className="w-4 h-4" /> Enregistrement…</> : "Sauvegarder les prix"}
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border-light">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary text-[11px] uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="py-2.5 pl-4 pr-3 text-left font-semibold">Marketplace</th>
                  <th className="py-2.5 px-3 text-left font-semibold">Ce qui est envoyé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light bg-bg-primary">
                {(["pfs", "ankorstore", "efashion", "faire", "microstore"] as const).map((key) => (
                  <tr key={key}>
                    <td className="py-2.5 pl-4 pr-3 font-body text-xs font-medium text-text-primary">
                      {MARKETPLACES_BRAND[key].name}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {previews[key].map((line, i) => (
                          <span key={i} className="font-body text-xs text-text-secondary">
                            <span className="text-text-muted">{line.label} · </span>
                            <span className="font-semibold tabular-nums text-text-primary">{line.value}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {/* ═══════════════════ DRAWERS ═══════════════════ */}
      <Drawer open={drawerKey === "pfs"} onClose={() => setDrawerKey(null)} brandKey="pfs">
        <DrawerSection icon={<Icons.Plug className="w-4 h-4" />} title="Identifiants" subtitle="Email et mot de passe de votre compte Paris Fashion Shops.">
          <CredentialBlock
            hasConfig={hasPfsConfig}
            editing={pfsEditing}
            setEditing={setPfsEditing}
            status={pfsStatus}
            validating={isValidatingPfs}
            saving={isSavingPfs}
            onValidate={handlePfsValidate}
            onSave={handlePfsSave}
            canSave={!!pfsEmail.trim() && !!pfsPassword.trim()}
            fields={<>
              <Field label="Email" type="email" value={pfsEmail} onChange={(v) => { setPfsEmail(v); if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none"); }} placeholder="votre@email-pfs.com" disabled={isValidatingPfs || isSavingPfs} />
              <Field label="Mot de passe" type="password" value={pfsPassword} onChange={(v) => { setPfsPassword(v); if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none"); }} placeholder="••••••••" disabled={isValidatingPfs || isSavingPfs} />
            </>}
          />
        </DrawerSection>

        <DrawerSection
          icon={<Icons.Tag className="w-4 h-4" />}
          title="Marque utilisée"
          subtitle="Sans marque sélectionnée, toutes les opérations PFS sont bloquées."
        >
          {!hasPfsConfig ? (
            <p className="font-body text-xs text-text-muted">Renseignez vos identifiants PFS pour choisir une marque.</p>
          ) : !brandPickerOpen ? (
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-bg-secondary/60 border border-border-light">
              <div className={`flex-1 font-body text-sm ${pfsBrand ? "text-text-primary font-medium" : "text-text-muted italic"}`}>
                {pfsBrand ? pfsBrand.name : "Aucune marque sélectionnée — PFS verrouillé"}
              </div>
              <button
                type="button"
                onClick={openBrandPicker}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-body font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                <Icons.Pencil className="w-3.5 h-3.5" />
                {pfsBrand ? "Changer" : "Choisir"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {isLoadingBrands && (
                <div className="inline-flex items-center gap-2 text-xs font-body text-text-muted">
                  <Icons.Loader className="w-3.5 h-3.5" /> Chargement des marques…
                </div>
              )}
              {brandListError && <p className="font-body text-xs text-error">{brandListError}</p>}
              {brandList && brandList.length === 0 && (
                <p className="font-body text-xs text-text-muted">Aucune marque disponible sur votre compte PFS.</p>
              )}
              {brandList && brandList.length > 0 && (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {brandList.map((b) => {
                    const isCurrent = pfsBrand?.id === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        disabled={isSavingBrand}
                        onClick={() => handlePickBrand({ id: b.id, name: b.name })}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                          isCurrent ? "border-bg-dark bg-bg-dark/5" : "border-border bg-bg-primary hover:bg-bg-secondary"
                        } disabled:opacity-50`}
                      >
                        <span className="flex-1 font-body text-sm text-text-primary">{b.name}</span>
                        {isCurrent && <Icons.Check className="w-4 h-4 text-emerald-600" />}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() => setBrandPickerOpen(false)}
                className="inline-flex items-center gap-1 h-8 px-2 text-xs font-body text-text-muted hover:text-text-primary transition-colors"
              >
                Fermer
              </button>
            </div>
          )}
        </DrawerSection>

        <DrawerSection icon={<Icons.Bolt className="w-4 h-4" />} title="Majoration prix HT" subtitle="Appliquée à tous les prix envoyés à PFS.">
          <MarkupRow label="Prix HT" state={pfsMarkup} onChange={setPfsMarkup} />
          <DrawerSaveBar onSave={handleSaveMarkup} saving={isSavingMarkup} />
        </DrawerSection>

        <DrawerSection
          icon={<Icons.Box className="w-4 h-4" />}
          title="Comportement en rupture de stock"
          subtitle="Ce qui se passe côté Paris Fashion Shops quand le stock d'une variante — ou de toutes les variantes d'un produit — passe à 0."
        >
          <div className="space-y-3">
            <div className="rounded-xl border border-border-light bg-bg-secondary/40 p-3.5">
              <p className="font-body text-xs font-medium text-text-primary mb-1">
                Variante à stock 0
              </p>
              <p className="font-body text-[11px] text-text-muted mb-3">
                Désactiver = la couleur disparaît de la fiche PFS. Laisser active = la couleur reste visible, marquée en rupture.
              </p>
              <div className="flex rounded-lg border border-border overflow-hidden h-9">
                <button
                  type="button"
                  onClick={() => setPfsOosDeactivate(true)}
                  className={`flex-1 text-xs font-body font-medium transition-colors ${
                    pfsOosDeactivate ? "bg-bg-dark text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                  }`}
                >
                  Désactiver la variante
                </button>
                <button
                  type="button"
                  onClick={() => setPfsOosDeactivate(false)}
                  className={`flex-1 text-xs font-body font-medium transition-colors ${
                    !pfsOosDeactivate ? "bg-bg-dark text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                  }`}
                >
                  Laisser active
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border-light bg-bg-secondary/40 p-3.5">
              <p className="font-body text-xs font-medium text-text-primary mb-1">
                Toutes les variantes en rupture
              </p>
              <p className="font-body text-[11px] text-text-muted mb-3">
                Ce que devient le produit sur PFS quand plus aucune couleur n'a de stock. Réversible dès qu'une variante repasse en stock.
              </p>
              <div className="flex rounded-lg border border-border overflow-hidden h-9">
                {(
                  [
                    { value: "archived" as const, label: "Archiver" },
                    { value: "deleted" as const, label: "Supprimer" },
                    { value: "draft" as const, label: "Brouillon" },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPfsOosAction(opt.value)}
                    className={`flex-1 text-xs font-body font-medium transition-colors ${
                      pfsOosAction === opt.value
                        ? "bg-bg-dark text-text-inverse"
                        : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handlePfsOosSave}
              disabled={isSavingPfsOos}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {isSavingPfsOos ? <><Icons.Loader className="w-3.5 h-3.5" /> Enregistrement…</> : "Sauvegarder"}
            </button>
          </div>
        </DrawerSection>
      </Drawer>

      <Drawer open={drawerKey === "ankorstore"} onClose={() => setDrawerKey(null)} brandKey="ankorstore">
        <DrawerSection icon={<Icons.Plug className="w-4 h-4" />} title="Identifiants API" subtitle="Client ID et Client Secret de votre app Ankorstore.">
          <CredentialBlock
            hasConfig={hasAnkorstoreConfig}
            editing={ankEditing}
            setEditing={setAnkEditing}
            status={ankStatus}
            validating={isValidatingAnk}
            saving={isSavingAnk}
            onValidate={handleAnkValidate}
            onSave={handleAnkSave}
            canSave={!!ankClientId.trim() && !!ankClientSecret.trim()}
            fields={<>
              <Field label="Client ID" type="text" value={ankClientId} onChange={(v) => { setAnkClientId(v); if (ankStatus === "valid" || ankStatus === "invalid") setAnkStatus("none"); }} placeholder="votre-client-id" disabled={isValidatingAnk || isSavingAnk} />
              <Field label="Client Secret" type="password" value={ankClientSecret} onChange={(v) => { setAnkClientSecret(v); if (ankStatus === "valid" || ankStatus === "invalid") setAnkStatus("none"); }} placeholder="••••••••" disabled={isValidatingAnk || isSavingAnk} />
            </>}
          />
        </DrawerSection>

        <DrawerSection icon={<Icons.Bolt className="w-4 h-4" />} title="Majoration prix" subtitle="Gros = envoyé aux détaillants. Public = prix conseillé affiché en vitrine Ankorstore.">
          <div className="space-y-3">
            <MarkupRow label="Prix de gros" state={ankWholesale} onChange={setAnkWholesale} />
            <MarkupRow label="Prix public conseillé" state={ankRetail} onChange={setAnkRetail} />
            <div className="rounded-xl border border-border-light bg-bg-secondary/40 p-3.5">
              <label className="font-body text-xs font-medium text-text-primary block mb-2">TVA par défaut (%)</label>
              <input
                type="number"
                min={0} max={100} step="0.1"
                value={ankVat}
                onChange={(e) => setAnkVat(Number(e.target.value) || 0)}
                placeholder="20"
                className="w-24 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-bg-dark/15 transition-shadow"
              />
            </div>
          </div>
          <DrawerSaveBar onSave={handleSaveMarkup} saving={isSavingMarkup} />
        </DrawerSection>
      </Drawer>

      <Drawer open={drawerKey === "faire"} onClose={() => setDrawerKey(null)} brandKey="faire">
        <DrawerSection icon={<Icons.Plug className="w-4 h-4" />} title="Clé API" subtitle="Disponible dans votre portail Faire : Settings → Integrations → Generate API key.">
          <CredentialBlock
            hasConfig={hasFaireConfig}
            editing={faiEditing}
            setEditing={setFaiEditing}
            status={faiStatus}
            validating={isValidatingFai}
            saving={isSavingFai}
            onValidate={handleFaiValidate}
            onSave={handleFaiSave}
            canSave={!!faiKey.trim()}
            fields={
              <Field label="Clé API Faire" type="password" value={faiKey} onChange={(v) => { setFaiKey(v); if (faiStatus === "valid" || faiStatus === "invalid") setFaiStatus("none"); }} placeholder="••••••••••••••••••••" disabled={isValidatingFai || isSavingFai} />
            }
          />
        </DrawerSection>

        <DrawerSection icon={<Icons.Bolt className="w-4 h-4" />} title="Majoration prix" subtitle="Faire impose un prix public ≥ 2× le prix de gros, ajusté à la hausse si besoin.">
          <div className="space-y-3">
            <MarkupRow label="Prix de gros" state={faiWholesale} onChange={setFaiWholesale} />
            <MarkupRow label="Prix public conseillé" state={faiRetail} onChange={setFaiRetail} />
          </div>
          <DrawerSaveBar onSave={handleSaveMarkup} saving={isSavingMarkup} />
        </DrawerSection>
      </Drawer>

      <Drawer open={drawerKey === "efashion"} onClose={() => setDrawerKey(null)} brandKey="efashion">
        <DrawerSection icon={<Icons.Plug className="w-4 h-4" />} title="Identifiants" subtitle="Email et mot de passe de votre compte eFashion Paris.">
          <CredentialBlock
            hasConfig={hasEfashionConfig}
            editing={efaEditing}
            setEditing={setEfaEditing}
            status={efaStatus}
            validating={isValidatingEfa}
            saving={isSavingEfa}
            onValidate={handleEfaValidate}
            onSave={handleEfaSave}
            canSave={!!efaEmail.trim() && !!efaPassword.trim()}
            fields={<>
              <Field label="Email" type="email" value={efaEmail} onChange={(v) => { setEfaEmail(v); if (efaStatus === "valid" || efaStatus === "invalid") setEfaStatus("none"); }} placeholder="votre@email-efashion.com" disabled={isValidatingEfa || isSavingEfa} />
              <Field label="Mot de passe" type="password" value={efaPassword} onChange={(v) => { setEfaPassword(v); if (efaStatus === "valid" || efaStatus === "invalid") setEfaStatus("none"); }} placeholder="••••••••" disabled={isValidatingEfa || isSavingEfa} />
            </>}
          />
          {efaVendor && (
            <p className="mt-3 font-body text-[11px] text-emerald-700">
              Connecté à <strong>{efaVendor.name}</strong> (vendeur n°{efaVendor.id}).
            </p>
          )}
        </DrawerSection>

        <DrawerSection icon={<Icons.Bolt className="w-4 h-4" />} title="Majoration prix" subtitle="Appliquée au prix de gros envoyé à eFashion.">
          <MarkupRow label="Prix de gros" state={efaMarkup} onChange={setEfaMarkup} />
          <DrawerSaveBar onSave={handleSaveMarkup} saving={isSavingMarkup} />
        </DrawerSection>
      </Drawer>

      <Drawer open={drawerKey === "microstore"} onClose={() => setDrawerKey(null)} brandKey="microstore">
        <DrawerSection
          icon={<Icons.Plug className="w-4 h-4" />}
          title="Connexion"
          subtitle="Nécessaire pour importer les commandes Microstore."
        >
          <MicrostoreConnectCard
            initiallyConnected={hasMicrostoreConfig}
            initiallyEnabled={microEnabled}
            initialExpiresAtIso={microstoreExpiresAtIso}
          />
        </DrawerSection>

        <DrawerSection icon={<Icons.Bolt className="w-4 h-4" />} title="Majoration prix" subtitle="Appliquée aux prix exportés dans le fichier Excel Microstore.">
          <MarkupRow label="Prix Excel" state={microMarkup} onChange={setMicroMarkup} />
          <DrawerSaveBar onSave={handleSaveMarkup} saving={isSavingMarkup} />
        </DrawerSection>
      </Drawer>
    </div>
  );
}

function DrawerSaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <div className="mt-4 flex justify-end">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
      >
        {saving ? <><Icons.Loader className="w-3.5 h-3.5" /> Enregistrement…</> : "Sauvegarder les réglages prix"}
      </button>
    </div>
  );
}
