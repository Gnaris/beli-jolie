"use client";

/**
 * Éditeur newsletter à blocs.
 * Layout 3 colonnes : palette / aperçu / réglages.
 * Enregistrement MANUEL via bouton « Enregistrer » — modale de garde-fou si
 * on quitte la page avec des modifs non sauvegardées.
 * Les images restent en local (blob URL) tant que le save n'est pas déclenché,
 * puis toutes les images en attente sont uploadées en batch avant persist.
 * Drag-and-drop pour réordonner (indicateur au-dessus/en-dessous).
 * Bouton « Ajouter » sur chaque bloc pour dupliquer en bas.
 * Color picker libre (roue chromatique + hex) sur toutes les couleurs.
 * Upload d'image depuis l'ordinateur (bannière, image+texte, colonnes).
 */

import React, { useState, useTransition, useCallback, useMemo, useRef, useEffect, createContext, useContext } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import { useDragReorder, dropIndicatorClass } from "@/components/admin/shared/useDragReorder";
import {
  updateNewsletterTemplate,
  searchProductsForNewsletter,
  listPreviewClients,
  getClientCartPreview,
  type NewsletterTemplateFull,
  type PreviewClientLite,
  type PreviewCart,
} from "@/app/actions/admin/newsletter-templates";
import {
  getAdminSelfEmail,
  getBoutiquePreviewOverrides,
  sendTestNewsletterEmail,
} from "@/app/actions/admin/send-newsletter";
import {
  defaultDataFor,
  getFooterContent,
  type NewsletterBlock,
  type NewsletterBlockType,
  type ColumnData,
} from "@/lib/newsletter-blocks";
import {
  allowedDynamicBlocksFor,
  requiredBlocksFor,
  type ScenarioKey,
  type RequiredBlockSpec,
} from "@/lib/mail-scenario-defaults";
import { BackgroundInput } from "@/components/admin/shared/GradientBuilder";
import {
  interpolate,
  buildPreviewContext,
  variablesForScenario,
  missingRequiredMarketingVariables,
  VARIABLE_GROUP_LABELS,
  type MailVariable,
  type PreviewOverrides,
  type VariableGroup,
} from "@/lib/mail-merge-variables";

/**
 * Une image « locale » : blob URL affiché instantanément dans l'aperçu, avec
 * le File d'origine conservé en mémoire pour l'upload différé au save.
 * On enregistre les fichiers dans un ref map indexé par blob URL.
 */
const RegisterFileContext = createContext<(blobUrl: string, file: File) => void>(() => {});
function useRegisterFile() { return useContext(RegisterFileContext); }

/**
 * Insertion de variable ({firstName}, etc.) — le bouton « Variables » est
 * GLOBAL, à un seul endroit (bandeau haut). Chaque input/textarea des blocs et
 * du sujet s'inscrit via `useActiveInputRegistrar()` au moment du focus. Le
 * bouton lit l'input actif et insère la variable au curseur.
 */
interface ActiveInputTarget {
  element: HTMLInputElement | HTMLTextAreaElement;
  getValue: () => string;
  setValue: (v: string) => void;
}
const ActiveInputContext = createContext<{
  target: ActiveInputTarget | null;
  register: (t: ActiveInputTarget) => void;
}>({ target: null, register: () => {} });
function useActiveInputRegistrar() { return useContext(ActiveInputContext).register; }
function useActiveInput() { return useContext(ActiveInputContext).target; }

/** Extrait toutes les URLs blob: présentes dans les blocs (image bannière / imgtext / colonnes). */
function collectBlobUrls(blocks: NewsletterBlock[]): string[] {
  const set = new Set<string>();
  for (const b of blocks) {
    if (b.type === "banner" && b.data.img?.startsWith("blob:")) set.add(b.data.img);
    if (b.type === "imgtext" && b.data.img?.startsWith("blob:")) set.add(b.data.img);
    if (b.type === "columns") {
      for (const col of b.data.columns) {
        if (col.kind === "image" && col.img?.startsWith("blob:")) set.add(col.img);
      }
    }
  }
  return Array.from(set);
}

/** Remplace toutes les URLs blob: par leur path serveur définitif (après upload). */
function replaceBlobUrls(blocks: NewsletterBlock[], map: Map<string, string>): NewsletterBlock[] {
  return blocks.map((b) => {
    if (b.type === "banner" && b.data.img && map.has(b.data.img)) {
      return { ...b, data: { ...b.data, img: map.get(b.data.img)! } };
    }
    if (b.type === "imgtext" && b.data.img && map.has(b.data.img)) {
      return { ...b, data: { ...b.data, img: map.get(b.data.img)! } };
    }
    if (b.type === "columns") {
      return {
        ...b,
        data: {
          ...b.data,
          columns: b.data.columns.map((col) =>
            col.kind === "image" && col.img && map.has(col.img)
              ? { ...col, img: map.get(col.img)! }
              : col,
          ),
        },
      };
    }
    return b;
  });
}

interface Props {
  template: NewsletterTemplateFull;
  /**
   * URL de retour pour le bouton « ← Retour » et la modale « Quitter sans
   * enregistrer ». Défaut : `/admin/marketing/mails` (hub des mails).
   * Utilisé par la variante panier abandonné pour renvoyer vers la config
   * des stades plutôt que la liste générale des modèles.
   */
  backUrl?: string;
  /**
   * Si fourni, remplace la navigation `router.push(backUrl)` par cet appel —
   * utilisé quand l'éditeur est monté dans une modale (fermer = fermer la
   * modale, pas naviguer). Reçoit un `save` flag pour info si besoin.
   */
  onLeave?: () => void;
  /**
   * Force le scénario appliqué aux règles d'obligation (blocs obligatoires
   * + blocs dynamiques autorisés), indépendamment du `template.scenarioKey`.
   * Utilisé par la modale panier abandonné : les templates des Stades 2+
   * ont `scenarioKey=null` (contrainte @@unique côté DB) mais doivent quand
   * même contenir le bloc « Panier du client » — obligatoire pour
   * ABANDONED_CART.
   */
  enforceScenario?: ScenarioKey;
}

interface BlockMeta {
  key: NewsletterBlockType;
  label: string;
  desc: string;
  icon: string;
}

const BLOCKS_META: BlockMeta[] = [
  { key: "header", label: "En-tête du mail", desc: "Logo + titre + sous-titre — toujours en haut", icon: "M3 5h18v6H3z M7 15h10 M7 19h6" },
  { key: "banner", label: "Bannière image", desc: "Photo plein largeur", icon: "M3 5h18v14H3zM8.5 10.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm12.5 4.5-5-5L5 21" },
  { key: "heading", label: "Titre + texte", desc: "Titre + paragraphe", icon: "M4 6h16M4 12h16M4 18h10" },
  { key: "callout", label: "Callout coloré", desc: "Bandeau coloré + CTA", icon: "M3 6h18v12H3z" },
  { key: "button", label: "Bouton CTA", desc: "Bouton cliquable", icon: "M4 9h16v6H4z" },
  { key: "products", label: "Grille produits", desc: "2 à 4 produits", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { key: "imgtext", label: "Image + texte", desc: "Photo et texte côte à côte", icon: "M3 4h8v16H3zM14 8h6M14 12h6M14 16h4" },
  { key: "columns", label: "Colonnes libres", desc: "2 ou 3 colonnes texte/image", icon: "M4 4h5v16H4zM10 4h4v16h-4zM15 4h5v16h-5z" },
  { key: "list", label: "Liste emojis", desc: "Puces stylisées", icon: "M5 6h14M5 12h14M5 18h14" },
  { key: "divider", label: "Séparateur", desc: "Ligne décorative", icon: "M4 12h16" },
  { key: "empty", label: "Bloc vide", desc: "Espace pour aérer", icon: "M4 4h16v16H4z" },
  { key: "featuresRow", label: "Ligne de features", desc: "3 icônes rondes + libellé (livraison, paiement…)", icon: "M6 8a3 3 0 106 0 3 3 0 00-6 0zM6 16a3 3 0 106 0 3 3 0 00-6 0zM14 12a3 3 0 106 0 3 3 0 00-6 0z" },
  { key: "footer", label: "Pied de page", desc: "Mentions légales — toujours en bas", icon: "M3 5h18v14H3z M7 9h10 M7 13h10 M7 17h6" },
  // ─── Blocs dynamiques (mails automatiques uniquement) ───
  { key: "cartItems", label: "Panier du client", desc: "Liste réelle des articles du panier", icon: "M6 6h15l-1.5 9h-12z M6 6L5 3H2 M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z" },
  { key: "favoritesGrid", label: "Favoris / Produits sélectionnés", desc: "Grille des produits à annoncer", icon: "M12 21s-7-4.5-9-9c-1-4 4-8 9-3 5-5 10-1 9 3-2 4.5-9 9-9 9z" },
  { key: "daysInactive", label: "Message jours d'inactivité", desc: "Texte avec le nombre de jours", icon: "M12 6v6l4 2 M12 22a10 10 0 100-20 10 10 0 000 20z" },
];

interface ProductLite {
  id: string;
  name: string;
  reference: string;
  imagePath: string | null;
  priceCents: number | null;
}

export default function NewsletterEditorClient({ template, backUrl = "/admin/marketing/mails", onLeave, enforceScenario }: Props) {
  const toast = useToast();
  const router = useRouter();
  // `enforceScenario` a priorité sur le scenarioKey du template : les Stades
  // 2+ panier abandonné n'ont pas de scenarioKey (contrainte @@unique) mais
  // doivent hériter des règles ABANDONED_CART (bloc « Panier du client »
  // obligatoire).
  const scenarioKey: ScenarioKey | null = enforceScenario ?? template.scenarioKey;
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  // À l'ouverture, on complète automatiquement le modèle avec les 2 blocs
  // OBLIGATOIRES (en-tête + pied de page) s'ils sont absents. Le header est
  // TOUJOURS en 1ʳᵉ position, le footer en DERNIÈRE — impossible à déplacer,
  // impossible à supprimer. La cliente ne peut que les personnaliser.
  const initialAutoAdded = useRef<boolean>(false);
  const [blocks, setBlocks] = useState<NewsletterBlock[]>(() => {
    const initial: NewsletterBlock[] = Array.isArray(template.blocks) ? [...template.blocks] : [];
    let header: NewsletterBlock | null = null;
    let footer: NewsletterBlock | null = null;
    const middle: NewsletterBlock[] = [];
    for (const b of initial) {
      if (b.type === "header" && !header) header = b;
      else if (b.type === "footer" && !footer) footer = b;
      else middle.push(b);
    }
    // Détection « il y a des changements à sauver » : header/footer manquant
    // OU présent mais mal positionné (pas en 1ᵉʳ / pas en dernier).
    const headerWasFirst = initial[0]?.type === "header";
    const footerWasLast = initial[initial.length - 1]?.type === "footer";
    if (!header) {
      header = {
        id: `auto-header-${Date.now()}`,
        type: "header",
        data: defaultDataFor("header"),
      } as NewsletterBlock;
      initialAutoAdded.current = true;
    } else if (!headerWasFirst) {
      initialAutoAdded.current = true;
    }
    if (!footer) {
      footer = {
        id: `auto-footer-${Date.now()}`,
        type: "footer",
        data: defaultDataFor("footer"),
      } as NewsletterBlock;
      initialAutoAdded.current = true;
    } else if (!footerWasLast) {
      initialAutoAdded.current = true;
    }
    return [header, ...middle, footer];
  });
  const subjectRef = useRef<HTMLInputElement | null>(null);

  // Cible active pour insertion de variable : mise à jour au focus de n'importe
  // quel input/textarea du sujet ou des blocs. Le bouton « Variables » global
  // dans le header lit cette cible.
  const [activeInput, setActiveInput] = useState<ActiveInputTarget | null>(null);
  const registerActiveInput = useCallback((t: ActiveInputTarget) => setActiveInput(t), []);
  const activeInputContextValue = useMemo(
    () => ({ target: activeInput, register: registerActiveInput }),
    [activeInput, registerActiveInput],
  );

  // Aperçu avec un vrai client (dropdown au-dessus de la zone aperçu).
  // Fallback : valeurs fictives (buildPreviewContext) tant que la liste n'est
  // pas encore chargée OU si aucun client APPROVED n'existe encore.
  //
  // La cible « Moi-même » (value = SELF_TARGET) envoie le mail de test sur le
  // mail perso vérifié de l'admin (KEY_VERIFIED_EMAIL). Pour l'aperçu à
  // l'écran on retombe sur les valeurs fictives — l'admin n'a pas de fiche
  // client à interpoler.
  const [previewClients, setPreviewClients] = useState<PreviewClientLite[]>([]);
  const [previewClientId, setPreviewClientId] = useState<string | null>(null);
  const [adminSelfEmail, setAdminSelfEmail] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  // Overrides boutique du tenant courant — sans ça la preview locale affiche
  // « Beli & Jolie » (hardcodé dans MAIL_VARIABLES) même en admin Issyma.
  const [boutiqueOverrides, setBoutiqueOverrides] = useState<PreviewOverrides | null>(null);
  // Panier réel du client sélectionné — injecté dans l'aperçu du bloc
  // « cartItems » à la place des lignes fictives.
  const [previewCart, setPreviewCart] = useState<PreviewCart | null>(null);
  useEffect(() => {
    let cancelled = false;
    // En parallèle : liste des clients + mail perso admin + overrides
    // boutique. La cliente pourra choisir un vrai client OU s'envoyer le mail
    // à elle-même pour tester ; les overrides remplacent les previewValue
    // câblés dans MAIL_VARIABLES par les vraies infos du tenant courant.
    Promise.all([listPreviewClients(), getAdminSelfEmail(), getBoutiquePreviewOverrides()])
      .then(([rows, self, overrides]) => {
        if (cancelled) return;
        setPreviewClients(rows);
        setAdminSelfEmail(self);
        setBoutiqueOverrides(overrides);
        if (rows.length > 0) {
          // Défaut : un client au hasard, permet à la cliente de voir
          // instantanément ce que verra un vrai destinataire.
          const random = rows[Math.floor(Math.random() * rows.length)];
          setPreviewClientId(random.id);
        }
      })
      .catch(() => { /* silencieux : l'aperçu retombe sur valeurs fictives */ });
    return () => { cancelled = true; };
  }, []);

  // À chaque changement de client sélectionné, on recharge son panier réel
  // pour l'aperçu du bloc « Panier du client ». Skip si pas de client (mode
  // « Moi-même » ou aucun client chargé).
  useEffect(() => {
    if (!previewClientId) {
      setPreviewCart(null);
      return;
    }
    let cancelled = false;
    getClientCartPreview(previewClientId)
      .then((cart) => {
        if (!cancelled) setPreviewCart(cart);
      })
      .catch(() => {
        if (!cancelled) setPreviewCart(null);
      });
    return () => { cancelled = true; };
  }, [previewClientId]);

  // Context d'aperçu : soit vrai client sélectionné, soit valeurs fictives.
  // Rendu réel côté serveur au moment de l'envoi (chaque destinataire son propre context).
  const previewContext = useMemo(() => {
    const fake = buildPreviewContext(scenarioKey, boutiqueOverrides ?? undefined);
    if (!previewClientId) return fake;
    const c = previewClients.find((u) => u.id === previewClientId);
    if (!c) return fake;
    return {
      ...fake, // conserve les tokens boutique + dynamiques (valeurs fictives)
      firstName: c.firstName,
      lastName: c.lastName,
      fullName: `${c.firstName} ${c.lastName}`.trim(),
      email: c.email,
      company: c.company,
      phone: c.phone,
      siret: c.siret ?? "",
      tvaIntra: c.vatNumber ?? "",
      address: c.addressStreet ?? "",
      postalCode: c.addressZip ?? "",
      city: c.addressCity ?? "",
      country: c.addressCountry ?? "",
      // {days} : vrai nombre de jours d'inactivité du client sélectionné.
      // null (jamais visité) → chaîne vide (le gabarit basculera sur
      // neverVisitedTemplate côté rendu final).
      days: c.daysInactive === null ? "" : String(c.daysInactive),
    };
  }, [scenarioKey, previewClientId, previewClients, boutiqueOverrides]);

  // Blocs dynamiques (cartItems / favoritesGrid / daysInactive) : uniquement
  // disponibles pour les modèles liés au scénario compatible. Les autres
  // sont cachés de la palette pour éviter la confusion.
  const allowedDynamic = useMemo(() => allowedDynamicBlocksFor(scenarioKey), [scenarioKey]);

  // Blocs obligatoires : le bouton « Enregistrer » est verrouillé tant que
  // le modèle n'en contient pas au moins un de chaque type requis.
  // Header + Footer sont OBLIGATOIRES et VERROUILLÉS en position sur tous
  // les modèles marketing (header en 1ᵉʳ, footer en dernier — impossible à
  // déplacer/supprimer).
  const requiredBlocks = useMemo<RequiredBlockSpec[]>(
    () => [
      { type: "header", label: "En-tête" },
      { type: "footer", label: "Pied de page" },
      ...requiredBlocksFor(scenarioKey),
    ],
    [scenarioKey],
  );
  const missingBlocks = useMemo<RequiredBlockSpec[]>(() => {
    const present = new Set<string>(blocks.map((b) => b.type));
    return requiredBlocks.filter((r) => !present.has(r.type));
  }, [requiredBlocks, blocks]);
  // Variables obligatoires manquantes (mentions légales RGPD/LCEN) —
  // vérifiées UNIQUEMENT dans le contenu du bloc « Pied de page ».
  // Si le footer est absent, on considère toutes les variables manquantes
  // (le message « Ajoutez un bloc pied de page » est déjà porté par missingBlocks).
  const missingRequired = useMemo(() => {
    const footerContent = getFooterContent(blocks);
    if (footerContent === null) return missingRequiredMarketingVariables("");
    return missingRequiredMarketingVariables(footerContent);
  }, [blocks]);
  const canSave = missingBlocks.length === 0 && missingRequired.length === 0;
  const visibleBlocksMeta = useMemo(
    () =>
      BLOCKS_META.filter((b) => {
        const isDynamic = b.key === "cartItems" || b.key === "favoritesGrid" || b.key === "daysInactive";
        return isDynamic ? allowedDynamic.has(b.key) : true;
      }),
    [allowedDynamic],
  );
  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  const [saving, startSaving] = useTransition();
  const [productsCache, setProductsCache] = useState<Map<string, ProductLite>>(new Map());
  // Si on a auto-ajouté / réordonné le header ou footer à l'ouverture, on
  // marque le modèle comme « modifié » pour inciter la cliente à cliquer
  // Enregistrer — sinon le bouton reste vert « Enregistré » alors que les
  // changements ne sont qu'en mémoire.
  const [dirty, setDirty] = useState(() => initialAutoAdded.current);
  const [leaveModal, setLeaveModal] = useState<{ next: string } | null>(null);

  const selected = selectedId !== null ? blocks.find((b) => b.id === selectedId) : null;

  /** Fichiers en attente d'upload, indexés par blob URL. */
  const pendingFiles = useRef<Map<string, File>>(new Map());
  const registerFile = useCallback((blobUrl: string, file: File) => {
    pendingFiles.current.set(blobUrl, file);
  }, []);

  /**
   * Enregistre le modèle : upload d'abord toutes les images en attente,
   * remplace les blob URLs par les paths serveur, puis save en BDD.
   * Retourne true si tout s'est bien passé.
   */
  const persist = useCallback(async (): Promise<boolean> => {
    const usedBlobUrls = collectBlobUrls(blocks);
    const uploaded = new Map<string, string>();
    try {
      for (const blobUrl of usedBlobUrls) {
        const file = pendingFiles.current.get(blobUrl);
        if (!file) continue; // déjà uploadée précédemment ou blob perdu
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch("/api/admin/newsletter-image", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload image échoué");
        uploaded.set(blobUrl, json.path as string);
      }
    } catch (err) {
      toast.error("Enregistrement échoué", (err as Error).message);
      return false;
    }

    const finalBlocks = replaceBlobUrls(blocks, uploaded);
    const res = await updateNewsletterTemplate(template.id, {
      name,
      subject,
      blocks: finalBlocks,
    });
    if (!res.success) {
      toast.error("Enregistrement échoué", res.error);
      return false;
    }

    // Cleanup : révoque les blob URLs uploadés, met à jour les blocs
    setBlocks(finalBlocks);
    for (const url of uploaded.keys()) {
      try { URL.revokeObjectURL(url); } catch {}
      pendingFiles.current.delete(url);
    }
    setDirty(false);
    return true;
  }, [blocks, name, subject, template.id, toast]);

  const handleSaveClick = useCallback(() => {
    startSaving(async () => {
      const ok = await persist();
      if (ok) toast.success("Modèle enregistré");
    });
  }, [persist, toast]);

  const stage = useCallback((next: NewsletterBlock[]) => {
    setBlocks(next);
    setDirty(true);
  }, []);

  // ─── Guard : bloque la fermeture d'onglet / rechargement si dirty ───
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const requestLeave = useCallback((href: string) => {
    if (!dirty) {
      router.push(href);
      return;
    }
    setLeaveModal({ next: href });
  }, [dirty, router]);

  const leaveWithoutSaving = useCallback(() => {
    // Libère la mémoire des blob URLs orphelins
    for (const url of pendingFiles.current.keys()) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    pendingFiles.current.clear();
    setDirty(false);
    const href = leaveModal?.next ?? backUrl;
    setLeaveModal(null);
    if (onLeave) onLeave();
    else router.push(href);
  }, [leaveModal, router, backUrl, onLeave]);

  const saveAndLeave = useCallback(() => {
    startSaving(async () => {
      const ok = await persist();
      if (!ok) return;
      const href = leaveModal?.next ?? backUrl;
      setLeaveModal(null);
      if (onLeave) onLeave();
      else router.push(href);
    });
  }, [persist, leaveModal, router, backUrl, onLeave]);

  // Compat legacy : quelques callbacks utilisaient `commit` ; on garde l'alias.
  const commit = stage;

  function makeBlock(type: NewsletterBlockType): NewsletterBlock {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      data: defaultDataFor(type),
    } as NewsletterBlock;
  }

  /**
   * Bornes autorisées pour insérer un nouveau bloc : jamais avant le header
   * (position 0) ni après le footer (position N-1). Retourne [min, max]
   * inclusifs — max = index où on peut splice, càd juste avant le footer.
   */
  function insertBounds(list: NewsletterBlock[]): { min: number; max: number } {
    let min = 0;
    let max = list.length;
    if (list[0]?.type === "header") min = 1;
    if (list[list.length - 1]?.type === "footer") max = list.length - 1;
    if (max < min) max = min;
    return { min, max };
  }

  function addBlock(type: NewsletterBlockType) {
    const newBlock = makeBlock(type);
    const { max } = insertBounds(blocks);
    // Insertion juste avant le footer (ou en fin si pas de footer, cas rare).
    const next = [...blocks];
    next.splice(max, 0, newBlock);
    setSelectedId(newBlock.id);
    commit(next);
  }

  function insertBlockAt(type: NewsletterBlockType, index: number) {
    const newBlock = makeBlock(type);
    const next = [...blocks];
    const { min, max } = insertBounds(next);
    const safe = Math.max(min, Math.min(max, index));
    next.splice(safe, 0, newBlock);
    setSelectedId(newBlock.id);
    commit(next);
  }

  function deleteBlock(id: number | string) {
    // Header et Footer sont obligatoires et verrouillés en position — refus
    // de suppression. La cliente peut les personnaliser mais pas les retirer.
    const target = blocks.find((b) => b.id === id);
    if (target?.type === "header") {
      toast.error(
        "Impossible de supprimer l'en-tête",
        "L'en-tête est obligatoire et toujours en haut du mail. Vous pouvez le personnaliser depuis les réglages du bloc.",
      );
      return;
    }
    if (target?.type === "footer") {
      toast.error(
        "Impossible de supprimer le pied de page",
        "Il contient les mentions légales obligatoires ({shopName}, {shopAddress}, {unsubscribeLink}, {privacyLink}). Vous pouvez le modifier depuis les réglages du bloc.",
      );
      return;
    }
    const next = blocks.filter((b) => b.id !== id);
    if (selectedId === id) setSelectedId(null);
    commit(next);
  }

  function updateBlockData<K extends string>(id: number | string, key: K, value: unknown) {
    const next = blocks.map((b) => {
      if (b.id !== id) return b;
      return { ...b, data: { ...b.data, [key]: value } } as NewsletterBlock;
    });
    commit(next);
  }

  // Charge en fond les produits référencés par les blocs « Grille produits »
  // pour l'aperçu. Un seul useEffect qui observe la liste d'IDs — pas de
  // side-effect pendant le rendu (bug React « setState in render »).
  useEffect(() => {
    const allIds = blocks
      .filter((b): b is Extract<NewsletterBlock, { type: "products" }> => b.type === "products")
      .flatMap((b) => b.data.productIds);
    const missing = allIds.filter((id) => !productsCache.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const all = await searchProductsForNewsletter("");
      if (cancelled) return;
      setProductsCache((prev) => {
        const next = new Map(prev);
        for (const p of all) next.set(p.id, p);
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [blocks, productsCache]);

  const orderedIds = blocks.map((b) => String(b.id));
  // Header et footer sont VERROUILLÉS en position (haut / bas) — non
  // déplaçables, non droppables (aucun autre bloc ne peut passer avant le
  // header ou après le footer).
  const lockedBlockIds = useMemo(() => {
    const set = new Set<string>();
    for (const b of blocks) {
      if (b.type === "header" || b.type === "footer") set.add(String(b.id));
    }
    return set;
  }, [blocks]);
  const drag = useDragReorder({
    orderedIds,
    isLocked: (id) => lockedBlockIds.has(id),
    onReorder: (newOrder) => {
      const byId = new Map(blocks.map((b) => [String(b.id), b]));
      const next = newOrder.map((id) => byId.get(id)!).filter(Boolean);
      commit(next);
    },
  });

  // Drag depuis la palette : on distingue via le type MIME dataTransfer.
  // paletteHover pointe vers l'index où le nouveau bloc s'insérerait.
  const [paletteHover, setPaletteHover] = useState<{ index: number; pos: "above" | "below" } | null>(null);
  const paletteDropIndicator = (blockIndex: number): string => {
    if (!paletteHover || paletteHover.index !== blockIndex) return "";
    return paletteHover.pos === "above"
      ? "before:content-[''] before:absolute before:left-2 before:right-2 before:-top-0.5 before:h-[3px] before:rounded before:bg-emerald-500 before:shadow-[0_0_0_2px_rgba(255,255,255,.9)] before:pointer-events-none"
      : "after:content-[''] after:absolute after:left-2 after:right-2 after:-bottom-0.5 after:h-[3px] after:rounded after:bg-emerald-500 after:shadow-[0_0_0_2px_rgba(255,255,255,.9)] after:pointer-events-none";
  };

  function handlePaletteDragOver(e: React.DragEvent, blockIndex: number) {
    if (!e.dataTransfer.types.includes("application/x-newsletter-type")) return false;
    // Refuse le survol de drop sur header + footer (positions verrouillées).
    const target = blocks[blockIndex];
    if (target?.type === "header" || target?.type === "footer") return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    setPaletteHover({ index: blockIndex, pos: above ? "above" : "below" });
    return true;
  }

  function handlePaletteDrop(e: React.DragEvent, blockIndex: number) {
    if (!e.dataTransfer.types.includes("application/x-newsletter-type")) return false;
    const target = blocks[blockIndex];
    if (target?.type === "header" || target?.type === "footer") return false;
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-newsletter-type") as NewsletterBlockType;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    const insertAt = above ? blockIndex : blockIndex + 1;
    setPaletteHover(null);
    if (type) insertBlockAt(type, insertAt);
    return true;
  }

  function handlePaletteDropAtEnd(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("application/x-newsletter-type")) return;
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-newsletter-type") as NewsletterBlockType;
    setPaletteHover(null);
    if (!type) return;
    // Insertion « en fin » = juste avant le footer (jamais après).
    const { max } = insertBounds(blocks);
    insertBlockAt(type, max);
  }

  function handlePaletteDragOverEnd(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("application/x-newsletter-type")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const { max } = insertBounds(blocks);
    setPaletteHover({ index: max, pos: "above" });
  }

  return (
    <RegisterFileContext.Provider value={registerFile}>
    <ActiveInputContext.Provider value={activeInputContextValue}>
    <div className="h-[calc(100vh-80px)] flex flex-col">
      {leaveModal && (
        <LeaveConfirmModal
          onCancel={() => setLeaveModal(null)}
          onLeave={leaveWithoutSaving}
          onSaveAndLeave={saveAndLeave}
          saving={saving}
        />
      )}
      <div className="bg-bg-primary border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              // En mode modale, requestLeave utilise le callback onLeave via
              // leaveWithoutSaving/saveAndLeave — la modale « quitter sans
              // enregistrer » s'affiche quand même si dirty=true.
              requestLeave(backUrl);
            }}
            className="text-xs font-body font-semibold text-text-secondary hover:text-text-primary shrink-0"
          >
            ← Retour
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            className="flex-1 min-w-0 font-heading font-bold text-lg text-text-primary bg-transparent focus:outline-none border-b border-transparent focus:border-slate-300"
            placeholder="Nom du modèle"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <GlobalVariableButton scenario={scenarioKey} />
          {dirty && (
            <span className="text-[11px] font-body text-amber-700 font-medium inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Modifications non enregistrées
            </span>
          )}
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={saving || !dirty || !canSave}
            title={
              !canSave
                ? [
                    missingBlocks.length > 0 ? `Blocs manquants : ${missingBlocks.map((b) => b.label).join(" · ")}` : "",
                    missingRequired.length > 0 ? `Variables manquantes : ${missingRequired.map((v) => `{${v.token}}`).join(" · ")}` : "",
                  ]
                    .filter(Boolean)
                    .join("  |  ")
                : undefined
            }
            className={`px-4 py-2 rounded-lg text-xs font-body font-bold shadow-sm transition-all inline-flex items-center gap-1.5 ${
              !canSave
                ? "bg-red-100 text-red-700 border border-red-300 cursor-not-allowed"
                : !dirty
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                  : "bg-gradient-to-br from-emerald-600 to-emerald-700 text-white hover:opacity-90 disabled:opacity-60"
            }`}
          >
            {saving ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Enregistrement…
              </>
            ) : !canSave ? (
              <>🔒 Bloc requis manquant</>
            ) : !dirty ? (
              <>✓ Enregistré</>
            ) : (
              <>💾 Enregistrer</>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-12 gap-3 p-3 bg-slate-100">

        <aside className="col-span-3 bg-bg-primary rounded-2xl border border-border overflow-hidden flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">Sujet du mail</div>
            <input
              ref={subjectRef}
              type="text"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setDirty(true); }}
              onFocus={(e) => registerActiveInput({
                element: e.currentTarget,
                getValue: () => subject,
                setValue: (v) => { setSubject(v); setDirty(true); },
              })}
              placeholder="Ce que verra le client dans sa boîte…"
              className="mt-2 w-full px-3 py-2 rounded-lg border border-border bg-bg-primary text-[13px] focus:outline-none focus:border-slate-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Section 1 : Blocs obligatoires (uniquement si scénario + au moins un requis) */}
            {requiredBlocks.length > 0 && (
              <details open className="group rounded-xl border border-red-200 bg-red-50/40 overflow-hidden">
                <summary className="cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-2 bg-red-100/60 hover:bg-red-100 transition">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-red-700 transition-transform group-open:rotate-90">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    <span className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-red-800">
                      Blocs obligatoires
                    </span>
                    <span className="text-[10px] font-body font-bold text-red-700 bg-white/60 border border-red-200 rounded-full px-1.5">
                      {requiredBlocks.length}
                    </span>
                  </div>
                </summary>
                <div className="p-2 space-y-2">
                  {visibleBlocksMeta
                    .filter((b) => requiredBlocks.some((r) => r.type === b.key))
                    .map((b) => {
                      const alreadyPresent = blocks.some((existing) => existing.type === b.key);
                      return renderPaletteBlock(
                        b,
                        selected?.type === b.key,
                        addBlock,
                        () => setPaletteHover(null),
                        alreadyPresent, // désactive drag + bouton Ajouter
                      );
                    })}
                </div>
              </details>
            )}

            {/* Section 2 : Blocs disponibles (tous les autres) */}
            <details open className="group rounded-xl border border-border bg-bg-primary overflow-hidden">
              <summary className="cursor-pointer select-none px-3 py-2 flex items-center justify-between gap-2 bg-bg-secondary/50 hover:bg-bg-secondary transition">
                <div className="flex items-center gap-2 min-w-0">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-text-secondary transition-transform group-open:rotate-90">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  <span className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-secondary">
                    Blocs disponibles
                  </span>
                </div>
                <span className="text-[10px] text-text-muted">Glissez ou +&nbsp;Ajouter</span>
              </summary>
              <div className="p-2 space-y-2">
                {visibleBlocksMeta
                  .filter((b) => !requiredBlocks.some((r) => r.type === b.key))
                  .map((b) => renderPaletteBlock(b, selected?.type === b.key, addBlock, () => setPaletteHover(null)))}
              </div>
            </details>
          </div>
        </aside>

        <main className="col-span-6 bg-bg-primary rounded-2xl border border-border overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-border bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-[12px] text-text-muted">
              Aperçu — largeur 600 px. Glissez un bloc pour le réorganiser.
            </span>
            <PreviewTargetBar
              clients={previewClients}
              selectedClientId={previewClientId}
              onSelectClient={setPreviewClientId}
              adminSelfEmail={adminSelfEmail}
              scenarioKey={scenarioKey}
              sending={sendingTest}
              onSendTest={async (targetValue) => {
                if (sendingTest) return;
                setSendingTest(true);
                try {
                  // L'éditeur auto-ajoute header + footer en mémoire à
                  // l'ouverture — sans sauvegarde préalable, la BDD peut ne
                  // pas les contenir et le mail de test partirait sans
                  // en-tête ni pied de page. On persiste d'abord (idempotent
                  // si déjà propre), puis on envoie sur les blocs à jour.
                  if (dirty) {
                    const saved = await persist();
                    if (!saved) return; // toast déjà affiché par persist()
                  }
                  const recipient =
                    targetValue === SELF_TARGET
                      ? { kind: "self" as const }
                      : { kind: "client" as const, userId: targetValue };
                  const res = await sendTestNewsletterEmail({
                    templateId: template.id,
                    recipient,
                  });
                  if (res.success) {
                    toast.success(
                      "Test envoyé",
                      `Un aperçu du mail a été envoyé à ${res.sentTo}.`,
                    );
                  } else {
                    toast.error("Envoi impossible", res.error);
                  }
                } finally {
                  setSendingTest(false);
                }
              }}
            />
          </div>
          <div
            className="mail-preview-light flex-1 overflow-y-auto py-6 pl-6 pr-16"
            style={{ background: "#f1f5f9" }}
          >
            {/* Wrapper overflow-visible : les boutons drag/corbeille de
                BlockCanvas sont positionnés à `-right-11` (44 px hors du
                bloc). Un overflow-hidden ici les rognerait — c'était le bug
                de septembre 2026 où on ne voyait plus les 2 boutons sur les
                blocs. La marge `pr-16` du conteneur de scroll leur réserve
                déjà 64 px de place à droite. Coins arrondis : rétablis sur le
                1ᵉʳ enfant (header) et l'avant-dernier (footer, avant la drop
                zone `h-3`) via sélecteurs CSS. Buttons header/footer sont
                verrouillés (grisés) → OK de les clipper. */}
            <div
              className="max-w-[600px] mx-auto rounded-lg shadow-sm [&>*:first-child]:rounded-t-lg [&>*:first-child]:overflow-hidden [&>*:nth-last-child(2)]:rounded-b-lg [&>*:nth-last-child(2)]:overflow-hidden"
              style={{ background: "#ffffff" }}
            >
              {/* Sélection : ring-inset (à l'intérieur du bloc) reste visible
                  même sur le 1ᵉʳ et le dernier bloc. */}
              {blocks.length === 0 ? (
                <div
                  className="p-16 text-center text-text-muted text-sm border-2 border-dashed border-slate-300 rounded-lg m-4"
                  onDragOver={handlePaletteDragOverEnd}
                  onDrop={handlePaletteDropAtEnd}
                  onDragLeave={() => setPaletteHover(null)}
                >
                  Ajoute un bloc depuis la palette de gauche — clique ou glisse-le ici.
                </div>
              ) : (
                <>
                  {blocks.map((b, i) => (
                    <BlockCanvas
                      key={b.id}
                      block={b}
                      isSelected={selectedId === b.id}
                      onSelect={() => setSelectedId(b.id)}
                      onDelete={() => deleteBlock(b.id)}
                      productsCache={productsCache}
                      dragBinding={drag.bind(String(b.id))}
                      dropIndicator={`${dropIndicatorClass(drag.overId, drag.overPos, String(b.id))} ${paletteDropIndicator(i)}`}
                      isDragging={drag.dragId === String(b.id)}
                      onPaletteDragOver={(e) => handlePaletteDragOver(e, i)}
                      onPaletteDrop={(e) => handlePaletteDrop(e, i)}
                      onPaletteDragLeave={() => setPaletteHover(null)}
                      previewContext={previewContext}
                      previewCart={previewCart}
                    />
                  ))}
                  {/* Zone de drop finale visible pendant un drag depuis palette */}
                  <div
                    className={`h-3 mx-2 rounded transition-all ${paletteHover?.index === blocks.length ? "bg-emerald-500 h-[8px] my-1" : ""}`}
                    onDragOver={handlePaletteDragOverEnd}
                    onDrop={handlePaletteDropAtEnd}
                    onDragLeave={() => setPaletteHover(null)}
                  />
                </>
              )}

            </div>
          </div>
        </main>

        <aside className="col-span-3 bg-bg-primary rounded-2xl border border-border overflow-hidden flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-text-muted">Réglages du bloc</div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!selected ? (
              <div className="text-center py-8 text-text-muted text-[13px]">
                Sélectionne un bloc dans l&apos;aperçu pour voir ses réglages.
              </div>
            ) : (
              <BlockSettings block={selected} onUpdate={(k, v) => updateBlockData(selected.id, k, v)} scenarioKey={scenarioKey} />
            )}
          </div>
        </aside>
      </div>
    </div>
    </ActiveInputContext.Provider>
    </RegisterFileContext.Provider>
  );
}

/**
 * Modale à 3 choix quand la cliente clique « Retour » (ou toute nav interne)
 * avec des modifications non enregistrées.
 * Le beforeunload du navigateur couvre déjà la fermeture d'onglet.
 */
function LeaveConfirmModal({
  onCancel,
  onLeave,
  onSaveAndLeave,
  saving,
}: {
  onCancel: () => void;
  onLeave: () => void;
  onSaveAndLeave: () => void;
  saving: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={() => !saving && onCancel()}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-bg-primary shadow-2xl border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border bg-gradient-to-br from-amber-50 to-bg-primary">
          <div className="text-[10px] uppercase tracking-[0.18em] font-body font-bold text-amber-800 mb-2">
            ⚠ Attention
          </div>
          <h3 className="font-heading font-bold text-lg text-text-primary">
            Modifications non enregistrées
          </h3>
          <p className="text-sm font-body text-text-secondary mt-1.5 leading-relaxed">
            Vous avez des changements qui n&apos;ont pas encore été sauvegardés. Que voulez-vous faire ?
          </p>
        </div>
        <div className="p-4 flex flex-col sm:flex-row gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2.5 rounded-lg text-sm font-body font-semibold text-text-secondary hover:bg-bg-secondary border border-border transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onLeave}
            disabled={saving}
            className="px-4 py-2.5 rounded-lg text-sm font-body font-semibold text-red-700 hover:bg-red-50 border border-red-200 transition-colors disabled:opacity-50"
          >
            Quitter sans enregistrer
          </button>
          <button
            type="button"
            onClick={onSaveAndLeave}
            disabled={saving}
            className="px-4 py-2.5 rounded-lg text-sm font-body font-bold bg-gradient-to-br from-emerald-600 to-emerald-700 text-white shadow-sm hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Enregistrement…
              </>
            ) : (
              <>💾 Enregistrer et quitter</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockCanvas({
  block,
  isSelected,
  onSelect,
  onDelete,
  productsCache,
  dragBinding,
  dropIndicator,
  isDragging,
  onPaletteDragOver,
  onPaletteDrop,
  onPaletteDragLeave,
  previewContext,
  previewCart,
}: {
  block: NewsletterBlock;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  productsCache: Map<string, ProductLite>;
  dragBinding: ReturnType<ReturnType<typeof useDragReorder>["bind"]>;
  dropIndicator: string;
  isDragging: boolean;
  onPaletteDragOver: (e: React.DragEvent) => void;
  onPaletteDrop: (e: React.DragEvent) => void;
  onPaletteDragLeave: () => void;
  previewContext: Record<string, string | undefined>;
  previewCart: PreviewCart | null;
}) {
  // On combine les handlers : palette (nouveau bloc) prioritaire sur reorder (bloc existant).
  const combinedOnDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-newsletter-type")) {
      onPaletteDragOver(e);
      return;
    }
    dragBinding.onDragOver(e);
  };
  const combinedOnDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-newsletter-type")) {
      onPaletteDrop(e);
      return;
    }
    dragBinding.onDrop(e);
  };
  const combinedOnDragLeave = (e: React.DragEvent) => {
    onPaletteDragLeave();
    dragBinding.onDragLeave(e);
  };

  return (
    <div
      draggable={dragBinding.draggable}
      onDragStart={dragBinding.onDragStart}
      onDragEnd={dragBinding.onDragEnd}
      onDragOver={combinedOnDragOver}
      onDragLeave={combinedOnDragLeave}
      onDrop={combinedOnDrop}
      className={`relative group ${isDragging ? "opacity-40" : ""} ${dropIndicator}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Boutons drag + supprimer — POSITIONNÉS À L'EXTÉRIEUR DROIT du bloc,
          centrés verticalement. Le parent (`.max-w-[600px]`) n'a plus
          d'overflow-hidden ; la zone d'aperçu réserve pr-16 pour l'espace. */}
      <div className={`absolute -right-11 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1.5 ${isSelected ? "" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
        {block.type === "header" || block.type === "footer" ? (
          <div
            className="h-9 w-9 rounded-lg bg-slate-300 text-white flex items-center justify-center shadow-md cursor-not-allowed opacity-70"
            title={block.type === "header"
              ? "En-tête verrouillé — toujours en haut, non déplaçable"
              : "Pied de page verrouillé — toujours en bas, non déplaçable"}
          >
            <svg width="14" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </svg>
          </div>
        ) : (
          <div
            className="h-9 w-9 rounded-lg bg-slate-800 hover:bg-slate-900 text-white flex items-center justify-center shadow-md cursor-grab active:cursor-grabbing"
            title="Glissez pour réorganiser ce bloc"
          >
            <svg width="14" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.8" />
              <circle cx="9" cy="12" r="1.8" />
              <circle cx="9" cy="18" r="1.8" />
              <circle cx="15" cy="6" r="1.8" />
              <circle cx="15" cy="12" r="1.8" />
              <circle cx="15" cy="18" r="1.8" />
            </svg>
          </div>
        )}
        {block.type === "header" || block.type === "footer" ? (
          <div
            className="h-9 w-9 rounded-lg bg-slate-300 text-white flex items-center justify-center shadow-md cursor-not-allowed opacity-70"
            title={block.type === "header"
              ? "L'en-tête est obligatoire — il ne peut pas être supprimé."
              : "Le pied de page est obligatoire — il ne peut pas être supprimé."}
            aria-label="Suppression verrouillée"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </svg>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="h-9 w-9 rounded-lg bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-md"
            title="Supprimer ce bloc"
            aria-label="Supprimer"
            draggable={false}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        )}
      </div>
      <BlockRender block={block} productsCache={productsCache} previewContext={previewContext} previewCart={previewCart} />
      {/* Calque overlay pour la bordure de sélection / survol. Placé au-dessus
          du contenu du bloc (BlockRender) via z-[2] pour rester visible même
          quand le bloc a un fond opaque plein (header, footer, callout…).
          `pointer-events-none` pour ne pas voler les clics au bloc. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-[2] rounded-[inherit] transition ${
          isSelected
            ? "shadow-[inset_0_0_0_2px_#ffffff,inset_0_0_0_4px_#7c3aed]"
            : "group-hover:shadow-[inset_0_0_0_2px_#cbd5e1]"
        }`}
      />
    </div>
  );
}

function BlockRender({
  block,
  productsCache,
  previewContext,
  previewCart,
}: {
  block: NewsletterBlock;
  productsCache: Map<string, ProductLite>;
  previewContext: Record<string, string | undefined>;
  previewCart: PreviewCart | null;
}) {
  const t = (s: string | undefined | null) => interpolate(s ?? "", previewContext);
  // Rendu React qui préserve les retours à la ligne saisis dans les inputs :
  // remplace chaque `\n` par un vrai <br/> dans le JSX. Mirroir de
  // escapeHtmlWithBreaks() côté serveur.
  const tBr = (s: string | undefined | null): React.ReactNode => {
    const text = interpolate(s ?? "", previewContext);
    const lines = text.split(/\r?\n/);
    return lines.map((line, i) => (
      <React.Fragment key={i}>
        {i > 0 && <br />}
        {line}
      </React.Fragment>
    ));
  };
  const s: React.CSSProperties = { fontFamily: "Roboto, sans-serif" };
  const bg = "bg" in block.data ? (block.data as { bg?: string }).bg : undefined;

  switch (block.type) {
    case "banner": {
      const h = block.data.height ? Math.max(60, Math.min(600, block.data.height)) : null;
      const fit: React.CSSProperties["objectFit"] = block.data.fit === "contain" ? "contain" : "cover";
      return (
        <div style={{ background: bg || "transparent" }}>
          {block.data.img ? (
            <img
              src={block.data.img}
              alt={block.data.alt}
              draggable={false}
              style={{ ...s, width: "100%", display: "block", ...(h ? { height: h, objectFit: fit } : {}) }}
            />
          ) : (
            <div style={{ ...s, height: h || 140, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>
              Choisis une image dans les réglages
            </div>
          )}
        </div>
      );
    }
    case "header": {
      const hBg = block.data.bg || "#0f172a";
      const color = block.data.textColor || "#ffffff";
      const align = (block.data.align || "center") as React.CSSProperties["textAlign"];
      const logoMax = Math.max(20, Math.min(160, block.data.logoMaxHeight || 60));
      const hasTitle = (block.data.title || "").trim().length > 0;
      const hasSubtitle = (block.data.subtitle || "").trim().length > 0;
      const hasLogo = !!block.data.logo;
      const isEmpty = !hasLogo && !hasTitle && !hasSubtitle;
      const titleFontFamily = block.data.titleFontFamily === "serif"
        ? "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
        : "Poppins";
      const hasRule = hasTitle && !!block.data.decorativeRule;
      const ruleColor = block.data.ruleColor || color;
      const letterSpacing = block.data.subtitleLetterSpacing
        ? `${block.data.subtitleLetterSpacing / 100}em`
        : undefined;
      const textTransform: React.CSSProperties["textTransform"] = block.data.subtitleUppercase ? "uppercase" : undefined;
      return (
        <div style={{ ...s, background: hBg, padding: "36px 24px", textAlign: align, color }}>
          {hasLogo && (
            <div style={{ marginBottom: 14 }}>
              <img src={block.data.logo} alt="" draggable={false} style={{ maxHeight: logoMax, display: "inline-block", border: 0 }} />
            </div>
          )}
          {hasTitle && (
            <h1 style={{ fontFamily: titleFontFamily, fontSize: block.data.titleSize || 22, fontWeight: 700, margin: 0, color, letterSpacing: "0.02em", wordBreak: "break-word", overflowWrap: "break-word" }}>{tBr(block.data.title)}</h1>
          )}
          {hasRule && (
            <div style={{ display: "flex", justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center", margin: hasSubtitle ? "12px 0" : "12px 0 0" }}>
              <div style={{ width: 48, height: 1, background: ruleColor }} />
            </div>
          )}
          {hasSubtitle && (
            <div style={{ fontSize: block.data.subtitleSize || 13, marginTop: hasTitle && !hasRule ? 8 : 0, color, opacity: 0.85, letterSpacing, textTransform, wordBreak: "break-word", overflowWrap: "break-word" }}>{tBr(block.data.subtitle)}</div>
          )}
          {isEmpty && (
            <div style={{ color, opacity: 0.55, fontSize: 12 }}>En-tête vide — renseigne logo, titre ou sous-titre dans les réglages.</div>
          )}
        </div>
      );
    }
    case "heading": {
      const hasBody = (block.data.body || "").trim().length > 0;
      const hasTitle = (block.data.title || "").trim().length > 0;
      const titleAlign = (block.data.titleAlign ?? block.data.align ?? "left") as React.CSSProperties["textAlign"];
      const bodyAlign = (block.data.bodyAlign ?? block.data.align ?? "left") as React.CSSProperties["textAlign"];
      return (
        <div style={{ ...s, padding: "24px 20px", background: block.data.bg || "transparent" }}>
          {hasTitle && (
            <h2 style={{ fontFamily: "Poppins", fontSize: block.data.titleSize || 20, fontWeight: 700, color: block.data.titleColor || "#0f172a", margin: hasBody ? "0 0 10px" : "0", textAlign: titleAlign, wordBreak: "break-word", overflowWrap: "break-word" }}>{tBr(block.data.title)}</h2>
          )}
          {hasBody && (
            <p style={{ fontSize: block.data.bodySize || 13, color: block.data.bodyColor || "#475569", lineHeight: 1.6, margin: 0, textAlign: bodyAlign, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}>{t(block.data.body)}</p>
          )}
          {!hasTitle && !hasBody && (
            <div style={{ color: "#cbd5e1", fontSize: 12 }}>Titre et texte vides — renseigne au moins l&apos;un dans les réglages.</div>
          )}
        </div>
      );
    }
    case "callout":
      return (
        <div style={{ ...s, background: block.data.wrapperBg || "transparent" }}>
          <div style={{ padding: "12px 20px" }}>
            <div style={{ background: block.data.bg, color: block.data.color, padding: 20, borderRadius: 14, textAlign: "center" }}>
              <div style={{ fontFamily: "Poppins", fontSize: block.data.titleSize || 16, fontWeight: 700, marginBottom: 6, wordBreak: "break-word", overflowWrap: "break-word" }}>{tBr(block.data.title)}</div>
              <div style={{ fontSize: block.data.subtitleSize || 13, opacity: 0.85, marginBottom: 14, wordBreak: "break-word", overflowWrap: "break-word" }}>{tBr(block.data.subtitle)}</div>
              <span style={{ display: "inline-block", background: "white", color: block.data.bg, padding: "8px 20px", borderRadius: 999, fontWeight: 600, fontSize: block.data.ctaSize || 12, wordBreak: "break-word", overflowWrap: "break-word", maxWidth: "100%" }}>{tBr(block.data.cta)}</span>
            </div>
          </div>
        </div>
      );
    case "button":
      return (
        <div style={{ ...s, background: block.data.wrapperBg || "transparent" }}>
          <div style={{ padding: "12px 20px", textAlign: block.data.align || "center" }}>
            <span style={{ display: "inline-block", background: block.data.bg, color: block.data.color, padding: "12px 28px", borderRadius: 10, fontFamily: "Poppins", fontWeight: 600, fontSize: block.data.labelSize || 13, wordBreak: "break-word", overflowWrap: "break-word", maxWidth: "100%" }}>{tBr(block.data.label)} →</span>
          </div>
        </div>
      );
    case "products": {
      if (block.data.productIds.length === 0) {
        return <div style={{ ...s, padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12, background: bg || "transparent" }}>Aucun produit sélectionné — choisis-en dans les réglages.</div>;
      }
      const products = block.data.productIds.map((id) => productsCache.get(id)).filter(Boolean) as ProductLite[];
      const cols = block.data.cols;
      return (
        <div style={{ ...s, padding: "12px 20px", display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8, background: bg || "transparent" }}>
          {products.map((p) => (
            <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
              {p.imagePath ? (
                <img src={p.imagePath} alt="" draggable={false} style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{ height: 100, background: "#f1f5f9" }} />
              )}
              <div style={{ padding: 8, textAlign: "center" }}>
                <div style={{ fontFamily: "Poppins", fontSize: 11, fontWeight: 600, color: "#0f172a" }}>{p.name}</div>
                {p.priceCents !== null && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{(p.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "imgtext": {
      const side = block.data.side;
      const isVertical = side === "top" || side === "bottom";
      const flexDir: React.CSSProperties["flexDirection"] =
        side === "left" ? "row" : side === "right" ? "row-reverse" : side === "top" ? "column" : "column-reverse";
      const imgW = Math.max(20, Math.min(100, block.data.imgWidth || 45));
      const titleAlign = (block.data.titleAlign ?? block.data.textAlign ?? "left") as React.CSSProperties["textAlign"];
      const bodyAlign = (block.data.bodyAlign ?? block.data.textAlign ?? "left") as React.CSSProperties["textAlign"];
      const imgEl = block.data.img
        ? <img src={block.data.img} alt="" draggable={false} style={{ width: "100%", borderRadius: 8, display: "block" }} />
        : <div style={{ height: 100, background: "#f1f5f9", borderRadius: 8 }} />;
      return (
        <div style={{ ...s, padding: "12px 20px", display: "flex", gap: 12, flexDirection: flexDir, background: block.data.bg || "transparent", alignItems: isVertical ? "center" : undefined }}>
          <div style={{ width: isVertical ? `${imgW}%` : `${imgW}%` }}>{imgEl}</div>
          <div style={{ flex: 1, width: isVertical ? "100%" : undefined }}>
            <div style={{ fontFamily: "Poppins", fontSize: block.data.titleSize || 15, fontWeight: 700, color: block.data.titleColor || "#0f172a", marginBottom: 6, textAlign: titleAlign, wordBreak: "break-word", overflowWrap: "break-word" }}>{tBr(block.data.title)}</div>
            <div style={{ fontSize: block.data.bodySize || 13, color: block.data.bodyColor || "#475569", lineHeight: 1.6, whiteSpace: "pre-wrap", textAlign: bodyAlign, wordBreak: "break-word", overflowWrap: "break-word" }}>{t(block.data.body)}</div>
          </div>
        </div>
      );
    }
    case "list":
      return (
        <ul style={{ ...s, padding: "12px 20px", listStyle: "none", margin: 0, background: block.data.bg || "transparent" }}>
          {block.data.items.map((it, i) => (
            <li key={i} style={{ padding: "6px 0", fontSize: block.data.itemSize || 14, color: block.data.color || "#334155", borderBottom: "1px solid #f1f5f9", wordBreak: "break-word", overflowWrap: "break-word" }}>{t(it)}</li>
          ))}
        </ul>
      );
    case "empty":
      return (
        <div
          style={{
            ...s,
            height: Math.max(4, Math.min(400, block.data.height || 40)),
            background: block.data.bg || "transparent",
          }}
        />
      );
    case "columns": {
      const cols = block.data.cols;
      const columns = block.data.columns.slice(0, cols);
      while (columns.length < cols) columns.push({ kind: "text", text: "" });
      return (
        <div style={{ ...s, padding: "12px 20px", display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, background: block.data.bg || "transparent" }}>
          {columns.map((col, i) => (
            <div key={i}>
              {col.kind === "image" ? (
                col.img ? <img src={col.img} alt="" draggable={false} style={{ width: "100%", borderRadius: 8, display: "block" }} /> : <div style={{ height: 90, background: "#f1f5f9", borderRadius: 8 }} />
              ) : (
                <div style={{ fontSize: 13, color: block.data.color || "#334155", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{col.text ? t(col.text) : <span style={{ color: "#cbd5e1" }}>Texte de colonne…</span>}</div>
              )}
            </div>
          ))}
        </div>
      );
    }
    case "featuresRow": {
      const items = block.data.items || [];
      const circleSize = Math.max(24, Math.min(120, block.data.circleSize || 56));
      const iconSize = Math.max(12, Math.min(60, block.data.iconSize || 22));
      const labelSize = Math.max(9, Math.min(20, block.data.labelSize || 12));
      const circleBg = block.data.circleBg || "#fbf1ee";
      const iconColor = block.data.iconColor || "#5f2231";
      const labelColor = block.data.labelColor || "#2a1418";
      return (
        <div style={{ ...s, padding: "18px 20px", background: block.data.bg || "transparent" }}>
          {items.length === 0 ? (
            <div style={{ color: "#cbd5e1", fontSize: 12, textAlign: "center" }}>Aucune feature — ajoute-en dans les réglages.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 8 }}>
              {items.map((it, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: circleSize, height: circleSize, borderRadius: "50%", background: circleBg, color: iconColor, fontSize: iconSize }}>
                    {it.icon || "★"}
                  </div>
                  <div style={{ marginTop: 8, fontFamily: "Poppins", fontSize: labelSize, color: labelColor, lineHeight: 1.45, whiteSpace: "pre-line" }}>{tBr(it.label)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    case "divider":
      return <hr style={{ ...s, border: "none", borderTop: "1px solid #e2e8f0", margin: "12px 20px" }} />;
    case "footer": {
      const fBg = block.data.bg || "#f8fafc";
      const color = block.data.color || "#64748b";
      const align = (block.data.align || "center") as React.CSSProperties["textAlign"];
      const fontSize = Math.max(9, Math.min(20, block.data.fontSize || 12));
      const content = (block.data.content || "").trim();
      return (
        <div style={{ ...s, background: fBg, color, padding: "20px 24px", textAlign: align, fontSize, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}>
          {content ? tBr(block.data.content) : (
            <span style={{ opacity: 0.55 }}>Pied de page vide — insère les mentions légales dans les réglages.</span>
          )}
        </div>
      );
    }
    case "cartItems": {
      const title = block.data.title?.trim();
      const totalLabel = block.data.totalLabel || "Total";
      const fmtEuro = (cents: number) =>
        (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
      const hasCart = previewCart !== null;
      const items = previewCart?.items ?? [];
      const totalCents = previewCart?.totalCents ?? 0;

      // Cas 1 : le client sélectionné a un panier vide (ou pas encore chargé).
      if (hasCart && items.length === 0) {
        const emptyMsg = (block.data.emptyMessage || "Votre panier est vide.").trim();
        return (
          <div style={{ ...s, padding: "12px 20px", background: block.data.bg || "transparent" }}>
            {title && <div style={{ fontFamily: "Poppins", fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>{title}</div>}
            <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, margin: 0 }}>{emptyMsg}</p>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
              💡 Ce client n&apos;a rien dans son panier — c&apos;est ce texte qui apparaîtra dans le mail.
            </div>
          </div>
        );
      }

      // Cas 2 : pas de client sélectionné (mode « Moi-même » ou chargement) —
      // on retombe sur un aperçu illustratif.
      const displayItems: Array<{ productName: string; colorName: string | null; quantity: number; totalCents: number; imagePath: string | null }> =
        hasCart
          ? items
          : [
              { productName: "Article exemple 1", colorName: null, quantity: 1, totalCents: 0, imagePath: null },
              { productName: "Article exemple 2", colorName: null, quantity: 1, totalCents: 0, imagePath: null },
            ];
      const displayTotal = hasCart ? totalCents : null;

      return (
        <div style={{ ...s, padding: "12px 20px", background: block.data.bg || "transparent" }}>
          {title && <div style={{ fontFamily: "Poppins", fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>{title}</div>}
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: 12 }}>
            {displayItems.map((it, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: i < displayItems.length - 1 ? "1px solid #e2e8f0" : "none" }}>
                {it.imagePath && (
                  <img src={it.imagePath} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#0f172a", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.productName}</div>
                  <div style={{ fontSize: 10.5, color: "#64748b" }}>
                    {it.colorName ? `${it.colorName} · ` : ""}x{it.quantity}
                  </div>
                </div>
                <span style={{ color: "#0f172a", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
                  {displayTotal === null ? "—" : fmtEuro(it.totalCents)}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #cbd5e1", paddingTop: 8, marginTop: 6, fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
              <span>{totalLabel}</span>
              <span>{displayTotal === null ? "—" : fmtEuro(displayTotal)}</span>
            </div>
          </div>
          {!hasCart && (
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
              💡 Sélectionnez un client dans « Aperçu pour » ci-dessus pour voir son vrai panier.
            </div>
          )}
        </div>
      );
    }
    case "favoritesGrid": {
      const cols = block.data.cols || 2;
      return (
        <div style={{ ...s, padding: "12px 20px", background: block.data.bg || "transparent" }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
            {Array.from({ length: cols }).map((_, i) => (
              <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                <div style={{ height: 80, background: "#f1f5f9", borderRadius: 6, marginBottom: 6 }} />
                <div style={{ fontSize: 11, fontFamily: "Poppins", fontWeight: 600, color: "#0f172a" }}>Produit exemple</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>—</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
            💡 Aperçu — les vrais produits sélectionnés seront injectés à l&apos;envoi.
          </div>
        </div>
      );
    }
    case "daysInactive": {
      // Vrai nombre de jours du client sélectionné (via previewContext.days
      // alimenté depuis c.daysInactive = floor((now - lastSeenAt) / 1 jour)).
      // Si vide → jamais visité → gabarit neverVisitedTemplate.
      const daysStr = previewContext.days ?? "";
      const hasDays = daysStr !== "";
      const template = hasDays
        ? (block.data.template || "")
        : (block.data.neverVisitedTemplate || "");
      const rendered = hasDays ? template.replace(/\{days\}/g, daysStr) : template;
      return (
        <div style={{ ...s, padding: "12px 20px", background: block.data.bg || "transparent" }}>
          <p style={{ fontSize: 13, color: block.data.color || "#475569", lineHeight: 1.6, margin: 0 }}>
            {rendered || <span style={{ color: "#cbd5e1" }}>Message vide — renseigne le gabarit dans les réglages.</span>}
          </p>
          <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
            💡 Aperçu {hasDays ? `(${daysStr} jour${daysStr === "1" ? "" : "s"} d'inactivité du client)` : "(jamais visité)"}.
          </div>
        </div>
      );
    }
  }
}

function BlockSettings({
  block,
  onUpdate,
  scenarioKey,
}: {
  block: NewsletterBlock;
  onUpdate: (key: string, value: unknown) => void;
  scenarioKey: ScenarioKey | null;
}) {
  // Enregistre chaque input/textarea comme cible potentielle d'insertion de
  // variable via le bouton global (voir ActiveInputContext).
  const registerActive = useActiveInputRegistrar();
  const fieldProps = (value: string, key: string) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      registerActive({
        element: e.currentTarget,
        getValue: () => value,
        setValue: (v) => onUpdate(key, v),
      }),
  });
  switch (block.type) {
    case "banner":
      return (
        <div className="space-y-3">
          <Field label="Image de la bannière">
            <ImageInput value={block.data.img} onChange={(v) => onUpdate("img", v)} />
          </Field>
          <Field label="Texte alternatif (accessibilité)">
            <input type="text" className="prop-input" value={block.data.alt} onChange={(e) => onUpdate("alt", e.target.value)} />
          </Field>
          <Field label={block.data.height ? `Hauteur fixe (${block.data.height} px)` : "Hauteur — automatique (proportion image)"}>
            <input
              type="range"
              min={0}
              max={600}
              step={10}
              value={block.data.height || 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                onUpdate("height", v === 0 ? undefined : v);
              }}
              className="w-full"
            />
            <div className="text-[10.5px] text-text-muted mt-1">Glisse à zéro pour laisser l&apos;image respirer à sa proportion naturelle.</div>
          </Field>
          {block.data.height ? (
            <Field label="Ajustement quand hauteur fixe">
              <CustomSelect
                value={block.data.fit || "cover"}
                onChange={(v) => onUpdate("fit", v)}
                options={[
                  { value: "cover", label: "Remplir (coupe les bords si besoin)" },
                  { value: "contain", label: "Contenir (voit toute l'image)" },
                ]}
                size="sm"
              />
            </Field>
          ) : null}
          {/* Pas de couleur/dégradé de fond : la bannière est une image pleine
              qui couvre tout le bloc — un fond derrière ne serait visible que
              sous un PNG transparent, cas ultra-rare qui n'a pas mérité un
              réglage supplémentaire dans l'UI. */}
        </div>
      );
    case "heading":
      return (
        <div className="space-y-3">
          <FieldGroup title="Titre">
            <Field label="Texte">
              <WrappingTextInput value={block.data.title} onChange={(v) => onUpdate("title", v)} {...fieldProps(block.data.title, "title")} />
            </Field>
            <AlignField value={block.data.titleAlign ?? block.data.align} onChange={(v) => onUpdate("titleAlign", v)} fallback="left" />
            <Field label="Couleur">
              <ColorPicker value={block.data.titleColor || "#0f172a"} onChange={(c) => onUpdate("titleColor", c)} />
            </Field>
            <SizeField label="Taille" value={block.data.titleSize} onChange={(v) => onUpdate("titleSize", v)} defaultSize={20} min={12} max={40} />
          </FieldGroup>
          <FieldGroup title="Paragraphe (facultatif)">
            <Field label="Texte">
              <textarea rows={4} className="prop-input" value={block.data.body} onChange={(e) => onUpdate("body", e.target.value)} placeholder="Vide pour n'afficher que le titre." {...fieldProps(block.data.body, "body")} />
            </Field>
            <AlignField value={block.data.bodyAlign ?? block.data.align} onChange={(v) => onUpdate("bodyAlign", v)} fallback="left" />
            <Field label="Couleur">
              <ColorPicker value={block.data.bodyColor || "#475569"} onChange={(c) => onUpdate("bodyColor", c)} />
            </Field>
            <SizeField label="Taille" value={block.data.bodySize} onChange={(v) => onUpdate("bodySize", v)} defaultSize={14} />
          </FieldGroup>
          <FieldGroup title="Général">
            <Field label="Fond du bloc">
              <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
            </Field>
          </FieldGroup>
        </div>
      );
    case "callout":
      return (
        <div className="space-y-3">
          <FieldGroup title="Titre">
            <Field label="Texte"><WrappingTextInput value={block.data.title} onChange={(v) => onUpdate("title", v)} {...fieldProps(block.data.title, "title")} /></Field>
            <SizeField label="Taille" value={block.data.titleSize} onChange={(v) => onUpdate("titleSize", v)} defaultSize={16} min={12} max={32} />
          </FieldGroup>
          <FieldGroup title="Sous-titre">
            <Field label="Texte"><WrappingTextInput value={block.data.subtitle} onChange={(v) => onUpdate("subtitle", v)} {...fieldProps(block.data.subtitle, "subtitle")} /></Field>
            <SizeField label="Taille" value={block.data.subtitleSize} onChange={(v) => onUpdate("subtitleSize", v)} defaultSize={13} />
          </FieldGroup>
          <FieldGroup title="Bouton CTA">
            <Field label="Texte du bouton"><WrappingTextInput value={block.data.cta} onChange={(v) => onUpdate("cta", v)} {...fieldProps(block.data.cta, "cta")} /></Field>
            <Field label="Lien"><input type="text" className="prop-input" value={block.data.ctaUrl} onChange={(e) => onUpdate("ctaUrl", e.target.value)} placeholder="https://…" /></Field>
            <SizeField label="Taille" value={block.data.ctaSize} onChange={(v) => onUpdate("ctaSize", v)} defaultSize={13} />
          </FieldGroup>
          <FieldGroup title="Général">
            <Field label="Couleur du cadre">
              <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "#0f172a")} allowEmpty={false} />
            </Field>
            <Field label="Couleur des textes">
              <ColorPicker value={block.data.color} onChange={(c) => onUpdate("color", c)} />
            </Field>
            <Field label="Fond du bloc">
              <BackgroundInput value={block.data.wrapperBg} onChange={(v) => onUpdate("wrapperBg", v ?? "")} />
            </Field>
          </FieldGroup>
        </div>
      );
    case "button":
      return (
        <div className="space-y-3">
          <FieldGroup title="Bouton">
            <Field label="Texte"><WrappingTextInput value={block.data.label} onChange={(v) => onUpdate("label", v)} {...fieldProps(block.data.label, "label")} /></Field>
            <Field label="Lien"><input type="text" className="prop-input" value={block.data.url} onChange={(e) => onUpdate("url", e.target.value)} placeholder="https://…" /></Field>
            <SizeField label="Taille" value={block.data.labelSize} onChange={(v) => onUpdate("labelSize", v)} defaultSize={14} />
            <Field label="Couleur du texte">
              <ColorPicker value={block.data.color} onChange={(c) => onUpdate("color", c)} />
            </Field>
            <Field label="Couleur du bouton">
              <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "#0f172a")} allowEmpty={false} />
            </Field>
          </FieldGroup>
          <FieldGroup title="Général">
            <Field label="Alignement">
              <CustomSelect
                value={block.data.align || "center"}
                onChange={(v) => onUpdate("align", v)}
                options={[
                  { value: "left", label: "← Gauche" },
                  { value: "center", label: "↔ Centre" },
                  { value: "right", label: "Droite →" },
                ]}
                size="sm"
              />
            </Field>
            <Field label="Fond du bloc">
              <BackgroundInput value={block.data.wrapperBg} onChange={(v) => onUpdate("wrapperBg", v ?? "")} />
            </Field>
          </FieldGroup>
        </div>
      );
    case "products":
      return (
        <div className="space-y-3">
          <Field label="Nombre de colonnes">
            <CustomSelect
              value={String(block.data.cols)}
              onChange={(v) => onUpdate("cols", Number(v))}
              options={[{ value: "2", label: "2 colonnes" }, { value: "3", label: "3 colonnes" }, { value: "4", label: "4 colonnes" }]}
              size="sm"
            />
          </Field>
          <ProductsPicker
            value={block.data.productIds}
            onChange={(ids) => onUpdate("productIds", ids)}
          />
          <Field label="Couleur de fond du bloc">
            <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
          </Field>
        </div>
      );
    case "imgtext":
      return (
        <div className="space-y-3">
          <FieldGroup title="Image">
            <Field label="Photo">
              <ImageInput value={block.data.img} onChange={(v) => onUpdate("img", v)} />
            </Field>
            <Field label="Position">
              <CustomSelect
                value={block.data.side}
                onChange={(v) => onUpdate("side", v)}
                options={[
                  { value: "left", label: "← Image à gauche" },
                  { value: "right", label: "Image à droite →" },
                  { value: "top", label: "↑ Image en haut" },
                  { value: "bottom", label: "↓ Image en bas" },
                ]}
                size="sm"
              />
            </Field>
            <Field label={`Largeur (${block.data.imgWidth || 45} %)`}>
              <input
                type="range"
                min={20}
                max={100}
                step={5}
                value={block.data.imgWidth || 45}
                onChange={(e) => onUpdate("imgWidth", Number(e.target.value))}
                className="w-full"
              />
            </Field>
          </FieldGroup>
          <FieldGroup title="Titre">
            <Field label="Texte"><WrappingTextInput value={block.data.title} onChange={(v) => onUpdate("title", v)} {...fieldProps(block.data.title, "title")} /></Field>
            <AlignField value={block.data.titleAlign ?? block.data.textAlign} onChange={(v) => onUpdate("titleAlign", v)} fallback="left" />
            <Field label="Couleur">
              <ColorPicker value={block.data.titleColor || "#0f172a"} onChange={(c) => onUpdate("titleColor", c)} />
            </Field>
            <SizeField label="Taille" value={block.data.titleSize} onChange={(v) => onUpdate("titleSize", v)} defaultSize={15} min={12} max={32} />
          </FieldGroup>
          <FieldGroup title="Paragraphe">
            <Field label="Texte"><textarea rows={3} className="prop-input" value={block.data.body} onChange={(e) => onUpdate("body", e.target.value)} {...fieldProps(block.data.body, "body")} /></Field>
            <AlignField value={block.data.bodyAlign ?? block.data.textAlign} onChange={(v) => onUpdate("bodyAlign", v)} fallback="left" />
            <Field label="Couleur">
              <ColorPicker value={block.data.bodyColor || "#475569"} onChange={(c) => onUpdate("bodyColor", c)} />
            </Field>
            <SizeField label="Taille" value={block.data.bodySize} onChange={(v) => onUpdate("bodySize", v)} defaultSize={13} />
          </FieldGroup>
          <FieldGroup title="Général">
            <Field label="Fond du bloc">
              <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
            </Field>
          </FieldGroup>
        </div>
      );
    case "list":
      return (
        <div className="space-y-3">
          <FieldGroup title="Liste">
            <Field label="Un item par ligne (commence par un emoji)">
              <textarea
                rows={6}
                className="prop-input"
                value={block.data.items.join("\n")}
                onChange={(e) => onUpdate("items", e.target.value.split("\n"))}
                onFocus={(e) => registerActive({
                  element: e.currentTarget,
                  getValue: () => block.data.items.join("\n"),
                  setValue: (v) => onUpdate("items", v.split("\n")),
                })}
              />
            </Field>
            <Field label="Couleur du texte">
              <ColorPicker value={block.data.color || "#334155"} onChange={(c) => onUpdate("color", c)} />
            </Field>
            <SizeField label="Taille des lignes" value={block.data.itemSize} onChange={(v) => onUpdate("itemSize", v)} defaultSize={14} />
          </FieldGroup>
          <FieldGroup title="Général">
            <Field label="Fond du bloc">
              <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
            </Field>
          </FieldGroup>
        </div>
      );
    case "empty":
      return (
        <div className="space-y-3">
          <Field label={`Hauteur (${block.data.height} px)`}>
            <input
              type="range"
              min={4}
              max={200}
              step={4}
              value={block.data.height}
              onChange={(e) => onUpdate("height", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label="Couleur de fond">
            <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
          </Field>
        </div>
      );
    case "columns":
      return <ColumnsSettings data={block.data} onUpdate={onUpdate} />;
    case "divider":
      return <div className="text-[12px] text-text-muted p-3 bg-bg-secondary rounded-lg">Ligne fine décorative — pas de réglage.</div>;
    case "footer":
      return (
        <div className="space-y-3">
          <div className="text-[11px] text-text-muted bg-red-50 border border-red-200 rounded-lg p-3">
            🔒 Pied de page <strong>obligatoire</strong>. Il DOIT contenir les 4 variables suivantes (elles seront remplacées à l&apos;envoi par les vraies infos) :
            <div className="mt-2 flex flex-wrap gap-1">
              <code className="bg-white px-1.5 py-0.5 rounded border">{"{shopName}"}</code>
              <code className="bg-white px-1.5 py-0.5 rounded border">{"{shopAddress}"}</code>
              <code className="bg-white px-1.5 py-0.5 rounded border">{"{unsubscribeLink}"}</code>
              <code className="bg-white px-1.5 py-0.5 rounded border">{"{privacyLink}"}</code>
            </div>
          </div>
          <Field label="Contenu (texte multi-ligne)">
            <textarea
              rows={6}
              className="prop-input"
              value={block.data.content || ""}
              onChange={(e) => onUpdate("content", e.target.value)}
              placeholder="{shopName} · {shopAddress}\nSe désinscrire : {unsubscribeLink}\nPolitique de confidentialité : {privacyLink}"
              {...fieldProps(block.data.content || "", "content")}
            />
          </Field>
          <Field label="Alignement">
            <CustomSelect
              value={block.data.align || "center"}
              onChange={(v) => onUpdate("align", v)}
              options={[
                { value: "left", label: "← Gauche" },
                { value: "center", label: "↔ Centre" },
                { value: "right", label: "Droite →" },
              ]}
              size="sm"
            />
          </Field>
          <SizeField label="Taille du texte" value={block.data.fontSize} onChange={(v) => onUpdate("fontSize", v)} defaultSize={12} min={9} max={20} />
          <Field label="Couleur du texte">
            <ColorPicker value={block.data.color || "#64748b"} onChange={(c) => onUpdate("color", c)} />
          </Field>
          <Field label="Fond du bloc">
            <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
          </Field>
        </div>
      );
    case "header":
      return (
        <div className="space-y-3">
          <div className="text-[11px] text-text-muted bg-slate-50 border border-slate-200 rounded-lg p-3">
            🔒 En-tête <strong>obligatoire</strong>, toujours en haut du mail (non déplaçable, non supprimable). Logo, titre et sous-titre restent facultatifs individuellement.
          </div>
          <FieldGroup title="Logo">
            <Field label="Image du logo">
              <ImageInput value={block.data.logo || ""} onChange={(v) => onUpdate("logo", v)} />
            </Field>
            <SizeField label="Hauteur max du logo" value={block.data.logoMaxHeight} onChange={(v) => onUpdate("logoMaxHeight", v)} defaultSize={60} min={20} max={160} />
          </FieldGroup>
          <FieldGroup title="Titre (facultatif)">
            <Field label="Texte">
              <WrappingTextInput value={block.data.title || ""} onChange={(v) => onUpdate("title", v)} {...fieldProps(block.data.title || "", "title")} />
            </Field>
            <SizeField label="Taille" value={block.data.titleSize} onChange={(v) => onUpdate("titleSize", v)} defaultSize={22} min={14} max={64} />
            <Field label="Police">
              <CustomSelect
                value={block.data.titleFontFamily || "sans"}
                onChange={(v) => onUpdate("titleFontFamily", v)}
                options={[
                  { value: "sans", label: "Sans-serif (Poppins)" },
                  { value: "serif", label: "Serif élégant (Cormorant)" },
                ]}
                size="sm"
              />
            </Field>
            <Field label="Trait décoratif sous le titre">
              <label className="flex items-center gap-2 text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={!!block.data.decorativeRule}
                  onChange={(e) => onUpdate("decorativeRule", e.target.checked)}
                />
                <span>Afficher une fine ligne horizontale</span>
              </label>
            </Field>
            {block.data.decorativeRule && (
              <Field label="Couleur du trait">
                <ColorPicker value={block.data.ruleColor || block.data.textColor || "#ffffff"} onChange={(c) => onUpdate("ruleColor", c)} />
              </Field>
            )}
          </FieldGroup>
          <FieldGroup title="Sous-titre (facultatif)">
            <Field label="Texte">
              <WrappingTextInput value={block.data.subtitle || ""} onChange={(v) => onUpdate("subtitle", v)} {...fieldProps(block.data.subtitle || "", "subtitle")} />
            </Field>
            <SizeField label="Taille" value={block.data.subtitleSize} onChange={(v) => onUpdate("subtitleSize", v)} defaultSize={13} />
            <Field label="Style tagline">
              <label className="flex items-center gap-2 text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={!!block.data.subtitleUppercase}
                  onChange={(e) => onUpdate("subtitleUppercase", e.target.checked)}
                />
                <span>MAJUSCULES</span>
              </label>
            </Field>
            <Field label={`Espacement des lettres (${block.data.subtitleLetterSpacing || 0} / 100)`}>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={block.data.subtitleLetterSpacing || 0}
                onChange={(e) => onUpdate("subtitleLetterSpacing", Number(e.target.value))}
                className="w-full"
              />
            </Field>
          </FieldGroup>
          <FieldGroup title="Général">
            <Field label="Alignement">
              <CustomSelect
                value={block.data.align || "center"}
                onChange={(v) => onUpdate("align", v)}
                options={[
                  { value: "left", label: "← Gauche" },
                  { value: "center", label: "↔ Centre" },
                  { value: "right", label: "Droite →" },
                ]}
                size="sm"
              />
            </Field>
            <Field label="Couleur des textes">
              <ColorPicker value={block.data.textColor || "#ffffff"} onChange={(c) => onUpdate("textColor", c)} />
            </Field>
            <Field label="Fond du bloc">
              <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "#0f172a")} allowEmpty={false} />
            </Field>
          </FieldGroup>
        </div>
      );
    case "featuresRow":
      return (
        <div className="space-y-3">
          <div className="text-[11px] text-text-muted bg-slate-50 border border-slate-200 rounded-lg p-3">
            💎 Ligne de <strong>2 à 4 features</strong> avec une icône ronde et un libellé (« Livraison suivie », « Paiement sécurisé »…). Astuce : utilise « \n » ou passe une ligne pour couper le libellé sur 2 lignes.
          </div>
          <FieldGroup title="Features">
            {block.data.items.map((it, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg-secondary/40 p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-primary">Feature {i + 1}</span>
                  {block.data.items.length > 1 && (
                    <button
                      type="button"
                      className="text-[11px] text-red-600 hover:underline"
                      onClick={() => {
                        const next = block.data.items.filter((_, j) => j !== i);
                        onUpdate("items", next);
                      }}
                    >
                      Supprimer
                    </button>
                  )}
                </div>
                <Field label="Icône (emoji)">
                  <input
                    type="text"
                    className="prop-input"
                    value={it.icon}
                    maxLength={4}
                    onChange={(e) => {
                      const next = [...block.data.items];
                      next[i] = { ...it, icon: e.target.value };
                      onUpdate("items", next);
                    }}
                    placeholder="🚚"
                  />
                </Field>
                <Field label="Libellé (2 lignes possibles)">
                  <textarea
                    rows={2}
                    className="prop-input"
                    value={it.label}
                    onChange={(e) => {
                      const next = [...block.data.items];
                      next[i] = { ...it, label: e.target.value };
                      onUpdate("items", next);
                    }}
                    placeholder="Livraison suivie\nsous 48 h"
                  />
                </Field>
              </div>
            ))}
            {block.data.items.length < 4 && (
              <button
                type="button"
                className="w-full text-[12px] text-text-secondary border border-dashed border-border rounded-lg py-2 hover:bg-bg-secondary"
                onClick={() => {
                  const next = [...block.data.items, { icon: "★", label: "Nouvelle feature" }];
                  onUpdate("items", next);
                }}
              >
                + Ajouter une feature (max 4)
              </button>
            )}
          </FieldGroup>
          <FieldGroup title="Style">
            <Field label="Fond du cercle">
              <ColorPicker value={block.data.circleBg || "#fbf1ee"} onChange={(c) => onUpdate("circleBg", c)} />
            </Field>
            <Field label="Couleur de l'icône">
              <ColorPicker value={block.data.iconColor || "#5f2231"} onChange={(c) => onUpdate("iconColor", c)} />
            </Field>
            <Field label="Couleur du libellé">
              <ColorPicker value={block.data.labelColor || "#2a1418"} onChange={(c) => onUpdate("labelColor", c)} />
            </Field>
            <SizeField label="Taille du cercle" value={block.data.circleSize} onChange={(v) => onUpdate("circleSize", v)} defaultSize={56} min={24} max={120} />
            <SizeField label="Taille de l'icône" value={block.data.iconSize} onChange={(v) => onUpdate("iconSize", v)} defaultSize={22} min={12} max={60} />
            <SizeField label="Taille du libellé" value={block.data.labelSize} onChange={(v) => onUpdate("labelSize", v)} defaultSize={12} min={9} max={20} />
            <Field label="Fond du bloc">
              <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
            </Field>
          </FieldGroup>
        </div>
      );
    case "cartItems":
      return (
        <div className="space-y-3">
          <div className="text-[11px] text-text-muted bg-violet-50 border border-violet-200 rounded-lg p-3">
            💡 Ce bloc affiche <strong>le vrai panier du client</strong> à l&apos;envoi. Vous personnalisez le titre, le libellé du total, et le message affiché si le panier est vide.
          </div>
          <Field label="Titre au-dessus de la liste (facultatif)">
            <WrappingTextInput value={block.data.title || ""} onChange={(v) => onUpdate("title", v)} {...fieldProps(block.data.title || "", "title")} />
          </Field>
          <Field label="Libellé de la ligne total">
            <WrappingTextInput value={block.data.totalLabel || "Total"} onChange={(v) => onUpdate("totalLabel", v)} {...fieldProps(block.data.totalLabel || "Total", "totalLabel")} />
          </Field>
          <Field label="Message si le panier du client est vide">
            <textarea rows={2} className="prop-input" value={block.data.emptyMessage || ""} onChange={(e) => onUpdate("emptyMessage", e.target.value)} {...fieldProps(block.data.emptyMessage || "", "emptyMessage")} />
          </Field>
          <Field label="Couleur de fond du bloc">
            <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
          </Field>
        </div>
      );
    case "favoritesGrid":
      return (
        <div className="space-y-3">
          <div className="text-[11px] text-text-muted bg-violet-50 border border-violet-200 rounded-lg p-3">
            💡 Ce bloc affiche <strong>les produits que vous sélectionnez</strong> au moment de l&apos;envoi du mail « Retour en stock ».
          </div>
          <Field label="Nombre de colonnes">
            <CustomSelect
              value={String(block.data.cols)}
              onChange={(v) => onUpdate("cols", Number(v))}
              options={[{ value: "2", label: "2 colonnes" }, { value: "3", label: "3 colonnes" }]}
              size="sm"
            />
          </Field>
          <Field label="Message si aucun produit n'est sélectionné">
            <textarea rows={2} className="prop-input" value={block.data.emptyMessage || ""} onChange={(e) => onUpdate("emptyMessage", e.target.value)} {...fieldProps(block.data.emptyMessage || "", "emptyMessage")} />
          </Field>
          <Field label="Couleur de fond du bloc">
            <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
          </Field>
        </div>
      );
    case "daysInactive":
      return (
        <div className="space-y-3">
          <div className="text-[11px] text-text-muted bg-violet-50 border border-violet-200 rounded-lg p-3">
            💡 Utilisez <code className="bg-white px-1 rounded border">{"{days}"}</code> à l&apos;endroit où le nombre de jours d&apos;inactivité doit apparaître.
          </div>
          <Field label="Message (avec {days} pour le nombre de jours)">
            <textarea rows={3} className="prop-input" value={block.data.template || ""} onChange={(e) => onUpdate("template", e.target.value)} {...fieldProps(block.data.template || "", "template")} />
          </Field>
          <Field label="Message si le client n'a jamais visité">
            <textarea rows={2} className="prop-input" value={block.data.neverVisitedTemplate || ""} onChange={(e) => onUpdate("neverVisitedTemplate", e.target.value)} {...fieldProps(block.data.neverVisitedTemplate || "", "neverVisitedTemplate")} />
          </Field>
          <Field label="Couleur du texte">
            <ColorPicker value={block.data.color || "#475569"} onChange={(c) => onUpdate("color", c)} />
          </Field>
          <Field label="Couleur de fond du bloc">
            <BackgroundInput value={block.data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
          </Field>
        </div>
      );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-body font-semibold text-text-muted mb-1.5">{label}</label>
      {children}
      <style jsx>{`
        :global(.prop-input) {
          width: 100%;
          padding: 7px 10px;
          font-size: 13px;
          border: 1px solid var(--color-border, #e2e8f0);
          border-radius: 8px;
          background: white;
          font-family: inherit;
        }
        :global(.prop-input:focus) {
          outline: none;
          border-color: #64748b;
          box-shadow: 0 0 0 3px rgba(15,23,42,.06);
        }
      `}</style>
    </div>
  );
}

/**
 * Regroupe plusieurs Field liés à un même élément (ex. « Titre » = input +
 * couleur + taille). Cadre gris subtil avec titre en tête pour clarifier
 * visuellement le périmètre des réglages.
 */
function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/80 bg-bg-secondary/30 p-3 space-y-3">
      <div className="text-[10px] uppercase tracking-[0.14em] font-body font-bold text-text-primary">
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Champ alignement — 3 boutons icônes côte à côte (style Google Docs).
 * Icônes SVG universelles (traits horizontaux alignés gauche / centre / droite).
 */
function AlignField({
  value,
  onChange,
  fallback,
}: {
  value: "left" | "center" | "right" | undefined;
  onChange: (v: "left" | "center" | "right") => void;
  fallback: "left" | "center" | "right";
}) {
  const current = value ?? fallback;
  const options: Array<{ v: "left" | "center" | "right"; label: string; icon: React.ReactNode }> = [
    {
      v: "left",
      label: "Aligner à gauche",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="15" y2="12" />
          <line x1="3" y1="18" x2="18" y2="18" />
        </svg>
      ),
    },
    {
      v: "center",
      label: "Centrer",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="5" y1="18" x2="19" y2="18" />
        </svg>
      ),
    },
    {
      v: "right",
      label: "Aligner à droite",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="9" y1="12" x2="21" y2="12" />
          <line x1="6" y1="18" x2="21" y2="18" />
        </svg>
      ),
    },
  ];
  return (
    <Field label="Alignement">
      <div className="inline-flex rounded-lg border border-border bg-bg-primary p-0.5" role="radiogroup" aria-label="Alignement">
        {options.map((o) => {
          const active = current === o.v;
          return (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={o.label}
              title={o.label}
              onClick={() => onChange(o.v)}
              className={`h-8 w-9 rounded-md flex items-center justify-center transition ${
                active
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-text-secondary hover:bg-bg-secondary"
              }`}
            >
              {o.icon}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/**
 * Champ nombre pour la taille de police d'un texte (en px).
 * Compact : input number à côté d'un slider, dans un Field partagé.
 */
function SizeField({
  label,
  value,
  onChange,
  defaultSize,
  min = 10,
  max = 48,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  defaultSize: number;
  min?: number;
  max?: number;
}) {
  const current = value ?? defaultSize;
  return (
    <Field label={`${label} — ${current} px`}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={current}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          min={min}
          max={max}
          value={current}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          className="w-16 px-2 py-1 text-[12px] font-mono border border-border rounded-md focus:outline-none focus:border-slate-500"
        />
      </div>
    </Field>
  );
}

/**
 * Champ texte mono-ligne qui se comporte comme le paragraphe : au lieu de
 * scroller horizontalement (input) et cacher le bout quand le contenu est
 * long, il wrap sur plusieurs lignes et grandit avec le contenu.
 * Utilisé pour tous les champs « titre / label / cta » des blocs newsletter.
 */
function WrappingTextInput({
  value,
  onChange,
  onFocus,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Auto-hauteur : reset à `auto` puis lit `scrollHeight` pour coller au contenu.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      placeholder={placeholder}
      rows={1}
      className="prop-input"
      style={{ resize: "none", overflow: "hidden", wordBreak: "break-word" }}
    />
  );
}

/**
 * Color picker libre : roue chromatique (native <input type=color>) + champ hex.
 * `allowEmpty` : bouton pour retirer la couleur (fond transparent).
 */
function ColorPicker({ value, onChange, allowEmpty = false }: { value: string; onChange: (c: string) => void; allowEmpty?: boolean }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-9 rounded-md border border-border cursor-pointer shrink-0"
        style={{ padding: 2 }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#000000"
        className="flex-1 min-w-0 px-2 py-1.5 text-[12px] font-mono border border-border rounded-md focus:outline-none focus:border-slate-500"
      />
      {allowEmpty && value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 px-2 py-1.5 text-[10.5px] text-text-muted hover:text-red-600 border border-border rounded-md hover:border-red-300"
          title="Retirer la couleur (fond transparent)"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Sélection d'image depuis l'ordinateur.
 * Affichage INSTANTANÉ via blob URL local — aucun upload au moment du choix.
 * Le fichier est enregistré dans un ref map partagé (via RegisterFileContext) ;
 * l'upload réel se fait au clic sur « Enregistrer » (persist()), en batch.
 * Retombe sur URL manuelle si besoin (compat avec anciennes newsletters).
 */
function ImageInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [showUrl, setShowUrl] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const registerFile = useRegisterFile();

  function handleFile(file: File) {
    const blobUrl = URL.createObjectURL(file);
    registerFile(blobUrl, file);
    onChange(blobUrl);
  }

  const isPending = value.startsWith("blob:");

  return (
    <div className="space-y-2">
      {value && (
        <div className="relative rounded-lg overflow-hidden border border-border">
          <img src={value} alt="" className="w-full h-24 object-cover" />
          {isPending && (
            <div
              className="absolute top-1 left-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/95 text-white text-[10px] font-body font-bold shadow"
              title="Cette image sera envoyée au serveur au moment où vous cliquerez sur « Enregistrer »"
            >
              À enregistrer
            </div>
          )}
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-1 right-1 h-6 w-6 rounded-md bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow"
            title="Retirer l'image"
            aria-label="Retirer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 px-3 py-2 text-[12px] font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
        >
          {value ? "Remplacer" : "📁 Choisir un fichier"}
        </button>
        <button
          type="button"
          onClick={() => setShowUrl((v) => !v)}
          className="px-2 py-2 text-[11px] font-semibold text-text-secondary border border-border rounded-lg hover:bg-bg-secondary"
          title="Coller une URL au lieu d'uploader"
        >
          URL
        </button>
      </div>
      {showUrl && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          className="prop-input"
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ColumnsSettings({ data, onUpdate }: { data: { cols: 2 | 3; columns: ColumnData[]; bg?: string; color?: string }; onUpdate: (key: string, value: unknown) => void }) {
  const registerActive = useActiveInputRegistrar();
  const columns = [...data.columns];
  while (columns.length < data.cols) columns.push({ kind: "text", text: "" });

  function updateCol(i: number, patch: Partial<ColumnData>) {
    const next = [...columns];
    next[i] = { ...next[i], ...patch };
    onUpdate("columns", next);
  }

  return (
    <div className="space-y-3">
      <Field label="Nombre de colonnes">
        <CustomSelect
          value={String(data.cols)}
          onChange={(v) => {
            const n = Number(v) as 2 | 3;
            onUpdate("cols", n);
            const next = [...columns];
            while (next.length < n) next.push({ kind: "text", text: "" });
            onUpdate("columns", next.slice(0, n));
          }}
          options={[{ value: "2", label: "2 colonnes" }, { value: "3", label: "3 colonnes" }]}
          size="sm"
        />
      </Field>
      {columns.slice(0, data.cols).map((col, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2 bg-bg-secondary/30">
          <div className="text-[11px] font-body font-bold text-text-primary">Colonne {i + 1}</div>
          <CustomSelect
            value={col.kind}
            onChange={(v) => updateCol(i, { kind: v as "text" | "image" })}
            options={[{ value: "text", label: "📝 Texte" }, { value: "image", label: "🖼️ Image" }]}
            size="sm"
          />
          {col.kind === "text" ? (
            <textarea
              rows={3}
              className="prop-input"
              value={col.text || ""}
              onChange={(e) => updateCol(i, { text: e.target.value })}
              onFocus={(e) => registerActive({
                element: e.currentTarget,
                getValue: () => col.text || "",
                setValue: (v) => updateCol(i, { text: v }),
              })}
              placeholder="Texte de la colonne…"
            />
          ) : (
            <ImageInput value={col.img || ""} onChange={(v) => updateCol(i, { img: v })} />
          )}
        </div>
      ))}
      <Field label="Couleur du texte">
        <ColorPicker value={data.color || "#334155"} onChange={(c) => onUpdate("color", c)} />
      </Field>
      <Field label="Couleur de fond du bloc">
        <BackgroundInput value={data.bg} onChange={(v) => onUpdate("bg", v ?? "")} />
      </Field>
    </div>
  );
}

function ProductsPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(false);

  async function doSearch(q: string) {
    setQuery(q);
    setLoading(true);
    const rows = await searchProductsForNewsletter(q);
    setResults(rows);
    setLoading(false);
  }

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-body font-semibold text-text-muted">
        Produits sélectionnés ({value.length})
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => doSearch(e.target.value)}
        onFocus={() => results.length === 0 && doSearch("")}
        placeholder="Chercher un produit…"
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg-primary text-[13px]"
      />
      {loading && <div className="text-[11px] text-text-muted">Chargement…</div>}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {results.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className={`w-full text-left flex items-center gap-2 p-2 rounded-lg border ${on ? "border-violet-500 bg-violet-50" : "border-border hover:bg-bg-secondary"}`}
            >
              {p.imagePath ? (
                <img src={p.imagePath} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded bg-slate-100 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-text-primary truncate">{p.name}</div>
                <div className="text-[10.5px] text-text-muted truncate">{p.reference}{p.priceCents !== null ? ` · ${(p.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""}</div>
              </div>
              {on && <span className="text-violet-700 text-lg shrink-0">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Historique : LockedBadge / LockedHeaderPreview / LockedFooterPreview retirés
// le 2026-09-09. Le header et le pied de page sont maintenant composés via
// des blocs éditables (types "header" et "footer"). Plus d'habillage global
// partagé — l'écran « Paramètres > Habillage des mails » a été supprimé.

/**
 * Rendu d'un item de la palette (utilisé dans les 2 accordéons obligatoires /
 * disponibles). Drag-and-drop + bouton « Ajouter » identiques à l'existant.
 */
function renderPaletteBlock(
  b: BlockMeta,
  isActive: boolean,
  addBlock: (type: NewsletterBlockType) => void,
  onDragEnd: () => void,
  alreadyPresent: boolean = false,
): React.ReactNode {
  const disabled = alreadyPresent;
  // Priorité visuelle : si le bloc est sélectionné dans l'aperçu, on affiche
  // l'état SÉLEC. même s'il est déjà présent (cas des blocs obligatoires
  // toujours ajoutés).
  return (
    <div
      key={b.key}
      draggable={!disabled}
      onDragStart={(e) => {
        if (disabled) { e.preventDefault(); return; }
        e.dataTransfer.setData("application/x-newsletter-type", b.key);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDragEnd={onDragEnd}
      className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
        isActive
          ? "border-slate-900 bg-slate-900 text-white shadow-md ring-2 ring-slate-900/20"
          : disabled
            ? "border-emerald-200 bg-emerald-50/60 cursor-not-allowed"
            : "border-border bg-bg-primary hover:border-emerald-400 hover:bg-emerald-50/40 cursor-grab active:cursor-grabbing"
      } ${isActive && !disabled ? "cursor-grab active:cursor-grabbing" : ""} ${isActive && disabled ? "cursor-default" : ""}`}
      title={
        isActive
          ? "Bloc actuellement sélectionné dans l'aperçu"
          : disabled
            ? "Ce bloc obligatoire est déjà ajouté au modèle — un seul autorisé."
            : "Glissez à la position voulue, ou cliquez « + Ajouter »"
      }
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
        isActive ? "bg-white/15 text-white" : disabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"
      }`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={b.icon} />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-heading font-semibold text-[12.5px] ${
            isActive ? "text-white" : disabled ? "text-emerald-900" : "text-text-primary"
          }`}>{b.label}</span>
          {(b.key === "cartItems" || b.key === "favoritesGrid" || b.key === "daysInactive") && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold ${
                isActive
                  ? "bg-white/15 text-white"
                  : "bg-amber-100 text-amber-800 border border-amber-200"
              }`}
              title="Bloc automatique — le contenu vient des données réelles du client à l'envoi (mails automatiques uniquement)."
            >
              Auto
            </span>
          )}
        </div>
        <div className={`text-[10.5px] truncate ${
          isActive ? "text-white/70" : disabled ? "text-emerald-700/80" : "text-text-muted"
        }`}>{b.desc}</div>
      </div>
      {isActive ? (
        <span className="shrink-0 text-[10px] uppercase tracking-wider font-bold bg-white/15 text-white px-1.5 py-0.5 rounded">
          Sélec.
        </span>
      ) : disabled ? (
        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded">
          ✓ Ajouté
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); addBlock(b.key); }}
          draggable={false}
          className="shrink-0 h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-body font-semibold flex items-center gap-1 shadow-sm"
          title={`Ajouter un bloc « ${b.label} » en bas`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Ajouter
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Bouton Variables GLOBAL — un seul par éditeur, dans la barre du haut.
   S'active quand un input/textarea du sujet ou des blocs est focus.
   ───────────────────────────────────────────────────────────────────────────── */
function GlobalVariableButton({ scenario }: { scenario: ScenarioKey | null }) {
  const target = useActiveInput();
  const enabled = target !== null;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function insertToken(token: string) {
    if (!target) return;
    const literal = `{${token}}`;
    const el = target.element;
    // Lecture DOM (toujours à jour) au lieu du closure `getValue()` figé au
    // moment du focus — sinon la 2ᵉ insertion écrasait la 1ère.
    const current = el.value;
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + literal + current.slice(end);
    target.setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + literal.length;
      el.setSelectionRange(pos, pos);
    });
    setOpen(false);
  }

  const variables = variablesForScenario(scenario);
  const byGroup = new Map<VariableGroup, MailVariable[]>();
  for (const v of variables) {
    const arr = byGroup.get(v.group) ?? [];
    arr.push(v);
    byGroup.set(v.group, arr);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        // preventDefault sur mousedown : évite que le clic sur le bouton fasse
        // perdre le focus de l'input actif (sinon `target` devient null avant
        // que le handler onClick s'exécute).
        onMouseDown={(e) => { e.preventDefault(); }}
        onClick={() => enabled && setOpen((o) => !o)}
        disabled={!enabled}
        title={
          enabled
            ? "Insérez une info du client (prénom, entreprise, etc.) dans le champ que vous éditez."
            : "Cliquez d'abord dans un champ texte (sujet, titre, paragraphe…) pour choisir où insérer la variable."
        }
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-body font-bold border transition ${
          enabled
            ? "bg-violet-600 hover:bg-violet-700 text-white border-violet-700 shadow-sm cursor-pointer"
            : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
        }`}
      >
        <span className="font-mono">{"{ }"}</span>
        Variables
      </button>

      {open && enabled && (
        <div
          className="absolute z-50 right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-bg-primary shadow-2xl"
          role="menu"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="sticky top-0 bg-bg-primary border-b border-border px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.14em] font-body font-bold text-text-muted">
              Cliquez pour insérer
            </div>
            <div className="text-[11px] text-text-muted mt-0.5 leading-snug">
              La variable sera remplacée par la vraie info du client à l'envoi.
            </div>
          </div>
          {(["legal", "client", "boutique", "dynamique"] as VariableGroup[]).map((g) => {
            const items = byGroup.get(g);
            if (!items || items.length === 0) return null;
            return (
              <div key={g} className="py-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-[0.14em] font-body font-bold text-text-muted bg-bg-secondary/50">
                  {VARIABLE_GROUP_LABELS[g]}
                </div>
                {items.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => insertToken(v.token)}
                    className="w-full flex items-baseline justify-between gap-2 px-3 py-1.5 hover:bg-slate-50 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[12.5px] text-text-primary font-body font-semibold">{v.label}</span>
                        {v.requiredMarketing && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-body font-bold uppercase bg-red-100 text-red-800 border border-red-200">
                            ⚠ Obligatoire
                          </span>
                        )}
                      </span>
                      {v.hint && <span className="block text-[10.5px] text-text-muted mt-0.5">{v.hint}</span>}
                    </span>
                    <code className="shrink-0 text-[10.5px] text-slate-600 font-mono">{`{${v.token}}`}</code>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Barre « Aperçu pour : » + envoi d'un mail de test
   ───────────────────────────────────────────────────────────── */

/**
 * Valeur spéciale du sélecteur qui désigne l'admin (envoi sur son mail perso
 * vérifié). Choisie improbable pour ne pas entrer en collision avec un ID
 * client réel.
 */
const SELF_TARGET = "__self__";

/**
 * Barre du bandeau d'aperçu : un CustomSelect qui liste « Moi-même » + tous
 * les clients APPROVED, un bouton dé (tirage au sort d'un client) et un
 * bouton d'envoi qui expédie le modèle courant en test à la cible choisie.
 *
 * La sélection ne modifie que le destinataire du bouton d'envoi : les tokens
 * `{firstName}`, `{company}`… affichés dans l'aperçu à l'écran restent
 * pilotés par `previewClientId` côté parent — l'option « Moi-même » ne
 * change PAS le rendu à l'écran (l'admin n'a pas de fiche client), elle sert
 * uniquement à l'envoi test.
 */
function PreviewTargetBar({
  clients,
  selectedClientId,
  onSelectClient,
  adminSelfEmail,
  scenarioKey,
  sending,
  onSendTest,
}: {
  clients: PreviewClientLite[];
  selectedClientId: string | null;
  onSelectClient: (id: string | null) => void;
  adminSelfEmail: string | null;
  scenarioKey: ScenarioKey | null;
  sending: boolean;
  onSendTest: (targetValue: string) => Promise<void> | void;
}) {
  // Cible en cours pour le CustomSelect + l'envoi test. Par défaut on suit le
  // client sélectionné dans l'aperçu, sauf si l'utilisateur bascule sur
  // « Moi-même » — dans ce cas on garde la cible self jusqu'au prochain
  // changement explicite.
  const [target, setTarget] = useState<string>(
    selectedClientId ?? (adminSelfEmail ? SELF_TARGET : ""),
  );
  useEffect(() => {
    // Suit le client sélectionné dans l'aperçu tant qu'on n'est pas en mode
    // "Moi-même". Utile après un tirage au dé.
    if (target !== SELF_TARGET && selectedClientId && target !== selectedClientId) {
      setTarget(selectedClientId);
    }
  }, [selectedClientId, target]);

  const options = useMemo(() => {
    const opts = [
      {
        value: SELF_TARGET,
        label: adminSelfEmail
          ? `Moi-même — ${adminSelfEmail}`
          : "Moi-même (mail perso non vérifié)",
        iconNode: (
          <span
            aria-hidden
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-amber-600 text-white text-[10px] font-bold shadow-sm"
          >
            ★
          </span>
        ),
        disabled: !adminSelfEmail,
      },
      ...clients.map((c) => {
        const displayName =
          c.company?.trim() ||
          `${c.firstName} ${c.lastName}`.trim() ||
          c.email;
        const initials = getInitials(c);
        return {
          value: c.id,
          label: `${displayName} — ${c.email}`,
          iconNode: (
            <span
              aria-hidden
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-slate-700 text-[9.5px] font-bold"
            >
              {initials}
            </span>
          ),
        };
      }),
    ];
    return opts;
  }, [clients, adminSelfEmail]);

  const canSend = !!target && !sending;
  const sendTitle = !target
    ? "Choisissez un destinataire"
    : target === SELF_TARGET
      ? `M'envoyer ce mail en test${adminSelfEmail ? ` à ${adminSelfEmail}` : ""}`
      : `Envoyer ce mail en test à ce client${scenarioKey === "ABANDONED_CART" ? " (avec son panier réel)" : ""}`;

  const nothingToPick = clients.length === 0 && !adminSelfEmail;

  if (nothingToPick) {
    return (
      <span className="text-[11px] font-body text-text-muted italic">
        Aucun destinataire d'aperçu disponible — validez d'abord un client
        APPROUVÉ ou vérifiez votre mail perso dans Paramètres → Messagerie.
      </span>
    );
  }

  function handleChange(v: string) {
    setTarget(v);
    // Aperçu à l'écran : on met à jour le client sélectionné pour que les
    // tokens {firstName}… se rafraîchissent. « Moi-même » n'a pas de client
    // à cibler pour l'aperçu — on laisse la sélection courante intacte.
    if (v !== SELF_TARGET) onSelectClient(v);
  }

  function pickRandom() {
    if (clients.length === 0) return;
    const r = clients[Math.floor(Math.random() * clients.length)];
    setTarget(r.id);
    onSelectClient(r.id);
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-[11px] text-text-muted font-body font-semibold whitespace-nowrap">
        Aperçu pour :
      </span>
      <div className="min-w-[220px] max-w-[280px]">
        <CustomSelect
          value={target}
          onChange={handleChange}
          options={options}
          size="sm"
          searchable
          aria-label="Destinataire de l'aperçu"
          title="Aperçu pour"
          emptyMessage="Aucun destinataire disponible."
        />
      </div>
      <button
        type="button"
        onClick={pickRandom}
        disabled={clients.length === 0}
        className="text-[13px] leading-none px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
        title="Choisir un autre client au hasard"
        aria-label="Choisir un client au hasard"
      >
        🎲
      </button>
      <button
        type="button"
        onClick={() => onSendTest(target)}
        disabled={!canSend}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-body font-bold bg-gradient-to-br from-slate-800 to-slate-900 text-white shadow-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        title={sendTitle}
        aria-label="Envoyer un mail de test"
      >
        {sending ? (
          <>
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Envoi…
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4z" />
            </svg>
            Envoyer un test
          </>
        )}
      </button>
    </div>
  );
}

function getInitials(c: PreviewClientLite): string {
  const src =
    c.company?.trim() ||
    `${c.firstName} ${c.lastName}`.trim() ||
    c.email;
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
