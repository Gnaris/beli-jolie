"use client";

/**
 * Modal d'édition d'un mail transactionnel système.
 *
 * UI :
 *  - Onglets langues (FR + EN/DE/ES/IT)
 *  - Champ Sujet
 *  - Palette de variables cliquables (insère au curseur)
 *  - Textarea HTML côté gauche + preview iframe côté droit
 *  - Bouton « Générer avec l'IA » (ouvre un panneau avec le prompt à copier)
 *  - Bouton « Revenir au modèle par défaut »
 *  - Bouton « Envoyer un test »
 *  - Bouton « Enregistrer »
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  classifyVariableKind,
  describeVariableUsage,
  getScenarioMeta,
  TRANSACTIONAL_LOCALE_LABELS,
  TRANSACTIONAL_LOCALES,
  VARIABLE_KIND_LABELS,
  type TransactionalLocale,
  type TransactionalScenarioKey,
  type TransactionalScenarioVariable,
  type TransactionalVariableKind,
} from "@/lib/transactional-email-scenarios";
import {
  getTransactionalTemplate,
  listTestEmailClients,
  resetTransactionalOverride,
  saveTransactionalOverride,
  sendTransactionalTestEmail,
  type TestEmailClientLite,
} from "@/app/actions/admin/transactional-emails";
import CustomSelect from "@/components/ui/CustomSelect";
import { buildTransactionalAiPrompt } from "@/lib/transactional-email-ai-prompt";

interface Props {
  scenarioKey: TransactionalScenarioKey;
  onClose: () => void;
}

export default function TransactionalEmailModal({ scenarioKey, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();

  const meta = useMemo(() => getScenarioMeta(scenarioKey), [scenarioKey]);
  const [locale, setLocale] = useState<TransactionalLocale>("fr");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [customized, setCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Panneau « Envoi de test » : moi-même par défaut, ou un client APPROVED.
  const [testOpen, setTestOpen] = useState(false);
  const [testTarget, setTestTarget] = useState<"self" | "client">("self");
  const [testClientId, setTestClientId] = useState<string>("");
  const [testClients, setTestClients] = useState<TestEmailClientLite[]>([]);
  const [testClientsLoaded, setTestClientsLoaded] = useState(false);

  // Panneau « Guide des variables » (fermé par défaut, dépliable).
  const [varsGuideOpen, setVarsGuideOpen] = useState(false);

  // `toast` est volontairement HORS des deps : il ne sert qu'à afficher une
  // erreur de chargement et n'a aucune raison de relancer la requête — sinon
  // chaque notification émise ailleurs dans l'app recharge le modèle et écrase
  // la saisie en cours.
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  // Charge le template actif à l'ouverture + à chaque changement de locale.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await getTransactionalTemplate({ scenarioKey, locale });
        if (cancelled) return;
        setSubject(data.subject);
        setHtml(data.html);
        setCustomized(data.customized);
      } catch (err) {
        if (!cancelled) {
          toastRef.current.error("Chargement impossible", err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scenarioKey, locale]);

  const insertToken = useCallback(
    (token: string, target: "subject" | "html" = "html") => {
      const marker = `{${token}}`;
      if (target === "subject") {
        const el = subjectRef.current;
        if (!el) return;
        const start = el.selectionStart ?? subject.length;
        const end = el.selectionEnd ?? subject.length;
        const next = subject.slice(0, start) + marker + subject.slice(end);
        setSubject(next);
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + marker.length;
          el.setSelectionRange(pos, pos);
        });
      } else {
        const el = htmlRef.current;
        if (!el) return;
        const start = el.selectionStart ?? html.length;
        const end = el.selectionEnd ?? html.length;
        const next = html.slice(0, start) + marker + html.slice(end);
        setHtml(next);
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + marker.length;
          el.setSelectionRange(pos, pos);
        });
      }
    },
    [subject, html],
  );

  // Preview = HTML courant avec variables remplacées par leur « example ».
  const previewHtml = useMemo(() => {
    if (!meta) return html;
    const vars: Record<string, string> = { shopName: "Beli & Jolie" };
    for (const v of meta.variables) vars[v.token] = v.example;
    return html.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, token: string) => {
      const value = vars[token];
      return value !== undefined ? value : match;
    });
  }, [html, meta]);

  async function onSave() {
    startTransition(async () => {
      const res = await saveTransactionalOverride({
        scenarioKey,
        locale,
        subject,
        html,
      });
      if (!res.success) {
        toast.error("Enregistrement impossible", res.error);
        return;
      }
      toast.success("Enregistré", `Le mail « ${meta?.label ?? ""} » a été personnalisé.`);
      setCustomized(true);
      router.refresh();
    });
  }

  async function onReset() {
    if (!meta) return;
    const scope = locale === "fr" ? "toutes les langues" : TRANSACTIONAL_LOCALE_LABELS[locale];
    const ok = await confirm({
      title: "Revenir au modèle par défaut ?",
      message:
        locale === "fr"
          ? `Votre personnalisation du mail « ${meta.label} » (${scope}) sera supprimée. Le mail d'origine sera à nouveau utilisé. Cette action est irréversible.`
          : `Votre version en ${scope} du mail « ${meta.label} » sera supprimée. Les autres langues restent personnalisées. Cette action est irréversible.`,
      confirmLabel: "Revenir au défaut",
      type: "warning",
    });
    if (ok !== true) return;

    startTransition(async () => {
      const res = await resetTransactionalOverride({ scenarioKey, locale });
      if (!res.success) {
        toast.error("Réinitialisation impossible", res.error);
        return;
      }
      toast.success("Modèle par défaut restauré");
      // Recharger pour afficher le défaut.
      const data = await getTransactionalTemplate({ scenarioKey, locale });
      setSubject(data.subject);
      setHtml(data.html);
      setCustomized(data.customized);
      router.refresh();
    });
  }

  async function toggleTestPanel() {
    const next = !testOpen;
    setTestOpen(next);
    if (next && !testClientsLoaded) {
      try {
        const list = await listTestEmailClients();
        setTestClients(list);
        setTestClientsLoaded(true);
      } catch (err) {
        toast.error(
          "Chargement des clients impossible",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  async function onSendTest() {
    if (testTarget === "client" && !testClientId) {
      toast.error("Choisissez un client destinataire.");
      return;
    }
    startTransition(async () => {
      const res = await sendTransactionalTestEmail({
        scenarioKey,
        locale,
        subject,
        html,
        target: testTarget,
        targetUserId: testTarget === "client" ? testClientId : undefined,
      });
      if (!res.success) {
        toast.error("Envoi test impossible", res.error);
        return;
      }
      toast.success("Test envoyé", `Un exemplaire a été envoyé à ${res.sentTo}.`);
    });
  }

  function onCopyAiPrompt() {
    const prompt = buildTransactionalAiPrompt({
      scenarioKey,
      description: aiDescription,
      currentSubject: subject,
    });
    void navigator.clipboard
      .writeText(prompt)
      .then(() => toast.success("Prompt copié", "Collez-le dans ChatGPT ou Claude."))
      .catch(() => toast.error("Copie impossible"));
  }

  if (!meta) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-none sm:rounded-2xl border border-border shadow-xl w-full sm:w-[95vw] sm:max-w-[1600px] mx-auto my-0 sm:my-auto h-[100vh] sm:h-[90vh] max-h-[100vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">
              {meta.audience === "CLIENT" ? "Mail client" : "Mail admin"}
              {customized && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-body font-bold uppercase tracking-wider bg-violet-100 text-violet-800">
                  Personnalisé
                </span>
              )}
            </div>
            <h2 className="font-heading text-lg font-bold text-text-primary mt-1">
              {meta.label}
            </h2>
            <p className="text-xs font-body text-text-muted mt-1 line-clamp-2">
              {meta.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-secondary hover:text-text-primary"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        {/* ── Onglets langue ── */}
        <div className="px-6 pt-3 border-b border-border bg-bg-secondary/30">
          <div className="flex gap-1 flex-wrap">
            {TRANSACTIONAL_LOCALES.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocale(loc)}
                className={`px-3 py-1.5 rounded-t-lg text-[12px] font-body font-semibold border-b-2 ${
                  locale === loc
                    ? "border-slate-800 text-text-primary bg-bg-primary"
                    : "border-transparent text-text-muted hover:text-text-primary"
                }`}
              >
                {TRANSACTIONAL_LOCALE_LABELS[loc]}
                {loc === "fr" && (
                  <span className="ml-1 text-[9px] font-body font-bold uppercase tracking-wider text-text-muted">
                    (défaut)
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Corps éditeur ── */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
            Chargement du modèle…
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col lg:grid lg:grid-cols-2 lg:gap-0 min-h-0">
            {/* ── Édition ── */}
            <div className="p-5 border-b lg:border-b-0 lg:border-r border-border overflow-y-auto">
              <label className="block text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                Sujet du mail
              </label>
              <input
                ref={subjectRef}
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary text-sm text-text-primary focus:outline-none focus:border-slate-500 mb-4"
                placeholder="Ex. Votre code de connexion — Beli & Jolie"
              />

              <label className="block text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                Contenu HTML du mail
              </label>
              <textarea
                ref={htmlRef}
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                className="w-full h-80 lg:h-[calc(100vh-520px)] min-h-[300px] px-3 py-2.5 rounded-lg border border-border bg-bg-primary text-xs text-text-primary font-mono focus:outline-none focus:border-slate-500 resize-y"
                spellCheck={false}
              />

              {/* ── Palette variables ── */}
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">
                    Variables disponibles pour ce mail
                  </div>
                  <button
                    type="button"
                    onClick={() => setVarsGuideOpen((v) => !v)}
                    className="text-[11px] font-body font-semibold text-text-secondary hover:text-text-primary"
                  >
                    {varsGuideOpen ? "Masquer les explications" : "Voir les explications ↓"}
                  </button>
                </div>
                <p className="text-[11px] text-text-muted mb-2">
                  Cliquez sur une variable pour l&apos;insérer dans le contenu.
                  <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-sky-500" /> Obligatoire</span>
                  <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> Texte</span>
                  <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-indigo-500" /> Lien (URL)</span>
                  <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-500" /> Bloc HTML</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {meta.variables.map((v) => (
                    <VariableChip
                      key={v.token}
                      variable={v}
                      onInsert={() => insertToken(v.token, "html")}
                      onInsertSubject={() => insertToken(v.token, "subject")}
                    />
                  ))}
                </div>

                {varsGuideOpen && (
                  <div className="mt-3 rounded-lg border border-border bg-bg-secondary/40 overflow-hidden">
                    <div className="px-3 py-2 border-b border-border bg-bg-secondary/70 text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">
                      Guide des variables pour « {meta.label} »
                    </div>
                    <ul className="divide-y divide-border/60">
                      {meta.variables.map((v) => (
                        <VariableGuideRow key={v.token} variable={v} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* ── Bloc IA ── */}
              <div className="mt-5 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setAiOpen((v) => !v)}
                  className="text-[12px] font-body font-semibold text-text-secondary hover:text-text-primary flex items-center gap-1"
                >
                  🤖 {aiOpen ? "Masquer" : "Afficher"}{" "}l&apos;aide IA
                </button>
                {aiOpen && (
                  <div className="mt-3 p-3 rounded-lg border border-border bg-bg-secondary/40">
                    <p className="text-[11px] text-text-muted mb-2">
                      Décrivez ce que vous voulez changer, générez le prompt, collez-le dans ChatGPT ou Claude, puis recopiez le HTML renvoyé dans le champ ci-dessus.
                    </p>
                    <textarea
                      value={aiDescription}
                      onChange={(e) => setAiDescription(e.target.value)}
                      placeholder="Ex. Ton plus chaleureux, ajoute une touche d'humour, mets le code en rouge, etc."
                      className="w-full h-20 px-2 py-1.5 rounded border border-border bg-bg-primary text-xs text-text-primary focus:outline-none focus:border-slate-500 mb-2"
                    />
                    <button
                      type="button"
                      onClick={onCopyAiPrompt}
                      className="px-3 py-1.5 rounded-md text-[11px] font-body font-bold bg-slate-800 text-white hover:opacity-90"
                    >
                      📋 Copier le prompt IA
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Preview ── */}
            <div className="flex flex-col overflow-hidden bg-bg-secondary/30 min-h-0">
              <div className="px-5 py-3 border-b border-border text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted shrink-0">
                Aperçu (avec exemples)
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <iframe
                  title="Aperçu du mail"
                  srcDoc={previewHtml}
                  className="w-full h-full min-h-[500px] bg-white rounded-lg border border-border"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Panneau d'envoi de test (dépliable) ── */}
        {testOpen && (
          <div className="px-6 py-3 border-t border-border bg-amber-50/60">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1 min-w-0">
                <label className="block text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-1.5">
                  Destinataire du test
                </label>
                <div className="flex gap-2 flex-wrap">
                  <label className="inline-flex items-center gap-2 text-[12px] font-body font-semibold text-text-primary">
                    <input
                      type="radio"
                      name="test-target"
                      value="self"
                      checked={testTarget === "self"}
                      onChange={() => setTestTarget("self")}
                    />
                    Moi-même
                  </label>
                  <label className="inline-flex items-center gap-2 text-[12px] font-body font-semibold text-text-primary">
                    <input
                      type="radio"
                      name="test-target"
                      value="client"
                      checked={testTarget === "client"}
                      onChange={() => setTestTarget("client")}
                    />
                    Un client (vraies données)
                  </label>
                </div>
              </div>

              {testTarget === "client" && (
                <div className="flex-[2] min-w-0">
                  <label className="block text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-1.5">
                    Client destinataire
                  </label>
                  <CustomSelect
                    value={testClientId}
                    onChange={(val) => setTestClientId(val)}
                    options={[
                      { value: "", label: testClientsLoaded ? "— choisir un client —" : "Chargement…" },
                      ...testClients.map((c) => ({ value: c.id, label: c.label })),
                    ]}
                    size="sm"
                    disabled={!testClientsLoaded || pending}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={onSendTest}
                disabled={pending || loading || (testTarget === "client" && !testClientId)}
                className="px-4 py-2 rounded-lg text-[12px] font-body font-bold bg-slate-800 text-white shadow-sm hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
              >
                {pending ? "Envoi…" : "Envoyer maintenant"}
              </button>
            </div>
            <p className="text-[11px] text-amber-900 mt-2 font-body">
              ⚠️ Les variables sensibles (code OTP, lien de réinitialisation, lien Stripe) sont remplacées par <strong>XXXXX</strong> dans les mails de test, même pour un vrai client.
            </p>
          </div>
        )}

        {/* ── Footer actions ── */}
        <div className="px-6 py-3 border-t border-border bg-bg-secondary/50 flex flex-wrap items-center gap-2">
          {customized && (
            <button
              type="button"
              onClick={onReset}
              disabled={pending}
              className="px-3 py-2 rounded-lg text-[12px] font-body font-semibold text-text-secondary hover:bg-bg-primary"
            >
              ↺ Revenir au modèle par défaut
            </button>
          )}
          <button
            type="button"
            onClick={toggleTestPanel}
            disabled={pending || loading}
            className={`px-3 py-2 rounded-lg text-[12px] font-body font-semibold ${
              testOpen
                ? "bg-amber-100 text-amber-900"
                : "text-text-secondary hover:bg-bg-primary"
            }`}
          >
            ✉️ {testOpen ? "Fermer l’envoi de test" : "Envoyer un test"}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-[12px] font-body font-semibold text-text-secondary hover:bg-bg-primary"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending || loading}
            className="px-4 py-2 rounded-lg text-[12px] font-body font-bold bg-gradient-to-br from-slate-800 to-slate-900 text-white shadow-sm hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Chip variable (insérable au clic)
   ───────────────────────────────────────────── */

const CHIP_KIND_STYLES: Record<
  TransactionalVariableKind,
  { border: string; bg: string; text: string }
> = {
  text: {
    border: "border-emerald-300",
    bg: "bg-emerald-50",
    text: "text-emerald-900",
  },
  url: {
    border: "border-indigo-300",
    bg: "bg-indigo-50",
    text: "text-indigo-900",
  },
  htmlBlock: {
    border: "border-amber-300",
    bg: "bg-amber-50",
    text: "text-amber-900",
  },
};

function VariableChip({
  variable,
  onInsert,
  onInsertSubject,
}: {
  variable: TransactionalScenarioVariable;
  onInsert: () => void;
  onInsertSubject: () => void;
}) {
  const kind = classifyVariableKind(variable);
  const kindStyle = CHIP_KIND_STYLES[kind];
  // Les variables obligatoires gardent une bordure bleue dominante (prioritaire
  // sur la couleur de type) pour qu'on les repère au premier coup d'œil.
  const styleClasses = variable.required
    ? "border-sky-500 bg-sky-50 text-sky-900"
    : `${kindStyle.border} ${kindStyle.bg} ${kindStyle.text}`;
  return (
    <div
      className={`group inline-flex items-center rounded-md border overflow-hidden text-[11px] font-mono ${styleClasses}`}
      title={`${variable.label}${variable.hint ? " — " + variable.hint : ""}\nType : ${VARIABLE_KIND_LABELS[kind]}\nExemple : ${variable.example}\n\n${describeVariableUsage(variable)}`}
    >
      <button
        type="button"
        onClick={onInsert}
        className="px-2 py-1 hover:bg-white/40"
      >
        {`{${variable.token}}`}
      </button>
      <button
        type="button"
        onClick={onInsertSubject}
        className="px-1.5 py-1 border-l border-current/20 text-[9px] uppercase tracking-wider opacity-70 hover:opacity-100 hover:bg-white/40"
        title="Insérer dans le sujet"
      >
        Sujet
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Ligne de guide pour une variable (dans le panneau dépliable)
   ───────────────────────────────────────────── */

function VariableGuideRow({
  variable,
}: {
  variable: TransactionalScenarioVariable;
}) {
  const kind = classifyVariableKind(variable);
  const kindStyle = CHIP_KIND_STYLES[kind];
  return (
    <li className="p-3 flex gap-3">
      <div className="shrink-0">
        <code
          className={`inline-block px-2 py-1 rounded-md border font-mono text-[11px] ${kindStyle.border} ${kindStyle.bg} ${kindStyle.text}`}
        >
          {`{${variable.token}}`}
        </code>
        <div className="mt-1 text-[9px] uppercase tracking-wider font-body font-bold text-text-muted text-center">
          {VARIABLE_KIND_LABELS[kind]}
        </div>
      </div>
      <div className="min-w-0 flex-1 text-[12px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-body font-bold text-text-primary">{variable.label}</span>
          {variable.required && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-body font-bold uppercase tracking-wider bg-sky-100 text-sky-800">
              Obligatoire
            </span>
          )}
        </div>
        {variable.hint && (
          <p className="text-text-muted mt-0.5 text-[11px]">{variable.hint}</p>
        )}
        <p className="mt-1 text-text-secondary leading-relaxed">
          {describeVariableUsage(variable)}
        </p>
        <p className="mt-1 text-[11px] text-text-muted">
          <span className="font-body font-semibold">Exemple de valeur :</span>{" "}
          <code className="font-mono">{variable.example}</code>
        </p>
      </div>
    </li>
  );
}
