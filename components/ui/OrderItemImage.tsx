"use client";

import { useState } from "react";
import Image from "next/image";

interface OrderItemImageProps {
  src: string | null;
  alt: string;
  /** Tailwind classes for the outer container size, e.g. "w-12 h-12 sm:w-16 sm:h-16" */
  sizeClass?: string;
}

export default function OrderItemImage({ src, alt, sizeClass = "w-14 h-14" }: OrderItemImageProps) {
  const [open, setOpen] = useState(false);

  if (!src) {
    return (
      <div className={`${sizeClass} shrink-0 bg-bg-tertiary border border-border rounded-lg overflow-hidden flex items-center justify-center`}>
        <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
        </svg>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${sizeClass} shrink-0 bg-bg-tertiary border border-border rounded-lg overflow-hidden cursor-zoom-in transition-shadow hover:shadow-md`}
      >
        <Image src={src} alt={alt} width={80} height={80} unoptimized className="w-full h-full object-cover" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/90 sm:bg-black/80 flex items-center justify-center p-0 sm:p-4 animate-lightbox-in touch-manipulation"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[100dvh] max-w-[100vw] sm:max-h-[90vh] sm:max-w-[90vw] object-contain sm:shadow-2xl sm:rounded-xl animate-lightbox-img-in touch-pinch-zoom"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 w-11 h-11 sm:w-9 sm:h-9 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl backdrop-blur-sm transition-transform hover:scale-110 animate-zoom-fade"
          >
            &times;
          </button>
        </div>
      )}
    </>
  );
}
