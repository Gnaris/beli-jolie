"use client";

/**
 * InsertVariableButton — bouton compact « { } Variables » qui insère un
 * `{token}` au curseur d'un input/textarea passé en ref.
 *
 * Version standalone, adaptée aux formulaires simples (settings d'habillage,
 * édition d'un champ isolé). L'éditeur newsletter utilise une variante
 * globale (`GlobalVariableButton`) via un ActiveInputContext quand plusieurs
 * champs partagent un unique bouton.
 *
 * `scenario={null}` (défaut) : n'affiche que les variables client + boutique
 * (pas les dynamiques scoped à un scénario transactionnel).
 */

import { useEffect, useRef, useState } from "react";
import {
  variablesForScenario,
  VARIABLE_GROUP_LABELS,
  type MailVariable,
  type VariableGroup,
} from "@/lib/mail-merge-variables";
import type { ScenarioKey } from "@/lib/mail-scenario-defaults";

interface Props {
  /** Réf vers l'input/textarea où insérer le token. */
  targetRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Valeur actuelle du champ (React state). */
  value: string;
  /** Setter React state — appelé avec la nouvelle valeur après insertion. */
  onChange: (v: string) => void;
  /** Restreint aux variables d'un scénario. `null` = communes uniquement. */
  scenario?: ScenarioKey | null;
  /** Libellé du bouton. Défaut « Variables ». */
  label?: string;
  /** Position du menu. Défaut « right ». */
  align?: "left" | "right";
}

export default function InsertVariableButton({
  targetRef,
  value,
  onChange,
  scenario = null,
  label = "Variables",
  align = "right",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Fermeture au clic extérieur + touche Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function insertToken(token: string) {
    const el = targetRef.current;
    const literal = `{${token}}`;
    if (!el) {
      // Pas de champ actif : on colle à la fin.
      onChange(value + literal);
      setOpen(false);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = el.value;
    const next = current.slice(0, start) + literal + current.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + literal.length;
      el.setSelectionRange(pos, pos);
    });
    setOpen(false);
  }

  const variables = variablesForScenario(scenario);
  const byGroup = new Map<VariableGroup, MailVariable[]>();
  for (const v of variables) {
    const arr = byGroup.get(v.group) ?? [];
    arr.push(v);
    byGroup.set(v.group, arr);
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title="Insère une variable qui sera remplacée par la vraie info du client à l'envoi."
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-body font-bold border bg-violet-600 hover:bg-violet-700 text-white border-violet-700 shadow-sm"
      >
        <span className="font-mono">{"{ }"}</span>
        {label}
      </button>

      {open && (
        <div
          className={`absolute z-50 ${align === "right" ? "right-0" : "left-0"} mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-bg-primary shadow-2xl`}
          role="menu"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="sticky top-0 bg-bg-primary border-b border-border px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.14em] font-body font-bold text-text-muted">
              Cliquez pour insérer
            </div>
            <div className="text-[11px] text-text-muted mt-0.5 leading-snug">
              La variable sera remplacée par la vraie info du client à l&apos;envoi.
            </div>
          </div>
          {(["legal", "client", "boutique", "dynamique"] as VariableGroup[]).map((g) => {
            const items = byGroup.get(g);
            if (!items || items.length === 0) return null;
            return (
              <div key={g} className="py-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-[0.14em] font-body font-bold text-text-muted bg-bg-secondary/50">
                  {VARIABLE_GROUP_LABELS[g]}
                </div>
                {items.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => insertToken(v.token)}
                    className="w-full flex items-baseline justify-between gap-2 px-3 py-1.5 hover:bg-slate-50 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[12.5px] text-text-primary font-body font-semibold">{v.label}</span>
                        {v.requiredMarketing && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-body font-bold uppercase bg-red-100 text-red-800 border border-red-200">
                            ⚠ Obligatoire
                          </span>
                        )}
                      </span>
                      {v.hint && <span className="block text-[10.5px] text-text-muted mt-0.5">{v.hint}</span>}
                    </span>
                    <code className="shrink-0 text-[10.5px] text-slate-600 font-mono">{`{${v.token}}`}</code>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
