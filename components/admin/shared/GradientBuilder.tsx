"use client";

/**
 * GradientBuilder — construit un dégradé CSS via UI simple, sans CSS.
 *
 * L'utilisateur choisit le type (linéaire/radial/conique), l'angle, et ajoute
 * autant de points de couleur qu'il veut. Chaque point a une couleur et une
 * position (0-100 %) qui contrôle la « douceur » de la transition.
 *
 * Valeur d'output : chaîne CSS prête à coller dans `background:` (interop
 * total avec l'existant qui stockait déjà des strings CSS).
 *
 * BackgroundInput est un wrapper : toggle « Couleur unie / Dégradé » qui bascule
 * entre un ColorInput et le GradientBuilder.
 */

import { useMemo, useState, useCallback } from "react";
import {
  parseGradient,
  serializeGradient,
  isGradientString,
  DEFAULT_GRADIENT,
  type GradientStop,
  type GradientType,
  type ParsedGradient,
} from "@/lib/gradient-parser";

/* ─────────────────────────────────────────────
   ColorInput (déplacé ici pour partage)
   ───────────────────────────────────────────── */

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const safe = /^#([0-9a-fA-F]{6})$/.test(value) ? value : "#000000";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-14 rounded-lg border border-border cursor-pointer"
        style={{ padding: 2 }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 px-3 py-2.5 text-[14px] font-mono border border-border rounded-md focus:outline-none focus:border-slate-500"
      />
    </div>
  );
}

/* ─────────────────────────────────────────────
   GradientBuilder
   ───────────────────────────────────────────── */

interface GradientBuilderProps {
  value: string;              // CSS string
  onChange: (v: string) => void;
}

export function GradientBuilder({ value, onChange }: GradientBuilderProps) {
  const parsed = useMemo<ParsedGradient>(
    () => (isGradientString(value) ? parseGradient(value) : DEFAULT_GRADIENT),
    [value],
  );

  const commit = useCallback(
    (next: ParsedGradient) => onChange(serializeGradient(next)),
    [onChange],
  );

  function setType(type: GradientType) {
    commit({ ...parsed, type });
  }
  function setAngle(angle: number) {
    commit({ ...parsed, angle });
  }
  function updateStop(index: number, patch: Partial<GradientStop>) {
    const next = [...parsed.stops];
    next[index] = { ...next[index], ...patch };
    commit({ ...parsed, stops: next });
  }
  function addStop() {
    const stops = [...parsed.stops].sort((a, b) => a.position - b.position);
    // Nouveau stop = milieu entre les 2 derniers (ou 50 % si un seul)
    const last = stops[stops.length - 1];
    const prev = stops[stops.length - 2];
    const newPos = prev ? Math.round((last.position + prev.position) / 2) : 50;
    // Couleur = mix simple entre les 2 derniers (moyenne des composantes)
    const mixColor = prev ? mixHex(prev.color, last.color) : last.color;
    commit({ ...parsed, stops: [...stops, { color: mixColor, position: newPos }] });
  }
  function removeStop(index: number) {
    if (parsed.stops.length <= 2) return; // toujours ≥ 2 pour un vrai dégradé
    const next = parsed.stops.filter((_, i) => i !== index);
    commit({ ...parsed, stops: next });
  }

  const cssPreview = serializeGradient(parsed);
  const showAngle = parsed.type !== "radial";

  return (
    <div className="rounded-xl border border-border bg-bg-secondary/40 p-4 space-y-4">
      {/* Aperçu large */}
      <div
        className="h-16 rounded-lg border border-border shadow-inner"
        style={{ background: cssPreview }}
        aria-label="Aperçu du dégradé"
      />

      {/* Type — 3 petits boutons carrés avec icône simple */}
      <div>
        <label className="block text-[11px] uppercase tracking-[0.14em] font-body font-bold text-text-muted mb-2">Type de dégradé</label>
        <div className="inline-flex gap-1.5">
          <GradientTypeButton
            active={parsed.type === "linear"}
            onClick={() => setType("linear")}
            label="Linéaire"
            shape="linear"
          />
          <GradientTypeButton
            active={parsed.type === "radial"}
            onClick={() => setType("radial")}
            label="Radial"
            shape="radial"
          />
          <GradientTypeButton
            active={parsed.type === "conic"}
            onClick={() => setType("conic")}
            label="Conique"
            shape="conic"
          />
        </div>
      </div>

      {showAngle && (
        <div>
          <label className="block text-[11px] uppercase tracking-[0.14em] font-body font-bold text-text-muted mb-1.5">
            Direction — {Math.round(parsed.angle)}°
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={parsed.angle}
              onChange={(e) => setAngle(Number(e.target.value))}
              className="flex-1"
            />
            <input
              type="number"
              min={0}
              max={360}
              value={Math.round(parsed.angle)}
              onChange={(e) => setAngle(Number(e.target.value) || 0)}
              className="w-16 px-2 py-1.5 text-[13px] font-mono border border-border rounded-md focus:outline-none focus:border-slate-500"
            />
          </div>
        </div>
      )}

      {/* Stops */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[11px] uppercase tracking-[0.14em] font-body font-bold text-text-muted">
            Couleurs — {parsed.stops.length} points
          </label>
          <button
            type="button"
            onClick={addStop}
            className="px-2.5 py-1 rounded-md text-[11px] font-body font-semibold bg-slate-800 text-white hover:bg-slate-900"
          >
            + Ajouter une couleur
          </button>
        </div>

        <div className="space-y-2">
          {parsed.stops.map((s, i) => (
            // Layout 2 lignes : ligne 1 = couleur (picker + hex + croix), ligne 2 = position (slider + %).
            // Évite l'overflow horizontal dans les panneaux étroits (settings d'un bloc newsletter).
            <div key={i} className="p-2.5 rounded-lg bg-bg-primary border border-border space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <input
                  type="color"
                  value={/^#([0-9a-f]{6})$/i.test(s.color) ? s.color : "#000000"}
                  onChange={(e) => updateStop(i, { color: e.target.value })}
                  className="h-9 w-11 rounded-md border border-border cursor-pointer shrink-0"
                  style={{ padding: 2 }}
                />
                <input
                  type="text"
                  value={s.color}
                  onChange={(e) => updateStop(i, { color: e.target.value })}
                  className="flex-1 min-w-0 px-2 py-1.5 text-[12px] font-mono border border-border rounded-md focus:outline-none focus:border-slate-500"
                />
                {parsed.stops.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeStop(i)}
                    className="shrink-0 w-8 h-8 rounded-md text-red-600 hover:bg-red-50 border border-red-200 flex items-center justify-center"
                    title="Supprimer cette couleur"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={s.position}
                  onChange={(e) => updateStop(i, { position: Number(e.target.value) })}
                  className="flex-1 min-w-0"
                  title="Position sur le dégradé"
                />
                <span className="shrink-0 w-11 text-right text-[12px] font-mono text-text-muted">
                  {Math.round(s.position)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   BackgroundInput — toggle Solid / Gradient
   ───────────────────────────────────────────── */

interface BackgroundInputProps {
  /** Chaîne CSS acceptable dans `background:` — hex, gradient, "transparent" ou "" */
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  /** Autorise « aucun fond » (null / transparent). Défaut : true. */
  allowEmpty?: boolean;
  /** Défaut appliqué au 1er passage en mode dégradé si `value` n'était pas un dégradé. */
  defaultGradient?: string;
}

export function BackgroundInput({
  value,
  onChange,
  allowEmpty = true,
  defaultGradient,
}: BackgroundInputProps) {
  const isEmpty = !value || value === "transparent";
  const isGradient = !isEmpty && isGradientString(value ?? "");
  const initialMode: "none" | "solid" | "gradient" = isEmpty
    ? (allowEmpty ? "none" : "solid")
    : isGradient
      ? "gradient"
      : "solid";
  const [mode, setMode] = useState<"none" | "solid" | "gradient">(initialMode);

  // Mémorise les dernières valeurs de chaque mode pour ne pas les perdre au switch
  const [lastSolid, setLastSolid] = useState<string>(
    !isEmpty && !isGradient ? (value as string) : "#0f172a",
  );
  const [lastGradient, setLastGradient] = useState<string>(
    isGradient ? (value as string) : defaultGradient ?? "linear-gradient(135deg,#0f172a,#334155)",
  );

  function switchMode(next: "none" | "solid" | "gradient") {
    setMode(next);
    if (next === "none") onChange(allowEmpty ? null : lastSolid);
    else if (next === "solid") onChange(lastSolid);
    else onChange(lastGradient);
  }

  const options: Array<{ value: string; label: string }> = [];
  if (allowEmpty) options.push({ value: "none", label: "Aucun fond" });
  options.push({ value: "solid", label: "Couleur unie" }, { value: "gradient", label: "Dégradé" });

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-border bg-bg-secondary p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => switchMode(o.value as "none" | "solid" | "gradient")}
            className={`px-3 py-1.5 rounded-md text-[12px] font-body font-semibold transition ${
              mode === o.value
                ? "bg-bg-primary text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {mode === "solid" && (
        <ColorInput
          value={lastSolid}
          onChange={(v) => {
            setLastSolid(v);
            onChange(v);
          }}
        />
      )}

      {mode === "gradient" && (
        <GradientBuilder
          value={lastGradient}
          onChange={(v) => {
            setLastGradient(v);
            onChange(v);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Helpers internes
   ───────────────────────────────────────────── */

function mixHex(a: string, b: string): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const mix = (x: number, y: number) => Math.round((x + y) / 2);
  return `#${toHex(mix(pa[0], pb[0]))}${toHex(mix(pa[1], pb[1]))}${toHex(mix(pa[2], pb[2]))}`;
}
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}
function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/* ─────────────────────────────────────────────
   Bouton visuel pour le choix de type de dégradé
   ───────────────────────────────────────────── */

function GradientTypeButton({
  active,
  onClick,
  label,
  shape,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  shape: "linear" | "radial" | "conic";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-all ${
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-sm ring-2 ring-slate-900/20"
          : "border-border bg-bg-primary text-text-secondary hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-text-primary"
      }`}
    >
      <GradientShapeIcon shape={shape} />
    </button>
  );
}

/**
 * Icône schématique 20×20 : représente la forme du dégradé (pas ses couleurs).
 * - linear : 3 bandes verticales de + en + claires (courant qui va d'un côté)
 * - radial : cercles concentriques (halo)
 * - conic : disque partagé en 4 secteurs (tour autour d'un point)
 */
function GradientShapeIcon({ shape }: { shape: "linear" | "radial" | "conic" }) {
  if (shape === "linear") {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="2" y="4" width="4" height="12" rx="1" fill="currentColor" opacity="0.9" />
        <rect x="8" y="4" width="4" height="12" rx="1" fill="currentColor" opacity="0.55" />
        <rect x="14" y="4" width="4" height="12" rx="1" fill="currentColor" opacity="0.25" />
      </svg>
    );
  }
  if (shape === "radial") {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="8" fill="currentColor" opacity="0.2" />
        <circle cx="10" cy="10" r="5" fill="currentColor" opacity="0.5" />
        <circle cx="10" cy="10" r="2.5" fill="currentColor" opacity="0.95" />
      </svg>
    );
  }
  // conic
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="currentColor" opacity="0.15" />
      <path d="M10 2 A8 8 0 0 1 18 10 L10 10 Z" fill="currentColor" opacity="0.95" />
      <path d="M10 10 L18 10 A8 8 0 0 1 10 18 Z" fill="currentColor" opacity="0.5" />
      <path d="M10 10 L10 18 A8 8 0 0 1 2 10 Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
