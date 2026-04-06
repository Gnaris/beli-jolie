"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";

interface CollectionItem {
  id: string;
  name: string;
  image: string | null;
}

interface Props {
  collections: CollectionItem[];
}

export default function CollectionsGrid({ collections }: Props) {
  const t = useTranslations("home");
  const tc = useTranslations("common");

  if (collections.length === 0) return null;

  return (
    <section className="py-16 bg-bg-primary">
      <div className="container-site">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-heading text-xl font-semibold text-text-primary">
            {t("collections")}
          </h2>
          <Link
            href="/collections"
            className="text-sm font-medium text-text-secondary hover:text-accent transition-colors font-body"
          >
            {tc("viewAll")} &rarr;
          </Link>
        </div>

        {/* Grid 2x2 */}
        <div className="grid grid-cols-2 gap-4 sm:gap-5">
          {collections.slice(0, 4).map((col, index) => (
            <Link
              key={col.id}
              href={`/collections/${col.id}`}
              className="group relative aspect-[4/3] rounded-[20px] overflow-hidden bg-bg-tertiary shadow-sm hover:shadow-md transition-all duration-300 animate-zoom-fade"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              {col.image ? (
                <Image
                  src={col.image}
                  alt={col.name}
                  fill
                  sizes="(max-width: 640px) 50vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.07]"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-bg-tertiary">
                  <svg
                    className="w-10 h-10 text-text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z"
                    />
                  </svg>
                </div>
              )}

              {/* Dark gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent group-hover:from-black/80 transition-colors" />

              {/* Label */}
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <p className="font-heading text-text-inverse font-semibold text-base leading-snug">
                  {col.name}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
