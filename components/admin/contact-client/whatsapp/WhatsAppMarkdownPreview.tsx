"use client";

import { Fragment } from "react";
import { tokenizeWhatsAppMarkdown } from "@/lib/whatsapp-markdown";

/**
 * Rend un texte au format markdown WhatsApp en JSX. Utilise
 * `tokenizeWhatsAppMarkdown` pour parser (pure, testé) puis mappe chaque
 * token à une balise React. Rendu 100 % React — le contenu utilisateur ne
 * transite jamais sous forme de HTML string, donc React échappe tout
 * automatiquement.
 */
export default function WhatsAppMarkdownPreview({ text, className }: { text: string; className?: string }) {
  const tokens = tokenizeWhatsAppMarkdown(text);
  return (
    <div className={className}>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case "text":
            return <Fragment key={i}>{t.content}</Fragment>;
          case "bold":
            return <strong key={i}>{t.content}</strong>;
          case "italic":
            return <em key={i}>{t.content}</em>;
          case "strike":
            return <s key={i}>{t.content}</s>;
          case "code":
            return (
              <code key={i} className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[13px]">
                {t.content}
              </code>
            );
          case "linebreak":
            return <br key={i} />;
        }
      })}
    </div>
  );
}
