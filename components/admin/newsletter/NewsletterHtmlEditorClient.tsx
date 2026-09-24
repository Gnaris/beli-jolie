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
  applyDynamicLimits,
  countMarkdownCodeFences,
  expandIterations,
  stripMarkdownCodeFences,
  substituteTemplateImages,
  type HtmlDynamicContext,
} from "@/lib/newsletter-html-render";
import {
  annotateHtmlForInlineEdit,
  applyImageMutation,
  applyLinkMutation,
  applyTextMutation,
  readAttrValue,
  readTextContent,
  stripEditAttrs,
  wrapElementInLink,
  type EditableKind,
} from "@/lib/newsletter-inline-edit";
import { HtmlSourceEditor } from "@/components/admin/newsletter/HtmlSourceEditor";
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

/**
 * Détecte la raison pour laquelle un élément cliqué n'est pas éditable
 * inline. Retourne un message court à afficher, ou null si silencieux.
 *
 * Depuis 2026-09-24, les textes avec variables SONT éditables via la modale
 * (qui propose une palette pour ré-insérer les tokens). Restent refusés :
 *   - Les blocs `{{#each}}` (structure de boucle → à éditer via le code).
 *   - Les tags mixtes avec sous-balises (édite l'enfant précis).
 */
function detectNonEditableReason(el: Element | null): string | null {
  if (!el) return null;
  const parent = el.closest(
    "p,span,h1,h2,h3,h4,h5,h6,td,div,li,strong,em,b,i,small,button,label",
  );
  if (!parent) return null;
  const inner = parent.innerHTML ?? "";
  if (/\{\{\s*[#/]/.test(inner)) {
    return "Ce bloc est une boucle qui se répète pour chaque article — modifie-le via le code HTML à gauche.";
  }
  if (/<[a-zA-Z/]/.test(inner)) {
    return "Ce bloc contient plusieurs éléments — fais clic droit directement sur l'élément à modifier (ex. le bouton, le mot en gras).";
  }
  return null;
}

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
  // HTML avec `data-bj-edit-id` sur chaque balise éditable inline (img, a,
  // texte pur sans token). Passé au pipeline de rendu iframe pour que le
  // clic droit dans l'aperçu puisse retrouver la balise source à muter.
  // Les data-attrs sont invisibles à l'affichage (clients mail les ignorent)
  // et sont strippés à la sauvegarde via stripEditAttrs.
  const htmlAnnotated = useMemo(
    () => annotateHtmlForInlineEdit(debouncedHtml).annotated,
    [debouncedHtml],
  );
  const localPreview = useMemo(() => {
    // Même pipeline que l'envoi réel : troncature 8 max + tokens
    // {cartMoreText}/{favoritesMoreText}, itérations, images, merge vars.
    const { dynamic: limited, extraMerge } = applyDynamicLimits(previewDynamic);
    const withIter = expandIterations(htmlAnnotated, limited, "");
    const withImages = substituteTemplateImages(withIter, images, "");
    return interpolate(withImages, { ...previewContext, ...extraMerge });
  }, [htmlAnnotated, images, previewContext, previewDynamic]);

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
    // Après un upload d'image : skip ce re-fetch (le DOM iframe est déjà
    // mis à jour de manière optimiste). Ça évite le "flash retour en haut"
    // causé par le reload du srcDoc.
    if (skipNextServerPreviewFetchRef.current) {
      skipNextServerPreviewFetchRef.current = false;
      return;
    }
    const recipient = previewTarget === SELF_TARGET
      ? { kind: "self" as const }
      : { kind: "client" as const, userId: previewTarget };
    setServerPreviewLoading(true);
    let cancelled = false;
    getNewsletterHtmlPreview({
      templateId: template.id,
      recipient,
      // On envoie la version annotée pour que les data-bj-edit-id survivent
      // au rendu serveur (interpolation, boucles) — le clic droit iframe
      // retrouve les balises. La sauvegarde strippe ces attrs.
      htmlOverride: htmlAnnotated,
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
  }, [previewTarget, template.id, htmlAnnotated, subject, toast]);

  // Injecte `<base target="_blank">` pour que TOUT clic sur un lien dans
  // l'aperçu ouvre un nouvel onglet — sinon un href="" (CTA non configuré)
  // rechargerait l'iframe sur about:blank et casserait l'aperçu.
  // Injecte aussi une <style> qui highlight au survol tout élément éditable
  // inline — feedback visuel indispensable pour que la cliente sache où
  // faire clic droit.
  const previewSrcDoc = useMemo(() => {
    const raw = serverPreview ?? localPreview;
    const head =
      '<base target="_blank">' +
      '<style>' +
      '[data-bj-edit-id]{cursor:context-menu;transition:outline 120ms ease-out;}' +
      '[data-bj-edit-id]:hover{outline:2px dashed #f59e0b;outline-offset:2px;}' +
      // Image en cours d'upload : opacity réduite + pulse pour indiquer
      // qu'un chargement est en cours. L'attribut `data-bj-upload` est
      // posé par le composant parent (mutation directe du contentDocument).
      '@keyframes bj-pulse{0%,100%{opacity:.35}50%{opacity:.6}}' +
      '[data-bj-upload="loading"]{animation:bj-pulse 1.2s ease-in-out infinite;filter:grayscale(.4) blur(1px);}' +
      '</style>';
    if (/<head\b[^>]*>/i.test(raw)) {
      return raw.replace(/<head\b[^>]*>/i, (m) => `${m}${head}`);
    }
    return head + raw;
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

  // ─── Édition inline dans l'aperçu iframe ───
  // Clic droit sur une balise éditable (<img>, <a>, texte sans token) →
  // menu contextuel avec 1 action selon le type. Mutation appliquée au HTML
  // annoté puis strippée pour le state clean, qui re-annote automatiquement
  // au prochain render.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Scroll iframe préservé entre re-renders du srcDoc (upload d'image, etc.).
  // Reset à 0 quand on change de destinataire d'aperçu.
  const iframeScrollTopRef = useRef<number>(0);
  useEffect(() => {
    iframeScrollTopRef.current = 0;
  }, [previewTarget]);

  // Flag pour skipper le prochain re-fetch server preview. Utilisé juste
  // après un upload d'image : la mutation directe du DOM iframe suffit à
  // afficher la nouvelle image, pas besoin de recharger tout le srcDoc
  // (sinon flash "retour en haut puis restauration scroll" désagréable).
  const skipNextServerPreviewFetchRef = useRef<boolean>(false);
  const [inlineMenu, setInlineMenu] = useState<
    | { id: string; kind: EditableKind; screenX: number; screenY: number }
    | null
  >(null);
  // Tooltip d'erreur affiché quand la cliente fait clic droit sur un élément
  // NON éditable (typiquement : texte contenant `{firstName}` ou boucle).
  // Auto-fade après 3 s, positionné à l'endroit du clic.
  const [inlineError, setInlineError] = useState<
    | { message: string; screenX: number; screenY: number; token: number }
    | null
  >(null);
  const [inlineTextEdit, setInlineTextEdit] = useState<
    | { id: string; initialValue: string; kind: EditableKind }
    | null
  >(null);
  const [inlineLinkEdit, setInlineLinkEdit] = useState<
    | { id: string; kind: EditableKind; currentHref: string }
    | null
  >(null);
  // Uploads d'image en cours — Set d'ids de <img data-bj-edit-id>. Chaque
  // upload est indépendant (nouveau <input type="file"> jetable créé au clic
  // menu et retiré du DOM après consommation), plusieurs peuvent tourner en
  // parallèle sans s'annuler mutuellement. Bug cliente 2026-09-24.
  const [inlineImageUploading, setInlineImageUploading] = useState<Set<string>>(new Set());

  const applyMutation = useCallback(
    (mutator: (current: string) => string) => {
      const nextAnnotated = mutator(htmlAnnotated);
      const cleaned = stripEditAttrs(nextAnnotated);
      setHtml(cleaned);
      setIsDirty(true);
    },
    [htmlAnnotated],
  );

  // Handler contextmenu attaché directement via la prop `onLoad` de l'iframe
  // (voir plus bas dans le JSX). À chaque changement de srcDoc, load fire →
  // handler ré-attaché sur le nouveau contentDocument. Approche onLoad JSX
  // plus fiable qu'un useEffect + listener (évite race avec React fiber).
  //
  // Ouvre un file picker pour uploader une nouvelle image sur la balise
  // ciblée. File input JETABLE (un par upload) → indépendance totale entre
  // uploads parallèles. Défini AVANT attachIframeListener pour ordre
  // d'initialisation des consts.
  const triggerImageUploadRef = useRef<((targetId: string) => void) | null>(null);
  const triggerImageUpload = useCallback((targetId: string) => {
    triggerImageUploadRef.current?.(targetId);
  }, []);

  // Comportement :
  //  - preventDefault TOUJOURS → le menu Google/Firefox natif est bloqué
  //    partout dans l'aperçu, on maîtrise l'UX complètement.
  //  - Element éditable ([data-bj-edit-id]) → menu inline (image/lien/texte).
  //  - Element non éditable avec token merge dans son texte → tooltip
  //    d'erreur qui fade out, expliquant pourquoi c'est bloqué.
  //  - Element non éditable sans token → silencieux (pas de bruit UI).
  //  - Un scroll dans l'iframe ferme immédiatement le menu / tooltip.
  const attachIframeListener = useCallback((iframe: HTMLIFrameElement) => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    const holder = doc as unknown as {
      __bjCtxHandler?: (e: MouseEvent) => void;
      __bjClickHandler?: (e: MouseEvent) => void;
      __bjScrollHandler?: () => void;
    };
    if (holder.__bjCtxHandler) doc.removeEventListener("contextmenu", holder.__bjCtxHandler);
    if (holder.__bjClickHandler) doc.removeEventListener("click", holder.__bjClickHandler, true);
    if (holder.__bjScrollHandler) {
      doc.removeEventListener("scroll", holder.__bjScrollHandler, true);
      iframe.contentWindow?.removeEventListener("scroll", holder.__bjScrollHandler);
    }

    // Handler partagé clic gauche / clic droit. Différence :
    //  - Clic droit : preventDefault (bloque menu natif du navigateur).
    //  - Clic gauche : preventDefault aussi (bloque la navigation par
    //    défaut des <a> vers about:blank via <base target="_blank">).
    // Sur <img> : upload direct (pas de menu, plus rapide pour la cliente).
    // Sur <a> / <p> / autres tags texte : ouvre le menu Actions.
    const handleActivation = (e: MouseEvent) => {
      const clicked = e.target as Element | null;
      const target = clicked?.closest("[data-bj-edit-id]");
      if (!target) {
        // Non éditable — ferme un éventuel menu déjà ouvert (le click
        // dans l'iframe ne bulle pas jusqu'au window listener parent).
        setInlineMenu(null);
        if (e.type === "contextmenu") {
          e.preventDefault();
          const reason = detectNonEditableReason(clicked);
          if (reason) {
            const rect = iframe.getBoundingClientRect();
            setInlineError({
              message: reason,
              screenX: rect.left + e.clientX,
              screenY: rect.top + e.clientY,
              token: Date.now(),
            });
          }
        }
        return;
      }
      e.preventDefault();
      const id = target.getAttribute("data-bj-edit-id") ?? "";
      const tag = target.tagName.toLowerCase();
      // Image → upload direct (pas de menu, la cliente veut 1 clic = upload).
      if (tag === "img") {
        setInlineMenu(null);
        setInlineError(null);
        triggerImageUpload(id);
        return;
      }
      const kind: EditableKind = tag === "a" ? "link" : "text";
      const rect = iframe.getBoundingClientRect();
      setInlineError(null);
      setInlineMenu({
        id,
        kind,
        screenX: rect.left + e.clientX,
        screenY: rect.top + e.clientY,
      });
    };

    const scrollHandler = () => {
      setInlineMenu(null);
      setInlineError(null);
      // Sauvegarde la position pour la restaurer après un re-render du srcDoc
      // (upload d'image = mut de state qui refait localPreview et recharge
      // l'iframe — sans ça le scroll revient à 0 → sensation de « refresh »
      // désagréable, bug cliente 2026-09-24).
      const y = iframe.contentWindow?.scrollY ?? 0;
      if (y > 0) iframeScrollTopRef.current = y;
    };

    holder.__bjCtxHandler = handleActivation;
    holder.__bjClickHandler = handleActivation;
    holder.__bjScrollHandler = scrollHandler;
    doc.addEventListener("contextmenu", handleActivation);
    doc.addEventListener("click", handleActivation, true);
    doc.addEventListener("scroll", scrollHandler, { capture: true, passive: true });
    iframe.contentWindow?.addEventListener("scroll", scrollHandler, { passive: true });

    // Restaure le scroll sauvegardé (utile après re-render du srcDoc).
    const savedY = iframeScrollTopRef.current;
    if (savedY > 0) {
      iframe.contentWindow?.scrollTo(0, savedY);
    }
  }, [triggerImageUpload]);

  // Ferme aussi le menu/tooltip au scroll du parent (l'iframe est dans une
  // colonne scrollable).
  useEffect(() => {
    if (!inlineMenu && !inlineError) return;
    const close = () => { setInlineMenu(null); setInlineError(null); };
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, [inlineMenu, inlineError]);

  // Auto-dismiss du tooltip d'erreur après 3 s (fade géré côté CSS).
  useEffect(() => {
    if (!inlineError) return;
    const t = setTimeout(() => setInlineError(null), 3000);
    return () => clearTimeout(t);
  }, [inlineError]);

  // Ferme le menu contextuel : ESC, clic à côté (window), scroll parent.
  // Le container du menu a `stopPropagation` sur son onClick → le click
  // interne (sur les boutons ou la croix) ne bulle pas jusqu'à window,
  // donc close() ne se déclenche pas quand on interagit avec le menu.
  // setTimeout 0 pour éviter que le clic droit qui a ouvert le menu ferme
  // immédiatement (le contextmenu event peut se propager au mousedown).
  useEffect(() => {
    if (!inlineMenu) return;
    const close = () => setInlineMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const timer = window.setTimeout(() => {
      window.addEventListener("click", close);
    }, 0);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, { capture: true } as EventListenerOptions);
    };
  }, [inlineMenu]);

  // Assigne l'implémentation réelle du trigger — appelée via la ref au
  // callsite pour contourner l'ordre d'initialisation.
  triggerImageUploadRef.current = (targetId: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void handleInlineImageFile(file, targetId);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  };

  type InlineAction = "replaceImage" | "editText" | "configureLink";
  const openInlineEditor = useCallback(
    (menu: { id: string; kind: EditableKind }, action: InlineAction) => {
      setInlineMenu(null);
      if (action === "replaceImage") {
        triggerImageUpload(menu.id);
        return;
      }
      if (action === "editText") {
        setInlineTextEdit({
          id: menu.id,
          kind: menu.kind,
          initialValue: readTextContent(htmlAnnotated, menu.id),
        });
        return;
      }
      if (action === "configureLink") {
        // Sur un <a> existant : on modifie son href. Sur autre chose (texte,
        // img) : on enveloppe le tag dans un <a href="…"> via wrapElementInLink.
        const currentHref =
          menu.kind === "link" ? readAttrValue(htmlAnnotated, menu.id, "href") : "";
        setInlineLinkEdit({
          id: menu.id,
          kind: menu.kind,
          currentHref,
        });
      }
    },
    [htmlAnnotated],
  );

  const handleInlineImageFile = useCallback(
    async (file: File, targetId: string) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Fichier refusé", "Choisis une image (JPG, PNG, WebP).");
        return;
      }
      // Marque cet id "loading" (Set immuable pour bien trigger re-render).
      setInlineImageUploading((prev) => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
      // Feedback visuel immédiat dans l'iframe : opacity réduite + spinner
      // via un attribut `data-bj-upload="loading"` que le style injecté dans
      // le srcDoc anime.
      const iframeDoc = iframeRef.current?.contentDocument;
      const targetEl = iframeDoc?.querySelector(`[data-bj-edit-id="${targetId}"]`);
      targetEl?.setAttribute("data-bj-upload", "loading");
      try {
        const form = new FormData();
        form.append("image", file);
        const autoName = `inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        form.append("name", autoName);
        const res = await fetch(
          `/api/admin/newsletter-templates/${template.id}/images`,
          { method: "POST", body: form },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({} as { error?: string }));
          toast.error("Upload refusé", body.error ?? `Erreur ${res.status}`);
          return;
        }
        const uploaded = (await res.json()) as { path: string };
        // 1) Mise à jour visuelle DIRECTE dans l'iframe — évite le flash
        //    que causerait le rerender du srcDoc entier. L'image apparaît
        //    tout de suite sans reload du reste de l'aperçu.
        if (targetEl?.tagName.toLowerCase() === "img") {
          targetEl.setAttribute("src", uploaded.path);
        }
        // 2) Mise à jour du state (source de vérité pour save + prochain
        //    render). On skip le re-fetch server preview qui suivra — le
        //    DOM iframe est déjà à jour visuellement, pas besoin de
        //    recharger tout l'aperçu (évite le flash "retour en haut").
        //    Le prochain vrai changement (édition texte, autre upload)
        //    re-fetchera normalement.
        skipNextServerPreviewFetchRef.current = true;
        applyMutation((current) => applyImageMutation(current, targetId, uploaded.path));
      } catch (err) {
        toast.error("Upload échoué", (err as Error).message);
      } finally {
        setInlineImageUploading((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
        targetEl?.removeAttribute("data-bj-upload");
      }
    },
    [applyMutation, template.id, toast],
  );

  // Garde-fou navigation
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Raccourci Ctrl/Cmd + S = enregistrer. Fonctionne partout dans l'éditeur
  // (textarea code, aperçu, sujet…) sauf dans les inputs de contentEditable
  // qui font leur propre save via Ctrl+Entrée. preventDefault → évite le
  // « Enregistrer sous » du navigateur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isDirty && !isPending) handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDirty, isPending, handleSave]);

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
              <SubjectInputWithVariables
                value={subject}
                scenario={template.scenarioKey}
                onChange={(v) => { setSubject(v); markDirty(); }}
              />
            </FieldRow>
            <FieldRow label="Code HTML" hint="Doit contenir {shopName}, {shopAddress}, {unsubscribeLink}, {privacyLink}">
              <MarkdownFencesBanner html={html} onClean={() => {
                setHtml((prev) => stripMarkdownCodeFences(prev).html);
                markDirty();
              }} />
              <HtmlSourceEditor
                value={html}
                onChange={(v) => { setHtml(v); markDirty(); }}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  const { html: cleaned, removed } = stripMarkdownCodeFences(pasted);
                  if (removed === 0) return;
                  e.preventDefault();
                  const target = e.currentTarget;
                  const start = target.selectionStart ?? html.length;
                  const end = target.selectionEnd ?? html.length;
                  const next = html.slice(0, start) + cleaned + html.slice(end);
                  setHtml(next);
                  markDirty();
                  toast.success(
                    "Balises Markdown nettoyées",
                    `${removed} bloc${removed > 1 ? "s" : ""} \`\`\`…\`\`\` retiré${removed > 1 ? "s" : ""} du collage.`,
                  );
                  requestAnimationFrame(() => {
                    const pos = start + cleaned.length;
                    target.setSelectionRange(pos, pos);
                  });
                }}
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
              ref={iframeRef}
              key={previewTarget ? `srv-${previewTarget}` : "local"}
              srcDoc={previewSrcDoc}
              onLoad={(e) => attachIframeListener(e.currentTarget)}
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
      </main>

      {/* ─── Édition inline dans l'aperçu ─── */}
      {/* Menu contextuel : 1 seule action, positionné au clic droit. Portale
          en fixed dans le layout parent. Clampé à la viewport pour ne pas
          sortir en bas / à droite. */}
      {inlineMenu && (
        <div
          className="fixed z-[120] bg-bg-primary border border-border rounded-lg shadow-xl py-1 min-w-[220px]"
          style={{
            left: Math.min(inlineMenu.screenX, window.innerWidth - 240),
            top: Math.min(inlineMenu.screenY, window.innerHeight - 120),
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-3 py-1 border-b border-border mb-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold">Actions</span>
            <button
              type="button"
              onClick={() => setInlineMenu(null)}
              aria-label="Fermer"
              className="text-text-muted hover:text-text-primary text-sm leading-none"
            >
              ✕
            </button>
          </div>
          {inlineMenu.kind === "image" && (
            <MenuAction
              icon="🖼"
              label="Remplacer l'image"
              onClick={() => openInlineEditor({ id: inlineMenu.id, kind: inlineMenu.kind }, "replaceImage")}
            />
          )}
          {inlineMenu.kind === "text" && (
            <MenuAction
              icon="✏️"
              label="Modifier le texte"
              onClick={() => openInlineEditor({ id: inlineMenu.id, kind: inlineMenu.kind }, "editText")}
            />
          )}
          {inlineMenu.kind === "link" && (
            <>
              <MenuAction
                icon="✏️"
                label="Modifier le texte"
                onClick={() => openInlineEditor({ id: inlineMenu.id, kind: inlineMenu.kind }, "editText")}
              />
              <MenuAction
                icon="🔗"
                label="Modifier le lien"
                onClick={() => openInlineEditor({ id: inlineMenu.id, kind: inlineMenu.kind }, "configureLink")}
              />
            </>
          )}
        </div>
      )}

      {/* Tooltip d'erreur au clic droit sur un élément non éditable (avec
          variable). Fade-out géré par le composant interne via transition
          d'opacity. Auto-dismiss 3 s via useEffect ci-dessus. */}
      {inlineError && (
        <InlineErrorTooltip
          key={inlineError.token}
          message={inlineError.message}
          left={Math.min(inlineError.screenX, window.innerWidth - 320)}
          top={Math.min(inlineError.screenY, window.innerHeight - 80)}
        />
      )}

      {/* Badge cumulatif "Upload en cours" — visible dès qu'au moins 1
          image est en train de s'uploader. Compte le nombre d'uploads
          parallèles pour informer la cliente. */}
      {inlineImageUploading.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[130] bg-bg-dark text-text-inverse px-4 py-2 rounded-full text-xs shadow-lg flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
          <span>
            {inlineImageUploading.size === 1
              ? "Upload en cours…"
              : `${inlineImageUploading.size} uploads en cours…`}
          </span>
        </div>
      )}

      {/* Modale édition texte inline. */}
      {inlineTextEdit && (
        <InlineTextEditModal
          initialValue={inlineTextEdit.initialValue}
          scenario={template.scenarioKey}
          disableAddLink={inlineTextEdit.kind === "link"}
          onCancel={() => setInlineTextEdit(null)}
          onValidate={(newText) => {
            const id = inlineTextEdit.id;
            applyMutation((current) => applyTextMutation(current, id, newText));
            setInlineTextEdit(null);
          }}
        />
      )}

      {/* Picker de lien inline. Selon le kind cible :
          - link : modifie le href du <a> existant.
          - image / text : enveloppe la balise dans un nouveau <a href="…">. */}
      {inlineLinkEdit && (
        <LinkPickerModal
          currentHref={inlineLinkEdit.currentHref}
          baseUrl={""}
          onClose={() => setInlineLinkEdit(null)}
          onValidate={(newHref) => {
            const { id, kind } = inlineLinkEdit;
            applyMutation((current) =>
              kind === "link"
                ? applyLinkMutation(current, id, newHref)
                : wrapElementInLink(current, id, newHref),
            );
            setInlineLinkEdit(null);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Input sujet avec palette de variables intégrée
   ───────────────────────────────────────────── */

/**
 * Input classique pour le sujet du mail + bouton `{...}` à droite qui ouvre
 * un popover listant les variables mergeables du scénario. Clic sur une
 * variable = insertion à la position du curseur (préservée même après un
 * clic sur le bouton).
 */
function SubjectInputWithVariables({
  value,
  scenario,
  onChange,
}: {
  value: string;
  scenario: ScenarioKey | null;
  onChange: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef<number>(value.length);
  const [open, setOpen] = useState(false);
  const variables = useMemo(() => variablesForScenario(scenario), [scenario]);

  const insertToken = (token: string) => {
    const insert = `{${token}}`;
    const pos = caretRef.current ?? value.length;
    const next = value.slice(0, pos) + insert + value.slice(pos);
    onChange(next);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const p = pos + insert.length;
      el.focus();
      el.setSelectionRange(p, p);
      caretRef.current = p;
    });
  };

  // Ferme le popover au clic ailleurs ou ESC.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest("[data-bj-subject-vars]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const t = window.setTimeout(() => document.addEventListener("click", onDoc), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" data-bj-subject-vars>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          caretRef.current = e.target.selectionStart ?? e.target.value.length;
        }}
        onKeyUp={(e) => { caretRef.current = e.currentTarget.selectionStart ?? 0; }}
        onClick={(e) => { caretRef.current = e.currentTarget.selectionStart ?? 0; }}
        onBlur={(e) => { caretRef.current = e.currentTarget.selectionStart ?? 0; }}
        className="w-full rounded-lg border border-border bg-bg-primary pl-3 pr-10 py-2 text-sm"
        placeholder="✨ Découvrez nos nouveautés"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title="Insérer une variable"
        aria-label="Insérer une variable"
        className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md text-text-secondary hover:bg-bg-secondary hover:text-text-primary flex items-center justify-center font-mono text-sm"
      >
        {"{…}"}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-30 w-80 max-h-[60vh] overflow-y-auto bg-bg-primary border border-border rounded-lg shadow-xl p-3"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2">
            Insérer une variable dans le sujet
          </div>
          {(["client", "boutique", "dynamique", "legal"] as VariableGroup[]).map((group) => {
            const inGroup = variables.filter((v) => v.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="mb-3 last:mb-0">
                <div className="text-[10px] font-semibold text-text-secondary mb-1">
                  {VARIABLE_GROUP_LABELS[group]}
                </div>
                <div className="flex flex-wrap gap-1">
                  {inGroup.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertToken(v.token)}
                      title={v.hint ? `${v.hint} — exemple : ${v.previewValue}` : `Exemple : ${v.previewValue}`}
                      className="text-[11px] px-2 py-1 rounded bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-text-secondary text-text-primary"
                    >
                      {v.label}
                      <span className="ml-1 text-text-muted font-mono">{`{${v.token}}`}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Bouton du menu contextuel (utilisé pour chaque action)
   ───────────────────────────────────────────── */

function MenuAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left text-sm px-3 py-1.5 hover:bg-bg-secondary flex items-center gap-2"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/* ─────────────────────────────────────────────
   Tooltip d'erreur au clic droit (fade-out 3 s)
   ───────────────────────────────────────────── */

function InlineErrorTooltip({
  message,
  left,
  top,
}: {
  message: string;
  left: number;
  top: number;
}) {
  const [opacity, setOpacity] = useState(1);
  useEffect(() => {
    // Visible immédiatement, fade-out démarré après 500 ms sur ~2.5 s.
    const t = setTimeout(() => setOpacity(0), 500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      className="fixed z-[120] max-w-xs bg-rose-600 text-white text-xs rounded-lg shadow-xl px-3 py-2 pointer-events-none"
      style={{
        left,
        top,
        opacity,
        transition: "opacity 2500ms ease-out",
      }}
    >
      {message}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modale édition texte inline (mini prompt)
   ───────────────────────────────────────────── */

/**
 * Modale d'édition rich text : contentEditable + toolbar (gras / italique /
 * souligné / lien) + palette de variables. Le HTML riche produit est passé
 * tel quel à `applyTextMutation` (qui sanitize).
 *
 * Persistance de la sélection : quand la cliente clique sur un bouton de
 * toolbar ou un chip variable, le focus de l'editor est perdu. On mémorise
 * la Range active dans `savedRangeRef` et on la restaure avant chaque
 * `execCommand` / insertion.
 */
function InlineTextEditModal({
  initialValue,
  scenario,
  disableAddLink,
  onCancel,
  onValidate,
}: {
  initialValue: string;
  scenario: ScenarioKey | null;
  /** true si l'élément édité est DÉJÀ un <a> — on interdit l'ajout d'un
   *  sous-lien pour éviter l'imbrication `<a><a>…</a></a>` invalide. */
  disableAddLink?: boolean;
  onCancel: () => void;
  onValidate: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    // Injecte le HTML initial de façon impérative (dangerouslySetInnerHTML
    // ne fonctionne pas bien avec contentEditable — react re-render écrase
    // le curseur à chaque frappe).
    el.innerHTML = initialValue;
    // Focus + curseur placé à la fin du contenu.
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
      savedRangeRef.current = range.cloneRange();
    }
  }, [initialValue]);

  const variables = useMemo(() => variablesForScenario(scenario), [scenario]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const range = savedRangeRef.current;
    const el = editorRef.current;
    if (!range || !el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const exec = (command: string, value?: string) => {
    restoreSelection();
    document.execCommand(command, false, value);
    saveSelection();
  };

  const insertToken = (token: string) => {
    restoreSelection();
    document.execCommand("insertText", false, `{${token}}`);
    saveSelection();
  };

  const validate = () => {
    const el = editorRef.current;
    onValidate(el ? el.innerHTML : "");
  };

  // Ferme sur clic overlay UNIQUEMENT si mousedown + mouseup ont eu lieu sur
  // l'overlay lui-même. Sinon une sélection de texte qui finit sur l'overlay
  // (glisse hors du modal en relâchant) fermerait par erreur.
  const overlayMouseDownRef = useRef(false);

  return (
    <div
      className="fixed inset-0 z-[125] bg-black/40 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        overlayMouseDownRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (overlayMouseDownRef.current && e.target === e.currentTarget) {
          onCancel();
        }
        overlayMouseDownRef.current = false;
      }}
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border shrink-0 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Édition du texte</div>
            <div className="text-sm font-heading font-semibold text-text-primary">Modifier le contenu</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="text-text-muted hover:text-text-primary text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Toolbar : formatage + lien */}
        <div className="px-4 pt-3 flex items-center gap-1 flex-wrap shrink-0">
          <ToolbarButton title="Gras (Ctrl+B)" onClick={() => exec("bold")}>
            <b>B</b>
          </ToolbarButton>
          <ToolbarButton title="Italique (Ctrl+I)" onClick={() => exec("italic")}>
            <i>I</i>
          </ToolbarButton>
          <ToolbarButton title="Souligné (Ctrl+U)" onClick={() => exec("underline")}>
            <u>U</u>
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            title={disableAddLink
              ? "Cet élément est déjà un lien — ajouter un sous-lien créerait une imbrication interdite."
              : "Ajouter un lien sur la sélection"}
            disabled={disableAddLink}
            onClick={() => {
              saveSelection();
              setLinkPickerOpen(true);
            }}
          >
            🔗 Lien
          </ToolbarButton>
          <ToolbarButton
            title={disableAddLink
              ? "Cet élément est déjà un lien complet — utilise le picker « Modifier le lien » du menu contextuel."
              : "Retirer le lien de la sélection"}
            disabled={disableAddLink}
            onClick={() => exec("unlink")}
          >
            ✕ Lien
          </ToolbarButton>
        </div>

        <div className="p-4 overflow-y-auto">
          {/* Zone éditable rich text */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onBlur={saveSelection}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                validate();
              }
              if (e.key === "Escape") onCancel();
            }}
            className="w-full min-h-[100px] rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-text-primary/20 text-left align-top whitespace-pre-wrap"
            style={{ textAlign: "left", verticalAlign: "top" }}
          />
          <div className="text-[11px] text-text-muted mt-1">
            Astuce : sélectionne du texte puis clique <b>B</b>/<i>I</i>/<u>U</u> ou 🔗 Lien.{" "}
            <kbd className="bg-bg-secondary rounded px-1">Ctrl</kbd>+<kbd className="bg-bg-secondary rounded px-1">Entrée</kbd> pour valider.
          </div>

          {/* Palette de variables */}
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-2">
              Insérer un mot-clé
            </div>
            {(["client", "boutique", "dynamique", "legal"] as VariableGroup[]).map((group) => {
              const inGroup = variables.filter((v) => v.group === group);
              if (inGroup.length === 0) return null;
              return (
                <div key={group} className="mb-2">
                  <div className="text-[10px] font-semibold text-text-secondary mb-1">
                    {VARIABLE_GROUP_LABELS[group]}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {inGroup.map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertToken(v.token)}
                        title={v.hint ? `${v.hint} — exemple : ${v.previewValue}` : `Exemple : ${v.previewValue}`}
                        className="text-[11px] px-2 py-1 rounded bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-text-secondary text-text-primary"
                      >
                        {v.label}
                        <span className="ml-1 text-text-muted font-mono">{`{${v.token}}`}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm px-3 py-1.5 rounded border border-border hover:bg-bg-secondary"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={validate}
            className="text-sm px-4 py-1.5 rounded bg-bg-dark text-text-inverse font-semibold transition-all hover:bg-amber-600 hover:shadow-md active:scale-95"
          >
            Valider
          </button>
        </div>
      </div>

      {/* Sous-picker : sélection dans l'éditeur → insertion d'un lien
          (execCommand createLink) sur les caractères sélectionnés. */}
      {linkPickerOpen && (
        <LinkPickerModal
          currentHref=""
          baseUrl={""}
          onClose={() => setLinkPickerOpen(false)}
          onValidate={(newHref) => {
            setLinkPickerOpen(false);
            exec("createLink", newHref);
          }}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // évite le blur du contentEditable
      onClick={onClick}
      className="min-w-[32px] h-8 px-2 rounded border border-border bg-bg-primary text-sm text-text-primary flex items-center justify-center transition-all hover:bg-amber-100 hover:border-amber-400 hover:text-amber-900 hover:shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-bg-primary disabled:hover:border-border disabled:hover:text-text-primary"
    >
      {children}
    </button>
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
      toast.success("Prompt copié", "Colle-le dans ton IA préférée, elle te renverra du HTML prêt à coller.");
    } catch {
      toast.error("Copie manuelle", "Ouvre l'aperçu, sélectionne le texte et Ctrl+C.");
    }
  };

  return (
    <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4">
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted">Assistant IA</div>
        <div className="text-sm font-heading font-semibold text-text-primary">
          Générer un modèle avec l'IA
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
          Copier le prompt pour l'IA
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
   Panneau Liens
   ───────────────────────────────────────────── */

/**
 * Bannière d'alerte affichée au-dessus du textarea HTML quand des fences
 * Markdown (``` ou ```html) sont présentes — typiquement quand l'IA a coupé
 * sa réponse en plusieurs blocs et que la cliente a tout collé. Un clic sur
 * « Nettoyer maintenant » les retire d'un coup.
 */
function MarkdownFencesBanner({ html, onClean }: { html: string; onClean: () => void }) {
  const count = useMemo(() => countMarkdownCodeFences(html), [html]);
  if (count === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 mb-2 flex items-start gap-3">
      <div className="text-lg" aria-hidden>⚠️</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-heading font-semibold text-amber-900">
          {count} balise{count > 1 ? "s" : ""} Markdown <code className="bg-white/70 rounded px-1 py-0.5 text-[11px]">```</code> détectée{count > 1 ? "s" : ""}
        </div>
        <div className="text-xs text-amber-800 mt-0.5">
          Ton IA a laissé des balises de bloc de code dans le HTML. Elles vont
          s&apos;afficher en clair dans le mail. Clique <span className="font-semibold">Nettoyer</span> pour les retirer.
        </div>
      </div>
      <button
        type="button"
        onClick={onClean}
        className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 shrink-0"
      >
        Nettoyer
      </button>
    </div>
  );
}


/* ─────────────────────────────────────────────
   Modale picker en arbre
   ───────────────────────────────────────────── */

type PickerParent = "home" | "cart" | "products" | "categories" | "collections" | "about" | "contact" | "custom";

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

  // Input « Lien personnalisé ». Pré-rempli si l'URL actuelle ressemble à une
  // URL absolue déjà tapée à la main (http/https/mailto/tel) — évite à la
  // cliente de tout retaper pour un simple changement de destination.
  const [customUrl, setCustomUrl] = useState<string>(() => {
    const t = currentHref.trim();
    return /^(https?:|mailto:|tel:)/i.test(t) ? t : "";
  });

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

  // Bouton Valider actif dès qu'une cible est choisie. `baseUrl` peut être
  // vide au moment du clic (chargement asynchrone) — on utilise alors un
  // fallback URL relatif (`/fr/…`), le rendu serveur absolutise à l'envoi.
  const canValidate =
    selected !== null &&
    !(selected.kind === "custom" && selected.url.trim().length === 0);

  const handleValidate = () => {
    if (!selected) {
      toast.error("Sélection incomplète", "Choisis une cible dans l'arbre.");
      return;
    }
    if (selected.kind === "custom" && selected.url.trim().length === 0) {
      toast.error("URL manquante", "Colle une URL complète (avec https://…) dans le champ Lien personnalisé.");
      return;
    }
    const newHref = buildLinkUrl(baseUrl || "", selected);
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
          {parentButton("cart", "Panier", "🛒", false, { kind: "cart" })}
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

          {/* Lien personnalisé : URL libre (domaine inclus). Utilisé pour les
              cas hors-boutique (Instagram, WhatsApp, page événement, PDF…). */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => setExpanded(expanded === "custom" ? null : "custom")}
                className={`flex-1 flex items-center gap-2 text-left ${selected?.kind === "custom" ? "text-emerald-700 font-semibold" : "text-text-primary"}`}
              >
                <span aria-hidden>🔗</span>
                <span className="text-sm">Lien personnalisé (URL libre)</span>
                <span className="text-xs text-text-muted ml-auto">
                  {expanded === "custom" ? "▼" : "▶"}
                </span>
              </button>
            </div>
            {expanded === "custom" && (
              <div className="p-3 border-t border-border bg-bg-secondary space-y-1.5">
                <input
                  type="url"
                  inputMode="url"
                  value={customUrl}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomUrl(v);
                    setSelected({ kind: "custom", url: v });
                  }}
                  onFocus={() => setSelected({ kind: "custom", url: customUrl })}
                  placeholder="https://exemple.com/ma-page"
                  className="w-full rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm"
                />
                <div className="text-[11px] text-text-muted">
                  Colle l&apos;URL complète (avec <code className="bg-bg-primary rounded px-1">https://</code>).
                  Aussi accepté : <code className="bg-bg-primary rounded px-1">mailto:</code>,{" "}
                  <code className="bg-bg-primary rounded px-1">tel:</code>.
                </div>
              </div>
            )}
          </div>
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
