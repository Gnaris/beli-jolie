"use client";

import { useState, useTransition } from "react";
import { setCollectionDisplayOrder } from "@/app/actions/admin/collections";
import { useToast } from "@/components/ui/Toast";

interface Props {
  id: string;
  initialOrder: number;
}

export default function CollectionOrderInput({ id, initialOrder }: Props) {
  const [value, setValue] = useState(String(initialOrder));
  const [committed, setCommitted] = useState(initialOrder);
  const [pending, startTransition] = useTransition();
  const { success, error } = useToast();

  function stop(e: React.SyntheticEvent) {
    e.stopPropagation();
  }

  function commit() {
    const parsed = Number.parseInt(value, 10);
    const next = Number.isFinite(parsed) ? parsed : 0;
    if (next === committed) {
      setValue(String(committed));
      return;
    }
    const previous = committed;
    setCommitted(next);
    setValue(String(next));
    startTransition(async () => {
      try {
        const res = await setCollectionDisplayOrder(id, next);
        if (!res.success) {
          setCommitted(previous);
          setValue(String(previous));
          error("Ordre non enregistré", res.error ?? "Numéro invalide.");
          return;
        }
        success("Ordre mis à jour", `Numéro d'affichage : ${next}`);
      } catch (err) {
        setCommitted(previous);
        setValue(String(previous));
        const detail = err instanceof Error ? err.message : "Erreur inconnue";
        error("Ordre non enregistré", detail);
      }
    });
  }

  return (
    <label
      className="inline-flex items-center gap-1.5 text-xs font-body text-text-muted"
      onClick={stop}
      title="Numéro d'ordre sur /collections (plus petit = en premier)"
    >
      <span>N°</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={9999}
        value={value}
        disabled={pending}
        onClick={stop}
        onKeyDown={(e) => {
          stop(e);
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onChange={(e) => {
          stop(e);
          setValue(e.target.value);
        }}
        onBlur={(e) => {
          stop(e);
          commit();
        }}
        className="w-14 px-2 py-1 rounded-lg border border-border bg-bg-primary text-text-primary text-center font-medium disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
    </label>
  );
}
