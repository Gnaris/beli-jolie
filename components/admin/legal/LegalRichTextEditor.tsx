"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import { LEGAL_VARIABLE_LIST } from "@/lib/legal-templates";

interface LegalRichTextEditorProps {
  onChange: (html: string) => void;
  placeholder?: string;
  initialContent?: string;
}

export default function LegalRichTextEditor({
  onChange,
  placeholder = "Rédigez le contenu du document...",
  initialContent = "",
}: LegalRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);
  const [showVariables, setShowVariables] = useState(false);

  useEffect(() => {
    if (editorRef.current && !isInitialized.current) {
      editorRef.current.innerHTML = initialContent;
      isInitialized.current = true;
    }
  }, [initialContent]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const exec = useCallback(
    (command: string, value?: string) => {
      document.execCommand(command, false, value);
      editorRef.current?.focus();
      handleInput();
    },
    [handleInput]
  );

  const handleHeading = useCallback(
    (tag: string) => {
      exec("formatBlock", tag);
    },
    [exec]
  );

  const handleLink = useCallback(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() || "";
    const url = prompt(
      "URL du lien :",
      selectedText.startsWith("http") ? selectedText : "https://"
    );
    if (url) {
      exec("createLink", url);
    }
  }, [exec]);

  const insertVariable = useCallback(
    (key: string) => {
      const tag = `{{${key}}}`;
      // Insert as a styled span
      exec(
        "insertHTML",
        `<span class="legal-variable" contenteditable="false" data-variable="${key}" style="background:#E0F2FE;color:#0369A1;padding:1px 6px;border-radius:4px;font-size:0.85em;font-family:monospace;cursor:default;">${tag}</span>&nbsp;`
      );
      setShowVariables(false);
    },
    [exec]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case "b":
            e.preventDefault();
            exec("bold");
            break;
          case "i":
            e.preventDefault();
            exec("italic");
            break;
          case "u":
            e.preventDefault();
            exec("underline");
            break;
        }
      }
    },
    [exec]
  );

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-bg-secondary flex-wrap">
        {/* Headings dropdown */}
        <select
          onChange={(e) => {
            if (e.target.value) handleHeading(e.target.value);
            e.target.value = "";
          }}
          className="h-9 px-2 text-xs rounded bg-bg-primary border border-border text-text-primary cursor-pointer"
          aria-label="Format de titre"
          defaultValue=""
        >
          <option value="" disabled>
            Titre
          </option>
          <option value="h2">Titre 2</option>
          <option value="h3">Titre 3</option>
          <option value="h4">Titre 4</option>
          <option value="p">Paragraphe</option>
        </select>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton onClick={() => exec("bold")} title="Gras (Ctrl+B)" aria-label="Gras">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton onClick={() => exec("italic")} title="Italique (Ctrl+I)" aria-label="Italique">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton onClick={() => exec("underline")} title="Souligné (Ctrl+U)" aria-label="Souligné">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => exec("strikeThrough")}
          title="Barré"
          aria-label="Barré"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z" />
          </svg>
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          onClick={() => exec("insertUnorderedList")}
          title="Liste à puces"
          aria-label="Liste à puces"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => exec("insertOrderedList")}
          title="Liste numérotée"
          aria-label="Liste numérotée"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z" />
          </svg>
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton onClick={handleLink} title="Insérer un lien" aria-label="Insérer un lien">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton
          onClick={() => exec("removeFormat")}
          title="Supprimer le formatage"
          aria-label="Supprimer le formatage"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z" />
          </svg>
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Variable insertion */}
        <div className="relative">
          <ToolbarButton
            onClick={() => setShowVariables(!showVariables)}
            title="Insérer une variable"
            aria-label="Insérer une variable"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 7h4v2H4v6h4v2H2V7h2zm16 0h-4v2h4v6h-4v2h6V7h-2zM9 5h6v2H9V5zm0 12h6v2H9v-2zm-1-8h8v6H8v-6z" />
            </svg>
          </ToolbarButton>

          {showVariables && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowVariables(false)}
              />
              <div className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-lg z-50 w-64 max-h-72 overflow-y-auto">
                <div className="p-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold px-2 py-1">
                    Variables société
                  </p>
                  {LEGAL_VARIABLE_LIST.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-secondary rounded transition-colors text-left"
                    >
                      <code className="text-xs text-blue-600 bg-blue-50 px-1 rounded">
                        {`{{${v.key}}}`}
                      </code>
                      <span className="text-xs text-text-muted truncate">{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        className="min-h-[400px] max-h-[600px] overflow-y-auto p-4 text-sm text-text-primary font-body focus:outline-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-text-muted [&:empty]:before:pointer-events-none [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:font-heading [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:font-heading [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_li]:my-0.5 [&_a]:text-blue-600 [&_a]:underline [&_p]:my-1.5 [&_strong]:font-semibold"
        role="textbox"
        aria-label="Contenu du document légal"
        aria-multiline="true"
      />
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  children,
  ...props
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-9 h-9 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
      {...props}
    >
      {children}
    </button>
  );
}
