"use client";

/**
 * SageArticleCodeMappingModal — code article Sage pour la facturation.
 * Utilisé par l'extension « Regroupement facture » qui l'envoie à SageBridge
 * pour la création de factures provisoires dans Sage 50.
 *
 * Le champ est un input texte avec autocomplétion : si SageBridge tourne sur
 * la machine de l'utilisateur (http://127.0.0.1:8765), on récupère la liste
 * réelle des articles de son dossier et on l'affiche en suggestions. Sinon
 * saisie libre pure. Chaque tenant interroge sa propre instance locale.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MappingModalShell, { AvatarBadge } from "./MappingModalShell";
import { useToast } from "@/components/ui/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  entityLabel: string;
  currentValue: string | null;
  onSave: (next: string | null) => Promise<unknown>;
}

type SageArticle = { code: string; nom: string };
type ArticlesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; list: SageArticle[] }
  | { kind: "unavailable"; reason: string };

export default function SageArticleCodeMappingModal({
  open,
  onClose,
  entityLabel,
  currentValue,
  onSave,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articles, setArticles] = useState<ArticlesState>({ kind: "idle" });

  useEffect(() => {
    if (!open) return;
    setValue(currentValue ?? "");
    setError(null);
    setSaving(false);
    setArticles({ kind: "loading" });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    fetch("http://127.0.0.1:8765/articles", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (resp) => {
        clearTimeout(timer);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const list = (await resp.json()) as SageArticle[];
        if (!Array.isArray(list)) throw new Error("Format inattendu");
        setArticles({ kind: "ready", list });
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const reason =
          err instanceof Error
            ? err.name === "AbortError"
              ? "délai dépassé"
              : err.message
            : "injoignable";
        setArticles({ kind: "unavailable", reason });
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, currentValue]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const next = value.trim() || null;
      await onSave(next);
      toast.success(next ? "Code article Sage enregistré" : "Code article Sage retiré");
      router.refresh();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur d'enregistrement.";
      setError(msg);
      toast.error("Sage", msg);
    } finally {
      setSaving(false);
    }
  }

  const datalistId = "sage-articles-datalist";

  return (
    <MappingModalShell
      open={open}
      onClose={onClose}
      eyebrow={`Mapping · ${entityLabel}`}
      title="Sage — code article de facturation"
      subtitle="Code utilisé par l'extension « Regroupement facture » pour créer les factures dans Sage 50 via SageBridge."
      avatar={<AvatarBadge gradient="linear-gradient(135deg,#10B981,#059669)" text="Sa" />}
      accentColor="#10B981"
      maxWidth="md"
      error={error}
      primaryAction={{ label: "Enregistrer", onClick: handleSave, loading: saving }}
    >
      <div className="flex flex-col gap-3">
        <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
          Code article dans ton dossier Sage
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ex : ART0003"
          autoFocus
          maxLength={50}
          className="field-input w-full text-sm font-mono"
          list={articles.kind === "ready" ? datalistId : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !saving) {
              e.preventDefault();
              handleSave();
            }
          }}
        />
        {articles.kind === "ready" && (
          <datalist id={datalistId}>
            {articles.list.map((a) => (
              <option key={a.code} value={a.code}>
                {a.nom ? `${a.code} — ${a.nom}` : a.code}
              </option>
            ))}
          </datalist>
        )}
        {articles.kind === "loading" && (
          <p className="text-[11.5px] text-text-muted leading-relaxed">
            Chargement de la liste d'articles depuis SageBridge…
          </p>
        )}
        {articles.kind === "ready" && (
          <p className="text-[11.5px] text-emerald-700 leading-relaxed">
            {articles.list.length} article{articles.list.length > 1 ? "s" : ""} chargé
            {articles.list.length > 1 ? "s" : ""} depuis ton Sage — tape pour chercher,
            ou colle un code manuel.
          </p>
        )}
        {articles.kind === "unavailable" && (
          <p className="text-[11.5px] text-amber-700 leading-relaxed">
            SageBridge n'a pas répondu ({articles.reason}) — saisie libre à la place
            de la liste. Pour voir tes articles : lance SageBridge et ouvre Sage 50,
            puis rouvre cette fenêtre.
          </p>
        )}
        <p className="text-[11.5px] text-text-muted leading-relaxed">
          Ce code doit exister à l'identique dans ton dossier Sage 50 (sinon
          Sage refuse la ligne lors de la création de la facture). Laisse vide
          pour que l'extension te demande à chaque fois.
        </p>
      </div>
    </MappingModalShell>
  );
}
