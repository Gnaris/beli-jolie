import { getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import IssymaShell from "@/components/issyma/IssymaShell";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";

const P = ISSYMA_PALETTE;

export interface CollectionsIssymaItem {
  id: string;
  slug: string | null;
  name: string;
  image: string | null;
  productCount: number;
}

export default async function CollectionsIssymaLayout({
  shopName,
  collections,
}: {
  shopName: string;
  collections: CollectionsIssymaItem[];
}) {
  const t = await getTranslations("collectionsPage");
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
            {t("intro", { shopName })}
          </p>
        </div>

        {/* GRILLE de tuiles blanches */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pb-14">
          {collections.length === 0 ? (
            <div className="text-center py-20 text-[14px]" style={{ color: P.inkSoft }}>
              {t("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {collections.map((col) => (
                <Link
                  key={col.id}
                  href={`/collections/${col.slug ?? col.id}`}
                  className="group relative rounded-2xl overflow-hidden block transition"
                  style={{
                    aspectRatio: "1 / 1",
                    border: `1px solid ${P.borderSoft}`,
                    background: P.blush100,
                  }}
                >
                  {/* Image plein cadre */}
                  {col.image ? (
                    <Image
                      src={col.image}
                      alt={col.name}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span
                        className="serif font-bold"
                        style={{ color: P.wine700, fontSize: "clamp(3rem, 5vw, 4.5rem)", lineHeight: 1 }}
                        aria-hidden="true"
                      >
                        {col.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                    </div>
                  )}

                  {/* Dégradé bas + libellé superposé */}
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-2/5 pointer-events-none"
                    style={{
                      background:
                        "linear-gradient(180deg, transparent 0%, rgba(42, 15, 21, 0.55) 60%, rgba(42, 15, 21, 0.85) 100%)",
                    }}
                  />
                  <p
                    className="absolute left-4 right-4 bottom-4 serif font-semibold text-[15px] sm:text-[17px] leading-tight"
                    style={{ color: P.cream }}
                  >
                    {col.name}
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
