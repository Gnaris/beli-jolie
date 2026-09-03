"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import SettingsModal from "./SettingsModal";
import {
  GROUP_ORDER,
  getTileMeta,
  isSettingsTile,
  type SettingsTileKey,
  type TileAccent,
  type TileStatus,
  type TileGroup,
} from "@/lib/settings-tiles";

/* ─────────────── Icônes par tuile (identiques à la maquette) ─────────────── */
const TILE_ICONS: Record<SettingsTileKey, ReactNode> = {
  vitrine:      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>,
  societe:      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15"/></svg>,
  horaires:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>,
  paiement:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>,
  livraison:    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 4v4h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  regles:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5"/><path d="M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/></svg>,
  marketplaces: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14"/></svg>,
  contenu:      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>,
  messagerie:   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75"/><path d="M21.75 6.75l-9.75 6-9.75-6"/></svg>,
  "habillage-mails": <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 8h18M7 12h6M7 15h4"/></svg>,
  traduction:   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h7M9 3v2M4 9c0 5 4 8 8 8M9 9c-2 4 0 8 4 8M14 5l6 14M17 15h6"/></svg>,
  compte:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  maintenance:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v3.75m0 3.75h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>,
};

const ACCENT_TILE_STYLES: Record<TileAccent, { topBar: string; iconBg: string; halo: string }> = {
  slate:   { topBar: "from-slate-400 to-slate-800",     iconBg: "bg-slate-100 border-slate-200 text-slate-700",     halo: "bg-slate-300/30" },
  sky:     { topBar: "from-sky-300 to-sky-700",         iconBg: "bg-sky-50 border-sky-100 text-sky-700",             halo: "bg-sky-200/30" },
  emerald: { topBar: "from-emerald-300 to-emerald-700", iconBg: "bg-emerald-50 border-emerald-100 text-emerald-700", halo: "bg-emerald-300/30" },
  violet:  { topBar: "from-violet-300 to-violet-700",   iconBg: "bg-violet-50 border-violet-100 text-violet-700",    halo: "bg-violet-200/30" },
  rose:    { topBar: "from-rose-300 to-rose-700",       iconBg: "bg-rose-50 border-rose-100 text-rose-700",          halo: "bg-rose-200/30" },
  amber:   { topBar: "from-amber-300 to-amber-700",     iconBg: "bg-amber-50 border-amber-100 text-amber-700",       halo: "bg-amber-200/30" },
};

const GROUP_BAR_ACCENT: Record<TileAccent, string> = {
  slate:   "from-slate-500 to-slate-900 text-slate-700",
  sky:     "from-sky-500 to-sky-800 text-sky-700",
  emerald: "from-emerald-500 to-emerald-800 text-emerald-700",
  violet:  "from-violet-500 to-violet-800 text-violet-700",
  rose:    "from-rose-500 to-rose-800 text-rose-700",
  amber:   "from-amber-500 to-amber-800 text-amber-700",
};

export interface DashboardTile {
  key: SettingsTileKey;
  status: TileStatus;
  /** Petit résumé factuel affiché en bas de la tuile (« 3 messages actifs · bannière définie »). */
  summary?: string;
  /** Le contenu de la modale — server components pré-rendus depuis page.tsx. */
  content: ReactNode;
  /** Largeur de la modale — default (5xl), wide (6xl), xl (7xl), full (95vw). */
  modalSize?: "default" | "wide" | "xl" | "full";
}

interface Props {
  tiles: DashboardTile[];
  initialOpen: SettingsTileKey | null;
}

export default function SettingsDashboard({ tiles, initialOpen }: Props) {
  const [openTile, setOpenTile] = useState<SettingsTileKey | null>(initialOpen);

  // Sync URL sans re-render (deep-link possible : /admin/parametres?open=paiement)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("tab"); // ancien nom, remplacé par ?open=
    if (openTile) url.searchParams.set("open", openTile);
    else url.searchParams.delete("open");
    window.history.replaceState(null, "", url.toString());
  }, [openTile]);

  // Écoute les liens internes vers /admin/parametres?open=X (retour arrière navigateur)
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("open");
      setOpenTile(next && isSettingsTile(next) ? next : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const handleOpen = useCallback((key: SettingsTileKey) => setOpenTile(key), []);
  const handleClose = useCallback(() => setOpenTile(null), []);

  const kpi = useMemo(() => {
    let ok = 0, warn = 0, off = 0;
    for (const t of tiles) {
      if (t.status.tone === "ok") ok++;
      else if (t.status.tone === "warn" || t.status.tone === "danger") warn++;
      else off++;
    }
    return { ok, warn, off };
  }, [tiles]);

  const tilesByGroup = useMemo(() => {
    const map = new Map<TileGroup, DashboardTile[]>();
    for (const t of tiles) {
      const g = getTileMeta(t.key).group;
      const arr = map.get(g) ?? [];
      arr.push(t);
      map.set(g, arr);
    }
    return map;
  }, [tiles]);

  const openTileData = openTile ? tiles.find((t) => t.key === openTile) : null;
  const openTileMeta = openTile ? getTileMeta(openTile) : null;

  return (
    <div className="space-y-8">
      {/* ══════════════ HERO ══════════════ */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm bg-bg-primary">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-20 -right-16 w-72 h-72 rounded-full blur-3xl bg-violet-200/30 pointer-events-none" />
        <div className="absolute -bottom-24 left-1/4 w-72 h-72 rounded-full blur-3xl bg-sky-200/30 pointer-events-none" />

        <div className="relative p-6 lg:p-8">
          <div className="text-[12px] text-text-muted mb-2 flex items-center gap-1.5">
            <Link href="/admin" className="hover:text-text-primary transition-colors">Admin</Link>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6"/></svg>
            <span className="text-text-secondary">Paramètres</span>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 backdrop-blur border border-border text-[11px] font-body font-bold uppercase tracking-[0.18em] text-text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-text-primary shadow-[0_0_0_3px_rgba(24,24,27,0.14)]" />
                Cockpit · {tiles.length} domaines
              </span>
              <h1 className="page-title mt-3">Vos paramètres, d&apos;un coup d&apos;œil</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Chaque tuile ouvre un écran dédié. Vous voyez tout de suite ce qui est{" "}
                <span className="text-emerald-700 font-semibold">en place</span>, ce qui reste{" "}
                <span className="text-amber-700 font-semibold">à finir</span>, et ce qui est{" "}
                <span className="text-slate-700 font-semibold">non configuré</span>.
              </p>
            </div>
            <KpiStrip ok={kpi.ok} warn={kpi.warn} off={kpi.off} />
          </div>
        </div>
      </section>

      {/* ══════════════ SECTIONS GROUPÉES ══════════════ */}
      {GROUP_ORDER.map((g) => {
        const groupTiles = tilesByGroup.get(g.key);
        if (!groupTiles || groupTiles.length === 0) return null;
        return (
          <div key={g.key}>
            <div className="flex items-center gap-3 mb-4 px-1">
              <span className={`w-[3px] h-5 rounded-full bg-gradient-to-b ${GROUP_BAR_ACCENT[g.accent].split(" ").slice(0, 2).join(" ")}`} />
              <h2 className={`text-[11px] font-body font-bold uppercase tracking-[0.18em] ${GROUP_BAR_ACCENT[g.accent].split(" ")[2]}`}>
                {g.label}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {groupTiles.map((t) => (
                <TileButton key={t.key} tile={t} onOpen={handleOpen} />
              ))}
            </div>
          </div>
        );
      })}

      {/* ══════════════ MODALE UNIQUE ══════════════ */}
      {openTileData && openTileMeta && (
        <SettingsModal
          open={true}
          onClose={handleClose}
          title={openTileMeta.title}
          description={openTileMeta.description}
          icon={TILE_ICONS[openTileMeta.key]}
          accent={openTileMeta.accent}
          headerRight={<StatusChipDark status={openTileData.status} />}
          size={openTileData.modalSize ?? "default"}
        >
          {openTileData.content}
        </SettingsModal>
      )}
    </div>
  );
}

/* ─────────────── KPI Strip (3 mini-cards) ─────────────── */
function KpiStrip({ ok, warn, off }: { ok: number; warn: number; off: number }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <KpiCard tone="ok"    label="En place"        value={ok}   />
      <KpiCard tone="warn"  label="À finir"         value={warn} />
      <KpiCard tone="off"   label="Non configurés"  value={off}  />
    </div>
  );
}

function KpiCard({ tone, label, value }: { tone: "ok" | "warn" | "off"; label: string; value: number }) {
  const styles = tone === "ok"
    ? { bg: "from-emerald-50 to-white", border: "border-emerald-100", text: "text-emerald-700", halo: "bg-emerald-300/40" }
    : tone === "warn"
      ? { bg: "from-amber-50 to-white", border: "border-amber-100", text: "text-amber-700", halo: "bg-amber-300/40" }
      : { bg: "from-slate-50 to-white", border: "border-slate-200", text: "text-slate-700", halo: "bg-slate-300/30" };
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${styles.bg} border ${styles.border} px-4 py-3 min-w-[120px]`}>
      <div className={`absolute -top-6 -right-6 w-14 h-14 rounded-full blur-3xl pointer-events-none ${styles.halo}`} />
      <div className={`text-[10px] font-body font-bold uppercase tracking-wider ${styles.text}`}>{label}</div>
      <div className={`font-heading text-2xl font-bold tabular-nums mt-0.5 ${styles.text}`}>{value}</div>
    </div>
  );
}

/* ─────────────── Tuile cliquable ─────────────── */
function TileButton({ tile, onOpen }: { tile: DashboardTile; onOpen: (k: SettingsTileKey) => void }) {
  const meta = getTileMeta(tile.key);
  const style = ACCENT_TILE_STYLES[meta.accent];
  return (
    <button
      type="button"
      onClick={() => onOpen(tile.key)}
      className={`group relative overflow-hidden rounded-2xl bg-bg-primary border border-border p-6 flex flex-col gap-3 text-left cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-border-strong min-h-[200px] ${meta.wide ? "sm:col-span-2" : ""}`}
    >
      {/* Bande dégradée fine en haut */}
      <span className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${style.topBar}`} />
      {/* Halo coin */}
      <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full blur-3xl pointer-events-none ${style.halo}`} />

      <div className="relative flex items-start justify-between gap-3">
        <span className={`inline-flex items-center justify-center w-11 h-11 rounded-xl border shrink-0 ${style.iconBg}`}>
          {TILE_ICONS[meta.key]}
        </span>
        <TileStatusChip status={tile.status} />
      </div>

      <div className="relative flex-1">
        <h3 className="font-heading text-lg font-bold text-text-primary leading-tight">{meta.title}</h3>
        <p className="text-sm text-text-muted mt-0.5 leading-snug">{meta.description}</p>
      </div>

      <div className="relative text-[12px] text-text-muted flex items-center gap-1.5 min-h-[16px]">
        <span className="truncate">{tile.summary ?? ""}</span>
        <svg className="w-3.5 h-3.5 ml-auto shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </div>
    </button>
  );
}

/* ─────────────── Chips de statut ─────────────── */
function TileStatusChip({ status }: { status: TileStatus }) {
  const map = {
    ok:     "bg-emerald-50 text-emerald-700 border-emerald-100",
    warn:   "bg-amber-50 text-amber-800 border-amber-100",
    off:    "bg-slate-50 text-slate-600 border-slate-200",
    danger: "bg-rose-50 text-rose-800 border-rose-100",
  } as const;
  const dot = {
    ok:     "bg-emerald-500",
    warn:   "bg-amber-500",
    off:    "bg-slate-400",
    danger: "bg-rose-500",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${map[status.tone]}`}>
      <span className={`w-2 h-2 rounded-full ${dot[status.tone]}`} />
      {status.label}
    </span>
  );
}

function StatusChipDark({ status }: { status: TileStatus }) {
  const dot = {
    ok:     "bg-emerald-400",
    warn:   "bg-amber-400",
    off:    "bg-white/40",
    danger: "bg-rose-400",
  } as const;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-white/16 bg-white/10 text-white">
      <span className={`w-1.5 h-1.5 rounded-full ${dot[status.tone]}`} />
      {status.label}
    </span>
  );
}
