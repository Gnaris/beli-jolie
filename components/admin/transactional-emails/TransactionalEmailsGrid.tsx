"use client";

/**
 * Grille des mails transactionnels système, groupée par :
 *   1. Audience (clients / admin)
 *   2. Groupe (auth / compte / commande / paiement / support / sécurité)
 *
 * Clic sur une carte → ouvre le modal d'édition `TransactionalEmailModal`.
 * Badge « Personnalisé » = la cliente a sauvegardé un override FR.
 */

import { useMemo, useState } from "react";
import {
  TRANSACTIONAL_SCENARIOS,
  AUDIENCE_LABELS,
  SCENARIO_GROUP_LABELS,
  type TransactionalScenarioAudience,
  type TransactionalScenarioGroup,
  type TransactionalScenarioKey,
  type TransactionalScenarioMeta,
} from "@/lib/transactional-email-scenarios";
import type { ScenarioOverrideState } from "@/app/actions/admin/transactional-emails";
import TransactionalEmailModal from "@/components/admin/transactional-emails/TransactionalEmailModal";

interface Props {
  overrides: ScenarioOverrideState[];
}

const GROUP_STYLES: Record<
  TransactionalScenarioGroup,
  { gradientFrom: string; gradientTo: string; chip: string; icon: string }
> = {
  auth: {
    gradientFrom: "from-indigo-100",
    gradientTo: "to-indigo-200",
    chip: "bg-indigo-100 text-indigo-800",
    icon: "🔑",
  },
  compte: {
    gradientFrom: "from-emerald-100",
    gradientTo: "to-emerald-200",
    chip: "bg-emerald-100 text-emerald-800",
    icon: "👤",
  },
  commande: {
    gradientFrom: "from-sky-100",
    gradientTo: "to-sky-200",
    chip: "bg-sky-100 text-sky-800",
    icon: "📦",
  },
  paiement: {
    gradientFrom: "from-amber-100",
    gradientTo: "to-amber-200",
    chip: "bg-amber-100 text-amber-800",
    icon: "💳",
  },
  support: {
    gradientFrom: "from-rose-100",
    gradientTo: "to-rose-200",
    chip: "bg-rose-100 text-rose-800",
    icon: "💬",
  },
  securite: {
    gradientFrom: "from-slate-200",
    gradientTo: "to-slate-300",
    chip: "bg-slate-200 text-slate-800",
    icon: "🛡️",
  },
};

function formatDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export default function TransactionalEmailsGrid({ overrides }: Props) {
  const [editing, setEditing] = useState<TransactionalScenarioKey | null>(null);
  const [query, setQuery] = useState("");

  const overrideByKey = useMemo(() => {
    const m = new Map<TransactionalScenarioKey, ScenarioOverrideState>();
    for (const o of overrides) m.set(o.scenarioKey, o);
    return m;
  }, [overrides]);

  // Filtre insensible à la casse / accents sur le label + description + groupe.
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

  const filteredScenarios = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return TRANSACTIONAL_SCENARIOS;
    return TRANSACTIONAL_SCENARIOS.filter((s) => {
      const hay = normalize(`${s.label} ${s.description} ${s.group}`);
      return hay.includes(q);
    });
  }, [query]);

  // Regroupe les scénarios filtrés : CLIENT en haut, ADMIN en bas.
  const sections = useMemo(() => {
    const byAudience = new Map<TransactionalScenarioAudience, TransactionalScenarioMeta[]>();
    for (const s of filteredScenarios) {
      const arr = byAudience.get(s.audience) ?? [];
      arr.push(s);
      byAudience.set(s.audience, arr);
    }
    return [
      { audience: "CLIENT" as const, items: byAudience.get("CLIENT") ?? [] },
      { audience: "ADMIN" as const, items: byAudience.get("ADMIN") ?? [] },
    ];
  }, [filteredScenarios]);

  const totalMatches = filteredScenarios.length;

  return (
    <>
      <div className="space-y-6">
        {/* ── Barre de recherche ── */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted">
            🔎
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un mail (ex. « OTP », « commande », « réclamation »…)"
            className="w-full pl-10 pr-24 py-3 rounded-xl border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:border-slate-500 shadow-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute inset-y-0 right-3 flex items-center text-[11px] font-body font-semibold text-text-muted hover:text-text-primary"
            >
              Effacer ✕
            </button>
          )}
        </div>

        {totalMatches === 0 && (
          <div className="bg-bg-primary rounded-2xl border border-dashed border-border shadow-sm py-12 px-6 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <p className="font-body font-semibold text-text-primary">Aucun mail ne correspond à « {query} »</p>
            <p className="text-xs text-text-muted mt-1">Essayez un autre mot-clé ou effacez la recherche.</p>
          </div>
        )}

      </div>

      <div className="space-y-10 mt-6">
        {sections.filter((s) => s.items.length > 0).map((section) => (
          <section key={section.audience}>
            <div className="flex items-center gap-2 mb-4">
              <span
                className={`w-1 h-6 rounded-full bg-gradient-to-b ${
                  section.audience === "CLIENT"
                    ? "from-violet-500 to-violet-700"
                    : "from-slate-500 to-slate-700"
                }`}
              />
              <h2 className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-secondary">
                {AUDIENCE_LABELS[section.audience]}
              </h2>
              <span className="ml-auto text-[11px] text-text-muted font-body">
                {section.items.length} mail{section.items.length > 1 ? "s" : ""}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {section.items.map((meta) => {
                const override = overrideByKey.get(meta.key);
                const style = GROUP_STYLES[meta.group];
                const updatedAt = formatDate(override?.updatedAt ?? null);
                return (
                  <button
                    key={meta.key}
                    type="button"
                    onClick={() => setEditing(meta.key)}
                    className="group text-left bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col hover:bg-bg-secondary/40 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    <div className="p-5 flex-1">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-11 h-11 rounded-xl bg-gradient-to-br ${style.gradientFrom} ${style.gradientTo} flex items-center justify-center text-xl shrink-0`}
                        >
                          {style.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-body font-bold uppercase tracking-wider ${style.chip}`}
                            >
                              {SCENARIO_GROUP_LABELS[meta.group]}
                            </span>
                            {override?.customized && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-body font-bold uppercase tracking-wider bg-violet-100 text-violet-800">
                                Personnalisé
                              </span>
                            )}
                          </div>
                          <div className="font-heading font-bold text-[15px] text-text-primary">
                            {meta.label}
                          </div>
                          <div className="text-[12px] text-text-muted mt-1 line-clamp-2">
                            {meta.description}
                          </div>
                          {updatedAt && (
                            <div className="text-[11px] text-text-muted mt-2">
                              Modifié le {updatedAt}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2 bg-bg-secondary border-t border-border flex justify-end gap-1">
                      <span className="px-2.5 py-1.5 rounded-md text-[11px] font-body font-semibold text-text-secondary group-hover:text-text-primary">
                        {override?.customized ? "Modifier →" : "Personnaliser →"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <TransactionalEmailModal
          scenarioKey={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
