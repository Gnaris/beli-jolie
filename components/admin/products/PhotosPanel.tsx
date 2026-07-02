"use client";

/**
 * PhotosPanel — Section "Photos" de la fiche produit (refonte Ardoise, variante B).
 *
 * Une ligne par couleur du produit : swatch + nom + tag "principale", et à droite
 * 5 slots numérotés (1 à 5). Le slot 1 rempli est étiqueté "principale". Clic sur
 * un slot vide → sélecteur natif de fichier (pas de modale). Clic sur la croix
 * d'un slot rempli → confirmation puis suppression.
 *
 * Le composant lit / écrit `colorImages` (ColorImageState[]) via `onChangeImages`,
 * exactement comme l'ancienne modale ImageManagerModal — la logique métier (upload
 * différé, sync marketplaces, etc.) reste dans ProductForm et n'est pas touchée.
 */

import { useRef, useMemo, useState, useEffect } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ColorSwatch from "@/components/ui/ColorSwatch";
import {
  type VariantState,
  type ColorImageState,
  type AvailableColor,
  isMultiColorPack,
  packLinesColorList,
  imageGroupKeyFromVariant,
} from "./ColorVariantManager";

interface Props {
  variants: VariantState[];
  colorImages: ColorImageState[];
  availableColors: AvailableColor[];
  onChangeImages: (next: ColorImageState[]) => void;
  primaryColorId: string | null;
  productReference?: string;
}

const MAX_SLOTS = 5;

export default function PhotosPanel({
  variants,
  colorImages,
  availableColors,
  onChangeImages,
  primaryColorId,
  productReference,
}: Props) {
  const { confirm } = useConfirm();
  const [zoomed, setZoomed] = useState<{ src: string; downloadName: string } | null>(null);

  useEffect(() => {
    if (!zoomed) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setZoomed(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  // Ordre d'affichage : on suit l'ordre des variantes. Pour un pack multi-couleurs,
  // on prend chaque couleur composante. Les entrées orphelines de colorImages
  // (couleur supprimée mais photos gardées en cache) ne sont pas affichées ici.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: { groupKey: string; colorId: string; colorName: string; colorHex: string }[] = [];
    for (const v of variants) {
      if (isMultiColorPack(v)) {
        for (const c of packLinesColorList(v.packLines)) {
          if (seen.has(c.colorId)) continue;
          seen.add(c.colorId);
          out.push({
            groupKey: c.colorId,
            colorId: c.colorId,
            colorName: c.colorName,
            colorHex: c.colorHex,
          });
        }
      } else if (v.colorId) {
        const gk = imageGroupKeyFromVariant(v);
        if (seen.has(gk)) continue;
        seen.add(gk);
        out.push({
          groupKey: gk,
          colorId: v.colorId,
          colorName: v.colorName,
          colorHex: v.colorHex,
        });
      }
    }
    return out;
  }, [variants]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3">
        {rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-bg-secondary/40 px-4 py-8 text-center text-sm text-text-muted font-body">
            Aucune couleur définie pour ce produit. Ajoutez d&apos;abord une variante couleur dans l&apos;onglet « Variantes ».
          </div>
        )}
        {rows.map((row) => (
          <PhotoRow
            key={row.groupKey}
            groupKey={row.groupKey}
            colorId={row.colorId}
            colorName={row.colorName}
            colorHex={row.colorHex}
            isPrimary={!!row.colorId && row.colorId === primaryColorId}
            availableColors={availableColors}
            colorImages={colorImages}
            onChangeImages={onChangeImages}
            productReference={productReference}
            onZoom={(src, downloadName) => setZoomed({ src, downloadName })}
            onConfirmDelete={async () => {
              return confirm({
                type: "danger",
                title: "Supprimer cette image ?",
                message: "L'image sera retirée de la variante.",
                confirmLabel: "Supprimer",
              });
            }}
          />
        ))}
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setZoomed(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomed.src}
            alt="Aperçu"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] max-w-[92vw] object-contain rounded-xl shadow-2xl"
          />
          <a
            href={zoomed.src}
            download={zoomed.downloadName}
            onClick={(e) => e.stopPropagation()}
            title="Télécharger"
            className="absolute top-4 right-16 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
          </a>
          <button
            type="button"
            onClick={() => setZoomed(null)}
            title="Fermer"
            aria-label="Fermer l'aperçu"
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center backdrop-blur-sm transition-colors"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

interface PhotoRowProps {
  groupKey: string;
  colorId: string;
  colorName: string;
  colorHex: string;
  isPrimary: boolean;
  availableColors: AvailableColor[];
  colorImages: ColorImageState[];
  onChangeImages: (next: ColorImageState[]) => void;
  onConfirmDelete: () => Promise<boolean | "secondary">;
  productReference?: string;
  onZoom: (src: string, downloadName: string) => void;
}

function slugForFile(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "photo";
}

function extFromSrc(src: string): string {
  const m = src.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : "jpg";
}

function PhotoRow({
  groupKey,
  colorId,
  colorName,
  colorHex,
  isPrimary,
  availableColors,
  colorImages,
  onChangeImages,
  onConfirmDelete,
  productReference,
  onZoom,
}: PhotoRowProps) {
  const state = colorImages.find((c) => c.groupKey === groupKey);
  const opt = availableColors.find((c) => c.id === colorId);
  const patternImage = opt?.patternImage ?? null;
  const swatchHex = colorHex || opt?.hex || "#9CA3AF";
  const hasNoPhoto = !state || state.imagePreviews.length === 0;
  const [isDragOver, setIsDragOver] = useState(false);

  function addFile(file: File, position: number) {
    if (!state) return;
    if (state.imagePreviews.length >= MAX_SLOTS) return;
    if (state.orders.includes(position)) return;
    const blob = URL.createObjectURL(file);
    onChangeImages(
      colorImages.map((c) =>
        c.groupKey === groupKey
          ? {
              ...c,
              imagePreviews: [...c.imagePreviews, blob],
              uploadedPaths: [...c.uploadedPaths, ""],
              orders: [...c.orders, position],
              pendingFiles: [...c.pendingFiles, file],
            }
          : c,
      ),
    );
  }

  /**
   * Drop de N fichiers d'un coup : chaque fichier prend la plus petite position
   * libre restante. On accumule en interne parce que `state` est un snapshot
   * React — on ne peut pas appeler addFile en boucle et voir la mise à jour.
   */
  function addDroppedFiles(files: File[]) {
    if (!state) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;

    let workingOrders = [...state.orders];
    const newPreviews: string[] = [];
    const newPaths: string[] = [];
    const newOrders: number[] = [];
    const newPending: (File | null)[] = [];

    for (const file of images) {
      if (workingOrders.length >= MAX_SLOTS) break;
      let nextPos = -1;
      for (let p = 0; p < MAX_SLOTS; p++) {
        if (!workingOrders.includes(p)) { nextPos = p; break; }
      }
      if (nextPos === -1) break;
      workingOrders.push(nextPos);
      newPreviews.push(URL.createObjectURL(file));
      newPaths.push("");
      newOrders.push(nextPos);
      newPending.push(file);
    }

    if (newOrders.length === 0) return;

    onChangeImages(
      colorImages.map((c) =>
        c.groupKey === groupKey
          ? {
              ...c,
              imagePreviews: [...c.imagePreviews, ...newPreviews],
              uploadedPaths: [...c.uploadedPaths, ...newPaths],
              orders: [...c.orders, ...newOrders],
              pendingFiles: [...c.pendingFiles, ...newPending],
            }
          : c,
      ),
    );
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!state || state.imagePreviews.length >= MAX_SLOTS) return;
    // Signale au navigateur que ce conteneur accepte le drop de FICHIERS externes.
    // Le drag interne (réordonnancement entre slots) est géré au niveau des slots.
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!isDragOver) setIsDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Ne quitte que si la souris sort vraiment de la row (pas un enfant)
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    addDroppedFiles(files);
  }

  /**
   * Déplace la photo présente en `fromPos` vers `toPos`. Si `toPos` est déjà
   * occupée, on permute les deux (swap). Utilisé pour le drag & drop entre
   * slots de la même couleur.
   */
  function movePhoto(fromPos: number, toPos: number) {
    if (!state || fromPos === toPos) return;
    const fromIdx = state.orders.indexOf(fromPos);
    if (fromIdx === -1) return;
    const toIdx = state.orders.indexOf(toPos);
    onChangeImages(
      colorImages.map((c) => {
        if (c.groupKey !== groupKey) return c;
        const newOrders = [...c.orders];
        newOrders[fromIdx] = toPos;
        if (toIdx !== -1) newOrders[toIdx] = fromPos;
        return { ...c, orders: newOrders };
      }),
    );
  }

  async function removeAt(position: number) {
    if (!state) return;
    const idx = state.orders.indexOf(position);
    if (idx === -1) return;
    const ok = await onConfirmDelete();
    if (!ok) return;
    const removedPreview = state.imagePreviews[idx];
    if (removedPreview?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(removedPreview);
      } catch {
        /* ignore */
      }
    }
    onChangeImages(
      colorImages.map((c) => {
        if (c.groupKey !== groupKey) return c;
        return {
          ...c,
          imagePreviews: c.imagePreviews.filter((_, j) => j !== idx),
          uploadedPaths: c.uploadedPaths.filter((_, j) => j !== idx),
          orders: c.orders
            .filter((_, j) => j !== idx)
            .map((o) => (o > position ? o - 1 : o)),
          pendingFiles: c.pendingFiles.filter((_, j) => j !== idx),
        };
      }),
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3 md:gap-4 items-center rounded-2xl border-2 transition-colors bg-bg-primary p-3 md:p-4 ${
        isDragOver
          ? "border-bg-dark border-dashed bg-bg-secondary"
          : "border-border"
      }`}>
      {/* Colonne gauche : swatch + nom + tag principale */}
      <div className="flex items-center gap-3">
        <ColorSwatch hex={swatchHex} patternImage={patternImage} size={28} rounded="full" />
        <div className="min-w-0">
          <div className="text-sm font-bold text-text-primary font-body truncate">
            {colorName}
            {isPrimary && (
              <span className="ml-1.5 text-[11px] font-medium text-text-muted">
                principale
              </span>
            )}
          </div>
          {hasNoPhoto && (
            <div className="mt-0.5 text-[10.5px] font-medium text-amber-700 font-body flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
              Aucune photo
            </div>
          )}
        </div>
      </div>

      {/* Colonne droite : 5 slots */}
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: MAX_SLOTS }, (_, pos) => {
          const idx = state?.orders.indexOf(pos) ?? -1;
          const src = idx >= 0 ? state?.imagePreviews[idx] : undefined;
          if (src) {
            const refPart = productReference ? slugForFile(productReference) : "photo";
            const colorPart = slugForFile(colorName || "couleur");
            const downloadName = `${refPart}-${colorPart}-${pos + 1}.${extFromSrc(src)}`;
            return (
              <FilledSlot
                key={pos}
                position={pos}
                src={src}
                downloadName={downloadName}
                onRemove={() => removeAt(pos)}
                onDropReorder={(fromPos) => movePhoto(fromPos, pos)}
                onZoom={() => onZoom(src, downloadName)}
              />
            );
          }
          return (
            <EmptySlot
              key={pos}
              position={pos}
              disabled={(state?.imagePreviews.length ?? 0) >= MAX_SLOTS}
              onPick={(file) => addFile(file, pos)}
              onDropReorder={(fromPos) => movePhoto(fromPos, pos)}
            />
          );
        })}
      </div>
    </div>
  );
}

const PHOTO_DND_TYPE = "application/x-beli-photo-pos";

function FilledSlot({
  position,
  src,
  downloadName,
  onRemove,
  onDropReorder,
  onZoom,
}: {
  position: number;
  src: string;
  downloadName: string;
  onRemove: () => void;
  onDropReorder: (fromPos: number) => void;
  onZoom: () => void;
}) {
  const isPrimary = position === 0;
  const [isDropTarget, setIsDropTarget] = useState(false);

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData(PHOTO_DND_TYPE, String(position));
    e.dataTransfer.setData("text/plain", String(position));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes(PHOTO_DND_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (!isDropTarget) setIsDropTarget(true);
  }

  function handleDragLeave() {
    setIsDropTarget(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    const raw = e.dataTransfer.getData(PHOTO_DND_TYPE);
    if (raw === "") return;
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
    const fromPos = Number(raw);
    if (Number.isFinite(fromPos)) onDropReorder(fromPos);
  }

  // Empêche le drag natif de démarrer quand on clique sur un bouton d'action
  // (le parent est draggable). preventDefault() sur dragstart bloque le drag,
  // stopPropagation() sur mousedown empêche le focus-drag involontaire.
  const stopDrag = {
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onDragStart: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    draggable: false as const,
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title="Glissez pour changer d'ordre"
      className={`group relative aspect-square rounded-lg overflow-hidden border-2 bg-bg-tertiary cursor-grab active:cursor-grabbing transition-colors ${
        isDropTarget ? "border-bg-dark ring-2 ring-bg-dark/30" : "border-border-strong"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Position ${position + 1}`}
        className="w-full h-full object-cover pointer-events-none"
        draggable={false}
      />

      {/* Overlay d'actions au survol — pointer-events-none sur le fond pour ne
          pas capter le drag ; seuls les boutons captent les clics. */}
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <button
          type="button"
          onClick={onZoom}
          {...stopDrag}
          title="Agrandir"
          aria-label={`Agrandir l'image en position ${position + 1}`}
          className="pointer-events-auto w-8 h-8 rounded-full bg-white/95 hover:bg-white text-slate-900 flex items-center justify-center shadow cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10.5 7v7M7 10.5h7M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
          </svg>
        </button>
        <a
          href={src}
          download={downloadName}
          onClick={(e) => e.stopPropagation()}
          {...stopDrag}
          title="Télécharger"
          aria-label={`Télécharger l'image en position ${position + 1}`}
          className="pointer-events-auto w-8 h-8 rounded-full bg-white/95 hover:bg-white text-slate-900 flex items-center justify-center shadow cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
        </a>
      </div>

      <span
        className={`absolute top-1 left-1 inline-flex items-center rounded-full text-white text-[9px] font-bold font-body px-1.5 py-0.5 pointer-events-none ${
          isPrimary ? "bg-bg-dark" : "bg-black/55"
        }`}
      >
        {position + 1}
        {isPrimary && (
          <span className="ml-1 hidden sm:inline font-medium">· principale</span>
        )}
      </span>
      <button
        type="button"
        onClick={onRemove}
        {...stopDrag}
        title="Supprimer cette image"
        aria-label={`Supprimer l'image en position ${position + 1}`}
        className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white text-[11px] leading-none flex items-center justify-center hover:bg-black/75 transition-colors cursor-pointer"
      >
        ×
      </button>
    </div>
  );
}

function EmptySlot({
  position,
  disabled,
  onPick,
  onDropReorder,
}: {
  position: number;
  disabled: boolean;
  onPick: (file: File) => void;
  onDropReorder: (fromPos: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

  function trigger() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    // Reset la valeur pour permettre de choisir 2 fois le même fichier de suite.
    e.target.value = "";
    if (!file) return;
    onPick(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLButtonElement>) {
    if (!Array.from(e.dataTransfer.types).includes(PHOTO_DND_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (!isDropTarget) setIsDropTarget(true);
  }

  function handleDragLeave() {
    setIsDropTarget(false);
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    const raw = e.dataTransfer.getData(PHOTO_DND_TYPE);
    if (raw === "") return;
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
    const fromPos = Number(raw);
    if (Number.isFinite(fromPos)) onDropReorder(fromPos);
  }

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={disabled}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={disabled ? "5 photos maximum" : `Ajouter une image en position ${position + 1}`}
      aria-label={`Ajouter une image en position ${position + 1}`}
      className={`relative aspect-square rounded-lg border-2 border-dashed bg-bg-primary hover:border-bg-dark hover:bg-bg-secondary transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
        isDropTarget ? "border-bg-dark bg-bg-secondary ring-2 ring-bg-dark/30" : "border-border-strong"
      }`}
    >
      <span className="absolute top-1 left-1 rounded-full bg-black/55 text-white text-[9px] font-bold font-body px-1.5 py-0.5">
        {position + 1}
      </span>
      <span className="text-2xl text-text-muted leading-none font-body">+</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onChange}
      />
    </button>
  );
}
