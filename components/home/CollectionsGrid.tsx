"use client";

import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";
import { useProductTranslation } from "@/hooks/useProductTranslation";

interface CollectionItem {
  id: string;
  name: string;
  image: string | null;
  _count?: { products: number };
}

interface Props {
  collections: CollectionItem[];
}

function CollectionCard({
  collection,
  large = false,
  sizes,
}: {
  collection: CollectionItem;
  large?: boolean;
  sizes: string;
}) {
  const { tp } = useProductTranslation();
  const t = useTranslations("home");
  const productCount = collection._count?.products ?? 0;

  return (
    <Link href={`/collections/${collection.id}`} className="group block h-full">
      <div className="relative w-full h-full rounded-3xl overflow-hidden bg-bg-darker">
        {collection.image ? (
          <Image
            src={collection.image}
            alt={collection.name}
            fill
            sizes={sizes}
            className="object-cover opacity-90 transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-bg-dark to-bg-darker" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-darker/85 via-bg-darker/20 to-transparent" />
        <div className={`absolute inset-0 flex flex-col justify-end text-white ${large ? "p-8" : "p-5"}`}>
          {productCount > 0 && (
            <p className={`uppercase tracking-[0.3em] text-white/60 mb-2 ${large ? "text-[11px]" : "text-[10px] mb-1"}`}>
              {t("collectionsProducts", { count: productCount })}
            </p>
          )}
          <h3 className={`font-heading font-bold ${large ? "text-3xl lg:text-4xl" : "text-xl"}`}>
            {tp(collection.name)}
          </h3>
          {large && (
            <span className="mt-4 inline-flex items-center gap-2 text-sm text-white group-hover:gap-3 transition-all">
              Découvrir <span aria-hidden>→</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function CollectionsGrid({ collections }: Props) {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  if (collections.length === 0) return null;

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-primary py-20 lg:py-24">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-2">À explorer</p>
            <h2
              className="font-heading font-bold text-text-primary"
              style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", letterSpacing: "-0.02em" }}
            >
              {t("collectionsTitle")}
            </h2>
          </div>
        </div>

        {collections.length >= 4 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="col-span-2 row-span-2 aspect-square lg:aspect-auto">
              <CollectionCard collection={collections[0]} large sizes="(min-width: 1024px) 50vw, 100vw" />
            </div>
            <div className="aspect-square">
              <CollectionCard collection={collections[1]} sizes="(min-width: 1024px) 25vw, 50vw" />
            </div>
            <div className="aspect-square">
              <CollectionCard collection={collections[2]} sizes="(min-width: 1024px) 25vw, 50vw" />
            </div>
            <div className="aspect-square">
              <CollectionCard collection={collections[3]} sizes="(min-width: 1024px) 25vw, 50vw" />
            </div>
            {collections[4] && (
              <div className="aspect-square">
                <CollectionCard collection={collections[4]} sizes="(min-width: 1024px) 25vw, 50vw" />
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {collections.map((col) => (
              <div key={col.id} className="aspect-square">
                <CollectionCard collection={col} sizes="(min-width: 640px) 33vw, 100vw" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
