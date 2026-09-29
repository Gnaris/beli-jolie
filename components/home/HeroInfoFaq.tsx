"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { HomeFaqItem } from "@/lib/home-faq";

/**
 * Hero de la home Beli & Jolie (refonte 2026-09-28).
 *
 * Remplace la bannière image + gros titre + CTA (`HeroBanner`) + la section FAQ
 * du bas de page. Nouvelle disposition : 2 colonnes.
 *  ├─ Gauche : « affiche » informative (fond bleu marine, texte blanc).
 *  │  10 lignes ramenées à 6 : minimum d'achat, qualité, catalogue, livraison,
 *  │  showroom (adresse + horaires), service. Le count produits + catégories
 *  │  provient de la BDD (dynamique).
 *  └─ Droite : FAQ (fond blanc) — reprend le state accordéon de FaqSection.
 *
 * BJ uniquement. Issyma continue d'utiliser HeroBanner + FaqSection classiques
 * via son propre layout (HomeIssymaLayout).
 */
interface HeroInfoFaqProps {
  productCount: number;
  categoryCount: number;
  showroomAddress: string;
  showroomHours: string;
  faqItems: HomeFaqItem[];
  /** Téléphone entreprise → construit le lien `tel:` du bouton Téléphone.
   *  Null / vide → bouton masqué. */
  companyPhone: string | null;
  /** Numéro WhatsApp entreprise → lien wa.me. Fallback sur companyPhone si
   *  vide. Null des deux côtés → bouton WhatsApp masqué. */
  companyWhatsapp: string | null;
  /** Images produit à afficher en fond décoratif du hero (colonnes qui
   *  défilent verticalement). Tirées au hasard une fois par jour côté
   *  serveur (`getCachedHomeHeroImages`). Vide → fond blanc classique. */
  heroImages?: string[];
}

const HERO_BG_COLUMNS = 6;
const HERO_BG_IMAGES_PER_COL = 8;

const NAVY = "#0b1b34";

/** Nettoie un numéro pour le protocole `tel:` (retire espaces, points,
 *  tirets, parenthèses). Idem que `nous-contacter`. */
function toTelLink(phone: string): string {
  return `tel:${phone.replace(/[\s.\-()]/g, "")}`;
}

/** Construit le lien wa.me à partir d'un numéro international (+ retiré). */
function toWhatsAppLink(phone: string): string {
  const cleaned = phone.replace(/[\s.\-()]/g, "").replace(/^\+/, "");
  return `https://wa.me/${cleaned}`;
}

export default function HeroInfoFaq({
  productCount,
  categoryCount,
  showroomAddress,
  showroomHours,
  faqItems,
  companyPhone,
  companyWhatsapp,
  heroImages = [],
}: HeroInfoFaqProps) {
  const t = useTranslations("home");
  const { data: session } = useSession();
  const [openId, setOpenId] = useState<string | null>(faqItems[0]?.id ?? null);
  const productCountFormatted = new Intl.NumberFormat("fr-FR").format(productCount);

  // CTA principal du bloc info : « Ouvrir un compte pro » → /inscription
  // pour les visiteurs, « Mon espace pro » → /espace-pro pour les clients
  // déjà connectés (l'admin en preview mode voit aussi ce libellé — cohérent
  // avec sa session active). Évite l'incongruité d'un « Ouvrir un compte »
  // quand on est déjà loggué.
  const isSignedIn = Boolean(session?.user);
  const ctaMainLabel = isSignedIn ? t("heroInfo.ctaMyAccount") : t("heroInfo.ctaOpenAccount");
  const ctaMainHref  = isSignedIn ? "/espace-pro" : "/inscription";

  // Répartit les images en 6 colonnes (round-robin) — l'ordre serveur est
  // déjà mélangé (Fisher-Yates seedé par la date) donc la distribution
  // est équilibrée sans nouveau shuffle côté client. Les colonnes paires
  // remontent, impaires descendent — effet demandé par la cliente pour que
  // le regard ne suive pas une direction unique.
  const bgColumns = buildBackgroundColumns(heroImages);

  return (
    <section className="relative bg-white border-b border-neutral-200 overflow-hidden">
      {/* ── Fond décoratif : bijoux qui défilent ─────────────────────
          Colonnes montantes/descendantes derrière les cartes. Purement
          visuel (`aria-hidden` + `pointer-events-none`), ne pénalise pas
          l'accessibilité ni la SEO. Masqué si aucune image renvoyée par
          le serveur (nouveau tenant sans photos, cache raté, dev sans
          uploads) → on retombe alors sur le simple fond blanc. */}
      {bgColumns.length > 0 && (
        <>
          <div
            className="absolute inset-0 grid gap-3 pointer-events-none select-none hero-fade-mask"
            style={{
              gridTemplateColumns: `repeat(${HERO_BG_COLUMNS}, minmax(0, 1fr))`,
              opacity: 0.30,
            }}
            aria-hidden="true"
          >
            {bgColumns.map((col, idx) => (
              <div key={idx} className="overflow-hidden">
                {/* Vitesse légèrement différente d'une colonne à l'autre
                    (90 / 110 / 130 s) pour éviter que toutes les colonnes
                    tournent en phase — plus vivant, moins hypnotique. */}
                <div
                  className={idx % 2 === 0 ? "hero-col-up" : "hero-col-down"}
                  style={{ ["--hero-scroll-speed" as string]: `${90 + (idx % 3) * 20}s` }}
                >
                  {/* Attention : on N'UTILISE PAS `gap-*` ici. Un gap entre
                      enfants ne s'applique PAS après le dernier — le raccord
                      1ʳᵉ ↔ 2ᵉ copie tomberait alors une demi-espace trop tôt
                      et l'anim rebondirait visuellement. On met un `mb-3` sur
                      CHAQUE image (y compris la dernière de la 2ᵉ copie), ce
                      qui égalise l'espacement et rend la translation `-50%`
                      exactement raccord. */}
                  <div className="flex flex-col">
                    {col.map((src, i) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        key={`a-${i}`}
                        src={src}
                        alt=""
                        loading="lazy"
                        className="w-full aspect-square object-cover rounded-lg mb-3"
                      />
                    ))}
                    {/* 2ᵉ copie pour la boucle sans saut (cf. keyframes). */}
                    {col.map((src, i) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        key={`b-${i}`}
                        src={src}
                        alt=""
                        loading="lazy"
                        className="w-full aspect-square object-cover rounded-lg mb-3"
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Voile blanc léger pour garantir le contraste des cartes. */}
          <div className="absolute inset-0 bg-white/20 pointer-events-none" aria-hidden="true" />
        </>
      )}

      <div className="relative max-w-[1400px] mx-auto px-4 md:px-8 py-10 md:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-stretch">

          {/* ── Bloc info — navy ────────────────────────────────────── */}
          <article
            className="rounded-3xl p-7 md:p-9 shadow-sm flex flex-col text-white"
            style={{ backgroundColor: NAVY }}
          >
            <header className="mb-6">
              {/* Eyebrow = nom de marque + ville (petit, en majuscules). Le
                  vrai H1 SEO devient la ligne suivante, riche en mots-clés
                  ("grossiste bijoux fantaisie · fournisseur B2B") pour aider
                  au référencement Google. La marque reste visible via le
                  header logo + le title tag + cet eyebrow. */}
              <p className="text-[0.7rem] tracking-[0.22em] uppercase font-semibold text-white/60 font-body">
                {t("heroInfo.eyebrow")}
              </p>
              <h1 className="mt-2 font-heading text-2xl md:text-[2rem] font-bold leading-tight">
                {t("heroInfo.h1")}
              </h1>
              <p className="mt-2 text-white/80 text-sm md:text-base font-body">
                {t("heroInfo.subtitle")}
              </p>
            </header>

            <ul className="divide-y divide-white/10 border-y border-white/10">
              <InfoRow
                icon={<IconEuro />}
                title={t("heroInfo.minOrderTitle")}
                desc={t("heroInfo.minOrderDesc")}
              />
              <InfoRow
                icon={<IconShield />}
                title={t("heroInfo.qualityTitle")}
                desc={t("heroInfo.qualityDesc")}
              />
              <InfoRow
                icon={<IconGrid />}
                title={t("heroInfo.catalogTitle", {
                  count: productCountFormatted,
                  catCount: categoryCount,
                })}
                desc={t("heroInfo.catalogDesc")}
              />
              <InfoRow
                icon={<IconTruck />}
                title={t("heroInfo.shippingTitle")}
                desc={t("heroInfo.shippingDesc")}
              />
              <InfoRow
                icon={<IconStore />}
                title={t("heroInfo.showroomTitle", { address: showroomAddress })}
                desc={t("heroInfo.showroomDesc", { hours: showroomHours })}
              />
              <InfoRow
                icon={<IconHeadset />}
                title={t("heroInfo.serviceTitle")}
                desc={t("heroInfo.serviceDesc")}
              />
            </ul>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Link
                href={ctaMainHref}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white font-heading font-semibold text-sm hover:bg-neutral-100 transition-colors"
                style={{ color: NAVY }}
              >
                {ctaMainLabel}
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/produits"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white/10 border border-white/20 text-white font-heading font-semibold text-sm hover:bg-white/15 transition-colors"
              >
                {t("heroInfo.ctaViewCatalog")}
              </Link>
            </div>
          </article>

          {/* ── FAQ — blanc ─────────────────────────────────────────── */}
          <aside className="rounded-3xl border border-neutral-200 bg-white p-7 md:p-9 shadow-sm flex flex-col">
            <header className="mb-6">
              <p className="text-[0.7rem] tracking-[0.22em] uppercase font-semibold text-neutral-500 font-body">
                {t("faqHero.eyebrow")}
              </p>
              <h2 className="mt-2 font-heading text-2xl md:text-3xl font-bold text-neutral-900 leading-tight">
                {t("faqHero.title")}
              </h2>
              <p className="mt-1 text-neutral-600 text-sm md:text-base font-body">
                {t("faqHero.subtitle")}
              </p>
            </header>

            <div className="flex-1 space-y-2">
              {faqItems.length === 0 ? (
                <p className="text-sm text-neutral-500 italic">—</p>
              ) : (
                faqItems.map((item) => {
                  const isOpen = openId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border transition-colors ${
                        isOpen
                          ? "bg-white border-neutral-300"
                          : "bg-neutral-50/60 border-neutral-200"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen ? null : item.id)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between gap-4 p-4 text-left"
                      >
                        <span className="font-heading font-semibold text-neutral-900 text-sm md:text-[0.95rem]">
                          {item.question}
                        </span>
                        <svg
                          className={`h-4 w-4 text-neutral-500 shrink-0 transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <div className="overflow-hidden">
                          <p className="px-4 pb-4 text-neutral-600 text-sm leading-relaxed font-body">
                            {item.answer}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bloc contact bas de FAQ */}
            <div
              className="mt-6 rounded-2xl text-white p-5"
              style={{ backgroundColor: NAVY }}
            >
              <p className="text-[0.7rem] tracking-[0.22em] uppercase font-semibold text-white/60 font-body">
                {t("faqHero.contactTitle")}
              </p>
              <p className="mt-1 font-heading font-semibold text-base md:text-lg">
                {t("faqHero.contactSubtitle")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {/* Chat : renvoie vers la page contact (formulaire de contact
                    async — pas encore de vraie messagerie live embarquée). */}
                <Link
                  href="/nous-contacter"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium font-body transition-colors"
                >
                  <IconChat />
                  {t("faqHero.contactChat")}
                </Link>

                {/* Téléphone : lien natif tel: — ouvre l'app téléphone du
                    téléphone / le composeur d'appel sur desktop. Bouton masqué
                    si aucun numéro renseigné dans Paramètres → Société. */}
                {companyPhone ? (
                  <a
                    href={toTelLink(companyPhone)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium font-body transition-colors"
                  >
                    <IconPhone />
                    {t("faqHero.contactPhone")}
                  </a>
                ) : null}

                {/* WhatsApp : ouvre wa.me/<numéro> — desktop = WhatsApp Web,
                    mobile = app WhatsApp native. Fallback sur companyPhone si
                    aucun numéro WhatsApp dédié n'est renseigné. */}
                {(companyWhatsapp || companyPhone) ? (
                  <a
                    href={toWhatsAppLink(companyWhatsapp || companyPhone!)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium font-body transition-colors"
                  >
                    <IconWhatsapp />
                    {t("faqHero.contactWhatsapp")}
                  </a>
                ) : null}
              </div>
            </div>
          </aside>

        </div>
      </div>
    </section>
  );
}

/**
 * Répartit les images en HERO_BG_COLUMNS colonnes (round-robin) et cape
 * chaque colonne à HERO_BG_IMAGES_PER_COL images pour éviter un DOM trop
 * lourd. Renvoie [] si l'entrée est vide OU si aucune image ne remplit
 * assez une colonne (< 2 tuiles → boucle visible → moche).
 */
function buildBackgroundColumns(images: string[]): string[][] {
  if (images.length < HERO_BG_COLUMNS * 2) return [];
  const cols: string[][] = Array.from({ length: HERO_BG_COLUMNS }, () => []);
  for (let i = 0; i < images.length; i++) {
    const c = i % HERO_BG_COLUMNS;
    if (cols[c].length < HERO_BG_IMAGES_PER_COL) cols[c].push(images[i]);
  }
  return cols;
}

/* ── Sous-composants ────────────────────────────────────────────── */

function InfoRow({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex items-center gap-4 py-3.5">
      <div className="h-9 w-9 rounded-full bg-white/10 grid place-items-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-heading font-semibold text-white text-[0.95rem]">{title}</p>
        <p className="text-xs md:text-sm text-white/70 font-body">{desc}</p>
      </div>
    </li>
  );
}

/* ── Icônes SVG (Lucide-like, stroke 2) ─────────────────────────── */

function IconEuro() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 7c-2.5-2-9.5-2-11 3s3.5 8 8 8" />
      <path d="M4 11h10" />
      <path d="M4 15h8" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v6c0 5 3.5 9.4 8 11 4.5-1.6 8-6 8-11V5l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function IconGrid() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function IconTruck() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h11v10H3z" />
      <path d="M14 10h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}
function IconStore() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1-5h16l1 5" />
      <path d="M4 9h16v11H4z" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}
function IconHeadset() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
      <rect x="3" y="14" width="4" height="6" rx="1" />
      <rect x="17" y="14" width="4" height="6" rx="1" />
      <path d="M21 18v1a3 3 0 0 1-3 3h-3" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92V21a1 1 0 0 1-1.11 1A19 19 0 0 1 2 4.11 1 1 0 0 1 3 3h4.09a1 1 0 0 1 1 .75l1 4a1 1 0 0 1-.29 1L7.21 10.79a16 16 0 0 0 6 6l2-1.58a1 1 0 0 1 1-.29l4 1a1 1 0 0 1 .79 1z" />
    </svg>
  );
}
function IconWhatsapp() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.52 3.48A11.9 11.9 0 0 0 12 0C5.37 0 0 5.37 0 12a11.9 11.9 0 0 0 1.67 6L0 24l6.24-1.63A12 12 0 0 0 12 24c6.63 0 12-5.37 12-12a11.9 11.9 0 0 0-3.48-8.52ZM12 22a10 10 0 0 1-5.1-1.4l-.36-.22-3.7.97.99-3.6-.24-.37A10 10 0 1 1 22 12a10 10 0 0 1-10 10Zm5.5-7.5c-.3-.15-1.77-.87-2.05-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.67-2.08-.18-.3-.02-.46.13-.6.13-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.68-1.63-.93-2.23-.25-.6-.5-.5-.68-.5h-.58c-.2 0-.53.07-.8.37-.28.3-1.05 1.03-1.05 2.5s1.08 2.9 1.23 3.1c.15.2 2.13 3.25 5.15 4.57.72.3 1.28.5 1.72.63.72.23 1.38.2 1.9.12.58-.08 1.78-.72 2.03-1.42.25-.7.25-1.3.18-1.42-.07-.13-.28-.2-.58-.35Z" />
    </svg>
  );
}
