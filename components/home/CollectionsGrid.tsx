"use client";

import { Link } from "@/i18n/navigation";
import Image from "next/image";
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
  className,
  sizes,
}: {
  collection: CollectionItem;
  className?: string;
  sizes: string;
}) {
  const { tp } = useProductTranslation();
  const t = useTranslations("home");
  const productCount = collection._count?.products ?? 0;

  return (
    <Link href={`/collections/${collection.id}`} className={`group block ${className ?? ""}`}>
      <div className="relative w-full h-full rounded-2xl overflow-hidden bg-bg-secondary">
        {collection.image ? (
          <Image
            src={collection.image}
            alt={collection.name}
            fill
            sizes={sizes}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-bg-tertiary" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-0 inset-x-0 p-5 flex items-end justify-between">
          <div>
            <h3 className="font-heading font-semibold text-white text-lg">{tp(collection.name)}</h3>
            {productCount > 0 && (
              <p className="font-body text-white/60 text-sm mt-0.5">{t("collectionsProducts", { count: productCount })}</p>
            )}
          </div>
          <span className="text-white/0 group-hover:text-white/80 transition-colors duration-300 text-lg">→</span>
        </div>
      </div>
    </Link>
  );
}

export default function CollectionsGrid({ collections }: Props) {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  if (collections.length === 0) return null;

  const [large, med1, med2, wide] = collections;

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-secondary py-16 lg:py-20">
      <div className="container-site" style={{ maxWidth: "1200px" }}>
        <div className="flex items-center gap-4 justify-center mb-10">
          <div className="h-px flex-1 max-w-[80px] bg-border" />
          <h2 className="font-heading text-lg font-semibold text-text-primary tracking-wide uppercase">{t("collectionsTitle")}</h2>
          <div className="h-px flex-1 max-w-[80px] bg-border" />
        </div>

        {collections.length >= 4 ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 lg:row-span-2 min-h-[280px] lg:min-h-[500px]">
              <CollectionCard collection={large} className="h-full" sizes="(min-width: 1024px) 60vw, 100vw" />
            </div>
            <div className="lg:col-span-2 min-h-[200px] lg:min-h-0">
              <CollectionCard collection={med1} className="h-full" sizes="(min-width: 1024px) 40vw, 100vw" />
            </div>
            <div className="lg:col-span-2 min-h-[200px] lg:min-h-0">
              <CollectionCard collection={med2} className="h-full" sizes="(min-width: 1024px) 40vw, 100vw" />
            </div>
            <div className="lg:col-span-5 min-h-[180px] lg:min-h-[200px]">
              <CollectionCard collection={wide} className="h-full" sizes="100vw" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {collections.map((col) => (
              <div key={col.id} className="min-h-[250px]">
                <CollectionCard collection={col} className="h-full" sizes="(min-width: 640px) 50vw, 100vw" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
