"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  initializeLegalDocuments,
  saveLegalDocument,
  toggleLegalDocument,
  getLegalDocumentVersions,
  rollbackLegalDocument,
} from "@/app/actions/admin/legal-documents";
import { LEGAL_VARIABLE_LIST } from "@/lib/legal-templates";
import LegalRichTextEditor from "./LegalRichTextEditor";
import type { LegalDocumentType } from "@prisma/client";

interface DocumentData {
  id: string;
  type: LegalDocumentType;
  title: string;
  content: string;
  isActive: boolean;
  updatedAt: string;
  createdAt: string;
  _count: { versions: number };
}

interface VersionData {
  id: string;
  content: string;
  companyInfoSnapshot: string;
  changeNote: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<LegalDocumentType, { label: string; icon: string; slug: string; mandatory: boolean }> = {
  MENTIONS_LEGALES: { label: "Mentions légales", icon: "M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z", slug: "mentions-legales", mandatory: true },
  CGV: { label: "CGV", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", slug: "cgv", mandatory: true },
  CGU: { label: "CGU", icon: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25", slug: "cgu", mandatory: false },
  POLITIQUE_CONFIDENTIALITE: { label: "Politique de confidentialité", icon: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z", slug: "confidentialite", mandatory: true },
  COOKIES: { label: "Politique de cookies", icon: "M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.379a48.474 48.474 0 00-6-.371c-2.032 0-4.034.126-6 .371m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.169c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12M12.265 3.11a.375.375 0 11-.53 0L12 2.845l.265.265z", slug: "cookies", mandatory: true },
};

interface Props {
  documents: DocumentData[];
  hasCompanyInfo: boolean;
}

export default function LegalDocumentsClient({ documents, hasCompanyInfo }: Props) {
  const [docs, setDocs] = useState(documents);
  const [editingDoc, setEditingDoc] = useState<DocumentData | null>(null);
  const [editContent, setEditContent] = useState("");
  const [versions, setVersions] = useState<VersionData[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<VersionData | null>(null);
  const [previewVersion, setPreviewVersion] = useState<VersionData | null>(null);
  const [rollbackStrategy, setRollbackStrategy] = useState<"content_only" | "content_and_company" | "content_with_current_company">("content_with_current_company");
  const [showGuide, setShowGuide] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Initialize default documents
  const handleInitialize = () => {
    startTransition(async () => {
      const result = await initializeLegalDocuments();
      if (result.success && result.created > 0) {
        window.location.reload();
      }
    });
  };

  // Open editor for a document
  const handleEdit = useCallback((doc: DocumentData) => {
    setEditingDoc(doc);
    setEditContent(doc.content);
    setShowVersions(false);
    setSelectedVersion(null);
    setPreviewVersion(null);
    setMessage(null);
    setShowGuide(false);
  }, []);

  // Save document
  const handleSave = () => {
    if (!editingDoc) return;
    setMessage(null);
    startTransition(async () => {
      const result = await saveLegalDocument(editingDoc.type, editContent);
      if (result.success) {
        setMessage({ type: "success", text: "Document enregistré avec succès." });
        setDocs((prev) =>
          prev.map((d) =>
            d.id === editingDoc.id
              ? { ...d, content: editContent, updatedAt: new Date().toISOString(), _count: { versions: d._count.versions + 1 } }
              : d
          )
        );
        setEditingDoc((prev) => prev ? { ...prev, content: editContent, updatedAt: new Date().toISOString(), _count: { versions: prev._count.versions + 1 } } : null);
      } else {
        setMessage({ type: "error", text: result.error || "Erreur lors de l'enregistrement." });
      }
    });
  };

  // Toggle active
  const handleToggle = (doc: DocumentData) => {
    startTransition(async () => {
      const result = await toggleLegalDocument(doc.type, !doc.isActive);
      if (result.success) {
        setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, isActive: !d.isActive } : d)));
      }
    });
  };

  // Load version history — separate loading state to avoid blocking UI
  const handleShowVersions = async () => {
    if (!editingDoc) return;
    if (showVersions) {
      setShowVersions(false);
      setSelectedVersion(null);
      setPreviewVersion(null);
      return;
    }
    setLoadingVersions(true);
    try {
      const result = await getLegalDocumentVersions(editingDoc.id);
      setVersions(JSON.parse(JSON.stringify(result)));
      setShowVersions(true);
      setSelectedVersion(null);
      setPreviewVersion(null);
    } finally {
      setLoadingVersions(false);
    }
  };

  // Rollback to version
  const handleRollback = () => {
    if (!selectedVersion) return;
    startTransition(async () => {
      const result = await rollbackLegalDocument(selectedVersion.id, rollbackStrategy);
      if (result.success) {
        setMessage({ type: "success", text: "Version restaurée avec succès." });
        setShowVersions(false);
        setSelectedVersion(null);
        setPreviewVersion(null);
        window.location.reload();
      } else {
        setMessage({ type: "error", text: result.error || "Erreur lors de la restauration." });
      }
    });
  };

  // No documents yet — show init button
  if (docs.length === 0) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center">
        {!hasCompanyInfo && (
          <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <strong>Conseil :</strong> Renseignez d&apos;abord les{" "}
            <Link href="/admin/parametres" className="underline font-medium">
              informations société
            </Link>{" "}
            dans les paramètres pour que les variables soient pré-remplies dans les documents.
          </div>
        )}
        <div className="w-16 h-16 rounded-2xl bg-bg-secondary flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <h3 className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-text-primary mb-2">
          Aucun document légal
        </h3>
        <p className="text-sm text-text-secondary mb-6 max-w-md mx-auto">
          Initialisez les documents légaux avec des templates pré-remplis (Mentions légales, CGV, CGU, Politique de confidentialité, Cookies).
        </p>
        <button onClick={handleInitialize} disabled={isPending} className="btn-primary mx-auto">
          {isPending ? "Initialisation..." : "Initialiser les documents"}
        </button>
      </div>
    );
  }

  // ─── Editor mode ────────────────────────────────────────────────
  if (editingDoc) {
    const typeInfo = TYPE_LABELS[editingDoc.type];
    return (
      <div className="space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <button onClick={() => setEditingDoc(null)} className="hover:text-text-primary transition-colors">
            Documents légaux
          </button>
          <span>/</span>
          <span className="text-text-primary font-medium">{typeInfo.label}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEditingDoc(null)}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-border hover:bg-bg-secondary transition-colors"
              aria-label="Retour"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <div>
              <h2 className="font-[family-name:var(--font-poppins)] text-lg font-semibold text-text-primary">
                {typeInfo.label}
              </h2>
              <p className="text-xs text-text-muted">
                Dernière modification : {new Date(editingDoc.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`btn-secondary text-sm ${showGuide ? "ring-2 ring-blue-300" : ""}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
              Guide
            </button>
            <button
              onClick={handleShowVersions}
              disabled={loadingVersions}
              className={`btn-secondary text-sm ${showVersions ? "ring-2 ring-blue-300" : ""}`}
            >
              {loadingVersions ? (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              Historique ({editingDoc._count.versions})
            </button>
            <button onClick={handleSave} disabled={isPending} className="btn-primary text-sm">
              {isPending ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </div>

        {message && (
          <div className={`rounded-lg px-4 py-3 text-sm ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message.text}
          </div>
        )}

        {/* Guide des variables */}
        {showGuide && (
          <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
                  Guide des variables
                </h3>
              </div>
              <button onClick={() => setShowGuide(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors" aria-label="Fermer le guide">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-text-secondary mb-4">
              Les variables sont remplacées automatiquement par les informations de votre société (configurées dans{" "}
              <Link href="/admin/parametres" className="text-blue-600 underline">Paramètres &gt; Informations société</Link>).
              Insérez-les via le bouton <code className="bg-bg-secondary px-1.5 py-0.5 rounded text-xs font-mono">{"{{}}"}</code> dans la barre d&apos;outils.
            </p>

            <div className="border border-border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-px bg-border text-xs font-semibold">
                <div className="bg-bg-secondary px-3 py-2 text-text-secondary uppercase tracking-wider">Variable</div>
                <div className="bg-bg-secondary px-3 py-2 text-text-secondary uppercase tracking-wider">Description</div>
                <div className="bg-bg-secondary px-3 py-2 text-text-secondary uppercase tracking-wider">Exemple</div>
              </div>
              <div className="divide-y divide-border">
                {LEGAL_VARIABLE_LIST.map((v) => (
                  <div key={v.key} className="grid grid-cols-[1fr_1fr_auto] gap-px bg-border">
                    <div className="bg-bg-primary px-3 py-2">
                      <code className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-mono">{`{{${v.key}}}`}</code>
                    </div>
                    <div className="bg-bg-primary px-3 py-2 text-xs text-text-primary">{v.label}</div>
                    <div className="bg-bg-primary px-3 py-2 text-xs text-text-muted italic">{getVariableExample(v.key)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Editor */}
        <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <LegalRichTextEditor
            key={editingDoc.id}
            initialContent={editingDoc.content}
            onChange={setEditContent}
          />
        </div>

        {/* Version history panel */}
        {showVersions && (
          <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
              <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-text-primary">
                Historique des versions
              </h3>
              <button onClick={() => { setShowVersions(false); setSelectedVersion(null); setPreviewVersion(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors" aria-label="Fermer l'historique">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {versions.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-8">Aucun historique disponible.</p>
            ) : (
              <div className="flex flex-col lg:flex-row">
                {/* Version list */}
                <div className="lg:w-80 lg:border-r border-border shrink-0">
                  <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
                    {versions.map((version, idx) => {
                      const isSelected = selectedVersion?.id === version.id;
                      const isPreviewed = previewVersion?.id === version.id;
                      const isCurrent = idx === 0;
                      return (
                        <div
                          key={version.id}
                          className={`px-4 py-3 cursor-pointer transition-colors ${
                            isPreviewed ? "bg-blue-50 border-l-2 border-l-blue-500" :
                            isSelected ? "bg-amber-50 border-l-2 border-l-amber-500" :
                            "hover:bg-bg-secondary border-l-2 border-l-transparent"
                          }`}
                          onClick={() => {
                            setPreviewVersion(version);
                            if (!isCurrent) setSelectedVersion(version);
                            else setSelectedVersion(null);
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-text-primary truncate">
                                  {isCurrent
                                    ? "Version actuelle"
                                    : new Date(version.createdAt).toLocaleDateString("fr-FR", {
                                        day: "2-digit",
                                        month: "2-digit",
                                        year: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                </p>
                                {isCurrent && (
                                  <span className="shrink-0 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                                    Actuelle
                                  </span>
                                )}
                              </div>
                              {version.changeNote && (
                                <p className="text-xs text-text-muted mt-0.5 truncate">{version.changeNote}</p>
                              )}
                            </div>
                            {isPreviewed && (
                              <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Preview + rollback */}
                <div className="flex-1 min-w-0">
                  {previewVersion ? (
                    <div className="flex flex-col h-full">
                      {/* Preview header */}
                      <div className="px-4 sm:px-6 py-3 border-b border-border bg-bg-secondary flex items-center justify-between gap-2">
                        <p className="text-xs text-text-secondary font-medium">
                          Aperçu — {versions.indexOf(previewVersion) === 0 ? "Version actuelle" : new Date(previewVersion.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                        {previewVersion.changeNote && (
                          <span className="text-xs text-text-muted bg-bg-primary px-2 py-0.5 rounded border border-border truncate max-w-[200px]">
                            {previewVersion.changeNote}
                          </span>
                        )}
                      </div>

                      {/* Preview content */}
                      <div className="p-4 sm:p-6 max-h-[400px] overflow-y-auto">
                        <article
                          className="prose prose-sm max-w-none text-sm font-[family-name:var(--font-roboto)] text-text-primary
                            [&_h2]:text-base [&_h2]:font-semibold [&_h2]:font-[family-name:var(--font-poppins)] [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-text-primary
                            [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:font-[family-name:var(--font-poppins)] [&_h3]:mt-3 [&_h3]:mb-1
                            [&_p]:my-1.5 [&_p]:leading-relaxed
                            [&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc
                            [&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal
                            [&_li]:my-0.5
                            [&_a]:text-blue-600 [&_a]:underline
                            [&_strong]:font-semibold
                            [&_code]:bg-bg-secondary [&_code]:px-1 [&_code]:rounded [&_code]:text-xs"
                          dangerouslySetInnerHTML={{ __html: previewVersion.content }}
                        />
                      </div>

                      {/* Rollback actions (only for non-current versions) */}
                      {selectedVersion && versions.indexOf(selectedVersion) > 0 && (
                        <div className="px-4 sm:px-6 py-4 border-t border-border bg-bg-secondary">
                          <h4 className="text-sm font-semibold text-text-primary mb-3">
                            Restaurer cette version
                          </h4>
                          <CompanyInfoDiffCheck
                            versionSnapshot={selectedVersion.companyInfoSnapshot}
                            rollbackStrategy={rollbackStrategy}
                            onStrategyChange={setRollbackStrategy}
                          />
                          <div className="flex items-center gap-2 mt-4">
                            <button
                              onClick={handleRollback}
                              disabled={isPending}
                              className="btn-primary text-sm"
                            >
                              {isPending ? "Restauration..." : "Restaurer cette version"}
                            </button>
                            <button
                              onClick={() => { setSelectedVersion(null); setPreviewVersion(null); }}
                              className="btn-secondary text-sm"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-text-muted">
                      <div className="text-center">
                        <svg className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <p className="text-sm">Cliquez sur une version pour voir l&apos;aperçu</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── List mode ────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {!hasCompanyInfo && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <strong>Attention :</strong> Les{" "}
          <Link href="/admin/parametres" className="underline font-medium">
            informations société
          </Link>{" "}
          ne sont pas encore renseignées. Les variables dans les documents ne seront pas remplacées.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {docs.map((doc) => {
          const typeInfo = TYPE_LABELS[doc.type];
          return (
            <div
              key={doc.id}
              className="bg-bg-primary border border-border rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-bg-secondary flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={typeInfo.icon} />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary">
                      {typeInfo.label}
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      {doc._count.versions} version{doc._count.versions > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {typeInfo.mandatory ? (
                    <span className="badge badge-info text-[10px]">Obligatoire</span>
                  ) : (
                    <span className="badge badge-neutral text-[10px]">Optionnel</span>
                  )}
                  <button
                    onClick={() => handleToggle(doc)}
                    disabled={isPending}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${doc.isActive ? "bg-green-500" : "bg-gray-300"}`}
                    aria-label={doc.isActive ? "Désactiver" : "Activer"}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${doc.isActive ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <p className="text-xs text-text-muted">
                  Modifié le {new Date(doc.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/${typeInfo.slug}`}
                    target="_blank"
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
                    title="Voir la page publique"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </Link>
                  <button
                    onClick={() => handleEdit(doc)}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    Modifier
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Variable examples ────────────────────────────────────────

function getVariableExample(key: string): string {
  const examples: Record<string, string> = {
    company_name: "Nom de la société",
    legal_form: "SAS",
    capital: "10 000",
    siret: "123 456 789 00012",
    rcs: "Paris B 123 456 789",
    tva_number: "FR12345678901",
    address: "12 rue de la Paix",
    city: "Paris",
    postal_code: "75001",
    country: "France",
    phone: "01 23 45 67 89",
    email: "contact@example.com",
    website: "www.example.com",
    director: "Jean Dupont",
    host_name: "Vercel Inc.",
    host_address: "340 S Lemon Ave",
    host_phone: "+1 (559) 288-7060",
    host_email: "privacy@vercel.com",
  };
  return examples[key] || "—";
}

// ─── Company info diff check for rollback ─────────────────────────

function CompanyInfoDiffCheck({
  versionSnapshot,
  rollbackStrategy,
  onStrategyChange,
}: {
  versionSnapshot: string;
  rollbackStrategy: string;
  onStrategyChange: (s: "content_only" | "content_and_company" | "content_with_current_company") => void;
}) {
  let snapshotData: Record<string, string> = {};
  try {
    snapshotData = JSON.parse(versionSnapshot);
  } catch {
    // invalid snapshot
  }

  const hasData = Object.keys(snapshotData).length > 0 && snapshotData.name;

  if (!hasData) {
    return (
      <p className="text-xs text-text-muted">
        Aucune information société associée à cette version.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
        Cette version a été créée avec des informations société potentiellement différentes. Choisissez comment restaurer :
      </p>
      <label className="flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-bg-primary cursor-pointer">
        <input
          type="radio"
          name="strategy"
          value="content_with_current_company"
          checked={rollbackStrategy === "content_with_current_company"}
          onChange={() => onStrategyChange("content_with_current_company")}
          className="mt-0.5"
        />
        <div>
          <p className="text-sm font-medium text-text-primary">Reprendre le contenu avec les infos société actuelles</p>
          <p className="text-xs text-text-muted">Le contenu sera restauré mais les variables afficheront vos infos société actuelles.</p>
        </div>
      </label>
      <label className="flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-bg-primary cursor-pointer">
        <input
          type="radio"
          name="strategy"
          value="content_and_company"
          checked={rollbackStrategy === "content_and_company"}
          onChange={() => onStrategyChange("content_and_company")}
          className="mt-0.5"
        />
        <div>
          <p className="text-sm font-medium text-text-primary">Tout restaurer (contenu + infos société)</p>
          <p className="text-xs text-text-muted">Le contenu ET les informations société seront restaurés à l&apos;état de cette version.</p>
        </div>
      </label>
      <label className="flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-bg-primary cursor-pointer">
        <input
          type="radio"
          name="strategy"
          value="content_only"
          checked={rollbackStrategy === "content_only"}
          onChange={() => onStrategyChange("content_only")}
          className="mt-0.5"
        />
        <div>
          <p className="text-sm font-medium text-text-primary">Restaurer uniquement le contenu</p>
          <p className="text-xs text-text-muted">Le contenu sera restauré sans toucher aux informations société.</p>
        </div>
      </label>
    </div>
  );
}
