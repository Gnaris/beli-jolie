"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  GROUP_ORDER,
  getTileMeta,
  type SettingsTileKey,
  type TileAccent,
  type TileStatus,
  type TileGroup,
} from "@/lib/settings-tiles";

/* ─────────────── Icônes par tuile ─────────────── */
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
  whatsapp:     <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/></svg>,
  traduction:   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h7M9 3v2M4 9c0 5 4 8 8 8M9 9c-2 4 0 8 4 8M14 5l6 14M17 15h6"/></svg>,
  compte:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  maintenance:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v3.75m0 3.75h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>,
};

/** Icônes réduites 16px pour la nav. */
const NAV_ICONS: Record<SettingsTileKey, ReactNode> = {
  vitrine:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>,
  societe:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15"/></svg>,
  horaires:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>,
  paiement:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>,
  livraison:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 4v4h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  regles:       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5"/><path d="M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/></svg>,
  marketplaces: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14"/></svg>,
  contenu:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>,
  messagerie:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75"/><path d="M21.75 6.75l-9.75 6-9.75-6"/></svg>,
  whatsapp:     <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/></svg>,
  traduction:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h7M9 3v2M4 9c0 5 4 8 8 8M9 9c-2 4 0 8 4 8M14 5l6 14M17 15h6"/></svg>,
  compte:       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  maintenance:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v3.75m0 3.75h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>,
};

const ACCENT_SECTION_STYLES: Record<TileAccent, { topBar: string; iconBg: string; halo: string }> = {
  slate:   { topBar: "from-slate-400 to-slate-800",     iconBg: "bg-slate-100 border-slate-200 text-slate-700",     halo: "bg-slate-300/30" },
  sky:     { topBar: "from-sky-300 to-sky-700",         iconBg: "bg-sky-50 border-sky-100 text-sky-700",             halo: "bg-sky-200/30" },
  emerald: { topBar: "from-emerald-300 to-emerald-700", iconBg: "bg-emerald-50 border-emerald-100 text-emerald-700", halo: "bg-emerald-300/30" },
  violet:  { topBar: "from-violet-300 to-violet-700",   iconBg: "bg-violet-50 border-violet-100 text-violet-700",    halo: "bg-violet-200/30" },
  rose:    { topBar: "from-rose-300 to-rose-700",       iconBg: "bg-rose-50 border-rose-100 text-rose-700",          halo: "bg-rose-200/30" },
  amber:   { topBar: "from-amber-300 to-amber-700",     iconBg: "bg-amber-50 border-amber-100 text-amber-700",       halo: "bg-amber-300/30" },
};

const GROUP_BAR_ACCENT: Record<TileAccent, { bar: string; text: string }> = {
  slate:   { bar: "from-slate-500 to-slate-900",     text: "text-slate-700" },
  sky:     { bar: "from-sky-500 to-sky-800",         text: "text-sky-700" },
  emerald: { bar: "from-emerald-500 to-emerald-800", text: "text-emerald-700" },
  violet:  { bar: "from-violet-500 to-violet-800",   text: "text-violet-700" },
  rose:    { bar: "from-rose-500 to-rose-800",       text: "text-rose-700" },
  amber:   { bar: "from-amber-500 to-amber-800",     text: "text-amber-700" },
};

const NAV_DOT: Record<TileStatus["tone"], string> = {
  ok:     "bg-emerald-500",
  warn:   "bg-amber-500",
  off:    "bg-slate-400",
  danger: "bg-rose-500",
};

/** Normalise une chaîne pour la recherche (accents + casse). */
const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");
function normalizeText(s: string): string {
  return s.normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase();
}

export interface DashboardTile {
  key: SettingsTileKey;
  status: TileStatus;
  /** Petit résumé factuel affiché en bas de la tuile. */
  summary?: string;
  /** Le contenu de la section — server components pré-rendus depuis page.tsx. */
  content: ReactNode;
  /** Conservé pour compat (ignoré depuis la refonte "tout sur une page"). */
  modalSize?: "default" | "wide" | "xl" | "full";
}

interface Props {
  tiles: DashboardTile[];
  /** Si l'URL arrive avec ?open=X ou ?tab=X, on scrolle direct à la section. */
  initialOpen: SettingsTileKey | null;
}

export default function SettingsDashboard({ tiles, initialOpen }: Props) {
  const [activeKey, setActiveKey] = useState<SettingsTileKey | null>(
    initialOpen ?? tiles[0]?.key ?? null,
  );
  // Clé de la section en train de sortir (anim swipe out). null quand aucune
  // transition en cours.
  const [prevKey, setPrevKey] = useState<SettingsTileKey | null>(null);
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const needle = useMemo(() => normalizeText(search.trim()), [search]);

  const matchesSearch = useMemo(() => {
    if (!needle) return () => true;
    return (t: DashboardTile) => {
      const meta = getTileMeta(t.key);
      const hay = normalizeText(
        [meta.title, meta.description, t.status.label, t.summary ?? ""].join(" "),
      );
      return hay.includes(needle);
    };
  }, [needle]);

  // Nettoyage de l'URL (?open= / ?tab=) après le mount — la section demandée
  // est déjà sélectionnée via le state initial.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initialOpen) {
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      url.searchParams.delete("open");
      window.history.replaceState(null, "", url.toString() + `#${initialOpen}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fin de l'animation de sortie : on démonte la section précédente ~340 ms
  // après le changement (320 ms d'anim + petite marge). La clé change
  // à chaque transition pour relancer le timer proprement.
  useEffect(() => {
    if (prevKey === null) return;
    const t = window.setTimeout(() => setPrevKey(null), 340);
    return () => window.clearTimeout(t);
  }, [prevKey, activeKey]);

  const kpi = useMemo(() => {
    let ok = 0, warn = 0, off = 0;
    for (const t of tiles) {
      if (t.status.tone === "ok") ok++;
      else if (t.status.tone === "warn" || t.status.tone === "danger") warn++;
      else off++;
    }
    return { ok, warn, off };
  }, [tiles]);

  /** Tuiles visibles (après filtre recherche), groupées. */
  const visibleTilesByGroup = useMemo(() => {
    const map = new Map<TileGroup, DashboardTile[]>();
    for (const t of tiles) {
      if (!matchesSearch(t)) continue;
      const g = getTileMeta(t.key).group;
      const arr = map.get(g) ?? [];
      arr.push(t);
      map.set(g, arr);
    }
    return map;
  }, [tiles, matchesSearch]);

  /** Index de parité (0 ou 1) par clé — pour l'alternance 1 sur 2. */
  const parityByKey = useMemo(() => {
    const m = new Map<SettingsTileKey, number>();
    let i = 0;
    for (const g of GROUP_ORDER) {
      const list = visibleTilesByGroup.get(g.key) ?? [];
      for (const t of list) {
        m.set(t.key, i % 2);
        i += 1;
      }
    }
    return m;
  }, [visibleTilesByGroup]);

  const totalVisible = useMemo(() => {
    let n = 0;
    visibleTilesByGroup.forEach((arr) => { n += arr.length; });
    return n;
  }, [visibleTilesByGroup]);

  const handleNavClick = (key: SettingsTileKey) => {
    setMobileNavOpen(false);
    if (key === activeKey) return;
    // Mémorise la section sortante pour lancer son anim "out" en parallèle
    // de l'anim "in" de la nouvelle section. Si une transition est déjà en
    // cours (prevKey existe encore), on la remplace — la plus ancienne saute.
    setPrevKey(activeKey);
    setActiveKey(key);
  };

  const activeTile = useMemo(
    () => tiles.find((t) => t.key === activeKey) ?? null,
    [tiles, activeKey],
  );
  const prevTile = useMemo(
    () => (prevKey ? tiles.find((t) => t.key === prevKey) ?? null : null),
    [tiles, prevKey],
  );
  const activeParity = activeTile ? parityByKey.get(activeTile.key) ?? 0 : 0;
  const prevParity = prevTile ? parityByKey.get(prevTile.key) ?? 0 : 0;

  return (
    <div className="space-y-6">
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
                Cockpit · {tiles.length} réglages
              </span>
              <h1 className="page-title mt-3">Vos paramètres, section par section</h1>
              <p className="page-subtitle font-body max-w-2xl">
                Cliquez un libellé à gauche pour afficher la section correspondante.
              </p>
            </div>
            <KpiStrip ok={kpi.ok} warn={kpi.warn} off={kpi.off} />
          </div>
        </div>
      </section>

      {/* ══════════════ GRILLE 2 COLONNES : NAV + CONTENU ══════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-5 items-start">

        {/* Nav gauche sticky, compacte */}
        <aside className="lg:sticky lg:top-6 bg-bg-primary border border-border rounded-xl shadow-sm overflow-hidden">
          {/* Barre de recherche (toujours visible) + bouton toggle mobile */}
          <div className="p-2 border-b border-border bg-bg-secondary/40 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchInput value={search} onChange={setSearch} />
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-expanded={mobileNavOpen}
              aria-controls="settings-nav-list"
              aria-label={mobileNavOpen ? "Fermer la liste des réglages" : "Ouvrir la liste des réglages"}
              className="lg:hidden shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${mobileNavOpen ? "rotate-180" : ""}`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>

          <div
            id="settings-nav-list"
            className={`p-1.5 max-h-80 overflow-y-auto lg:max-h-[calc(100vh-10rem)] ${
              mobileNavOpen ? "block" : "hidden"
            } lg:block`}
          >
            <nav className="flex flex-col gap-0.5">
              {GROUP_ORDER.map((g, gi) => {
                const groupTiles = visibleTilesByGroup.get(g.key);
                if (!groupTiles || groupTiles.length === 0) return null;
                return (
                  <div key={g.key}>
                    <div
                      className={`text-[9.5px] font-body font-bold uppercase tracking-[0.16em] text-text-muted px-2.5 pb-1 ${
                        gi === 0 ? "pt-1" : "pt-3"
                      }`}
                    >
                      {g.label}
                    </div>
                    {groupTiles.map((t) => {
                      const meta = getTileMeta(t.key);
                      const active = activeKey === t.key;
                      const parity = parityByKey.get(t.key) ?? 0;
                      const base = active
                        ? "bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-900 shadow-[0_3px_8px_rgba(15,23,42,0.15)] font-semibold"
                        : parity === 1
                          ? "border-transparent bg-bg-secondary/60 text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
                          : "border-transparent text-text-secondary hover:bg-bg-secondary hover:text-text-primary";
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => handleNavClick(t.key)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] font-body font-medium text-left transition border w-full ${base}`}
                        >
                          <span className={`shrink-0 ${active ? "text-white" : "text-text-muted"}`}>
                            {NAV_ICONS[meta.key]}
                          </span>
                          <span className="truncate flex-1">{meta.title}</span>
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${NAV_DOT[t.status.tone]} ${
                              active ? "shadow-[0_0_0_2px_rgba(255,255,255,0.2)]" : ""
                            }`}
                            aria-hidden
                          />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {totalVisible === 0 && (
                <div className="px-2.5 py-5 text-[12px] text-text-muted text-center">
                  Aucun résultat pour « {search} ».
                </div>
              )}
            </nav>
          </div>
        </aside>

        {/* Contenu : UNE SEULE section à la fois, avec animation swipe entre
            deux onglets. L'ancienne glisse hors écran vers la droite + fade,
            la nouvelle arrive depuis la droite + fade in, en parallèle. */}
        <main className="min-w-0">
          {totalVisible === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-bg-secondary/40 py-12 text-center">
              <p className="text-sm text-text-muted">
                Aucun réglage ne correspond à « <span className="font-semibold text-text-primary">{search}</span> ».
              </p>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="mt-3 inline-flex items-center px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border border-border text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition"
              >
                Effacer la recherche
              </button>
            </div>
          ) : activeTile ? (
            <div className="relative overflow-hidden">
              {/* Ancienne section — superposée en absolute pendant la transition.
                  pointer-events-none pour ne pas gêner les clics sur la nouvelle. */}
              {prevTile && (
                <div
                  key={`prev-${prevTile.key}-${activeTile.key}`}
                  className="absolute inset-0 pointer-events-none settings-swap-out"
                  aria-hidden
                >
                  <SectionCard tile={prevTile} parity={prevParity} />
                </div>
              )}
              {/* Nouvelle section — en flow normal, pilote la hauteur du conteneur. */}
              <div
                key={`active-${activeTile.key}`}
                className="settings-swap-in"
              >
                <SectionCard tile={activeTile} parity={activeParity} />
              </div>
            </div>
          ) : null}
          <div className="h-24" aria-hidden />
        </main>
      </div>
    </div>
  );
}

/* ─────────────── Barre de recherche ─────────────── */
function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" />
        </svg>
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder="Rechercher…"
        aria-label="Rechercher un réglage"
        className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-border bg-bg-primary text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900/40"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Effacer la recherche"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-secondary transition"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ─────────────── Section inline (ex-modale) ─────────────── */
function SectionCard({
  tile,
  parity,
}: {
  tile: DashboardTile;
  parity: number;
}) {
  const meta = getTileMeta(tile.key);
  const style = ACCENT_SECTION_STYLES[meta.accent];
  const cardBg = parity === 1 ? "bg-bg-secondary" : "bg-bg-primary";
  return (
    <section
      id={tile.key}
      className={`relative overflow-hidden rounded-2xl border border-border shadow-sm ${cardBg}`}
    >
      <span className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${style.topBar}`} />
      <div className={`absolute -top-10 -right-10 w-28 h-28 rounded-full blur-3xl pointer-events-none ${style.halo}`} />

      <header className="relative flex items-start gap-4 px-5 sm:px-6 pt-6 pb-4">
        <span className={`inline-flex items-center justify-center w-11 h-11 rounded-xl border shrink-0 ${style.iconBg}`}>
          {TILE_ICONS[meta.key]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-heading text-xl font-bold text-text-primary leading-tight">
              {meta.title}
            </h3>
            <TileStatusChip status={tile.status} />
          </div>
          <p className="text-sm text-text-muted mt-1 leading-snug">{meta.description}</p>
          {tile.summary && (
            <p className="text-[12.5px] text-text-muted mt-1 leading-snug">{tile.summary}</p>
          )}
        </div>
      </header>

      <div className="relative px-5 sm:px-6 pb-6">{tile.content}</div>
    </section>
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

/* ─────────────── Chip de statut ─────────────── */
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
    <span className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${map[status.tone]}`}>
      <span className={`w-2 h-2 rounded-full ${dot[status.tone]}`} />
      {status.label}
    </span>
  );
}
