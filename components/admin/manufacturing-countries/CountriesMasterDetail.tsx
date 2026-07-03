"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import CountriesList from "./CountriesList";
import CountryDetail, { type CountryDetailData } from "./CountryDetail";
import CountryEditModal, { type CountryEditModalEditMode } from "./CountryEditModal";
import {
  deleteManufacturingCountry,
  updateManufacturingCountryDirect,
  updateManufacturingCountryPfsRef,
  updateManufacturingCountryFaireCode,
} from "@/app/actions/admin/manufacturing-countries";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

export type CountryItem = {
  id: string;
  name: string;
  isoCode: string | null;
  pfsCountryRef: string | null;
  efashionProvenanceId: number | null;
  efashionProvenanceLabel: string | null;
  faireCountryCode: string | null;
  productCount: number;
  translations: Record<string, string>;
};

type Props = {
  initialCountries: CountryItem[];
};

export default function CountriesMasterDetail({ initialCountries }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { confirm } = useConfirm();
  const toast = useToast();

  const urlSelectedId = searchParams.get("country");
  const initialSelectedId = urlSelectedId ?? initialCountries[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CountryItem | null>(null);

  useEffect(() => {
    if (urlSelectedId && urlSelectedId !== selectedId) {
      setSelectedId(urlSelectedId);
    }
  }, [urlSelectedId, selectedId]);

  useEffect(() => {
    if (selectedId && !initialCountries.some((c) => c.id === selectedId)) {
      setSelectedId(initialCountries[0]?.id ?? null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("country");
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
  }, [selectedId, initialCountries, pathname, router, searchParams]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("country", id);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  function handleBack() {
    setSelectedId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("country");
    window.history.replaceState(null, "", `${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  async function handleDelete(item: CountryItem) {
    if (item.productCount > 0) {
      toast.error(
        "Impossible",
        `« ${item.name} » est attribué à ${item.productCount} produit${item.productCount > 1 ? "s" : ""}.`,
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ce pays ?",
      message: `« ${item.name} » sera définitivement supprimé.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    try {
      await deleteManufacturingCountry(item.id);
      toast.success("Pays supprimé.");
      const remaining = initialCountries.filter((c) => c.id !== item.id);
      setSelectedId(remaining[0]?.id ?? null);
      router.refresh();
    } catch (err) {
      toast.error("Erreur", (err as Error).message);
    }
  }

  const selected = initialCountries.find((c) => c.id === selectedId) ?? null;
  const selectedDetail: CountryDetailData | null = selected
    ? {
        id: selected.id,
        name: selected.name,
        isoCode: selected.isoCode,
        pfsCountryRef: selected.pfsCountryRef,
        efashionProvenanceId: selected.efashionProvenanceId,
        efashionProvenanceLabel: selected.efashionProvenanceLabel,
        faireCountryCode: selected.faireCountryCode,
        productCount: selected.productCount,
        translations: selected.translations,
      }
    : null;

  const editMode: CountryEditModalEditMode | undefined = editTarget
    ? {
        id: editTarget.id,
        name: editTarget.name,
        translations: editTarget.translations,
        isoCode: editTarget.isoCode,
        pfsCountryRef: editTarget.pfsCountryRef,
        efashionCurrentId: editTarget.efashionProvenanceId,
        faireCountryCode: editTarget.faireCountryCode,
        onSave: async (name, translations, pfs, faire) => {
          const target = editTarget;
          await updateManufacturingCountryDirect(target.id, name, pfs.isoCode, translations);
          const newRef = pfs.ref || null;
          if (newRef !== (target.pfsCountryRef ?? null)) {
            await updateManufacturingCountryPfsRef(target.id, newRef);
          }
          const newFaireCode = faire.countryCode ?? null;
          if (newFaireCode !== (target.faireCountryCode ?? null)) {
            await updateManufacturingCountryFaireCode(target.id, newFaireCode);
          }
          router.refresh();
        },
      }
    : undefined;

  return (
    <>
      <div
        className="grid grid-cols-1 md:grid-cols-[340px_1fr] bg-bg-primary border border-border rounded-3xl overflow-hidden md:h-[calc(100vh-22rem)] md:min-h-[600px]"
        style={{ boxShadow: "var(--shadow-pop)" }}
      >
        {/* Master (list) */}
        <div className={`${selectedId ? "hidden" : "block"} md:block md:border-r md:border-border md:min-h-0 md:h-full md:overflow-hidden`}>
          <CountriesList
            items={initialCountries}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </div>

        {/* Detail pane */}
        <div className={`${selectedId ? "block" : "hidden"} md:block md:min-h-0 md:h-full md:overflow-hidden`}>
          {selectedDetail && selected ? (
            <CountryDetail
              item={selectedDetail}
              showBackButton={!!selectedId}
              onBack={handleBack}
              onEdit={() => setEditTarget(selected)}
              onDelete={() => handleDelete(selected)}
            />
          ) : (
            <div className="hidden md:flex flex-col items-center justify-center h-full min-h-[600px] text-text-muted text-sm">
              Sélectionnez un pays à gauche.
            </div>
          )}
        </div>
      </div>

      {/* Modale création */}
      <CountryEditModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false);
          if (created?.id) handleSelect(created.id);
          router.refresh();
        }}
      />

      {/* Modale édition */}
      {editTarget && editMode && (
        <CountryEditModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          editMode={editMode}
        />
      )}

      {/* Trigger invisible pour le bouton « Nouveau pays » du hero */}
      <button
        type="button"
        data-trigger-create-country
        className="hidden"
        onClick={() => setCreateOpen(true)}
      />
    </>
  );
}
