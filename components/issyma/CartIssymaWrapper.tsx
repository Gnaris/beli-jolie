import IssymaShell from "@/components/issyma/IssymaShell";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";

const P = ISSYMA_PALETTE;

/**
 * CSS injecté seulement quand la coquille Issyma /panier s'affiche.
 * Masque le header + footer génériques de la (client) layout — sans ça, le
 * pied de page noir (FooterIssyma) apparaît sous le pied wine d'IssymaShell.
 * Scopé strict au conteneur racine unique de la (client) layout.
 */
const CART_ISSYMA_CHROME_HIDE = `
.min-h-screen.bg-bg-secondary.flex.flex-col > header,
.min-h-screen.bg-bg-secondary.flex.flex-col > footer {
  display: none !important;
}
.min-h-screen.bg-bg-secondary.flex.flex-col > main {
  padding: 0 !important;
}
`;

function IconTruck() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h11v9H2z"/><path d="M13 11h4l4 3v3h-8"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>
    </svg>
  );
}
function IconBoxLine() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>
    </svg>
  );
}
function IconHeadset() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14v-2a9 9 0 0 1 18 0v2"/>
      <rect x="3" y="14" width="4" height="6" rx="1"/>
      <rect x="17" y="14" width="4" height="6" rx="1"/>
    </svg>
  );
}

/**
 * Coquille Issyma pour la page /panier : en-tête + pied de page bordeaux,
 * hero rose poudré (« Mon compte / Mon panier »), bandeau réassurance rose
 * dégradé (mêmes 3 tuiles que la fiche produit). Le wizard interactif du
 * panier (Panier → Livraison → Paiement) est passé en `children` et
 * conservé intact — seule l'enveloppe change.
 */
export default async function CartIssymaWrapper({
  shopName,
  children,
}: {
  shopName: string;
  children: React.ReactNode;
}) {
  return (
    <IssymaShell shopName={shopName}>
      <style>{CART_ISSYMA_CHROME_HIDE}</style>

      {/* Hero rose poudré, titre à gauche */}
      <section style={{ background: P.blush50 }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-8 sm:pt-10 pb-6">
          <p
            className="text-[10px] tracking-[0.32em] uppercase font-semibold"
            style={{ color: P.wine700 }}
          >
            Mon compte
          </p>
          <h1
            className="serif mt-3"
            style={{
              color: P.ink,
              fontSize: "clamp(2.4rem, 5.5vw, 4.4rem)",
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            Mon panier
          </h1>
          <p className="mt-3 max-w-xl text-[13px] leading-[1.6] font-light" style={{ color: P.inkSoft }}>
            Vérifiez vos articles et finalisez votre commande.
          </p>
        </div>

        {/* Wizard existant — logique et interactions conservées à l'identique.
            Le fond de la section reste rose poudré pour cadrer visuellement. */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pb-10">
          {children}
        </div>

        {/* Bandeau réassurance rose dégradé, mêmes 3 tuiles que la fiche produit
            adaptées au contexte panier. */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pb-14">
          <div
            className="rounded-3xl grid grid-cols-1 sm:grid-cols-3 overflow-hidden"
            style={{
              background: `linear-gradient(90deg, #fbf1ee 0%, #f8e6e0 50%, #fbf1ee 100%)`,
              border: `1px solid ${P.borderSoft}`,
            }}
          >
            {[
              { Icon: IconTruck, title: "Paiement sécurisé", desc: "Carte ou virement" },
              { Icon: IconBoxLine, title: "Préparation 24 à 48h", desc: "Expédition rapide et soignée" },
              { Icon: IconHeadset, title: "Une question ?", desc: "Contactez-nous, on vous répond vite" },
            ].map(({ Icon, title, desc }, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-6 sm:px-8 py-6"
                style={{
                  borderLeft: i > 0 ? `1px solid rgba(122, 42, 60, 0.15)` : "none",
                }}
              >
                <span className="shrink-0" style={{ color: P.wine700 }}>
                  <Icon />
                </span>
                <div className="leading-tight">
                  <p className="text-[14px] font-semibold" style={{ color: P.ink }}>{title}</p>
                  <p className="text-[12px] mt-0.5" style={{ color: P.inkSoft }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </IssymaShell>
  );
}
