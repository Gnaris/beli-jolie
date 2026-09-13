"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { updateHeroOverlay } from "@/app/actions/admin/site-config";
import {
  DEFAULT_HERO_OVERLAY,
  heroOverlayBackground,
  type HeroOverlayDirection,
  type HeroOverlaySettings,
  type HeroOverlayType,
} from "@/lib/hero-overlay";

interface DirectionButton {
  value: HeroOverlayDirection;
  label: string;
  preview: string;
}

const DIRECTION_BUTTONS: DirectionButton[] = [
  {
    value: "left",
    label: "Gauche",
    preview: "linear-gradient(to right, rgba(15,15,15,0.95) 0%, rgba(15,15,15,0.85) 45%, transparent 100%)",
  },
  {
    value: "right",
    label: "Droite",
    preview: "linear-gradient(to left, rgba(15,15,15,0.95) 0%, rgba(15,15,15,0.85) 45%, transparent 100%)",
  },
  {
    value: "top",
    label: "Haut",
    preview: "linear-gradient(to bottom, rgba(15,15,15,0.95) 0%, rgba(15,15,15,0.85) 45%, transparent 100%)",
  },
  {
    value: "bottom",
    label: "Bas",
    preview: "linear-gradient(to top, rgba(15,15,15,0.95) 0%, rgba(15,15,15,0.85) 45%, transparent 100%)",
  },
  {
    value: "diagonal",
    label: "Diagonale",
    preview: "linear-gradient(to bottom right, rgba(15,15,15,0.95) 0%, rgba(15,15,15,0.85) 45%, transparent 100%)",
  },
];

interface TypeButton {
  value: HeroOverlayType;
  label: string;
  hint: string;
  preview: string;
}

const TYPE_BUTTONS: TypeButton[] = [
  {
    value: "linear",
    label: "Dégradé linéaire",
    hint: "Voile qui se fond d'un côté",
    preview: "linear-gradient(to right, rgba(15,15,15,0.95) 0%, rgba(15,15,15,0.85) 45%, transparent 100%)",
  },
  {
    value: "radial",
    label: "Dégradé radial",
    hint: "Vignette — bords sombres",
    preview: "radial-gradient(circle at center, transparent 0%, rgba(15,15,15,0.95) 100%)",
  },
  {
    value: "solid",
    label: "Voile uni",
    hint: "Même couleur partout",
    preview: "rgba(15,15,15,0.7)",
  },
];

interface Props {
  initial: HeroOverlaySettings;
  bannerImage: string | null;
}

export default function HeroOverlayConfig({ initial, bannerImage }: Props) {
  const [type, setType] = useState<HeroOverlayType>(initial.type);
  const [direction, setDirection] = useState<HeroOverlayDirection>(initial.direction);
  const [color, setColor] = useState<string>(initial.color);
  const [opacity, setOpacity] = useState<number>(initial.opacity);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const preview = useMemo(
    () => heroOverlayBackground({ type, direction, color, opacity }),
    [type, direction, color, opacity],
  );

  async function handleSave() {
    setSaving(true);
    try {
      const res = await updateHeroOverlay({ type, direction, color, opacity });
      if (res.success) {
        toast({ type: "success", title: "Succès", message: "Voile mis à jour." });
      } else {
        toast({ type: "error", title: "Erreur", message: res.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de la sauvegarde." });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setType(DEFAULT_HERO_OVERLAY.type);
    setDirection(DEFAULT_HERO_OVERLAY.direction);
    setColor(DEFAULT_HERO_OVERLAY.color);
    setOpacity(DEFAULT_HERO_OVERLAY.opacity);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-bg-secondary p-3">
        <p className="text-xs uppercase tracking-[0.18em] text-text-muted font-body mb-2">
          Aperçu du voile sur la bannière
        </p>
        <div
          className="relative w-full aspect-[2.4/1] rounded-md overflow-hidden bg-bg-darker"
          style={{
            backgroundImage: bannerImage ? `url(${bannerImage})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="absolute inset-0" style={{ background: preview }} />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <p className="text-[10px] uppercase tracking-[0.28em] text-white/60 font-body">
                Exemple
              </p>
              <p className="text-lg font-heading font-bold leading-tight mt-1">
                Titre de la bannière
              </p>
              <p className="text-xs text-white/70 mt-1 max-w-[220px]">
                Le voile doit garder ce texte parfaitement lisible.
              </p>
            </div>
          </div>
        </div>
        {!bannerImage && (
          <p className="text-xs text-text-secondary font-body mt-2">
            Ajoutez d'abord une bannière juste au-dessus pour voir l'effet sur votre vraie image.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
            Type de voile
          </label>
          <div className="grid grid-cols-3 gap-2">
            {TYPE_BUTTONS.map((btn) => {
              const active = type === btn.value;
              return (
                <button
                  key={btn.value}
                  type="button"
                  onClick={() => setType(btn.value)}
                  aria-pressed={active}
                  className={`group flex flex-col items-stretch gap-2 p-2.5 rounded-lg border transition-all text-left ${
                    active
                      ? "border-bg-dark bg-bg-dark/5 ring-2 ring-bg-dark/20"
                      : "border-border hover:border-text-secondary bg-bg-primary"
                  }`}
                >
                  <div
                    className="w-full aspect-[2.4/1] rounded-md bg-slate-200 overflow-hidden"
                    style={{ backgroundImage: btn.preview }}
                    aria-hidden
                  />
                  <div>
                    <p className={`text-xs font-heading font-semibold leading-tight ${active ? "text-text-primary" : "text-text-primary"}`}>
                      {btn.label}
                    </p>
                    <p className="text-[10px] text-text-secondary font-body leading-tight mt-0.5">
                      {btn.hint}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {type === "linear" && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
              Direction du dégradé
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {DIRECTION_BUTTONS.map((btn) => {
                const active = direction === btn.value;
                return (
                  <button
                    key={btn.value}
                    type="button"
                    onClick={() => setDirection(btn.value)}
                    aria-pressed={active}
                    className={`flex flex-col items-stretch gap-1.5 p-2 rounded-lg border transition-all ${
                      active
                        ? "border-bg-dark bg-bg-dark/5 ring-2 ring-bg-dark/20"
                        : "border-border hover:border-text-secondary bg-bg-primary"
                    }`}
                  >
                    <div
                      className="w-full aspect-[2.4/1] rounded bg-slate-200 overflow-hidden"
                      style={{ backgroundImage: btn.preview }}
                      aria-hidden
                    />
                    <p className="text-[11px] font-heading font-semibold text-text-primary text-center leading-tight">
                      {btn.label}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
              Couleur du voile
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 rounded-md border border-border bg-bg-primary cursor-pointer"
                aria-label="Choisir la couleur du voile"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                pattern="#[0-9a-fA-F]{6}"
                className="flex-1 h-10 px-3 rounded-md border border-border bg-bg-primary text-sm font-mono text-text-primary"
                placeholder="#0f0f0f"
              />
            </div>
            <p className="text-[11px] text-text-muted font-body mt-1">
              Noir par défaut. Testez une teinte proche de votre logo pour un rendu personnalisé.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
              Intensité — {opacity}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full accent-bg-dark"
              aria-label="Intensité du voile"
            />
            <div className="flex justify-between text-[11px] text-text-muted font-body mt-1">
              <span>Aucun voile</span>
              <span>Voile opaque</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bg-dark text-text-inverse text-sm font-heading font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer le voile"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-text-secondary text-sm font-body hover:bg-bg-secondary transition-colors disabled:opacity-50"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
