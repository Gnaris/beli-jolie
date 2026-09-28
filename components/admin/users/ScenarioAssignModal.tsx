"use client";

/**
 * Modale de sélection de la cible d'assignation d'un modèle libre à un mail
 * automatique. Utilisée quand le scénario a plusieurs cibles possibles
 * (ABANDONED_CART, INACTIVE_CLIENT — un stade par cible).
 *
 * Pour RESTOCK qui n'a qu'une cible, le flux passe directement par un
 * <ConfirmDialog> côté parent — cette modale n'est pas ouverte.
 */

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  getScenarioAssignTargets,
  type ScenarioAssignTarget,
} from "@/app/actions/admin/newsletter-templates";
import {
  SCENARIO_LABELS,
  type ScenarioKey,
} from "@/lib/mail-scenario-defaults";

interface Props {
  sourceTemplateId: string;
  sourceTemplateName: string;
  scenario: ScenarioKey;
  onCancel: () => void;
  onConfirm: (target: ScenarioAssignTarget) => void;
  pending?: boolean;
}

export default function ScenarioAssignModal({
  sourceTemplateName,
  scenario,
  onCancel,
  onConfirm,
  pending,
}: Props) {
  const toast = useToast();
  const [targets, setTargets] = useState<ScenarioAssignTarget[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getScenarioAssignTargets(scenario);
      if (cancelled) return;
      if (!res.success) {
        toast.error("Chargement impossible", res.error);
        onCancel();
        return;
      }
      setTargets(res.targets);
      if (res.targets.length > 0) setSelectedKey(res.targets[0].key);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scenario, onCancel, toast]);

  function handleConfirm() {
    const target = targets?.find((t) => t.key === selectedKey);
    if (!target) return;
    onConfirm(target);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-bg-primary rounded-2xl border border-border shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border">
          <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">
            {SCENARIO_LABELS[scenario]}
          </div>
          <h2 className="font-heading text-lg font-bold text-text-primary mt-1">
            Sur quel stade appliquer ce modèle ?
          </h2>
          <p className="text-xs font-body text-text-muted mt-2 leading-relaxed">
            Le contenu du modèle{" "}
            <span className="font-semibold text-text-secondary">« {sourceTemplateName} »</span>{" "}
            (HTML, sujet, images) sera copié sur le stade choisi. Le nom du mail
            auto ne change pas — le modèle source reste dans « Mes modèles ».
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-sm text-text-muted text-center py-8">Chargement des stades…</div>
          ) : !targets || targets.length === 0 ? (
            <div className="text-sm text-text-muted text-center py-8">
              Aucun stade configuré pour ce mail automatique. Ouvre d&apos;abord la
              page dédiée pour créer un premier stade.
            </div>
          ) : (
            <div className="space-y-2">
              {targets.map((t) => (
                <label
                  key={t.key}
                  className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                    selectedKey === t.key
                      ? "border-amber-500 bg-amber-50"
                      : "border-border bg-bg-primary hover:bg-bg-secondary"
                  }`}
                >
                  <input
                    type="radio"
                    name="target"
                    value={t.key}
                    checked={selectedKey === t.key}
                    onChange={() => setSelectedKey(t.key)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-body font-bold text-sm text-text-primary">
                      {t.label}
                    </div>
                    {t.sublabel && (
                      <div className="text-xs font-body text-text-muted mt-0.5">
                        {t.sublabel}
                      </div>
                    )}
                    <div className="text-[11px] font-body text-text-muted mt-1">
                      Mail actuel :{" "}
                      <span className="italic">« {t.templateName} »</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-4 py-2 rounded-lg text-sm font-body font-semibold text-text-secondary hover:bg-bg-secondary"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending || loading || !selectedKey}
            className="px-4 py-2 rounded-lg text-sm font-body font-bold bg-gradient-to-br from-amber-600 to-amber-700 text-white shadow-sm hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Copie en cours…" : "Copier vers ce stade"}
          </button>
        </div>
      </div>
    </div>
  );
}
