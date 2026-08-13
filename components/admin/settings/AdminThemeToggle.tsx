"use client";

import { useState, useTransition } from "react";
import { setAdminTheme } from "@/app/actions/admin/admin-theme";
import { useToast } from "@/components/ui/Toast";
import type { AdminTheme } from "@/lib/admin-theme";

interface Props {
  initialTheme: AdminTheme;
}

export default function AdminThemeToggle({ initialTheme }: Props) {
  const [theme, setTheme] = useState<AdminTheme>(initialTheme);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function applyClass(next: AdminTheme) {
    if (typeof document === "undefined") return;
    const wrapper = document.getElementById("admin-theme-wrapper");
    if (wrapper) {
      if (next === "dark") wrapper.classList.add("admin-dark");
      else wrapper.classList.remove("admin-dark");
    }
    // Miroir sur <html> pour que la scrollbar du navigateur (rendue par
    // html/body, hors du wrapper) puisse être stylée en sombre.
    const html = document.documentElement;
    if (next === "dark") html.classList.add("admin-dark");
    else html.classList.remove("admin-dark");
  }

  function handleChange(next: AdminTheme) {
    if (next === theme || isPending) return;
    setTheme(next);
    applyClass(next);
    startTransition(async () => {
      const res = await setAdminTheme(next);
      if (!res.success) {
        setTheme(theme);
        applyClass(theme);
        toast.error("Erreur", res.error || "Impossible d'enregistrer le thème.");
        return;
      }
      toast.success(
        next === "dark" ? "Mode sombre activé" : "Mode clair activé",
        "Votre préférence a été enregistrée.",
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ThemeCard
          selected={theme === "light"}
          onSelect={() => handleChange("light")}
          disabled={isPending}
          label="Clair"
          hint="Fond blanc, texte foncé"
          preview={
            <div className="w-full h-full rounded-lg bg-white border border-zinc-200 flex flex-col overflow-hidden">
              <div className="h-3 bg-zinc-100 border-b border-zinc-200" />
              <div className="flex-1 flex">
                <div className="w-8 bg-zinc-50 border-r border-zinc-200" />
                <div className="flex-1 p-1.5 space-y-1">
                  <div className="h-1.5 w-full rounded bg-zinc-200" />
                  <div className="h-1.5 w-2/3 rounded bg-zinc-200" />
                  <div className="h-1.5 w-1/2 rounded bg-zinc-200" />
                </div>
              </div>
            </div>
          }
        />
        <ThemeCard
          selected={theme === "dark"}
          onSelect={() => handleChange("dark")}
          disabled={isPending}
          label="Sombre"
          hint="Fond noir, texte clair"
          preview={
            <div className="w-full h-full rounded-lg bg-zinc-900 border border-zinc-700 flex flex-col overflow-hidden">
              <div className="h-3 bg-zinc-800 border-b border-zinc-700" />
              <div className="flex-1 flex">
                <div className="w-8 bg-zinc-950 border-r border-zinc-700" />
                <div className="flex-1 p-1.5 space-y-1">
                  <div className="h-1.5 w-full rounded bg-zinc-700" />
                  <div className="h-1.5 w-2/3 rounded bg-zinc-700" />
                  <div className="h-1.5 w-1/2 rounded bg-zinc-700" />
                </div>
              </div>
            </div>
          }
        />
      </div>
      <p className="text-[12px] text-text-muted font-body">
        Choix personnel — mémorisé pour votre compte administrateur. N'affecte que
        les pages <span className="font-semibold text-text-secondary">/admin</span>,
        pas la boutique visible par les clients.
      </p>
    </div>
  );
}

interface ThemeCardProps {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  preview: React.ReactNode;
}

function ThemeCard({ selected, disabled, onSelect, label, hint, preview }: ThemeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`group relative flex items-center gap-3 p-3 rounded-2xl border-2 text-left transition-all ${
        selected
          ? "border-text-primary bg-bg-secondary shadow-sm"
          : "border-border bg-bg-primary hover:border-border-strong"
      } ${disabled ? "opacity-70 cursor-wait" : "cursor-pointer"}`}
      aria-pressed={selected}
    >
      <div className="w-16 h-12 shrink-0">{preview}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-body font-semibold text-text-primary">
            {label}
          </span>
          {selected && (
            <span className="inline-flex items-center gap-1 text-[10px] font-body font-bold uppercase tracking-[0.14em] text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Actif
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-text-muted font-body mt-0.5">{hint}</p>
      </div>
    </button>
  );
}
