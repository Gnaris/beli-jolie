"use client";

import { useState, useTransition, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { previewMarketplaceExportAction } from "@/app/actions/admin/marketplace-export";
import { useToast } from "@/components/ui/Toast";
import type { MarketplaceKey, ExportMode } from "@/lib/marketplace-excel/types";
import MarketplaceExportPreviewModal from "./MarketplaceExportPreviewModal";

interface MarketplaceOption {
  key: MarketplaceKey;
  label: string;
}

const MARKETPLACES: MarketplaceOption[] = [
  { key: "pfs", label: "Paris Fashion Shop" },
  { key: "efashion", label: "Efashion" },
  { key: "microstore", label: "Microstore" },
  { key: "ankorstore", label: "Ankorstore" },
  { key: "faire", label: "Faire" },
];

interface Props {
  productIds: string[];
  disabled?: boolean;
  onExported?: () => void;
}

export interface PreviewState {
  marketplace: MarketplaceKey;
  marketplaceLabel: string;
  eligible: { productId: string; reference: string }[];
  ignored: { productId: string; reference: string; missing: string[] }[];
}

export default function MarketplaceExportButton({ productIds, disabled, onExported }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [mode, setMode] = useState<ExportMode>("both");
  const [isLoadingPreview, startPreview] = useTransition();
  const [isDownloading, setIsDownloading] = useState(false);
  const toast = useToast();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Le menu est rendu dans un portail (document.body) parce que la barre d'actions
  // parente est dans un wrapper `overflow-hidden` (utilisé pour l'animation
  // d'apparition fluide) qui clippe sinon le menu déroulant — bug rapporté
  // 2026-06-06 « on ne voit plus les choix déroulants du bouton Exporter ».
  const MENU_WIDTH = 224;
  useLayoutEffect(() => {
    if (!menuOpen) return;
    function updatePos() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        top: rect.bottom + 4,
        left: rect.right - MENU_WIDTH,
      });
    }
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  function handlePickMarketplace(marketplace: MarketplaceKey) {
    setMenuOpen(false);
    // Reset du mode à chaque nouvelle sélection de marketplace : Ankorstore
    // n'a pas le choix "images-only", donc on repart toujours sur "both".
    setMode("both");
    startPreview(async () => {
      const result = await previewMarketplaceExportAction(marketplace, productIds);
      if (!result.success) {
        toast.error("Erreur", result.error);
        return;
      }
      setPreview({
        marketplace: result.marketplace,
        marketplaceLabel: result.marketplaceLabel,
        eligible: result.eligible,
        ignored: result.ignored,
      });
    });
  }

  async function handleConfirmExport() {
    if (!preview) return;
    setIsDownloading(true);
    try {
      const res = await fetch("/api/admin/marketplace-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketplace: preview.marketplace,
          productIds: preview.eligible.map((e) => e.productId),
          mode,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Erreur inconnue" }));
        toast.error("Échec de l'export", data.error || `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match?.[1] || `export-${preview.marketplace}.zip`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const eligibleCount = preview.eligible.length;
      const ignoredCount = preview.ignored.length;
      toast.success(
        "Export terminé",
        `${eligibleCount} produit${eligibleCount > 1 ? "s" : ""} exporté${eligibleCount > 1 ? "s" : ""}${
          ignoredCount > 0 ? ` (${ignoredCount} ignoré${ignoredCount > 1 ? "s" : ""})` : ""
        }.`,
      );
      setPreview(null);
      onExported?.();
    } catch (err) {
      toast.error("Erreur réseau", err instanceof Error ? err.message : "Inconnue");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={disabled || isLoadingPreview || productIds.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary/10 text-text-inverse text-xs font-medium rounded-lg hover:bg-bg-primary/20 disabled:opacity-50 transition-colors font-body"
          title="Exporter la sélection au format Excel"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {isLoadingPreview ? "Préparation…" : "Exporter"}
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {menuOpen && menuPos && typeof document !== "undefined" && createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
            className="z-[9999] bg-white border border-border rounded-lg shadow-lg overflow-hidden"
          >
            {MARKETPLACES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => handlePickMarketplace(m.key)}
                className="block w-full text-left px-4 py-2.5 text-sm font-body text-text-primary hover:bg-bg-secondary transition-colors border-none bg-transparent cursor-pointer"
              >
                {m.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>

      {preview && (
        <MarketplaceExportPreviewModal
          preview={preview}
          isDownloading={isDownloading}
          mode={mode}
          onModeChange={setMode}
          onCancel={() => setPreview(null)}
          onConfirm={handleConfirmExport}
        />
      )}
    </>
  );
}
