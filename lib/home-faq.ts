/**
 * FAQ affichée en bas de la page d'accueil.
 *
 * Stockage : SiteConfig["home_faq"].value = JSON.stringify(HomeFaqItem[])
 * Rendu UI : `<FaqSection items={parseHomeFaq(row?.value)} />`
 * SEO : chaque item est aussi injecté dans un JSON-LD `FAQPage` sur la page
 * d'accueil — Google peut alors afficher les questions/réponses en rich
 * results (schema.org/FAQPage).
 *
 * Édition admin : `HomeFaqConfig` dans Paramètres → Contenu vitrine. Si
 * aucune FAQ n'est saisie, la section est masquée sur la home.
 *
 * Le nombre d'items est plafonné à 8 : au-delà, la section devient trop
 * longue et Google réduit la valeur SEO d'une FAQPage trop verbeuse.
 */
export interface HomeFaqItem {
  /** Identifiant stable (clés React côté éditeur). */
  id: string;
  /** Question FR — obligatoire, sinon l'item est ignoré. */
  question: string;
  /** Réponse FR — obligatoire, sinon l'item est ignoré. */
  answer: string;
  /** Version anglaise optionnelle — vide → fallback sur la version FR. */
  questionEn?: string;
  answerEn?: string;
}

export const MAX_HOME_FAQ_ITEMS = 8;

/** Questions par défaut pré-remplies quand la cliente ouvre l'éditeur pour la
 *  première fois. Elle peut les modifier / supprimer. Non écrites en base
 *  automatiquement — juste un state initial UI. */
export const DEFAULT_HOME_FAQ_ITEMS: HomeFaqItem[] = [
  {
    id: "faq-default-1",
    question: "Les articles sont-ils vendus à l'unité ?",
    answer: "Oui, nos modèles peuvent être commandés à l'unité, sans lot ni pack imposé.",
  },
  {
    id: "faq-default-2",
    question: "Pourquoi les prix ne sont-ils pas affichés ?",
    answer: "Nos tarifs grossiste sont réservés aux professionnels. Créez gratuitement votre compte pour consulter les prix et les stocks.",
  },
  {
    id: "faq-default-3",
    question: "Sous quel délai les commandes sont-elles préparées ?",
    answer: "Les commandes en ligne sont généralement préparées sous 24 à 48 heures ouvrées.",
  },
  {
    id: "faq-default-4",
    question: "Livrez-vous en France et en Europe ?",
    answer: "Oui, nous livrons en France, dans les DOM-TOM et dans plusieurs pays européens.",
  },
];

export function parseHomeFaq(raw: string | null | undefined): HomeFaqItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .slice(0, MAX_HOME_FAQ_ITEMS)
      .map((r, i) => {
        const item: HomeFaqItem = {
          id: typeof r.id === "string" && r.id ? r.id : `faq-${i}`,
          question: typeof r.question === "string" ? r.question.trim() : "",
          answer: typeof r.answer === "string" ? r.answer.trim() : "",
        };
        // Ne posons les champs EN que s'ils sont explicitement présents et non
        // vides — évite de trainer des chaînes vides dans le JSON stocké et
        // conserve la forme historique pour les FAQ 100 % FR.
        const qEn = typeof r.questionEn === "string" ? r.questionEn.trim() : "";
        const aEn = typeof r.answerEn === "string" ? r.answerEn.trim() : "";
        if (qEn) item.questionEn = qEn;
        if (aEn) item.answerEn = aEn;
        return item;
      })
      .filter((r) => r.question && r.answer);
  } catch {
    return [];
  }
}

/**
 * Résout la version localisée de chaque item : si `locale === "en"` et que la
 * traduction EN existe pour question ET answer, on l'utilise. Sinon fallback
 * sur la version FR. Retourne un nouveau tableau avec `question`/`answer` déjà
 * dans la bonne langue — les layouts consomment ce résultat sans se soucier
 * de la locale.
 */
export function resolveHomeFaqForLocale(
  items: HomeFaqItem[],
  locale: string,
): HomeFaqItem[] {
  if (locale === "fr" || !items.length) return items;
  return items.map((it) => {
    const useEn = locale === "en" && (it.questionEn?.trim() || it.answerEn?.trim());
    if (!useEn) return it;
    return {
      ...it,
      question: it.questionEn?.trim() || it.question,
      answer: it.answerEn?.trim() || it.answer,
    };
  });
}

/** Construit le JSON-LD FAQPage schema.org — à injecter dans un
 *  `<script type="application/ld+json">` sur la home. */
export function buildFaqJsonLd(items: HomeFaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: it.answer,
      },
    })),
  };
}
