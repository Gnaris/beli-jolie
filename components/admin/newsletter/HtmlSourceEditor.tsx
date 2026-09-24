"use client";

/**
 * Éditeur de code HTML avec numéros de ligne (style VSCode léger).
 *
 * Un gutter à gauche affiche 1..N (font mono, line-height fixé), synchronisé
 * en scroll avec le textarea principal. Pas de highlight de ligne ni de
 * scroll programmatique — feedback simple type IDE.
 */

import { useMemo, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  heightClass?: string;
}

const LINE_HEIGHT = 20;
const PADDING_TOP = 8;

export function HtmlSourceEditor({
  value,
  onChange,
  onPaste,
  heightClass = "h-[560px]",
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const lineCount = useMemo(() => (value.match(/\n/g)?.length ?? 0) + 1, [value]);

  const handleScroll = () => {
    const ta = textareaRef.current;
    if (!ta || !gutterRef.current) return;
    gutterRef.current.scrollTop = ta.scrollTop;
  };

  return (
    <div className={`relative flex ${heightClass} rounded-lg border border-border bg-bg-primary overflow-hidden`}>
      <div
        ref={gutterRef}
        aria-hidden
        className="shrink-0 w-12 bg-bg-secondary text-text-muted text-xs font-mono text-right pr-2 select-none overflow-hidden border-r border-border"
        style={{ lineHeight: `${LINE_HEIGHT}px`, paddingTop: PADDING_TOP }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i + 1}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onScroll={handleScroll}
        spellCheck={false}
        className="flex-1 min-w-0 px-3 text-xs font-mono resize-none focus:outline-none bg-transparent text-text-primary block"
        style={{ lineHeight: `${LINE_HEIGHT}px`, paddingTop: PADDING_TOP, paddingBottom: PADDING_TOP }}
      />
    </div>
  );
}
