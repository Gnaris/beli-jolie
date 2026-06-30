"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CompactFiltersHeader from "./CompactFiltersHeader";
import AdminProductsFilters from "./AdminProductsFilters";

interface CategoryOption { id: string; name: string; subCategories?: { id: string; name: string }[] }
interface TagOption { id: string; name: string }
interface CompositionOption { id: string; name: string }
interface HsCodeOption { id: string; code: string; label: string }

interface Props {
  totalCount: number;
  activeCount: number;
  categories: CategoryOption[];
  tags: TagOption[];
  compositions: CompositionOption[];
  hsCodes: HsCodeOption[];
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
}

const STORAGE_KEY = "bj_filters_detailed_open";

/**
 * Combine la barre compacte (pills + bouton Filtres) avec le panneau détaillé
 * existant. Le panneau détaillé reste replié par défaut ; on l'ouvre par le
 * bouton « Filtres détaillés ». S'il y a déjà des filtres actifs, on l'ouvre
 * une première fois automatiquement pour montrer ce qu'ils sont.
 */
export default function ProductFiltersPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setOpen(true);
    } catch {}
    setHydrated(true);
  }, []);

  // Auto-déplie si des filtres sont actifs au premier rendu
  useEffect(() => {
    if (!hydrated) return;
    if (props.activeCount > 0 && !open) {
      // ne fait qu'une fois au montage
    }
  }, [hydrated, props.activeCount, open]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <CompactFiltersHeader
        totalCount={props.totalCount}
        activeCount={props.activeCount}
        detailedOpen={open}
        onToggleDetailed={toggle}
        categories={props.categories}
        tags={props.tags}
        compositions={props.compositions}
        hsCodes={props.hsCodes}
      />
      {open && (
        <div className="pt-3 border-t border-border-light">
          <AdminProductsFilters
            totalCount={props.totalCount}
            categories={props.categories}
            tags={props.tags}
            compositions={props.compositions}
            hsCodes={props.hsCodes}
            hasPfsConfig={props.hasPfsConfig}
            hasAnkorstoreConfig={props.hasAnkorstoreConfig}
            hasEfashionConfig={props.hasEfashionConfig}
            hasFaireConfig={props.hasFaireConfig}
            forceOpen
          />
        </div>
      )}
    </div>
  );
}
