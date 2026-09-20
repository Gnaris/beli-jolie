import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import IssymaShell from "@/components/issyma/IssymaShell";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";

const P = ISSYMA_PALETTE;

export interface CategoriesIssymaCategory {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  productCount: number;
  subCategories?: { id: string; name: string }[];
}

export default async function CategoriesIssymaLayout({
  shopName,
  categories,
}: {
  shopName: string;
  categories: CategoriesIssymaCategory[];
}) {
  const t = await getTranslations("categoriesPage");
  const session = await getServerSession(authOptions);
  const isGuest = !session?.user?.id;

  return (
    <IssymaShell shopName={shopName}>
      {/* HERO — rose poudré, titre à gauche */}
      <section style={{ background: P.blush50 }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-8 sm:pt-10 pb-6">
          <p
            className="text-[10px] tracking-[0.32em] uppercase font-semibold"
            style={{ color: P.wine700 }}
          >
            Explorer
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
            {t("title")}
          </h1>
          <p className="mt-3 max-w-xl text-[13px] leading-[1.6] font-light" style={{ color: P.inkSoft }}>
            Découvrez toutes nos catégories et trouvez les pièces parfaites pour votre boutique.
          </p>
        </div>

        {/* GRILLE de tuiles rose poudré sur fond rose (continuité visuelle) */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pb-14">
          {categories.length === 0 ? (
            <div className="text-center py-20 text-[14px]" style={{ color: P.inkSoft }}>
              {t("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3">
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/categories/${c.slug}`}
                  className="group rounded-xl overflow-hidden flex flex-col items-center text-center p-2.5 sm:p-3 transition"
                  style={{
                    background: P.paper,
                    aspectRatio: "1 / 1",
                    border: `1px solid ${P.borderSoft}`,
                  }}
                >
                  {/* Illustration : image sans cercle, ou grande initiale bordeaux */}
                  <div className="flex-1 w-full flex items-center justify-center">
                    {c.image ? (
                      <Image
                        src={c.image}
                        alt={c.name}
                        width={160}
                        height={160}
                        className="max-w-[65%] max-h-[65%] object-contain transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <span
                        className="serif font-bold"
                        style={{ color: P.wine700, fontSize: "clamp(1.6rem, 3.5vw, 2.4rem)", lineHeight: 1 }}
                        aria-hidden="true"
                      >
                        {c.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                    )}
                  </div>

                  {/* Libellé sans-serif gras */}
                  <p
                    className="mt-1 font-semibold text-[11px] sm:text-[12px] leading-tight"
                    style={{ color: P.ink }}
                  >
                    {c.name}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA BORDEAUX — visible uniquement pour les visiteurs non connectés */}
      {isGuest && (
        <section style={{ background: P.paper }}>
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-10">
            <div
              className="rounded-3xl px-6 sm:px-10 py-6 sm:py-7 flex flex-col sm:flex-row items-center justify-between gap-4"
              style={{
                background: `linear-gradient(135deg, ${P.wine900} 0%, ${P.wine700} 60%, ${P.wine600} 100%)`,
              }}
            >
              <div>
                <p
                  className="text-[10px] tracking-[0.28em] uppercase font-semibold"
                  style={{ color: `${P.cream2}cc` }}
                >
                  Professionnels
                </p>
                <p
                  className="serif mt-1.5 text-[18px] sm:text-[22px] font-semibold"
                  style={{ color: P.cream }}
                >
                  Accédez à nos tarifs et passez commande
                </p>
              </div>
              <Link
                href="/inscription"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold transition shrink-0"
                style={{ background: P.cream, color: P.wine800 }}
              >
                Créer un compte <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>
      )}
    </IssymaShell>
  );
}
