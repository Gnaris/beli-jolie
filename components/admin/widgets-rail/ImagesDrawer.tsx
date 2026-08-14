"use client";

/**
 * Tiroir « Images produits »
 *
 * Deux sources sont poll ées :
 *   - GET /api/admin/import-jobs  → jobs bulk agrégés (barre de progression totale)
 *   - GET /api/admin/image-jobs   → une ligne par image (miniature + réf + couleur + position)
 *
 * L'admin voit donc à la fois le compteur global de l'import et le détail
 * image-par-image pour la traçabilité (« Où est passée telle photo ? »).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";

interface JobView {
  id: string;
  type: "PRODUCTS" | "IMAGES";
  status: "PENDING" | "UPLOADING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  filename: string | null;
  totalItems: number;
  processedItems: number;
  successItems: number;
  errorItems: number;
  errorMessage: string | null;
  updatedAt: string;
}

export interface ImageItem {
  id: string;
  source: "form" | "bulk";
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  reference: string | null;
  colorName: string | null;
  colorHex: string | null;
  colorPatternImage: string | null;
  position: number | null;
  imagePath: string | null;
  error: string | null;
  createdAt: string;
}

const ACTIVE = new Set(["PENDING", "UPLOADING", "PROCESSING"]);
const DONE = new Set(["COMPLETED", "FAILED"]);
const RECENT_DONE_MS = 8 * 60_000;
const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 60_000;
const GROUP_THRESHOLD = 15; // au-delà, on plie par référence
const INITIAL_DISPLAY_LIMIT = 40; // affichage initial avant « Voir plus »

const IMAGES_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
);

export function ImagesDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT);
  const [isVisible, setIsVisible] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [jobsRes, imagesRes] = await Promise.all([
        fetch("/api/admin/import-jobs", { cache: "no-store" }),
        fetch("/api/admin/image-jobs", { cache: "no-store" }),
      ]);
      if (jobsRes.ok) {
        const data = (await jobsRes.json()) as { jobs?: JobView[] };
        setJobs(data.jobs ?? []);
      }
      if (imagesRes.ok) {
        const data = (await imagesRes.json()) as { items?: ImageItem[] };
        setImages(data.items ?? []);
      }
    } catch {
      // ignored
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (isVisible) void refresh();
  }, [isVisible, refresh]);

  const active = jobs.filter((j) => ACTIVE.has(j.status));
  const activeImages = images.filter((i) => i.status === "PENDING" || i.status === "PROCESSING");

  useEffect(() => {
    if (!isVisible) return;
    const hasActive = active.length > 0 || activeImages.length > 0;
    const delay = hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(refresh, delay);
    return () => window.clearInterval(id);
  }, [active.length, activeImages.length, isVisible, refresh]);

  const recent = jobs.filter((j) => {
    if (!DONE.has(j.status)) return false;
    const age = Date.now() - new Date(j.updatedAt).getTime();
    return age < RECENT_DONE_MS;
  });

  useEffect(() => {
    const pulse = active.length > 0 || activeImages.length > 0;
    setBadge("images", { count: active.length + activeImages.length, pulse });
  }, [active.length, activeImages.length, setBadge]);

  const totalPlanned = active.reduce((n, j) => n + (j.totalItems || 0), 0);
  const totalProcessed = active.reduce((n, j) => n + (j.processedItems || 0), 0);
  const pct = totalPlanned > 0 ? Math.round((totalProcessed / totalPlanned) * 100) : 0;

  // Groupement automatique par (reference, colorName) au-delà du seuil.
  // On garde une seule tuile de synthèse par groupe très volumineux pour éviter
  // de noyer le tiroir pendant un import massif (100+ photos).
  const displayItems = useMemo(() => groupImages(images), [images]);
  const shownItems = displayItems.slice(0, displayLimit);
  const hasMore = displayItems.length > displayLimit;

  const title =
    active.length > 0
      ? `${totalProcessed} / ${totalPlanned} traitées`
      : activeImages.length > 0
      ? `${activeImages.length} image${activeImages.length > 1 ? "s" : ""} en cours`
      : recent.length > 0
      ? `${recent.length} terminé${recent.length > 1 ? "s" : ""}`
      : images.length > 0
      ? `${images.length} récente${images.length > 1 ? "s" : ""}`
      : "Aucun import";

  return (
    <DrawerShell
      open={openWidget === "images"}
      onClose={close}
      accent="emerald"
      eyebrow="Images"
      title={
        <span className="flex items-center gap-1.5">
          {(active.length > 0 || activeImages.length > 0) && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={IMAGES_ICON}
      autoScrollFullscreen
      footer={
        <div className="text-[11px] text-slate-500 flex items-center justify-between">
          <span>3 en parallèle</span>
          <Link href="/admin/produits/importer" className="text-slate-500 hover:text-slate-700 underline">
            Ouvrir l&apos;import
          </Link>
        </div>
      }
    >
      {jobs.length === 0 && images.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucun import récent.</p>
        </div>
      ) : (
        <>
          {active.length > 0 && totalPlanned > 0 && (
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-slate-600">Progression totale</p>
                <p className="text-xs font-semibold text-emerald-700 tabular-nums">
                  {totalProcessed} / {totalPlanned}
                </p>
              </div>
              <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          {active.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
          {recent.length > 0 && (
            <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-emerald-700 font-semibold bg-emerald-50/40 border-b border-slate-100">
              Récemment terminés
            </div>
          )}
          {recent.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}

          {displayItems.length > 0 && (
            <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold bg-slate-50/60 border-b border-slate-100">
              Détail des images
            </div>
          )}
          {shownItems.map((it) =>
            it.kind === "single" ? (
              <ImageRow key={it.item.id} item={it.item} />
            ) : (
              <GroupRow key={it.groupKey} group={it} />
            ),
          )}
          {hasMore && (
            <button
              type="button"
              onClick={() => setDisplayLimit((n) => n + INITIAL_DISPLAY_LIMIT)}
              className="w-full py-2 text-xs text-emerald-700 hover:bg-emerald-50/40 border-b border-slate-100"
            >
              Voir plus ({displayItems.length - displayLimit} restant{displayItems.length - displayLimit > 1 ? "s" : ""})
            </button>
          )}
        </>
      )}
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────
// Groupement par référence + couleur
// ─────────────────────────────────────────────

export type DisplayItem =
  | { kind: "single"; item: ImageItem }
  | {
      kind: "group";
      groupKey: string;
      reference: string;
      colorName: string | null;
      colorHex: string | null;
      colorPatternImage: string | null;
      items: ImageItem[];
      counts: { done: number; processing: number; failed: number; total: number };
    };

export function groupImages(images: ImageItem[]): DisplayItem[] {
  // Bucketise par (reference|colorName). Les items sans reference restent seuls.
  const buckets = new Map<string, ImageItem[]>();
  const singletons: ImageItem[] = [];

  for (const img of images) {
    if (!img.reference) {
      singletons.push(img);
      continue;
    }
    const key = `${img.reference}::${img.colorName ?? ""}`;
    const existing = buckets.get(key);
    if (existing) existing.push(img);
    else buckets.set(key, [img]);
  }

  const out: DisplayItem[] = [];
  for (const [key, items] of buckets) {
    if (items.length < GROUP_THRESHOLD) {
      // Trop peu pour grouper : on remet tel quel dans le flux
      for (const it of items) out.push({ kind: "single", item: it });
      continue;
    }
    const first = items[0];
    const counts = {
      done: items.filter((i) => i.status === "DONE").length,
      processing: items.filter((i) => i.status === "PENDING" || i.status === "PROCESSING").length,
      failed: items.filter((i) => i.status === "FAILED").length,
      total: items.length,
    };
    out.push({
      kind: "group",
      groupKey: key,
      reference: first.reference!,
      colorName: first.colorName,
      colorHex: first.colorHex,
      colorPatternImage: first.colorPatternImage,
      items,
      counts,
    });
  }
  for (const s of singletons) out.push({ kind: "single", item: s });

  // Réordonne pour garder l'ordre chronologique global (le plus récent des items du groupe)
  out.sort((a, b) => {
    const aDate = a.kind === "single" ? a.item.createdAt : a.items[0].createdAt;
    const bDate = b.kind === "single" ? b.item.createdAt : b.items[0].createdAt;
    return aDate < bDate ? 1 : aDate > bDate ? -1 : 0;
  });
  return out;
}

// ─────────────────────────────────────────────
// Rendu — pastille couleur (mirror léger de ColorSwatch)
// ─────────────────────────────────────────────

function ColorDot({
  hex,
  patternImage,
  size = 14,
}: {
  hex: string | null;
  patternImage: string | null;
  size?: number;
}) {
  const bg: React.CSSProperties = patternImage
    ? {
        backgroundImage: `url(${patternImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: hex ?? "#CBD5E1" };
  return (
    <span
      className="inline-block rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.14)] flex-shrink-0"
      style={{ ...bg, width: size, height: size }}
    />
  );
}

// ─────────────────────────────────────────────
// Rendu — ligne image individuelle
// ─────────────────────────────────────────────

function ImageRow({ item }: { item: ImageItem }) {
  const active = item.status === "PENDING" || item.status === "PROCESSING";
  const failed = item.status === "FAILED";
  const bg = failed ? "bg-rose-50/30" : "";

  return (
    <div className={`px-4 py-2.5 border-b border-slate-100 ${bg} flex items-center gap-3`}>
      <ImageThumb item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800 truncate">
          <span className="truncate">{item.reference ?? "Brouillon"}</span>
          {item.colorName && (
            <>
              <span className="text-slate-300">·</span>
              <ColorDot hex={item.colorHex} patternImage={item.colorPatternImage} />
              <span className="truncate text-slate-600">{item.colorName}</span>
            </>
          )}
          {item.position != null && (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-slate-500 tabular-nums">#{item.position}</span>
            </>
          )}
        </div>
        {failed && item.error && (
          <p className="text-[11px] text-rose-600 truncate mt-0.5">{item.error}</p>
        )}
      </div>
      <StatusIcon status={item.status} />
    </div>
  );
}

function ImageThumb({ item }: { item: ImageItem }) {
  if (item.imagePath) {
    return (
      <div className="relative w-10 h-10 rounded-md overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-200">
        <Image
          src={item.imagePath}
          alt={item.reference ?? ""}
          fill
          sizes="40px"
          className="object-cover"
          unoptimized
        />
      </div>
    );
  }
  if (item.status === "FAILED") {
    return (
      <div className="w-10 h-10 rounded-md bg-rose-100 border border-rose-200 flex-shrink-0 flex items-center justify-center">
        <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  // PENDING / PROCESSING : skeleton pulsant
  return (
    <div className="w-10 h-10 rounded-md bg-slate-200 animate-pulse flex-shrink-0 border border-slate-200" />
  );
}

function StatusIcon({ status }: { status: ImageItem["status"] }) {
  if (status === "PENDING" || status === "PROCESSING") {
    return (
      <svg className="w-4 h-4 text-emerald-700 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    );
  }
  if (status === "DONE") {
    return (
      <svg className="w-4 h-4 text-emerald-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-rose-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.007M4.03 19.5l7.97-15 7.97 15H4.03z" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Rendu — ligne groupe (dépliable)
// ─────────────────────────────────────────────

function GroupRow({ group }: { group: Extract<DisplayItem, { kind: "group" }> }) {
  const [expanded, setExpanded] = useState(false);
  const { reference, colorName, colorHex, colorPatternImage, counts, items } = group;

  return (
    <div className="border-b border-slate-100">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 text-left"
      >
        <div className="w-10 h-10 rounded-md bg-slate-100 border border-slate-200 flex-shrink-0 flex items-center justify-center text-slate-500 text-xs font-semibold tabular-nums">
          {counts.total}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800 truncate">
            <span className="truncate">{reference}</span>
            {colorName && (
              <>
                <span className="text-slate-300">·</span>
                <ColorDot hex={colorHex} patternImage={colorPatternImage} />
                <span className="truncate text-slate-600">{colorName}</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {counts.done > 0 && <span className="text-emerald-700">{counts.done} traitées</span>}
            {counts.processing > 0 && (
              <>
                {counts.done > 0 && <span className="text-slate-300"> · </span>}
                <span className="text-slate-600">{counts.processing} en cours</span>
              </>
            )}
            {counts.failed > 0 && (
              <>
                {(counts.done > 0 || counts.processing > 0) && <span className="text-slate-300"> · </span>}
                <span className="text-rose-600">{counts.failed} échec{counts.failed > 1 ? "s" : ""}</span>
              </>
            )}
          </p>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {expanded && (
        <div className="bg-slate-50/40 pl-4">
          {items.map((it) => (
            <ImageRow key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Rendu — ligne job agrégé (inchangé)
// ─────────────────────────────────────────────

function JobRow({ job }: { job: JobView }) {
  const active = ACTIVE.has(job.status);
  const done = job.status === "COMPLETED";
  const failed = job.status === "FAILED";
  const isImages = job.type === "IMAGES";
  const bg = failed ? "bg-rose-50/30" : done ? "bg-emerald-50/20" : "";

  return (
    <div className={`px-4 py-3 border-b border-slate-100 ${bg}`}>
      <div className="flex items-center gap-2">
        <span className="text-base flex-shrink-0" aria-hidden>
          {isImages ? "🖼️" : "📦"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {job.filename || (isImages ? "Import images" : "Import produits")}
          </p>
          <p className="text-[11px] text-slate-500">
            {active
              ? `${job.processedItems} / ${job.totalItems} traité${job.totalItems > 1 ? "s" : ""}`
              : done
              ? `${job.successItems} réussi${job.successItems > 1 ? "s" : ""}${job.errorItems > 0 ? ` · ${job.errorItems} erreur${job.errorItems > 1 ? "s" : ""}` : ""}`
              : failed
              ? job.errorMessage?.slice(0, 60) || "Échec"
              : job.status}
          </p>
        </div>
        {active && (
          <svg className="w-4 h-4 text-emerald-700 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {done && (
          <svg className="w-4 h-4 text-emerald-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </div>
  );
}
