"use client";

/**
 * Éditeur des préférences de notifications push PWA — version accordéon.
 *
 * Chaque type d'événement (commande, inscription, SAV, chat) est présenté sur
 * UNE ligne compacte avec son icône, son état (activé/désactivé) et un aperçu
 * court de ce qu'il envoie. Clic → déplie l'éditeur complet. Un seul panneau
 * ouvert à la fois pour garder l'écran propre.
 *
 * Priorité au scan rapide : la cliente doit pouvoir repérer en 2 secondes
 * « ah, les notifications SAV sont désactivées » ou « le texte des commandes
 * est perso » sans tout déplier.
 */

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  savePushPreferences,
  resetPushPreferenceType,
  sendTestPushForEventType,
} from "@/app/actions/admin/push-preferences";
import {
  PUSH_EVENT_TYPES,
  PUSH_EVENT_LABELS,
  PUSH_EVENT_PLACEHOLDERS,
  PUSH_EVENT_PREVIEW_VALUES as PREVIEW_VALUES,
  DEFAULT_PUSH_PREFERENCES,
  renderTemplate,
  type PushPreferences,
  type PushEventType,
} from "@/lib/push-preferences";

interface Props {
  initialPreferences: PushPreferences;
}

/** Icône compacte 18×18 par type d'événement — accrochage visuel immédiat. */
const EVENT_ICONS: Record<PushEventType, ReactNode> = {
  order_new: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
    </svg>
  ),
  client_new: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  ),
  claim_new: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  ),
  chat_message: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

/** Couleur de l'icône / badge par type (cohérent avec le reste de l'admin). */
const EVENT_ACCENTS: Record<PushEventType, { icon: string; dot: string }> = {
  order_new:    { icon: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  client_new:   { icon: "bg-sky-50 text-sky-700 border-sky-200",             dot: "bg-sky-500" },
  claim_new:    { icon: "bg-rose-50 text-rose-700 border-rose-200",          dot: "bg-rose-500" },
  chat_message: { icon: "bg-violet-50 text-violet-700 border-violet-200",    dot: "bg-violet-500" },
};

export default function PushPreferencesEditor({ initialPreferences }: Props) {
  const [prefs, setPrefs] = useState<PushPreferences>(initialPreferences);
  const [openType, setOpenType] = useState<PushEventType | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  function updateEntry(type: PushEventType, patch: Partial<PushPreferences[PushEventType]>) {
    setPrefs((p) => ({ ...p, [type]: { ...p[type], ...patch } }));
    setDirty(true);
  }

  function handleSave() {
    startTransition(async () => {
      const res = await savePushPreferences(prefs);
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Enregistrement impossible.");
        return;
      }
      setDirty(false);
      toast.success("Préférences enregistrées", "Les prochaines notifications utilisent vos nouveaux textes.");
    });
  }

  function handleReset(type: PushEventType) {
    startTransition(async () => {
      const res = await resetPushPreferenceType(type);
      if (!res.success || !res.defaults) {
        toast.error("Erreur", res.error ?? "Reset impossible.");
        return;
      }
      setPrefs((p) => ({ ...p, [type]: res.defaults! }));
      setDirty(false);
      toast.success("Réinitialisé", `« ${PUSH_EVENT_LABELS[type].title} » remis aux valeurs d'origine.`);
    });
  }

  function handleTest(type: PushEventType) {
    const entry = prefs[type];
    startTransition(async () => {
      const res = await sendTestPushForEventType(type, entry.title, entry.body);
      if (!res.success) {
        toast.error("Test impossible", res.error ?? "Envoi raté.");
        return;
      }
      toast.success(
        "Notification de test envoyée",
        `Reçue sur ${res.devicesTargeted} appareil${(res.devicesTargeted ?? 0) > 1 ? "s" : ""}.`,
      );
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] font-body text-text-muted leading-relaxed">
        Cliquez sur une ligne pour la modifier. Les mots entre accolades comme
        <code className="mx-1 px-1 py-0.5 rounded bg-bg-secondary border border-border text-text-primary text-[11px]">{"{customer}"}</code>
        sont remplacés par les vraies valeurs à l&apos;envoi.
      </p>

      <ul className="divide-y divide-border rounded-2xl border border-border overflow-hidden">
        {PUSH_EVENT_TYPES.map((type) => (
          <EventRow
            key={type}
            type={type}
            value={prefs[type]}
            isOpen={openType === type}
            onToggleOpen={() => setOpenType((cur) => (cur === type ? null : type))}
            onChange={(patch) => updateEntry(type, patch)}
            onReset={() => handleReset(type)}
            onTest={() => handleTest(type)}
            disabled={isPending}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="text-[12px] font-body text-text-muted">
          {dirty ? (
            <span className="text-amber-700 font-semibold">Modifications non enregistrées</span>
          ) : (
            "Tout est à jour"
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !dirty}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-bg-dark text-white text-sm font-heading font-semibold hover:bg-bg-darker transition disabled:opacity-50"
        >
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

interface RowProps {
  type: PushEventType;
  value: PushPreferences[PushEventType];
  isOpen: boolean;
  onToggleOpen: () => void;
  onChange: (patch: Partial<PushPreferences[PushEventType]>) => void;
  onReset: () => void;
  onTest: () => void;
  disabled: boolean;
}

function EventRow({ type, value, isOpen, onToggleOpen, onChange, onReset, onTest, disabled }: RowProps) {
  const label = PUSH_EVENT_LABELS[type];
  const placeholders = PUSH_EVENT_PLACEHOLDERS[type];
  const defaults = DEFAULT_PUSH_PREFERENCES[type];
  const accent = EVENT_ACCENTS[type];
  const isDefault = useMemo(
    () =>
      value.title === defaults.title &&
      value.body === defaults.body &&
      value.enabled === defaults.enabled &&
      value.emailEnabled === defaults.emailEnabled,
    [value, defaults],
  );

  const previewValues: Record<string, string> = {};
  for (const ph of placeholders) previewValues[ph] = PREVIEW_VALUES[ph] ?? "";
  const previewTitle = renderTemplate(value.title, previewValues);
  const previewBody = renderTemplate(value.body, previewValues);

  return (
    <li className="bg-bg-primary">
      {/* ─── Ligne compacte (toujours visible) ─── */}
      <button
        type="button"
        onClick={onToggleOpen}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-secondary/30 transition"
      >
        <div className={`shrink-0 w-9 h-9 rounded-xl border inline-flex items-center justify-center ${accent.icon}`}>
          <div className="w-[18px] h-[18px]">{EVENT_ICONS[type]}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-heading text-[14px] font-bold text-text-primary">{label.title}</h4>
            {value.enabled ? (
              <span className={`inline-flex items-center gap-1 text-[10px] font-body font-bold uppercase tracking-[0.08em] text-emerald-700`}>
                <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} />
                Activé
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-body font-bold uppercase tracking-[0.08em] text-text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60" />
                Désactivé
              </span>
            )}
            {value.enabled && !value.emailEnabled && (
              <span className="text-[10px] font-body font-bold uppercase tracking-[0.08em] text-text-muted">
                · sans mail
              </span>
            )}
            {!isDefault && (
              <span className="text-[10px] font-body font-bold uppercase tracking-[0.08em] text-text-muted">
                · personnalisé
              </span>
            )}
          </div>
          <p className="text-[12px] font-body text-text-muted mt-0.5 truncate">
            {value.enabled ? previewTitle : <span className="italic">Vous ne recevrez pas cette alerte</span>}
          </p>
        </div>
        <Chevron open={isOpen} />
      </button>

      {/* ─── Panneau d'édition (déplié) ─── */}
      {isOpen && (
        <div className="border-t border-border bg-bg-secondary/20 p-4 space-y-4">
          {/* Switch Activé/Désactivé plus visible */}
          <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-bg-primary border border-border cursor-pointer">
            <span className="text-[13px] font-body font-semibold text-text-primary">
              Recevoir cette alerte
            </span>
            <Toggle
              checked={value.enabled}
              onChange={(enabled) => onChange({ enabled })}
              disabled={disabled}
            />
          </label>

          {/* Doublon mail — permet de couper le mail quand la notif push suffit */}
          <label
            className={`flex items-center justify-between gap-3 p-3 rounded-xl bg-bg-primary border border-border cursor-pointer ${
              value.enabled ? "" : "opacity-40 pointer-events-none"
            }`}
          >
            <span className="flex flex-col min-w-0">
              <span className="text-[13px] font-body font-semibold text-text-primary">
                Recevoir aussi par mail
              </span>
              <span className="text-[11px] font-body text-text-muted mt-0.5">
                Désactivez si la notification sur votre téléphone suffit.
              </span>
            </span>
            <Toggle
              checked={value.emailEnabled}
              onChange={(emailEnabled) => onChange({ emailEnabled })}
              disabled={disabled || !value.enabled}
            />
          </label>

          <div className={value.enabled ? "" : "opacity-40 pointer-events-none"}>
            <FieldRow
              label="Titre"
              value={value.title}
              maxLength={80}
              onChange={(v) => onChange({ title: v })}
              disabled={disabled || !value.enabled}
            />
            <div className="h-3" />
            <FieldRow
              label="Message"
              value={value.body}
              maxLength={160}
              onChange={(v) => onChange({ body: v })}
              disabled={disabled || !value.enabled}
            />

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-body text-text-muted mr-1">Insérer :</span>
              {placeholders.map((ph) => (
                <button
                  key={ph}
                  type="button"
                  disabled={disabled || !value.enabled}
                  onClick={() => onChange({ body: (value.body + " {" + ph + "}").trim() })}
                  className="px-2 py-0.5 rounded-md bg-bg-primary border border-border text-[11px] font-mono text-text-primary hover:bg-bg-secondary transition disabled:opacity-40"
                  title={`Ajouter {${ph}} dans le message`}
                >
                  {"{" + ph + "}"}
                </button>
              ))}
            </div>

            {/* Aperçu + Tester côte à côte */}
            <div className="mt-4 rounded-xl bg-bg-primary border border-border p-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-xl bg-bg-dark text-white inline-flex items-center justify-center">
                  <IcoBell />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-heading font-bold text-text-primary leading-tight truncate">
                    {previewTitle || <span className="italic text-text-muted">Titre vide</span>}
                  </div>
                  <div className="text-[12px] font-body text-text-secondary leading-snug mt-0.5 line-clamp-2">
                    {previewBody || <span className="italic text-text-muted">Message vide</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onTest}
                  disabled={disabled || !value.enabled}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-dark text-white text-[11px] font-heading font-semibold hover:bg-bg-darker transition disabled:opacity-40"
                  title="Envoie une vraie notification sur vos appareils liés"
                >
                  <IcoSend />
                  Tester
                </button>
              </div>
            </div>
          </div>

          {!isDefault && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onReset}
                disabled={disabled}
                className="text-[11px] font-body text-text-muted hover:text-text-primary underline underline-offset-2 transition disabled:opacity-50"
              >
                Réinitialiser au texte d&apos;origine
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Champ texte uniforme (titre / message). */
function FieldRow({
  label, value, maxLength, onChange, disabled,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-body font-bold uppercase tracking-[0.12em] text-text-muted">
          {label}
        </label>
        <span className="text-[10px] font-body text-text-muted tabular-nums">
          {value.length}/{maxLength}
        </span>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-xl border border-border bg-bg-primary text-[13px] font-body text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary/20 disabled:opacity-60"
      />
    </div>
  );
}

/** Switch iOS-like minimaliste. */
function Toggle({
  checked, onChange, disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-emerald-600" : "bg-text-muted/40"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IcoBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IcoSend() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
