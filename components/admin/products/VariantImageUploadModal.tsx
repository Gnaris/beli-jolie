"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import PhotosPanel from "./PhotosPanel";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import ColorSwatch from "@/components/ui/ColorSwatch";
import {
  type VariantState,
  type ColorImageState,
  type AvailableColor,
  isMultiColorPack,
  packLinesColorList,
} from "./ColorVariantManager";

interface Props {
  open: boolean;
  variant: VariantState | null;
  colorImages: ColorImageState[];
  availableColors: AvailableColor[];
  onChangeImages: (next: ColorImageState[]) => void;
  primaryColorId: string | null;
  onChangePrimaryColorId: (colorId: string) => void;
  productReference?: string;
  onClose: () => void;
}

export default function VariantImageUploadModal({
  open,
  variant,
  colorImages,
  availableColors,
  onChangeImages,
  primaryColorId,
  onChangePrimaryColorId,
  productReference,
  onClose,
}: Props) {
  const backdrop = useBackdropClose(onClose);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const colorList = useMemo(() => {
    if (!variant) return [] as { colorId: string; colorName: string; colorHex: string }[];
    if (isMultiColorPack(variant)) return packLinesColorList(variant.packLines);
    if (variant.colorId) {
      return [{ colorId: variant.colorId, colorName: variant.colorName, colorHex: variant.colorHex }];
    }
    return [];
  }, [variant]);

  if (!open || !variant) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <svg
              className="w-4 h-4 text-text-muted shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18a1.5 1.5 0 001.5-1.5V6A1.5 1.5 0 0021 4.5H3A1.5 1.5 0 001.5 6v13.5A1.5 1.5 0 003 21z"
              />
            </svg>
            <span className="text-sm font-semibold text-text-primary font-heading shrink-0">
              Images de la variante
            </span>
            {colorList.length > 0 && (
              <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                <span className="text-xs text-text-muted font-body shrink-0">—</span>
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  {colorList.slice(0, 3).map((c) => {
                    const opt = availableColors.find((o) => o.id === c.colorId);
                    return (
                      <span
                        key={c.colorId}
                        className="inline-flex items-center gap-1 bg-bg-secondary px-2 py-0.5 rounded-full text-[11px] font-body text-text-primary"
                      >
                        <ColorSwatch
                          hex={c.colorHex}
                          patternImage={opt?.patternImage ?? null}
                          size={12}
                          rounded="full"
                        />
                        <span className="truncate max-w-[120px]">{c.colorName}</span>
                      </span>
                    );
                  })}
                  {colorList.length > 3 && (
                    <span className="text-[11px] text-text-muted font-body">
                      +{colorList.length - 3}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {colorList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-bg-secondary/40 px-4 py-8 text-center text-sm text-text-muted font-body">
              Choisissez d&apos;abord une couleur pour cette variante avant d&apos;ajouter des photos.
            </div>
          ) : (
            <PhotosPanel
              variants={[variant]}
              colorImages={colorImages}
              availableColors={availableColors}
              onChangeImages={onChangeImages}
              primaryColorId={primaryColorId}
              onChangePrimaryColorId={onChangePrimaryColorId}
              productReference={productReference}
              brandedBadgeEnabled={false}
            />
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(modal, document.body) : null;
}
