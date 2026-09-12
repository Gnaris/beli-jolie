"use client";

import { useState } from "react";
import { updateHomeHero } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  initialEyebrow: string;
  initialTitleLine1: string;
  initialTitleLine2: string;
  initialDescription: string;
  initialCtaSecondaryLabel: string;
  initialCtaSecondaryHref: string;
}

const EYEBROW_MAX = 120;
const TITLE_MAX = 60;
const DESC_MAX = 400;
const LABEL_MAX = 60;
const HREF_MAX = 200;

export default function HomeHeroConfig({
  initialEyebrow,
  initialTitleLine1,
  initialTitleLine2,
  initialDescription,
  initialCtaSecondaryLabel,
  initialCtaSecondaryHref,
}: Props) {
  const [eyebrow, setEyebrow] = useState(initialEyebrow);
  const [titleLine1, setTitleLine1] = useState(initialTitleLine1);
  const [titleLine2, setTitleLine2] = useState(initialTitleLine2);
  const [description, setDescription] = useState(initialDescription);
  const [ctaSecondaryLabel, setCtaSecondaryLabel] = useState(initialCtaSecondaryLabel);
  const [ctaSecondaryHref, setCtaSecondaryHref] = useState(initialCtaSecondaryHref);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateHomeHero({
        eyebrow,
        titleLine1,
        titleLine2,
        description,
        ctaSecondaryLabel,
        ctaSecondaryHref,
      });
      if (result.success) {
        toast({ type: "success", title: "Enregistré", message: "Bloc d'accueil mis à jour." });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de la sauvegarde." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-muted font-body">
        Textes affichés dans le grand bandeau noir en haut de la page d&apos;accueil.
        Laissez un champ vide pour utiliser le texte générique par défaut.
      </p>

      <div>
        <label htmlFor="hero-eyebrow" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Surtitre (petit texte au-dessus du titre)
        </label>
        <input
          id="hero-eyebrow"
          type="text"
          value={eyebrow}
          onChange={(e) => setEyebrow(e.target.value.slice(0, EYEBROW_MAX))}
          placeholder="Grossiste en prêt-à-porter féminin B2B · CIFA Aubervilliers"
          className="field-input"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {eyebrow.length} / {EYEBROW_MAX}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="hero-title-1" className="block text-sm font-body font-medium text-text-primary mb-1.5">
            Titre — 1ʳᵉ ligne
          </label>
          <input
            id="hero-title-1"
            type="text"
            value={titleLine1}
            onChange={(e) => setTitleLine1(e.target.value.slice(0, TITLE_MAX))}
            placeholder="Des produits tendance"
            className="field-input"
          />
          <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
            {titleLine1.length} / {TITLE_MAX}
          </p>
        </div>
        <div>
          <label htmlFor="hero-title-2" className="block text-sm font-body font-medium text-text-primary mb-1.5">
            Titre — 2ᵉ ligne (soulignée en jaune)
          </label>
          <input
            id="hero-title-2"
            type="text"
            value={titleLine2}
            onChange={(e) => setTitleLine2(e.target.value.slice(0, TITLE_MAX))}
            placeholder="pour votre boutique"
            className="field-input"
          />
          <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
            {titleLine2.length} / {TITLE_MAX}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="hero-desc" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Description sous le titre
        </label>
        <textarea
          id="hero-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
          rows={3}
          placeholder="Plus de 600 références disponibles pour les boutiques et revendeurs professionnels…"
          className="field-input resize-y min-h-[80px]"
        />
        <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
          {description.length} / {DESC_MAX}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-bg-secondary p-4 space-y-4">
        <p className="text-xs font-body font-medium text-text-primary">
          2ᵉ bouton (le 1ᵉʳ reste « Voir le catalogue » → /produits)
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="hero-cta2-label" className="block text-sm font-body font-medium text-text-primary mb-1.5">
              Libellé du bouton
            </label>
            <input
              id="hero-cta2-label"
              type="text"
              value={ctaSecondaryLabel}
              onChange={(e) => setCtaSecondaryLabel(e.target.value.slice(0, LABEL_MAX))}
              placeholder="Créer un compte professionnel"
              className="field-input"
            />
            <p className="text-[11px] text-text-muted font-body mt-1 text-right tabular-nums">
              {ctaSecondaryLabel.length} / {LABEL_MAX}
            </p>
          </div>
          <div>
            <label htmlFor="hero-cta2-href" className="block text-sm font-body font-medium text-text-primary mb-1.5">
              Adresse du bouton
            </label>
            <input
              id="hero-cta2-href"
              type="text"
              value={ctaSecondaryHref}
              onChange={(e) => setCtaSecondaryHref(e.target.value.slice(0, HREF_MAX))}
              placeholder="/inscription"
              className="field-input font-mono text-sm"
            />
            <p className="text-[11px] text-text-muted font-body mt-1">
              Commence par « / » pour une page interne ou « https:// » pour un lien externe.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary px-5 disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
