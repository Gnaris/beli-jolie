"use client";

import { useState, useCallback, useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { updateImageExportFormats } from "@/app/actions/admin/site-config";
import type { ImageExportFormat, ImageExportFormatPattern } from "@/app/actions/admin/site-config";
import CustomSelect from "@/components/ui/CustomSelect";

const VARIABLES = [
  { key: "reference", label: "Référence", color: "bg-blue-100 text-blue-800 border-blue-300" },
  { key: "couleur", label: "Couleur", color: "bg-pink-100 text-pink-800 border-pink-300" },
  { key: "position", label: "Position", color: "bg-amber-100 text-amber-800 border-amber-300" },
] as const;

const EXTENSIONS = [
  { value: "jpg", label: "JPEG (.jpg)" },
  { value: "png", label: "PNG (.png)" },
  { value: "webp", label: "WebP (.webp)" },
];

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function buildPreview(pattern: ImageExportFormatPattern[], extension: string): string {
  const parts = pattern.map((p) => {
    if (p.type === "text") return p.value;
    if (p.value === "reference") return "BJ-001";
    if (p.value === "couleur") return "Rouge";
    if (p.value === "position") return "1";
    return "";
  });
  const name = parts.join("") || "nom-fichier";
  return `${name}.${extension}`;
}

interface Props {
  initialFormats: ImageExportFormat[];
}

export default function ImageExportFormatsConfig({ initialFormats }: Props) {
  const [formats, setFormats] = useState<ImageExportFormat[]>(initialFormats);
  const [saving, setSaving] = useState(false);
  const { success, error } = useToast();

  const addFormat = useCallback(() => {
    setFormats((prev) => [
      ...prev,
      {
        id: generateId(),
        name: "",
        pattern: [
          { type: "variable", value: "reference" },
          { type: "text", value: "_" },
          { type: "variable", value: "couleur" },
          { type: "text", value: "-" },
          { type: "variable", value: "position" },
        ],
        extension: "jpg",
        width: null,
        height: null,
      },
    ]);
  }, []);

  const removeFormat = useCallback((id: string) => {
    setFormats((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const updateFormat = useCallback((id: string, updates: Partial<ImageExportFormat>) => {
    setFormats((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const res = await updateImageExportFormats(formats);
    setSaving(false);
    if (res.success) {
      success("Formats d'export sauvegardés.");
    } else {
      error(res.error || "Erreur lors de la sauvegarde.");
    }
  }, [formats, success, error]);

  return (
    <div className="space-y-6">
      {formats.map((format) => (
        <FormatCard
          key={format.id}
          format={format}
          onUpdate={(updates) => updateFormat(format.id, updates)}
          onRemove={() => removeFormat(format.id)}
        />
      ))}

      <button
        type="button"
        onClick={addFormat}
        className="w-full py-3 border-2 border-dashed border-border rounded-xl text-sm font-body text-text-secondary hover:border-text-muted hover:text-text-primary transition-colors"
      >
        + Ajouter un format d&apos;image
      </button>

      {formats.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? "Sauvegarde..." : "Sauvegarder les formats"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Format Card ──────────────────────────────────────────────────────────────

interface FormatCardProps {
  format: ImageExportFormat;
  onUpdate: (updates: Partial<ImageExportFormat>) => void;
  onRemove: () => void;
}

function FormatCard({ format, onUpdate, onRemove }: FormatCardProps) {
  const [useCustomSize, setUseCustomSize] = useState(format.width !== null && format.height !== null);

  return (
    <div className="border border-border rounded-xl p-4 space-y-4 bg-bg-secondary/30">
      {/* Header: Name + Delete */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={format.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Nom du format (= nom du dossier)"
          className="flex-1 input-field text-sm"
        />
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-text-muted hover:text-error transition-colors rounded-lg hover:bg-red-50"
          title="Supprimer ce format"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </div>

      {/* Pattern builder with drag & drop */}
      <div>
        <label className="text-xs font-medium text-text-secondary mb-2 block">Modèle de nom de fichier</label>
        <PatternBuilder
          pattern={format.pattern}
          onChange={(pattern) => onUpdate({ pattern })}
        />
      </div>

      {/* Extension + Dimensions */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-44">
          <label className="text-xs font-medium text-text-secondary mb-1 block">Extension</label>
          <CustomSelect
            value={format.extension}
            onChange={(val) => onUpdate({ extension: val as "jpg" | "png" | "webp" })}
            options={EXTENSIONS}
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-text-secondary flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useCustomSize}
              onChange={(e) => {
                setUseCustomSize(e.target.checked);
                if (!e.target.checked) onUpdate({ width: null, height: null });
              }}
              className="rounded border-border"
            />
            Dimensions personnalisées
          </label>
        </div>

        {useCustomSize && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={format.width ?? ""}
              onChange={(e) => onUpdate({ width: e.target.value ? Number(e.target.value) : null })}
              placeholder="Largeur"
              className="input-field text-sm w-24"
            />
            <span className="text-text-muted text-sm">x</span>
            <input
              type="number"
              min={1}
              value={format.height ?? ""}
              onChange={(e) => onUpdate({ height: e.target.value ? Number(e.target.value) : null })}
              placeholder="Hauteur"
              className="input-field text-sm w-24"
            />
            <span className="text-xs text-text-muted">px</span>
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="text-xs text-text-muted font-body">
        Aperçu : <span className="font-medium text-text-primary">{buildPreview(format.pattern, format.extension)}</span>
      </div>
    </div>
  );
}

// ─── Pattern Builder (drag & drop) ───────────────────────────────────────────

interface PatternBuilderProps {
  pattern: ImageExportFormatPattern[];
  onChange: (pattern: ImageExportFormatPattern[]) => void;
}

function PatternBuilder({ pattern, onChange }: PatternBuilderProps) {
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDragStart = (e: React.DragEvent, variableKey: string) => {
    e.dataTransfer.setData("variable", variableKey);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const variableKey = e.dataTransfer.getData("variable");
    if (!variableKey) return;
    onChange([...pattern, { type: "variable", value: variableKey }]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const removeItem = (index: number) => {
    onChange(pattern.filter((_, i) => i !== index));
  };

  const handleTextChange = (index: number, value: string) => {
    const updated = [...pattern];
    updated[index] = { type: "text", value };
    onChange(updated);
  };

  const addTextSegment = () => {
    onChange([...pattern, { type: "text", value: "_" }]);
  };

  return (
    <div className="space-y-3">
      {/* Drop zone / pattern display */}
      <div
        ref={dropZoneRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`min-h-[48px] flex flex-wrap items-center gap-1.5 p-3 border-2 rounded-xl transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-50/50"
            : "border-border bg-bg-primary"
        }`}
      >
        {pattern.length === 0 && (
          <span className="text-sm text-text-muted italic">
            Glissez les variables ici ou ajoutez du texte...
          </span>
        )}
        {pattern.map((item, idx) => (
          <PatternItem
            key={idx}
            item={item}
            onRemove={() => removeItem(idx)}
            onTextChange={(val) => handleTextChange(idx, val)}
          />
        ))}
      </div>

      {/* Available variables to drag */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-muted">Variables :</span>
        {VARIABLES.map((v) => (
          <span
            key={v.key}
            draggable
            onDragStart={(e) => handleDragStart(e, v.key)}
            className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border cursor-grab active:cursor-grabbing select-none ${v.color}`}
          >
            {v.label}
          </span>
        ))}
        <button
          type="button"
          onClick={addTextSegment}
          className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
        >
          + Texte
        </button>
      </div>
    </div>
  );
}

// ─── Pattern Item (tag or text input) ─────────────────────────────────────────

interface PatternItemProps {
  item: ImageExportFormatPattern;
  onRemove: () => void;
  onTextChange: (value: string) => void;
}

function PatternItem({ item, onRemove, onTextChange }: PatternItemProps) {
  if (item.type === "variable") {
    const varDef = VARIABLES.find((v) => v.key === item.value);
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border ${varDef?.color || "bg-gray-100 text-gray-800 border-gray-300"}`}>
        {varDef?.label || item.value}
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 hover:opacity-70 transition-opacity"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </span>
    );
  }

  // Text segment — inline editable
  return (
    <span className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-1">
      <input
        type="text"
        value={item.value}
        onChange={(e) => onTextChange(e.target.value)}
        className="w-16 min-w-[2rem] max-w-[8rem] text-xs font-mono bg-transparent border-none outline-none py-1 px-1 text-text-primary"
        style={{ width: `${Math.max(2, item.value.length * 0.6)}rem` }}
        placeholder="_"
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-text-muted hover:text-error transition-colors"
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </span>
  );
}
