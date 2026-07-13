"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
}

/**
 * Iframe Roundcube full-height. Détecte si l'iframe n'a jamais chargé
 * (probable blocage CSP frame-ancestors ou X-Frame-Options) et propose
 * un fallback « ouvrir dans un nouvel onglet ».
 */
export default function MessagerieFrame({ src }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [tookTooLong, setTookTooLong] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    // Si l'iframe ne charge pas dans 8s, on assume qu'elle est bloquée par le navigateur
    const t = window.setTimeout(() => {
      if (!loaded) setTookTooLong(true);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [loaded]);

  return (
    <div className="relative rounded-2xl border border-zinc-200 bg-white overflow-hidden shadow-sm" style={{ height: "calc(100vh - 180px)", minHeight: 520 }}>
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-50 z-10">
          <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
          <p className="text-sm text-zinc-600">Chargement de votre boîte mail…</p>
          {tookTooLong && (
            <div className="mt-2 max-w-sm text-center px-6">
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Votre navigateur bloque peut-être l'intégration.{" "}
                <a href={src} target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                  Cliquez ici pour ouvrir la messagerie dans un nouvel onglet.
                </a>
              </p>
            </div>
          )}
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={src}
        title="Webmail Roundcube"
        onLoad={() => setLoaded(true)}
        className="w-full h-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
