"use client";

import { useState, useTransition } from "react";
import { updateGtmContainerId } from "@/app/actions/admin/analytics";
import { GTM_CONTAINER_ID_PATTERN } from "@/lib/analytics";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  initialGtmId: string;
}

/**
 * Carte « Google Tag Manager » dans Paramètres → Contenu & Google.
 *
 * ID public (du type GTM-ABC1234) visible dans le code source du site —
 * pas de chiffrement nécessaire. Valide le format côté client avant d'appeler
 * l'action serveur ; vider le champ désactive GTM.
 */
export default function AnalyticsConfig({ initialGtmId }: Props) {
  const [gtmId, setGtmId] = useState(initialGtmId);
  const [savedId, setSavedId] = useState(initialGtmId);
  const [isSaving, startSaving] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const trimmed = gtmId.trim();
  const dirty = trimmed !== savedId.trim();
  const validFormat = trimmed === "" || GTM_CONTAINER_ID_PATTERN.test(trimmed);

  function handleSave() {
    showLoading();
    startSaving(async () => {
      try {
        const result = await updateGtmContainerId(trimmed);
        if (result.success) {
          setSavedId(trimmed);
          toast.success(
            "Enregistré",
            trimmed ? "Google Tag Manager est actif sur votre boutique." : "Google Tag Manager désactivé.",
          );
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-secondary/40 p-4">
        <p className="text-sm font-body text-text-secondary leading-relaxed">
          Google Tag Manager vous permet de brancher Google Analytics, Meta Pixel et d&apos;autres
          outils de suivi sans passer par nous.{" "}
          <a
            href="https://tagmanager.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-primary underline hover:no-underline"
          >
            Créer un compte GTM
          </a>
          , récupérer l&apos;identifiant au format{" "}
          <code className="font-mono text-[12px] px-1.5 py-0.5 rounded bg-bg-primary border border-border">
            GTM-XXXXXXX
          </code>{" "}
          et le coller ci-dessous.
        </p>
        <p className="text-[12px] font-body text-text-muted mt-2 leading-relaxed">
          Une bannière de consentement cookies RGPD s&apos;affichera automatiquement sur votre
          boutique dès qu&apos;un identifiant est enregistré — vos visiteurs doivent accepter
          avant que GTM ne soit activé.
        </p>
      </div>

      <div>
        <label className="block text-[12px] font-body font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
          Identifiant Google Tag Manager
        </label>
        <input
          type="text"
          value={gtmId}
          onChange={(e) => setGtmId(e.target.value.toUpperCase())}
          placeholder="GTM-XXXXXXX"
          className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body font-mono placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
          disabled={isSaving}
          autoComplete="off"
          spellCheck={false}
        />
        {trimmed && !validFormat && (
          <p className="text-[12px] font-body text-rose-600 mt-1.5">
            Format attendu : <code className="font-mono">GTM-</code> suivi de 4 à 10 lettres
            majuscules ou chiffres.
          </p>
        )}
        <div className="flex items-center justify-between mt-3">
          <span className="text-[12px] font-body text-text-muted">
            {savedId
              ? `GTM actif : ${savedId}`
              : "GTM désactivé — aucune bannière cookies, aucun suivi."}
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !dirty || !validFormat}
            className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {isSaving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
