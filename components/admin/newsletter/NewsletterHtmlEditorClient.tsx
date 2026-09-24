"use client";

/**
 * Éditeur newsletter format="html" — HTML/CSS libre + bibliothèque d'images
 * scopée au modèle. Layout côte à côte : textarea HTML à gauche, iframe de
 * preview à droite (rafraîchie 300 ms après la dernière frappe), panneaux
 * variables + images en dessous.
 *
 * Deux modes d'aperçu :
 *  - Aperçu local instantané (défaut) : les tokens `{firstName}` restent
 *    affichés tels quels, les images `{{img.nom}}` sont substituées côté
 *    client via la liste connue — permet une frappe fluide.
 *  - Aperçu client (via sélecteur) : appelle `getNewsletterHtmlPreview` côté
 *    serveur pour rendre le HTML avec les vraies données du client choisi
 *    (ou du profil « Marie Dupont » pour l'admin self). Rafraîchit sur
 *    changement de client uniquement — pas de re-fetch pendant la frappe.
 *
 * Bouton « Envoyer un test » : expédie le modèle courant au destinataire
 * sélectionné (via `sendTestNewsletterHtmlEmail`). Attention : n'utilise pas
 * le HTML en cours de saisie s'il n'a pas été enregistré — un garde-fou UI
 * grise le bouton tant qu'il y a des modifs non enregistrées.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";
import {
  updateNewsletterTemplateHtml,
  listPreviewClients,
  type NewsletterTemplateFull,
  type NewsletterTemplateImageLite,
  type PreviewClientLite,
} from "@/app/actions/admin/newsletter-templates";
import {
  getNewsletterHtmlPreview,
  sendTestNewsletterHtmlEmail,
} from "@/app/actions/admin/send-newsletter-html";
import {
  getAdminSessionEmail,
  getBoutiquePreviewOverrides,
} from "@/app/actions/admin/send-newsletter";
import {
  deleteNewsletterTemplateImage,
  renameNewsletterTemplateImage,
  updateNewsletterTemplateImageAlt,
} from "@/app/actions/admin/newsletter-template-images";
import {
  applyDynamicLimits,
  countAnchorsWithoutHref,
  expandIterations,
  extractHrefs,
  extractImageTokens,
  injectMissingHrefs,
  isHrefUnconfigured,
  rewriteHref,
  substituteTemplateImages,
  type HtmlDynamicContext,
  type LinkHrefEntry,
} from "@/lib/newsletter-html-render";
import {
  buildLinkUrl,
  describeLinkTarget,
  type LinkTarget,
} from "@/lib/newsletter-link-targets";
import {
  getNewsletterEditorBaseUrl,
  listCategoriesForLink,
  listCollectionsForLink,
  searchProductsForLink,
  type CategoryLinkOption,
  type CollectionLinkOption,
  type ProductLinkOption,
} from "@/app/actions/admin/newsletter-links";
import { buildAiPrompt } from "@/lib/newsletter-ai-prompt";
import type { ScenarioKey } from "@/lib/mail-scenario-defaults";
import {
  buildPreviewContext,
  interpolate,
  variablesForScenario,
  VARIABLE_GROUP_LABELS,
  type MailVariable,
  type PreviewOverrides,
  type VariableGroup,
} from "@/lib/mail-merge-variables";

const SELF_TARGET = "__self__";

interface Props {
  template: NewsletterTemplateFull;
  /** Cible du bouton « ← Retour ». Ignoré si `onLeave` est fourni. */
  backUrl?: string;
  /**
   * Callback appelé quand la cliente clique « ← Retour ». Alternative à
   * `backUrl` utilisée par les modales de scénario auto (panier abandonné,
   * inactivité) qui ne sont pas des pages autonomes. Si fourni, le bouton
   * Retour appelle `onLeave()` au lieu de router.push(backUrl).
   */
  onLeave?: () => void;
}

export default function NewsletterHtmlEditorClient({ template, backUrl, onLeave }: Props) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [html, setHtml] = useState(template.html ?? "");
  const [images, setImages] = useState<NewsletterTemplateImageLite[]>(template.images);
  const [isDirty, setIsDirty] = useState(false);

  const markDirty = useCallback(() => setIsDirty(true), []);

  // Preview locale débouncée (200 ms) — tokens laissés tels quels, images
  // remplacées côté client. Sert de fallback quand aucun client n'est
  // sélectionné dans le sélecteur d'aperçu.
  const [debouncedHtml, setDebouncedHtml] = useState(html);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedHtml(html), 200);
    return () => clearTimeout(t);
  }, [html]);
  // Overrides boutique du tenant courant — chargés au montage pour que la
  // preview locale affiche « L'équipe {vraiShopName} » plutôt que la valeur
  // d'exemple « Beli & Jolie » câblée dans MAIL_VARIABLES (fuite visuelle
  // cross-tenant, incident Issyma 2026-09-23).
  const [boutiqueOverrides, setBoutiqueOverrides] = useState<PreviewOverrides | null>(null);
  useEffect(() => {
    let cancelled = false;
    getBoutiquePreviewOverrides()
      .then((o) => {
        if (!cancelled) setBoutiqueOverrides(o);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Contexte factice « Marie Dupont / <shopName tenant> / … » — issu des
  // previewValue de MAIL_VARIABLES + overrides tenant. On passe le scenarioKey
  // pour inclure aussi les tokens spécifiques ({cartTotal}, {cartCount},
  // {days}, {favoritesCount}) sans quoi ces variables resteraient brutes dans
  // l'aperçu local (ex. « ça fait {days} jours »).
  const previewContext = useMemo(
    () => buildPreviewContext(template.scenarioKey, boutiqueOverrides ?? undefined),
    [template.scenarioKey, boutiqueOverrides],
  );
  // Contexte dynamique local — sert de placeholder pendant le chargement
  // de l'aperçu serveur (~200-500 ms). Cart vide = la boucle {{#each cart}}
  // se développe à 0 ligne. Aligné sur la règle serveur « vrai panier
  // uniquement, jamais de démo factice ».
  const previewDynamic = useMemo<HtmlDynamicContext | undefined>(() => {
    if (template.scenarioKey === "ABANDONED_CART") {
      return { cart: { items: [], totalCents: 0 } };
    }
    if (template.scenarioKey === "RESTOCK") {
      return { favorites: [] };
    }
    return undefined;
  }, [template.scenarioKey]);
  const localPreview = useMemo(() => {
    // Même pipeline que l'envoi réel : troncature 8 max + tokens
    // {cartMoreText}/{favoritesMoreText}, itérations, images, merge vars.
    const { dynamic: limited, extraMerge } = applyDynamicLimits(previewDynamic);
    const withIter = expandIterations(debouncedHtml, limited, "");
    const withImages = substituteTemplateImages(withIter, images, "");
    return interpolate(withImages, { ...previewContext, ...extraMerge });
  }, [debouncedHtml, images, previewContext, previewDynamic]);

  // ─── Aperçu client ───
  const [previewClients, setPreviewClients] = useState<PreviewClientLite[]>([]);
  // Email du compte admin CONNECTÉ (session.user.email), pas le mail perso
  // vérifié. Sert à afficher « Moi-même — beliandjolie@gmail.com » dans le
  // sélecteur et à envoyer les tests vers ce login.
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  // Par défaut on démarre sur SELF_TARGET : l'aperçu n'est jamais « générique » —
  // il montre toujours des vraies infos (soit celles de l'admin, soit celles
  // d'un client sélectionné). Si le mail perso n'est pas configuré, on retombe
  // sur le 1er client disponible (voir useEffect de chargement).
  const [previewTarget, setPreviewTarget] = useState<string>(SELF_TARGET);
  const [serverPreview, setServerPreview] = useState<string | null>(null);
  const [serverPreviewLoading, setServerPreviewLoading] = useState(false);
  const [serverPreviewMeta, setServerPreviewMeta] = useState<{
    liveCartCount?: number;
    previewedEmail?: string;
  }>({});
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listPreviewClients(), getAdminSessionEmail()])
      .then(([clients, email]) => {
        if (cancelled) return;
        setPreviewClients(clients);
        setAdminEmail(email);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Charge l'aperçu serveur quand la cible change OU quand le HTML/sujet
  // évolue (débouncé — voir `debouncedHtml` plus haut). Le HTML courant est
  // envoyé côté serveur en override — la cliente voit ce qu'elle tape même
  // sans avoir enregistré. Le `cancelled` flag évite qu'une réponse tardive
  // écrase un aperçu plus récent.
  useEffect(() => {
    if (!previewTarget) { setServerPreview(null); return; }
    const recipient = previewTarget === SELF_TARGET
      ? { kind: "self" as const }
      : { kind: "client" as const, userId: previewTarget };
    setServerPreviewLoading(true);
    let cancelled = false;
    getNewsletterHtmlPreview({
      templateId: template.id,
      recipient,
      htmlOverride: debouncedHtml,
      subjectOverride: subject,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setServerPreview(res.html);
          setServerPreviewMeta({
            liveCartCount: res.liveCartCount,
            previewedEmail: res.previewedEmail,
          });
        } else {
          setServerPreview(null);
          setServerPreviewMeta({});
          toast.error("Aperçu client indisponible", res.error);
        }
      })
      .finally(() => { if (!cancelled) setServerPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [previewTarget, template.id, debouncedHtml, subject, toast]);

  // Injecte `<base target="_blank">` pour que TOUT clic sur un lien dans
  // l'aperçu ouvre un nouvel onglet — sinon un href="" (CTA non configuré)
  // rechargerait l'iframe sur about:blank et casserait l'aperçu.
  const previewSrcDoc = useMemo(() => {
    const raw = serverPreview ?? localPreview;
    const base = '<base target="_blank">';
    if (/<head\b[^>]*>/i.test(raw)) {
      return raw.replace(/<head\b[^>]*>/i, (m) => `${m}${base}`);
    }
    return base + raw;
  }, [serverPreview, localPreview]);

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const res = await updateNewsletterTemplateHtml(template.id, { name, subject, html });
      if (res.success) {
        setIsDirty(false);
        toast.success("Modèle enregistré.");
        router.refresh();
      } else {
        toast.error("Impossible d'enregistrer", res.error);
      }
    });
  }, [template.id, name, subject, html, toast, router]);

  const handleSendTest = useCallback(async () => {
    if (!previewTarget) {
      toast.error("Aucun destinataire choisi");
      return;
    }
    setTestSending(true);
    const recipient = previewTarget === SELF_TARGET
      ? { kind: "self" as const }
      : { kind: "client" as const, userId: previewTarget };
    // On envoie la version affichée à l'écran (HTML courant + sujet courant),
    // pas la version en BDD — l'aperçu et le test doivent coïncider.
    const res = await sendTestNewsletterHtmlEmail({
      templateId: template.id,
      recipient,
      htmlOverride: html,
      subjectOverride: subject,
    });
    setTestSending(false);
    if (res.success) {
      toast.success("Test envoyé", `Mail parti à ${res.sentTo}`);
    } else {
      toast.error("Envoi de test échoué", res.error);
    }
  }, [previewTarget, template.id, html, subject, toast]);

  // Garde-fou navigation
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleBackClick = useCallback(
    async (e: React.MouseEvent) => {
      // Modales : on intercepte TOUJOURS le clic (pas de navigation Link).
      // Pages autonomes : intercept uniquement si dirty pour poser la confirm.
      if (onLeave) {
        e.preventDefault();
        if (isDirty) {
          const ok = await confirm.confirm({
            type: "warning",
            title: "Modifications non enregistrées",
            message: "Tu as des modifications non enregistrées. Fermer sans enregistrer ?",
            confirmLabel: "Fermer",
            cancelLabel: "Rester",
          });
          if (ok !== true) return;
        }
        onLeave();
        return;
      }
      if (!isDirty) return;
      e.preventDefault();
      const ok = await confirm.confirm({
        type: "warning",
        title: "Modifications non enregistrées",
        message: "Tu as des modifications non enregistrées. Quitter sans enregistrer ?",
        confirmLabel: "Quitter",
        cancelLabel: "Rester",
      });
      if (ok === true && backUrl) router.push(backUrl);
    },
    [isDirty, confirm, router, backUrl, onLeave],
  );

  return (
    <div className="min-h-screen bg-bg-secondary">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg-primary/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={backUrl ?? "#"}
              onClick={handleBackClick}
              className="text-sm text-text-secondary hover:text-text-primary shrink-0"
            >
              ← Retour
            </Link>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Modèle HTML</div>
              <div className="text-sm font-heading font-semibold text-text-primary truncate">{name || "Sans nom"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                Modifications non enregistrées
              </span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !isDirty}
              className="text-sm px-4 py-2 rounded-lg bg-bg-dark text-text-inverse hover:bg-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </header>

      {/* ─── Barre d'aperçu client + envoi test ─── */}
      <PreviewTargetBar
        clients={previewClients}
        adminEmail={adminEmail}
        target={previewTarget}
        onChange={setPreviewTarget}
        onSendTest={handleSendTest}
        loading={serverPreviewLoading}
        sending={testSending}
        scenario={template.scenarioKey}
        meta={serverPreviewMeta}
      />

      {/* ─── Corps 2 colonnes ─── */}
      <main className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Colonne gauche : nom + sujet + HTML */}
          <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4 space-y-3 flex flex-col">
            <FieldRow label="Nom interne">
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); markDirty(); }}
                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm"
                placeholder="Nouveautés d'automne 2026"
              />
            </FieldRow>
            <FieldRow label="Sujet du mail">
              <input
                value={subject}
                onChange={(e) => { setSubject(e.target.value); markDirty(); }}
                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm"
                placeholder="✨ Découvrez nos nouveautés"
              />
            </FieldRow>
            <FieldRow label="Code HTML" hint="Doit contenir {shopName}, {shopAddress}, {unsubscribeLink}, {privacyLink}">
              <textarea
                value={html}
                onChange={(e) => { setHtml(e.target.value); markDirty(); }}
                spellCheck={false}
                className="w-full h-[560px] rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-text-primary/20"
              />
            </FieldRow>
          </section>

          {/* Colonne droite : preview iframe */}
          <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Aperçu</div>
                <div className="text-xs text-text-secondary">
                  {previewTarget
                    ? (serverPreviewLoading
                        ? "Chargement…"
                        : "Avec les vraies infos du destinataire (mis à jour à chaque modif)")
                    : "Aperçu avec des valeurs d'exemple (Marie Dupont, Beli & Jolie…)"}
                </div>
              </div>
            </div>
            <iframe
              key={previewTarget ? `srv-${previewTarget}` : "local"}
              srcDoc={previewSrcDoc}
              // allow-popups + allow-popups-to-escape-sandbox : indispensables
              // pour que `<base target="_blank">` puisse effectivement ouvrir
              // les liens dans un vrai onglet du navigateur.
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              title="Aperçu newsletter"
              className="w-full flex-1 min-h-[600px] rounded-lg border border-border bg-white"
            />
          </section>
        </div>

        {/* Panneau Prompt IA */}
        <AiPromptPanel scenario={template.scenarioKey} />

        {/* Panneau liens : capture les hrefs du HTML et propose de choisir
            leur cible dans l'arbre de la boutique (Produit / Catégorie / …). */}
        <LinksPanel
          html={html}
          onRewrite={(oldHref, newHref, occurrenceIndex) => {
            setHtml((prev) => {
              const { html: next } = rewriteHref(prev, oldHref, newHref, occurrenceIndex);
              return next;
            });
            markDirty();
          }}
          onInjectMissing={() => {
            setHtml((prev) => {
              const { html: next } = injectMissingHrefs(prev);
              return next;
            });
            markDirty();
          }}
        />

        {/* Panneau variables */}
        <VariablesPanel scenario={template.scenarioKey} />

        {/* Bandeau images utilisées dans le HTML mais pas encore uploadées.
            Se masque tout seul quand tout est OK — pas de bruit UI inutile. */}
        <MissingImagesBanner
          templateId={template.id}
          htmlContent={html}
          images={images}
          onUploaded={(img) => setImages((prev) => [...prev, img])}
        />

        {/* Panneau images */}
        <ImagesPanel
          templateId={template.id}
          images={images}
          onChange={setImages}
        />
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Bandeau « images manquantes »
   ───────────────────────────────────────────── */

function MissingImagesBanner({
  templateId,
  htmlContent,
  images,
  onUploaded,
}: {
  templateId: string;
  htmlContent: string;
  images: NewsletterTemplateImageLite[];
  onUploaded: (img: NewsletterTemplateImageLite) => void;
}) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingNameRef = useRef<string | null>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);

  const missing = useMemo(() => {
    const tokens = extractImageTokens(htmlContent);
    const uploaded = new Set(images.map((i) => i.name.toLowerCase()));
    return tokens.filter((t) => !uploaded.has(t));
  }, [htmlContent, images]);

  if (missing.length === 0) return null;

  const handleClickChip = (name: string) => {
    pendingNameRef.current = name;
    fileInputRef.current?.click();
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const name = pendingNameRef.current;
    pendingNameRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file || !name) return;

    setUploadingName(name);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("name", name);
      const res = await fetch(
        `/api/admin/newsletter-templates/${templateId}/images`,
        { method: "POST", body: formData },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error("Upload échoué", data.error ?? "Erreur inconnue.");
        return;
      }
      onUploaded({
        id: data.id,
        name: data.name,
        path: data.path,
        alt: data.alt,
        sizeBytes: data.sizeBytes,
        width: data.width,
        height: data.height,
      });
      toast.success(
        `Image « ${data.name} » ajoutée`,
        "Elle est désormais visible dans le HTML et l'aperçu.",
      );
    } catch (err) {
      toast.error("Erreur", (err as Error).message);
    } finally {
      setUploadingName(null);
    }
  };

  return (
    <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="text-2xl leading-none" aria-hidden>🖼️</div>
        <div className="flex-1 min-w-[240px]">
          <div className="text-sm font-heading font-semibold text-amber-900">
            {missing.length} image{missing.length > 1 ? "s" : ""} à ajouter
          </div>
          <div className="text-xs text-amber-800 mt-0.5">
            Ces images sont référencées dans ton HTML mais pas encore uploadées.
            Clique sur chaque nom pour choisir l'image correspondante depuis ton ordinateur —
            elle sera ajoutée à la bibliothèque et apparaîtra dans l'aperçu.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {missing.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => handleClickChip(name)}
            disabled={uploadingName === name}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            <span className="text-amber-500">+</span>
            <span className="font-mono">{name}</span>
            {uploadingName === name && <span className="italic ml-1">envoi…</span>}
          </button>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFilePicked}
      />
    </section>
  );
}

/* ─────────────────────────────────────────────
   Panneau Prompt IA
   ───────────────────────────────────────────── */

function AiPromptPanel({ scenario }: { scenario: ScenarioKey | null }) {
  const toast = useToast();
  const [description, setDescription] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const prompt = useMemo(() => buildAiPrompt({ description, scenario }), [description, scenario]);

  const handleCopy = async () => {
    if (!description.trim()) {
      toast.error(
        "Décris ton mail d'abord",
        "Écris quelques lignes sur ce que tu veux voir dans le mail (style, ton, sections…).",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Prompt copié", "Colle-le dans ChatGPT ou Claude, il te renverra du HTML prêt à coller.");
    } catch {
      toast.error("Copie manuelle", "Ouvre l'aperçu, sélectionne le texte et Ctrl+C.");
    }
  };

  return (
    <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4">
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Assistant IA</div>
        <div className="text-sm font-heading font-semibold text-text-primary">
          Générer un modèle avec ChatGPT / Claude
        </div>
        <div className="text-xs text-text-secondary mt-0.5">
          Décris ce que tu veux, copie le prompt, colle-le dans ton IA préférée — elle te
          renverra un HTML complet respectant tous les tokens obligatoires et les contraintes
          des clients mail.
        </div>
      </div>

      <label className="block">
        <div className="text-xs font-medium text-text-secondary mb-1">
          Décris ton modèle de mail
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex : Un mail élégant pour annoncer la collection de rentrée. Palette dorée et beige, une grande image en tête, un titre chaleureux, 3 produits en vitrine (2 colonnes), un bouton « Découvrir la collection » vers la boutique, un mot personnel signé Meriem, et un pied de page discret."
          className="w-full min-h-[140px] rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-text-primary/20"
        />
        <div className="text-[11px] text-text-muted mt-1">
          Le prompt final inclura automatiquement : les contraintes techniques, la liste des
          4 mentions légales obligatoires, la liste des variables facultatives, et ta description.
        </div>
      </label>

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          onClick={handleCopy}
          className="text-sm px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700"
        >
          Copier le prompt pour ChatGPT / Claude
        </button>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-sm px-4 py-2 rounded-lg bg-bg-secondary hover:bg-bg-tertiary border border-border"
        >
          {showPreview ? "Masquer" : "Voir"} le prompt complet
        </button>
      </div>

      {showPreview && (
        <pre className="mt-3 max-h-[400px] overflow-auto text-[11px] font-mono leading-relaxed p-3 bg-bg-secondary border border-border rounded-lg whitespace-pre-wrap">
          {prompt}
        </pre>
      )}
    </section>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-text-secondary mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
    </label>
  );
}

/* ─────────────────────────────────────────────
   Barre d'aperçu client + bouton envoi test
   ───────────────────────────────────────────── */

function PreviewTargetBar({
  clients,
  adminEmail,
  target,
  onChange,
  onSendTest,
  loading,
  sending,
  scenario,
  meta,
}: {
  clients: PreviewClientLite[];
  adminEmail: string | null;
  target: string;
  onChange: (v: string) => void;
  onSendTest: () => void | Promise<void>;
  loading: boolean;
  sending: boolean;
  scenario: ScenarioKey | null;
  meta: { liveCartCount?: number; previewedEmail?: string };
}) {
  const options = useMemo(() => {
    const opts: Array<{ value: string; label: string; disabled?: boolean }> = [
      {
        value: SELF_TARGET,
        label: adminEmail ? `Moi-même — ${adminEmail}` : "Moi-même (chargement…)",
        disabled: !adminEmail,
      },
      ...clients.map((c) => {
        const displayName = c.company?.trim() || `${c.firstName} ${c.lastName}`.trim() || c.email;
        return { value: c.id, label: `${displayName} — ${c.email}` };
      }),
    ];
    return opts;
  }, [clients, adminEmail]);

  const canSendTest = !!target && !sending;
  const noRecipients = clients.length === 0 && !adminEmail;

  // Badge panier — uniquement pour le scénario panier abandonné. Distingue
  // « vrai panier avec N articles » de « panier vide ». Le texte s'adapte
  // selon qu'on regarde son propre panier (self) ou celui d'un client.
  const cartBadge = scenario === "ABANDONED_CART" && typeof meta.liveCartCount === "number"
    ? cartBadgeFor(target === SELF_TARGET, meta.liveCartCount, meta.previewedEmail)
    : null;

  return (
    <div className="border-b border-border bg-bg-primary px-4 sm:px-6 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted shrink-0">
          Aperçu pour
        </div>
        <div className="flex-1 min-w-[240px] max-w-md">
          <CustomSelect
            value={target}
            onChange={onChange}
            options={options}
            placeholder="Choisir un destinataire"
            searchable
            title="Destinataire de l'aperçu"
          />
        </div>
        <button
          type="button"
          onClick={onSendTest}
          disabled={!canSendTest}
          title={
            !target
              ? "Choisis un destinataire d'abord"
              : "Envoie le mail (version enregistrée) à ce destinataire"
          }
          className="text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? "Envoi…" : "Envoyer un test"}
        </button>
        {loading && (
          <span className="text-xs text-text-muted italic">Chargement de l'aperçu…</span>
        )}
        {noRecipients && (
          <span className="text-xs text-text-muted italic">
            Aucun destinataire d'aperçu — valide un client APPROUVÉ ou vérifie ton mail perso.
          </span>
        )}
      </div>
      {cartBadge && (
        <div className="mt-2">
          {cartBadge}
        </div>
      )}
    </div>
  );
}

/**
 * Bandeau contextuel qui indique l'état du panier réel de l'utilisateur
 * affiché (admin en self, ou client sélectionné). Le message s'adapte pour
 * que la cliente comprenne d'un coup d'œil si l'aperçu vide est normal
 * (personne n'a de panier) ou si elle attend des articles qui ne remontent
 * pas.
 */
function cartBadgeFor(isSelf: boolean, liveCount: number, previewedEmail?: string) {
  const accountSuffix = previewedEmail ? ` — compte ${previewedEmail}` : "";
  if (liveCount > 0) {
    const who = isSelf ? "Ton vrai panier" : "Vrai panier du client";
    return (
      <div className="text-xs px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">
        🛒 <strong>{who}</strong> — {liveCount} article{liveCount > 1 ? "s" : ""}{accountSuffix}.
      </div>
    );
  }
  const emptyText = isSelf
    ? "Ton panier est vide — aucun article dans l'aperçu."
    : "Ce client n'a pas d'articles dans son panier — aucun article dans l'aperçu.";
  return (
    <div className="text-xs px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
      ⚠️ <strong>Panier vide.</strong> {emptyText}{accountSuffix ? ` (${accountSuffix.trim().replace(/^— /, "")})` : ""}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Panneau variables
   ───────────────────────────────────────────── */

function VariablesPanel({ scenario }: { scenario: ScenarioKey | null }) {
  const toast = useToast();
  // Pour un scénario auto, on ajoute ses tokens dynamiques ({cartTotal},
  // {days}, {favoritesCount}) à la liste des variables communes.
  const variables = useMemo(() => variablesForScenario(scenario), [scenario]);

  const grouped = useMemo(() => {
    const map = new Map<VariableGroup, MailVariable[]>();
    for (const v of variables) {
      const arr = map.get(v.group) ?? [];
      arr.push(v);
      map.set(v.group, arr);
    }
    return map;
  }, [variables]);

  const handleCopy = async (token: string) => {
    const literal = `{${token}}`;
    try {
      await navigator.clipboard.writeText(literal);
      toast.success("Copié", `${literal} — colle dans le HTML.`);
    } catch {
      toast.error("Impossible de copier", `Copie manuellement : ${literal}`);
    }
  };

  const order: VariableGroup[] = ["client", "boutique", "dynamique", "legal"];

  return (
    <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4">
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Variables disponibles</div>
        <div className="text-sm font-heading font-semibold text-text-primary">
          {variables.length} variables
        </div>
        <div className="text-xs text-text-secondary mt-0.5">
          Copie une variable et colle-la dans le HTML — elle sera remplacée à l'envoi par la vraie donnée du destinataire.
        </div>
      </div>
      <div className="space-y-4">
        {order.map((group) => {
          const list = grouped.get(group);
          if (!list || list.length === 0) return null;
          return (
            <div key={group}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-2">
                {VARIABLE_GROUP_LABELS[group]}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {list.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => handleCopy(v.token)}
                    className="group text-left border border-border bg-bg-primary hover:bg-bg-secondary rounded-lg p-2.5 transition-colors"
                    title={v.hint ?? "Cliquer pour copier"}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-text-primary truncate">{v.label}</span>
                      {v.requiredMarketing && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                          Obligatoire
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <code className="text-[11px] bg-bg-secondary rounded px-1.5 py-0.5 text-text-secondary truncate">
                        {`{${v.token}}`}
                      </code>
                      <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        Copier
                      </span>
                    </div>
                    {v.hint && (
                      <div className="text-[10px] text-text-muted mt-1 line-clamp-2">{v.hint}</div>
                    )}
                    <div className="text-[10px] text-text-muted mt-1">
                      Exemple : <em>{v.previewValue}</em>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Panneau images
   ───────────────────────────────────────────── */

function ImagesPanel({
  templateId,
  images,
  onChange,
}: {
  templateId: string;
  images: NewsletterTemplateImageLite[];
  onChange: (imgs: NewsletterTemplateImageLite[]) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const handlePickFile = () => fileInputRef.current?.click();

  const handleUpload = async (file: File) => {
    const name = uploadName.trim() || file.name.replace(/\.[^.]+$/, "");
    if (!name) {
      toast.error("Nom manquant", "Donne un nom court à ton image (ex: hero, logo, produit-1).");
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("name", name);
      const res = await fetch(`/api/admin/newsletter-templates/${templateId}/images`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Upload échoué", data.error ?? "Erreur inconnue.");
        return;
      }
      onChange([...images, {
        id: data.id, name: data.name, path: data.path, alt: data.alt,
        sizeBytes: data.sizeBytes, width: data.width, height: data.height,
      }]);
      setUploadName("");
      toast.success("Image ajoutée", `Insère-la dans le HTML avec ${data.tag}`);
    } catch (err) {
      toast.error("Erreur", (err as Error).message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCopyTag = async (image: NewsletterTemplateImageLite) => {
    // Balise <img> complète — plus pratique pour la cliente non-technique qui
    // n'a plus qu'à coller là où elle veut, sans se soucier de l'attribut
    // `src=""` ni des styles. Le `alt` reprend celui saisi (fallback : nom),
    // les styles inline (max-width:100%;display:block;height:auto;) rendent
    // l'image responsive dans tous les clients mail.
    const altValue = (image.alt || image.name).replace(/"/g, "&quot;");
    const tag = `<img src="{{img.${image.name}}}" alt="${altValue}" style="max-width:100%;display:block;height:auto;">`;
    try {
      await navigator.clipboard.writeText(tag);
      toast.success("Balise <img> copiée", `Colle-la dans ton HTML là où tu veux afficher « ${image.name} ».`);
    } catch {
      toast.error("Impossible de copier", "Copie manuellement : " + tag);
    }
  };

  const handleRename = async (image: NewsletterTemplateImageLite) => {
    const newName = window.prompt(`Nouveau nom pour « ${image.name} » :`, image.name);
    if (!newName || newName === image.name) return;
    const res = await renameNewsletterTemplateImage(image.id, newName);
    if (!res.success) {
      toast.error("Renommage impossible", res.error);
      return;
    }
    onChange(images.map((i) => i.id === image.id ? { ...i, name: res.name, path: res.path } : i));
    toast.success("Image renommée");
  };

  const handleEditAlt = async (image: NewsletterTemplateImageLite) => {
    const newAlt = window.prompt(`Texte alternatif pour « ${image.name} » (pour les mails où les images sont bloquées) :`, image.alt);
    if (newAlt === null) return;
    const res = await updateNewsletterTemplateImageAlt(image.id, newAlt);
    if (!res.success) {
      toast.error("Erreur", res.error);
      return;
    }
    onChange(images.map((i) => i.id === image.id ? { ...i, alt: newAlt } : i));
  };

  const handleDelete = async (image: NewsletterTemplateImageLite) => {
    const ok = await confirm.confirm({
      type: "danger",
      title: "Supprimer cette image ?",
      message: `« ${image.name} » sera retirée du modèle. Si tu l'utilises encore dans ton HTML (${`{{img.${image.name}}}`}), le mail n'affichera plus rien à cet endroit.`,
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
    const res = await deleteNewsletterTemplateImage(image.id);
    if (!res.success) {
      toast.error("Suppression impossible", res.error);
      return;
    }
    onChange(images.filter((i) => i.id !== image.id));
    toast.success("Image supprimée");
  };

  return (
    <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Bibliothèque d'images</div>
          <div className="text-sm font-heading font-semibold text-text-primary">
            {images.length} image{images.length > 1 ? "s" : ""}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">
            Chaque image est disponible via <code className="text-[11px] bg-bg-secondary rounded px-1 py-0.5">{"{{img.nom}}"}</code> dans le HTML.
          </div>
        </div>
      </div>

      {/* Zone d'upload */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end p-3 bg-bg-secondary rounded-xl mb-4">
        <div className="flex-1">
          <div className="text-xs font-medium text-text-secondary mb-1">Nom de la nouvelle image</div>
          <input
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="hero, logo, produit-1…"
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm"
          />
          <div className="text-[11px] text-text-muted mt-1">
            Lettres, chiffres et tirets uniquement. Sera référencée par {"{{img."}<em>ton-nom</em>{"}}"}.
          </div>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          <button
            type="button"
            onClick={handlePickFile}
            disabled={isUploading}
            className="w-full sm:w-auto text-sm px-4 py-2 rounded-lg bg-bg-dark text-text-inverse hover:bg-text-primary disabled:opacity-40"
          >
            {isUploading ? "Envoi…" : "Choisir une image"}
          </button>
        </div>
      </div>

      {/* Grille des images */}
      {images.length === 0 ? (
        <div className="text-center text-sm text-text-muted py-8 border border-dashed border-border rounded-xl">
          Aucune image pour le moment. Ajoutes-en une pour la référencer dans ton HTML.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((img) => (
            <div key={img.id} className="border border-border rounded-xl overflow-hidden bg-bg-primary flex flex-col">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.path}
                alt={img.alt || img.name}
                className="w-full h-32 object-cover bg-bg-secondary"
              />
              <div className="p-2 space-y-1 flex-1 flex flex-col">
                <div className="font-mono text-xs truncate" title={img.name}>{img.name}</div>
                <div className="text-[10px] text-text-muted">
                  {formatBytes(img.sizeBytes)}
                  {img.width && img.height ? ` · ${img.width}×${img.height}` : ""}
                </div>
                <div className="flex flex-wrap gap-1 pt-1 mt-auto">
                  <button
                    type="button"
                    onClick={() => handleCopyTag(img)}
                    className="flex-1 text-[11px] px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                    title="Copier la balise <img> complète, prête à coller"
                  >
                    Copier &lt;img&gt;
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRename(img)}
                    className="text-[11px] px-2 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary border border-border"
                    title="Renommer"
                  >
                    ✏
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEditAlt(img)}
                    className="text-[11px] px-2 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary border border-border"
                    title="Texte alternatif"
                  >
                    Alt
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(img)}
                    className="text-[11px] px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200"
                    title="Supprimer"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(2)} Mo`;
}

/* ─────────────────────────────────────────────
   Panneau Liens
   ───────────────────────────────────────────── */

function LinksPanel({
  html,
  onRewrite,
  onInjectMissing,
}: {
  html: string;
  onRewrite: (oldHref: string, newHref: string, occurrenceIndex?: number) => void;
  onInjectMissing: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState<string>("");
  // Cible du picker : href brut à récrire + occurrence à cibler (uniquement
  // pour les hrefs non-configurés où plusieurs <a> partagent la même valeur).
  const [pickerFor, setPickerFor] = useState<
    | { href: string; occurrenceIndex?: number }
    | null
  >(null);
  const [showConfigured, setShowConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNewsletterEditorBaseUrl()
      .then((u) => { if (!cancelled) setBaseUrl(u); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const missingHrefCount = useMemo(() => countAnchorsWithoutHref(html), [html]);

  const { unconfigured, configured } = useMemo(() => {
    const all = extractHrefs(html);
    return {
      unconfigured: all.filter((e) => isHrefUnconfigured(e.href)),
      configured: all.filter((e) => !isHrefUnconfigured(e.href)),
    };
  }, [html]);

  // Cas particulier : le HTML contient des <a> sans attribut href du tout —
  // typiquement ChatGPT qui a oublié. Sans href, le picker ne peut rien
  // extraire ni configurer. On propose un fix en 1 clic qui injecte href=""
  // partout où c'est manquant.
  const missingHrefWarning = missingHrefCount > 0 && (
    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-3 mb-3">
      <div className="text-lg" aria-hidden>⚠️</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-heading font-semibold text-rose-900">
          {missingHrefCount} lien{missingHrefCount > 1 ? "s" : ""} sans <code className="text-[11px] bg-white/70 rounded px-1 py-0.5">href</code>
        </div>
        <div className="text-xs text-rose-800 mt-0.5">
          Ces balises <code className="text-[11px] bg-white/70 rounded px-1 py-0.5">&lt;a&gt;</code>
          {" "}n'ont pas d'attribut <code className="text-[11px] bg-white/70 rounded px-1 py-0.5">href</code>
          {" "}et resteront invisibles au picker. Ajoute un <code className="text-[11px] bg-white/70 rounded px-1 py-0.5">href=""</code> vide sur chacun pour pouvoir les configurer.
        </div>
      </div>
      <button
        type="button"
        onClick={onInjectMissing}
        className="text-xs font-semibold px-3 py-1.5 rounded bg-rose-600 text-white hover:bg-rose-700 shrink-0"
      >
        Corriger
      </button>
    </div>
  );

  if (unconfigured.length === 0 && configured.length === 0) {
    return (
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4">
        {missingHrefWarning}
        <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Liens du mail</div>
        <div className="text-sm font-heading font-semibold text-text-primary">
          {missingHrefCount > 0 ? "Corrige les liens sans href pour les faire apparaître" : "Aucun lien détecté"}
        </div>
        <div className="text-xs text-text-secondary mt-1">
          Ajoute un <code className="text-[11px] bg-bg-secondary rounded px-1 py-0.5">{`<a href="">…</a>`}</code>
          {" "}dans ton HTML (ou colle un modèle généré par ChatGPT), reviens ici pour choisir vers quoi il redirige.
        </div>
      </section>
    );
  }

  const renderLinkRow = (entry: LinkHrefEntry, needsConfig: boolean) => {
    const { href, label, occurrenceIndex } = entry;
    const displayHref = href.trim().length === 0 ? "(vide)" : href;
    const displayLabel = label.trim().length === 0 ? "(sans texte)" : label;
    // Key React unique : sans l'occurrence, 2 hrefs vides collapseraient.
    const rowKey = occurrenceIndex !== undefined ? `${href}::${occurrenceIndex}` : href;
    return (
    <div
      key={rowKey}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 border ${needsConfig ? "border-amber-300 bg-amber-50" : "border-border bg-bg-primary"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className={`text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${needsConfig ? "bg-amber-200 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>
            {needsConfig ? "À configurer" : "OK"}
          </div>
          <div
            className={`text-sm font-medium truncate ${label.trim().length === 0 ? "italic text-text-muted" : "text-text-primary"}`}
            title={displayLabel}
          >
            {displayLabel}
          </div>
        </div>
        <div
          className={`text-[11px] font-mono truncate mt-0.5 ${href.trim().length === 0 ? "italic text-text-muted" : "text-text-secondary"}`}
          title={displayHref}
        >
          {displayHref}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPickerFor({ href, occurrenceIndex })}
        className={`text-xs px-3 py-1.5 rounded shrink-0 font-semibold ${needsConfig ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-bg-secondary text-text-primary hover:bg-bg-tertiary border border-border"}`}
      >
        {needsConfig ? "Configurer" : "Modifier"}
      </button>
    </div>
    );
  };

  return (
    <>
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4">
        {missingHrefWarning}
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Liens du mail</div>
          <div className="text-sm font-heading font-semibold text-text-primary">
            {unconfigured.length > 0
              ? `${unconfigured.length} lien${unconfigured.length > 1 ? "s" : ""} à configurer`
              : "Tous les liens sont configurés ✓"}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">
            Clique le bouton <span className="font-semibold text-amber-800">Configurer</span> à droite pour choisir la cible du lien (Produit / Catégorie / …). L'URL sera écrite automatiquement dans ton HTML.
          </div>
        </div>

        {unconfigured.length > 0 && (
          <div className="space-y-2">
            {unconfigured.map((h) => renderLinkRow(h, true))}
          </div>
        )}

        {configured.length > 0 && (
          <div className={`${unconfigured.length > 0 ? "mt-4 pt-4 border-t border-border" : ""}`}>
            <button
              type="button"
              onClick={() => setShowConfigured((v) => !v)}
              className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1"
            >
              <span>{showConfigured ? "▼" : "▶"}</span>
              <span>Déjà configurés ({configured.length})</span>
            </button>
            {showConfigured && (
              <div className="space-y-2 mt-2">
                {configured.map((h) => renderLinkRow(h, false))}
              </div>
            )}
          </div>
        )}
      </section>

      {pickerFor !== null && (
        <LinkPickerModal
          currentHref={pickerFor.href}
          baseUrl={baseUrl}
          onClose={() => setPickerFor(null)}
          onValidate={(newHref) => {
            onRewrite(pickerFor.href, newHref, pickerFor.occurrenceIndex);
            setPickerFor(null);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Modale picker en arbre
   ───────────────────────────────────────────── */

type PickerParent = "home" | "products" | "categories" | "collections" | "about" | "contact";

function LinkPickerModal({
  currentHref,
  baseUrl,
  onClose,
  onValidate,
}: {
  currentHref: string;
  baseUrl: string;
  onClose: () => void;
  onValidate: (newHref: string) => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<LinkTarget | null>(null);
  const [expanded, setExpanded] = useState<PickerParent | null>(null);

  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState<ProductLinkOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const [categories, setCategories] = useState<CategoryLinkOption[]>([]);
  const [collections, setCollections] = useState<CollectionLinkOption[]>([]);

  // Charge produits (debounced), catégories, collections quand on ouvre les
  // sous-branches correspondantes. Idempotent (skip si déjà chargé).
  useEffect(() => {
    if (expanded !== "products") return;
    setProductsLoading(true);
    const t = setTimeout(() => {
      searchProductsForLink(productQuery)
        .then((rows) => setProducts(rows))
        .finally(() => setProductsLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [expanded, productQuery]);

  useEffect(() => {
    if (expanded !== "categories" || categories.length > 0) return;
    listCategoriesForLink().then(setCategories).catch(() => {});
  }, [expanded, categories.length]);

  useEffect(() => {
    if (expanded !== "collections" || collections.length > 0) return;
    listCollectionsForLink().then(setCollections).catch(() => {});
  }, [expanded, collections.length]);

  const canValidate = selected !== null && baseUrl !== "";

  const handleValidate = () => {
    if (!selected || !baseUrl) {
      toast.error("Sélection incomplète", "Choisis une cible dans l'arbre.");
      return;
    }
    const newHref = buildLinkUrl(baseUrl, selected);
    onValidate(newHref);
  };

  const parentButton = (
    id: PickerParent,
    label: string,
    icon: string,
    hasChildren: boolean,
    directTarget: LinkTarget | null,
  ) => {
    const isExpanded = expanded === id;
    const isPickedDirectly = directTarget !== null && selected !== null && selected.kind === directTarget.kind;
    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 p-2.5">
          <button
            type="button"
            onClick={() => {
              if (hasChildren) {
                setExpanded(isExpanded ? null : id);
              }
              if (directTarget) setSelected(directTarget);
            }}
            className={`flex-1 flex items-center gap-2 text-left ${isPickedDirectly ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
          >
            <span aria-hidden>{icon}</span>
            <span className="text-sm">{label}</span>
            {hasChildren && (
              <span className="text-xs text-text-muted ml-auto">
                {isExpanded ? "▼" : "▶"}
              </span>
            )}
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div className="p-2 border-t border-border bg-bg-secondary">
            {id === "products" && (
              <div className="space-y-2">
                <input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Chercher par nom ou référence…"
                  className="w-full rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm"
                />
                {productsLoading && <div className="text-xs text-text-muted">Chargement…</div>}
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {products.map((p) => {
                    const isSel = selected?.kind === "product" && selected.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelected({ kind: "product", id: p.id, name: p.name, reference: p.reference, handle: p.handle })}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-text-muted ml-1">— {p.reference}</span>
                      </button>
                    );
                  })}
                  {!productsLoading && products.length === 0 && (
                    <div className="text-xs text-text-muted italic px-2">Aucun résultat.</div>
                  )}
                </div>
              </div>
            )}
            {id === "categories" && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {categories.map((c) => {
                  const isSel = selected?.kind === "category" && selected.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelected({ kind: "category", id: c.id, name: c.name, slug: c.slug })}
                      className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {categories.length === 0 && (
                  <div className="text-xs text-text-muted italic px-2">Aucune catégorie.</div>
                )}
              </div>
            )}
            {id === "collections" && (
              <div className="max-h-48 overflow-y-auto space-y-1">
                {collections.map((c) => {
                  const isSel = selected?.kind === "collection" && selected.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelected({ kind: "collection", id: c.id, name: c.name, slug: c.slug })}
                      className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {collections.length === 0 && (
                  <div className="text-xs text-text-muted italic px-2">Aucune collection.</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border">
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Configurer un lien</div>
          <div className="text-sm font-heading font-semibold text-text-primary">Choisis la cible</div>
          <div className="text-xs text-text-muted mt-1">
            URL actuelle : <code className="text-[11px] bg-bg-secondary rounded px-1 py-0.5 break-all">{currentHref}</code>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {parentButton("home", "Accueil", "🏠", false, { kind: "home" })}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => setSelected({ kind: "products" })}
                className={`text-sm ${selected?.kind === "products" ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
              >
                📦 Tous les produits
              </button>
              <button
                type="button"
                onClick={() => setExpanded(expanded === "products" ? null : "products")}
                className="ml-auto text-xs text-text-muted"
              >
                {expanded === "products" ? "▼ un produit précis" : "▶ ou un produit précis"}
              </button>
            </div>
            {expanded === "products" && (
              <div className="p-2 border-t border-border bg-bg-secondary space-y-2">
                <input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Chercher par nom ou référence…"
                  className="w-full rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm"
                />
                {productsLoading && <div className="text-xs text-text-muted">Chargement…</div>}
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {products.map((p) => {
                    const isSel = selected?.kind === "product" && selected.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelected({ kind: "product", id: p.id, name: p.name, reference: p.reference, handle: p.handle })}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-text-muted ml-1">— {p.reference}</span>
                      </button>
                    );
                  })}
                  {!productsLoading && products.length === 0 && (
                    <div className="text-xs text-text-muted italic px-2">Aucun résultat.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => setSelected({ kind: "categories" })}
                className={`text-sm ${selected?.kind === "categories" ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
              >
                📂 Toutes les catégories
              </button>
              <button
                type="button"
                onClick={() => setExpanded(expanded === "categories" ? null : "categories")}
                className="ml-auto text-xs text-text-muted"
              >
                {expanded === "categories" ? "▼ une catégorie précise" : "▶ ou une catégorie précise"}
              </button>
            </div>
            {expanded === "categories" && (
              <div className="p-2 border-t border-border bg-bg-secondary">
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {categories.map((c) => {
                    const isSel = selected?.kind === "category" && selected.id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelected({ kind: "category", id: c.id, name: c.name, slug: c.slug })}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                  {categories.length === 0 && (
                    <div className="text-xs text-text-muted italic px-2">Aucune catégorie.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => setSelected({ kind: "collections" })}
                className={`text-sm ${selected?.kind === "collections" ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
              >
                ✨ Toutes les collections
              </button>
              <button
                type="button"
                onClick={() => setExpanded(expanded === "collections" ? null : "collections")}
                className="ml-auto text-xs text-text-muted"
              >
                {expanded === "collections" ? "▼ une collection précise" : "▶ ou une collection précise"}
              </button>
            </div>
            {expanded === "collections" && (
              <div className="p-2 border-t border-border bg-bg-secondary">
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {collections.map((c) => {
                    const isSel = selected?.kind === "collection" && selected.id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelected({ kind: "collection", id: c.id, name: c.name, slug: c.slug })}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${isSel ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "hover:bg-bg-primary"}`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                  {collections.length === 0 && (
                    <div className="text-xs text-text-muted italic px-2">Aucune collection.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          {parentButton("about", "Qui sommes-nous", "ℹ️", false, { kind: "about" })}
          {parentButton("contact", "Nous contacter", "📞", false, { kind: "contact" })}
        </div>
        <div className="p-4 border-t border-border flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted min-w-0 truncate flex-1">
            {selected ? (
              <>
                <span className="text-text-primary font-medium">{describeLinkTarget(selected)}</span>
                <span className="ml-2 text-text-muted">→ {buildLinkUrl(baseUrl || "https://…", selected)}</span>
              </>
            ) : (
              "Choisis une cible dans la liste ci-dessus"
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded border border-border hover:bg-bg-secondary"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleValidate}
              disabled={!canValidate}
              className="text-sm px-3 py-1.5 rounded bg-bg-dark text-text-inverse hover:bg-text-primary disabled:opacity-40"
            >
              Valider
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
