"use client";

import { forwardRef } from "react";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  /** True quand la traduction est en cours — affiche l'overlay et désactive la saisie. */
  translating: boolean;
  /** Classe du wrapper `<div>` qui porte l'overlay. Par défaut adapté à un flex parent. */
  wrapperClassName?: string;
}

/**
 * Input textuel qui affiche un overlay « Traduction en cours… » (avec spinner)
 * par-dessus lui-même quand `translating=true`. L'input reste dans le DOM
 * (les props `value`/`onChange` restent contrôlées) mais devient `disabled`
 * le temps de la traduction — l'utilisateur ne peut pas taper par-dessus.
 */
const TranslatingInput = forwardRef<HTMLInputElement, Props>(function TranslatingInput(
  { translating, wrapperClassName = "relative flex-1 min-w-0", className, disabled, ...inputProps },
  ref,
) {
  return (
    <div className={wrapperClassName}>
      <input
        ref={ref}
        {...inputProps}
        disabled={translating || disabled}
        aria-busy={translating}
        className={className}
      />
      {translating && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-bg-primary/95 text-text-secondary text-xs font-medium pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <span
            className="w-3.5 h-3.5 border-2 border-text-secondary/30 border-t-text-secondary rounded-full animate-spin"
            aria-hidden
          />
          Traduction en cours…
        </div>
      )}
    </div>
  );
});

export default TranslatingInput;
