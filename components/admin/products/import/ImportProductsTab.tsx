"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CustomSelect from "@/components/ui/CustomSelect";
import { revalidateAfterImport } from "@/app/actions/admin/products";
import type { PreviewResult, PreviewProduct, MissingEntity } from "@/app/api/admin/products/import/preview/route";

// PFS attribute types for mapping dropdowns
interface PfsColor { reference: string; value: string; image: string | null; labels: Record<string, string> }
interface PfsCategory { id: string; family: { id: string }; labels: Record<string, string>; gender: string }
interface PfsComposition { id: string; reference: string; labels: Record<string, string> }
interface PfsFamily { id: string; labels: Record<string, string>; gender: string }
interface PfsGender { reference: string; labels: Record<string, string> }
interface PfsAttributes {
  colors: PfsColor[];
  categories: PfsCategory[];
  compositions: PfsComposition[];
  families: PfsFamily[];
  genders: PfsGender[];
  pfsDisabled?: boolean;
}

const TEMPLATE_JSON = JSON.stringify(
  [
    // ─── 1. T-shirt basique : 1 couleur, UNIT, simple ───
    {
      reference: "TSH-001",
      name: "T-shirt Essentiel",
      description: "T-shirt col rond en coton bio, coupe droite",
      category: "T-shirts",
      sub_categories: ["Basiques"],
      tags: ["basique", "coton", "essentiel"],
      compositions: [{ material: "Coton", percentage: 100 }],
      season: "Été 2026",
      manufacturing_country: "Portugal",
      similar_refs: ["TSH-002"],
      colors: [
        { color: "Blanc", saleType: "UNIT", unitPrice: 14.90, stock: 500, weight: 180, isPrimary: true, size: "M" },
      ],
    },
    // ─── 2. T-shirt premium : 3 couleurs, UNIT + PACK, remise sur 1 couleur ───
    {
      reference: "TSH-002",
      name: "T-shirt Oversize Urban",
      description: "T-shirt oversize à épaules tombantes, toucher doux",
      category: "T-shirts",
      sub_categories: ["Oversize", "Streetwear"],
      tags: ["oversize", "streetwear", "urban"],
      compositions: [
        { material: "Coton", percentage: 90 },
        { material: "Élasthanne", percentage: 10 },
      ],
      season: "Automne 2026",
      manufacturing_country: "Turquie",
      similar_refs: ["TSH-001"],
      colors: [
        { color: "Noir", saleType: "UNIT", unitPrice: 24.90, stock: 300, weight: 220, isPrimary: true, size: "L" },
        { color: "Noir", saleType: "PACK", unitPrice: 19.90, stock: 50, weight: 220, packQuantity: 6 },
        { color: "Kaki", saleType: "UNIT", unitPrice: 24.90, stock: 200, weight: 220, size: "M" },
        { color: "Beige", saleType: "UNIT", unitPrice: 24.90, stock: 250, weight: 220, size: "S", discountType: "PERCENT", discountValue: 10 },
      ],
    },
    // ─── 3. Collier pendentif : UNIT, remise PERCENT ───
    {
      reference: "COL-001",
      name: "Collier Lune Dorée",
      description: "Collier fin avec pendentif croissant de lune, plaqué or 18k",
      category: "Bijoux",
      sub_categories: ["Colliers", "Pendentifs"],
      tags: ["lune", "pendentif", "plaqué or", "élégant"],
      compositions: [
        { material: "Laiton", percentage: 85 },
        { material: "Or", percentage: 15 },
      ],
      manufacturing_country: "France",
      similar_refs: ["COL-002", "BRC-001"],
      colors: [
        { color: "Doré", saleType: "UNIT", unitPrice: 29.90, stock: 150, weight: 12, isPrimary: true, discountType: "PERCENT", discountValue: 15 },
      ],
    },
    // ─── 4. Collier multi-rang : multi-couleurs, UNIT + PACK avec remise ───
    {
      reference: "COL-002",
      name: "Collier Triple Chaîne",
      description: "Collier trois rangs superposables, maille fine",
      category: "Bijoux",
      sub_categories: ["Colliers"],
      tags: ["multi-rang", "superposable", "chaîne"],
      compositions: [{ material: "Acier inoxydable", percentage: 100 }],
      season: "Printemps 2026",
      manufacturing_country: "Italie",
      similar_refs: ["COL-001"],
      colors: [
        { color: "Doré/Argenté/Or Rose", saleType: "UNIT", unitPrice: 34.50, stock: 80, weight: 18, isPrimary: true },
        { color: "Doré/Argenté/Or Rose", saleType: "PACK", unitPrice: 28.00, stock: 20, weight: 18, packQuantity: 6, discountType: "PERCENT", discountValue: 20 },
      ],
    },
    // ─── 5. Bracelet jonc : 2 couleurs, remise AMOUNT ───
    {
      reference: "BRC-001",
      name: "Bracelet Jonc Torsadé",
      description: "Bracelet jonc fin torsadé, ajustable",
      category: "Bijoux",
      sub_categories: ["Bracelets"],
      tags: ["jonc", "torsadé", "ajustable"],
      compositions: [
        { material: "Laiton", percentage: 90 },
        { material: "Or", percentage: 10 },
      ],
      manufacturing_country: "France",
      similar_refs: ["COL-001", "COL-002"],
      colors: [
        { color: "Doré", saleType: "UNIT", unitPrice: 18.90, stock: 300, weight: 25, isPrimary: true, discountType: "AMOUNT", discountValue: 3 },
        { color: "Argenté", saleType: "UNIT", unitPrice: 18.90, stock: 200, weight: 25, discountType: "AMOUNT", discountValue: 3 },
      ],
    },
    // ─── 6. Pantalon chino : 2 couleurs, UNIT ───
    {
      reference: "PNT-001",
      name: "Chino Classique Slim",
      description: "Pantalon chino coupe slim, taille mi-haute",
      category: "Pantalons",
      sub_categories: ["Chinos"],
      tags: ["chino", "slim", "classique"],
      compositions: [
        { material: "Coton", percentage: 98 },
        { material: "Élasthanne", percentage: 2 },
      ],
      season: "Printemps 2026",
      manufacturing_country: "Turquie",
      similar_refs: ["PNT-002", "JNS-001"],
      colors: [
        { color: "Beige", saleType: "UNIT", unitPrice: 39.90, stock: 180, weight: 450, isPrimary: true, size: "42" },
        { color: "Marine", saleType: "UNIT", unitPrice: 39.90, stock: 150, weight: 450, size: "40" },
      ],
    },
    // ─── 7. Pantalon cargo : UNIT + PACK, remise PERCENT sur PACK ───
    {
      reference: "PNT-002",
      name: "Cargo Wide Leg",
      description: "Pantalon cargo coupe large avec poches latérales",
      category: "Pantalons",
      sub_categories: ["Cargo", "Streetwear"],
      tags: ["cargo", "wide", "streetwear", "poches"],
      compositions: [{ material: "Coton", percentage: 100 }],
      season: "Automne 2026",
      manufacturing_country: "Inde",
      similar_refs: ["PNT-001"],
      colors: [
        { color: "Kaki", saleType: "UNIT", unitPrice: 49.90, stock: 120, weight: 520, isPrimary: true, size: "44" },
        { color: "Kaki", saleType: "PACK", unitPrice: 42.00, stock: 30, weight: 520, packQuantity: 4, discountType: "PERCENT", discountValue: 10 },
        { color: "Noir", saleType: "UNIT", unitPrice: 49.90, stock: 100, weight: 520, size: "42" },
      ],
    },
    // ─── 8. Jean slim : UNIT, remise AMOUNT ───
    {
      reference: "JNS-001",
      name: "Jean Slim Stretch",
      description: "Jean slim confortable avec stretch, délavage moyen",
      category: "Jeans",
      sub_categories: ["Slim"],
      tags: ["slim", "stretch", "délavé"],
      compositions: [
        { material: "Coton", percentage: 92 },
        { material: "Polyester", percentage: 6 },
        { material: "Élasthanne", percentage: 2 },
      ],
      manufacturing_country: "Tunisie",
      similar_refs: ["JNS-002", "PNT-001"],
      colors: [
        { color: "Bleu Moyen", saleType: "UNIT", unitPrice: 44.90, stock: 250, weight: 600, isPrimary: true, size: "40", discountType: "AMOUNT", discountValue: 5 },
      ],
    },
    // ─── 9. Jean large : 2 couleurs, UNIT ───
    {
      reference: "JNS-002",
      name: "Jean Wide Vintage",
      description: "Jean coupe large inspiration 90s, taille haute",
      category: "Jeans",
      sub_categories: ["Wide", "Vintage"],
      tags: ["wide", "vintage", "90s", "taille haute"],
      compositions: [{ material: "Coton", percentage: 100 }],
      season: "Printemps 2026",
      manufacturing_country: "Italie",
      similar_refs: ["JNS-001"],
      colors: [
        { color: "Bleu Clair", saleType: "UNIT", unitPrice: 52.00, stock: 130, weight: 650, isPrimary: true, size: "38" },
        { color: "Noir Brut", saleType: "UNIT", unitPrice: 52.00, stock: 100, weight: 650, size: "42" },
      ],
    },
    // ─── 10. Mocassin cuir : 2 couleurs, UNIT ───
    {
      reference: "MOC-001",
      name: "Mocassin Cambridge",
      description: "Mocassin en cuir pleine fleur, semelle cousue Blake",
      category: "Chaussures",
      sub_categories: ["Mocassins"],
      tags: ["cuir", "élégant", "blake", "classique"],
      compositions: [{ material: "Cuir", percentage: 100 }],
      manufacturing_country: "Italie",
      similar_refs: ["MOC-002"],
      colors: [
        { color: "Marron", saleType: "UNIT", unitPrice: 89.90, stock: 80, weight: 380, isPrimary: true, size: "43" },
        { color: "Noir", saleType: "UNIT", unitPrice: 89.90, stock: 60, weight: 380, size: "42" },
      ],
    },
    // ─── 11. Mocassin daim : UNIT + PACK, remise PERCENT ───
    {
      reference: "MOC-002",
      name: "Mocassin Souple Daim",
      description: "Mocassin en daim souple, intérieur cuir, semelle gomme",
      category: "Chaussures",
      sub_categories: ["Mocassins"],
      tags: ["daim", "souple", "décontracté"],
      compositions: [
        { material: "Daim", percentage: 80 },
        { material: "Cuir", percentage: 20 },
      ],
      season: "Été 2026",
      manufacturing_country: "Portugal",
      similar_refs: ["MOC-001"],
      colors: [
        { color: "Taupe", saleType: "UNIT", unitPrice: 69.90, stock: 100, weight: 320, isPrimary: true, size: "41", discountType: "PERCENT", discountValue: 20 },
        { color: "Taupe", saleType: "PACK", unitPrice: 59.90, stock: 15, weight: 320, packQuantity: 4, discountType: "PERCENT", discountValue: 25 },
      ],
    },
    // ─── 12. Basket running : multi-couleurs, UNIT ───
    {
      reference: "CHS-001",
      name: "Sneaker Runner Pro",
      description: "Basket de running légère, semelle amorti mousse",
      category: "Chaussures",
      sub_categories: ["Baskets", "Running"],
      tags: ["running", "léger", "amorti", "sport"],
      compositions: [
        { material: "Synthétique", percentage: 70 },
        { material: "Mousse", percentage: 30 },
      ],
      manufacturing_country: "Vietnam",
      similar_refs: ["CHS-002"],
      colors: [
        { color: "Blanc/Noir", saleType: "UNIT", unitPrice: 79.90, stock: 200, weight: 290, isPrimary: true, size: "43" },
        { color: "Noir/Rouge", saleType: "UNIT", unitPrice: 79.90, stock: 150, weight: 290, size: "42" },
      ],
    },
    // ─── 13. Bottine chelsea : UNIT simple ───
    {
      reference: "CHS-002",
      name: "Bottine Chelsea Cuir",
      description: "Bottine chelsea en cuir lisse, élastique latéral, bout arrondi",
      category: "Chaussures",
      sub_categories: ["Bottines"],
      tags: ["chelsea", "bottine", "cuir", "classique"],
      compositions: [
        { material: "Cuir", percentage: 90 },
        { material: "Caoutchouc", percentage: 10 },
      ],
      season: "Hiver 2026",
      manufacturing_country: "Espagne",
      similar_refs: ["MOC-001", "CHS-001"],
      colors: [
        { color: "Noir", saleType: "UNIT", unitPrice: 109.00, stock: 70, weight: 480, isPrimary: true, size: "42" },
      ],
    },
    // ─── 14. Sac cabas : 2 couleurs, UNIT + PACK ───
    {
      reference: "SAC-001",
      name: "Sac Cabas Parisien",
      description: "Sac cabas structuré en cuir grainé, double anse, poche intérieure zippée",
      category: "Sacs",
      sub_categories: ["Cabas", "Sacs à main"],
      tags: ["cabas", "cuir", "parisien", "élégant"],
      compositions: [
        { material: "Cuir", percentage: 85 },
        { material: "Coton", percentage: 15 },
      ],
      season: "Automne 2026",
      manufacturing_country: "France",
      similar_refs: ["SAC-002", "SAC-003"],
      colors: [
        { color: "Noir", saleType: "UNIT", unitPrice: 64.90, stock: 90, weight: 650, isPrimary: true },
        { color: "Camel", saleType: "UNIT", unitPrice: 64.90, stock: 70, weight: 650 },
        { color: "Noir", saleType: "PACK", unitPrice: 55.00, stock: 20, weight: 650, packQuantity: 3 },
      ],
    },
    // ─── 15. Pochette bandoulière : UNIT, remise PERCENT ───
    {
      reference: "SAC-002",
      name: "Pochette Bandoulière Mini",
      description: "Mini sac bandoulière en cuir souple, bandoulière amovible chaîne dorée",
      category: "Sacs",
      sub_categories: ["Bandoulière", "Pochettes"],
      tags: ["pochette", "mini", "bandoulière", "chaîne"],
      compositions: [
        { material: "Cuir", percentage: 90 },
        { material: "Métal", percentage: 10 },
      ],
      season: "Printemps 2026",
      manufacturing_country: "Italie",
      similar_refs: ["SAC-001"],
      colors: [
        { color: "Rose Poudré", saleType: "UNIT", unitPrice: 42.50, stock: 120, weight: 280, isPrimary: true, discountType: "PERCENT", discountValue: 15 },
      ],
    },
    // ─── 16. Sac à dos : multi-couleurs, UNIT ───
    {
      reference: "SAC-003",
      name: "Sac à Dos Canvas",
      description: "Sac à dos en toile épaisse avec empiècements cuir, compartiment laptop 15 pouces",
      category: "Sacs",
      sub_categories: ["Sacs à dos"],
      tags: ["sac à dos", "canvas", "laptop", "voyage"],
      compositions: [
        { material: "Toile", percentage: 75 },
        { material: "Cuir", percentage: 25 },
      ],
      manufacturing_country: "Inde",
      similar_refs: ["SAC-001"],
      colors: [
        { color: "Gris/Marron", saleType: "UNIT", unitPrice: 54.90, stock: 90, weight: 750, isPrimary: true },
        { color: "Marine/Camel", saleType: "UNIT", unitPrice: 54.90, stock: 60, weight: 750 },
      ],
    },
    // ─── 17. Chapeau fedora : 2 couleurs, UNIT + PACK avec remise ───
    {
      reference: "CHP-001",
      name: "Fedora Laine Premium",
      description: "Chapeau fedora en feutre de laine, ruban gros-grain contrasté",
      category: "Chapeaux",
      sub_categories: ["Fedora"],
      tags: ["fedora", "laine", "élégant", "ruban"],
      compositions: [{ material: "Laine", percentage: 100 }],
      season: "Automne 2026",
      manufacturing_country: "France",
      similar_refs: ["CHP-002"],
      colors: [
        { color: "Camel", saleType: "UNIT", unitPrice: 35.00, stock: 80, weight: 150, isPrimary: true, size: "58" },
        { color: "Noir", saleType: "UNIT", unitPrice: 35.00, stock: 60, weight: 150, size: "56" },
        { color: "Camel", saleType: "PACK", unitPrice: 28.00, stock: 15, weight: 150, packQuantity: 6, discountType: "PERCENT", discountValue: 15 },
      ],
    },
    // ─── 18. Bonnet : UNIT, remise PERCENT ───
    {
      reference: "CHP-002",
      name: "Bonnet Côtelé Chaud",
      description: "Bonnet en maille côtelée, doublure polaire, revers ajustable",
      category: "Chapeaux",
      sub_categories: ["Bonnets"],
      tags: ["bonnet", "chaud", "côtelé", "polaire"],
      compositions: [
        { material: "Laine", percentage: 50 },
        { material: "Acrylique", percentage: 50 },
      ],
      season: "Hiver 2026",
      manufacturing_country: "Écosse",
      similar_refs: ["CHP-001", "GNT-001"],
      colors: [
        { color: "Gris Chiné", saleType: "UNIT", unitPrice: 19.90, stock: 350, weight: 90, isPrimary: true, discountType: "PERCENT", discountValue: 25 },
      ],
    },
    // ─── 19. Gants cuir : multi-couleurs, UNIT + PACK, remise AMOUNT ───
    {
      reference: "GNT-001",
      name: "Gants Cuir Doublés",
      description: "Gants en cuir d'agneau doublés cachemire, coutures sellier",
      category: "Accessoires",
      sub_categories: ["Gants"],
      tags: ["gants", "cuir", "cachemire", "hiver"],
      compositions: [
        { material: "Cuir", percentage: 70 },
        { material: "Cachemire", percentage: 30 },
      ],
      season: "Hiver 2026",
      manufacturing_country: "Italie",
      similar_refs: ["CHP-002"],
      colors: [
        { color: "Noir", saleType: "UNIT", unitPrice: 49.90, stock: 100, weight: 120, isPrimary: true, size: "M" },
        { color: "Marron/Beige", saleType: "UNIT", unitPrice: 52.90, stock: 70, weight: 120, size: "L" },
        { color: "Noir", saleType: "PACK", unitPrice: 42.00, stock: 20, weight: 120, packQuantity: 6, discountType: "AMOUNT", discountValue: 5 },
      ],
    },
    // ─── 20. T-shirt lot pro : PACK only, remise AMOUNT ───
    {
      reference: "TSH-003",
      name: "T-shirt Uni Lot Pro",
      description: "T-shirt uni basique vendu en lot, idéal revendeurs et événements",
      category: "T-shirts",
      sub_categories: ["Basiques", "Lots"],
      tags: ["lot", "pro", "revendeur", "basique"],
      compositions: [{ material: "Coton", percentage: 100 }],
      manufacturing_country: "Bangladesh",
      similar_refs: ["TSH-001", "TSH-002"],
      colors: [
        { color: "Blanc", saleType: "PACK", unitPrice: 8.90, stock: 100, weight: 170, isPrimary: true, packQuantity: 12, discountType: "AMOUNT", discountValue: 1 },
        { color: "Noir", saleType: "PACK", unitPrice: 8.90, stock: 80, weight: 170, packQuantity: 12, discountType: "AMOUNT", discountValue: 1 },
        { color: "Gris Chiné", saleType: "PACK", unitPrice: 9.50, stock: 60, weight: 170, packQuantity: 12 },
      ],
    },
  ],
  null,
  2
);

type Step = "upload" | "preview" | "done";

export default function ImportProductsTab() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; errors: number; total: number; draftId?: string; jobId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxProducts, setMaxProducts] = useState<string>("");

  // Job polling state
  const [jobStatus, setJobStatus] = useState<"PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | null>(null);
  const [jobProgress, setJobProgress] = useState({ processed: 0, total: 0, success: 0, errors: 0, errorDraftId: null as string | null, errorMessage: null as string | null });

  // Poll job status when in "done" step
  useEffect(() => {
    if (step !== "done" || !importResult?.jobId) return;
    if (jobStatus === "COMPLETED" || jobStatus === "FAILED") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/import-jobs/${importResult.jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        const job = data.job;
        setJobStatus(job.status);
        setJobProgress({
          processed: job.processedItems,
          total: job.totalItems,
          success: job.successItems,
          errors: job.errorItems,
          errorDraftId: job.errorDraftId,
          errorMessage: job.errorMessage,
        });
        // Invalidate server-side cache via server action (revalidateTag
        // doesn't work inside fire-and-forget background jobs, so we
        // trigger it from the client in a proper request context)
        if (job.status === "COMPLETED" || job.status === "FAILED") {
          revalidateAfterImport();
          router.refresh();
        }
      } catch {
        // Silently retry on next interval
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [step, importResult?.jobId, jobStatus, router]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setStep("upload");
    setPreview(null);
    setError(null);
    setImportResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); setStep("upload"); setPreview(null); setError(null); }
  };

  const analyzeFile = useCallback(async (targetFile?: File) => {
    const f = targetFile ?? file;
    if (!f) return;
    setLoadingPreview(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", f);
    const limit = parseInt(maxProducts);
    if (limit > 0) fd.append("maxProducts", String(limit));
    try {
      const res = await fetch("/api/admin/products/import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur d'analyse."); return; }
      setPreview(data);
      setStep("preview");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoadingPreview(false);
    }
  }, [file, maxProducts]);

  const confirmImport = async () => {
    if (!file) return;
    setLoadingImport(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", "PRODUCTS");
    const limit = parseInt(maxProducts);
    if (limit > 0) fd.append("maxProducts", String(limit));
    try {
      const res = await fetch("/api/admin/import-jobs", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur d'importation."); return; }
      // Job created — background processing started
      setImportResult({ success: 0, errors: 0, total: preview?.totalVariants ?? 0, jobId: data.jobId });
      setStep("done");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoadingImport(false);
    }
  };

  const reset = () => {
    setFile(null); setStep("upload"); setPreview(null); setImportResult(null); setError(null);
    setJobStatus(null); setJobProgress({ processed: 0, total: 0, success: 0, errors: 0, errorDraftId: null, errorMessage: null });
  };

  const downloadTemplate = (type: "json" | "xlsx") => {
    if (type === "json") {
      const blob = new Blob([TEMPLATE_JSON], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "template-produits.json"; a.click();
      URL.revokeObjectURL(url);
    } else {
      window.open("/api/admin/products/import/template", "_blank");
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Format guide ── */}
      <div className="bg-bg-secondary border border-border rounded-2xl p-6">
        <h3 className="font-semibold text-text-primary mb-3 font-heading">Format d'importation</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm text-[#666]">
          <ul className="space-y-1 font-body">
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">reference</code> — Référence unique</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">name</code> — Nom (FR)</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">color</code> — Couleur (ex: Doré, Doré/Rouge/Noir pour multi-couleur)</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">sale_type</code> — UNIT ou PACK</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">unit_price</code> — Prix HT (€)</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">stock</code> — Stock</li>
            <li><code className="bg-bg-primary px-1 rounded text-xs">pack_qty</code> · <code className="bg-bg-primary px-1 rounded text-xs">category</code> · <code className="bg-bg-primary px-1 rounded text-xs">tags</code></li>
            <li><code className="bg-bg-primary px-1 rounded text-xs">sub_categories</code> · <code className="bg-bg-primary px-1 rounded text-xs">composition</code></li>
            <li><code className="bg-bg-primary px-1 rounded text-xs">similar_refs</code> — Réf. produits similaires (ex: BJ-002,BJ-003)</li>
          </ul>
          <div>
            <p className="font-medium text-text-primary mb-2">Règles</p>
            <ul className="space-y-1 font-body">
              <li>• Excel : <strong>une ligne = une variante couleur</strong> — même référence = même produit</li>
              <li>• Les couleurs et catégories doivent exister en base</li>
              <li>• Produits créés en statut <strong>Hors ligne</strong></li>
              <li>• <strong>Produits similaires</strong> : si la référence n'existe pas encore, le lien sera créé automatiquement quand le produit sera importé plus tard</li>
              <li>• <strong>Traitement en arrière-plan</strong> : vous pouvez fermer la page après confirmation</li>
            </ul>
            <div className="mt-3 flex gap-2">
              <button onClick={() => downloadTemplate("json")} className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-bg-primary transition-colors">↓ Template JSON</button>
              <button onClick={() => downloadTemplate("xlsx")} className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-bg-primary transition-colors">↓ Template Excel</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Step indicator ── */}
      <div className="flex items-center gap-3 text-sm">
        {(["upload", "preview", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-[#E5E5E5]" />}
            <div className={`flex items-center gap-2 ${step === s ? "text-text-primary font-medium" : step === "done" || (step === "preview" && s === "upload") ? "text-green-600" : "text-[#999]"}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === s ? "bg-bg-dark text-text-inverse" : step === "done" || (step === "preview" && s === "upload") ? "bg-green-100 text-green-600" : "bg-bg-secondary text-[#999]"}`}>
                {step === "done" || (step === "preview" && s === "upload") ? "✓" : i + 1}
              </span>
              {s === "upload" ? "Fichier" : s === "preview" ? "Résumé" : "Importé"}
            </div>
          </div>
        ))}
      </div>

      {/* ── Step: Upload ── */}
      {step === "upload" && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div
            className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-bg-dark transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input ref={fileRef} type="file" accept=".json,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
            <div className="text-4xl mb-3">📄</div>
            {file ? (
              <div>
                <p className="font-medium text-text-primary">{file.name}</p>
                <p className="text-sm text-[#666]">{(file.size / 1024).toFixed(1)} Ko</p>
              </div>
            ) : (
              <div>
                <p className="text-text-primary font-medium">Glissez votre fichier ici</p>
                <p className="text-sm text-[#666] mt-1">ou cliquez pour sélectionner</p>
                <p className="text-xs text-[#999] mt-2">Formats : .json, .xlsx, .xls</p>
              </div>
            )}
          </div>
          {error && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
          <div className="mt-4 flex items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="maxProducts" className="text-sm text-[#666] whitespace-nowrap">Nb produits max</label>
              <input
                id="maxProducts"
                type="number"
                min="1"
                placeholder="Tous"
                value={maxProducts}
                onChange={(e) => setMaxProducts(e.target.value)}
                className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-text-primary bg-bg-primary focus:outline-none focus:ring-2 focus:ring-bg-dark/20"
              />
            </div>
            <button onClick={() => analyzeFile()} disabled={!file || loadingPreview} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              {loadingPreview ? "Analyse en cours…" : "Analyser le fichier →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Preview ── */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          {/* Loading overlay during re-analysis */}
          {loadingPreview && (
            <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center justify-center gap-3">
              <svg className="w-5 h-5 text-text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-text-primary font-medium">Ré-analyse du fichier en cours...</span>
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Produits détectés" value={preview.totalProducts} color="neutral" />
            <StatCard label="Variantes totales" value={preview.totalVariants} color="neutral" />
            <StatCard label="Prêts à importer" value={preview.readyToImport} color="green" />
            <StatCard label="Avec erreurs" value={preview.withErrors + preview.alreadyExist} color={preview.withErrors + preview.alreadyExist > 0 ? "red" : "green"} />
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

          {/* Missing entities — quick create */}
          {preview.missingEntities && preview.missingEntities.length > 0 && (
            <MissingEntitiesPanel
              entities={preview.missingEntities}
              onEntitiesCreated={() => analyzeFile()}
            />
          )}

          {/* Product table — grouped */}
          <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="grid grid-cols-[auto_1fr_1fr_2fr_auto] gap-4 px-6 py-3 bg-bg-secondary border-b border-border text-xs font-medium text-[#666] uppercase tracking-wide">
              <div>Statut</div>
              <div>Référence</div>
              <div>Nom / Catégorie</div>
              <div>Variantes couleurs</div>
              <div>Erreurs</div>
            </div>
            <div className="divide-y divide-[#F0F0F0] max-h-[500px] overflow-y-auto">
              {preview.products.map((p, i) => (
                <ProductPreviewRow key={i} product={p} />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button onClick={reset} className="btn-secondary">← Changer de fichier</button>
            <div className="flex items-center gap-3">
              {preview.readyToImport === 0 && (
                <p className="text-sm text-[#666]">Aucun produit ne peut être importé.</p>
              )}
              {preview.readyToImport > 0 && (
                <p className="text-sm text-[#666]">
                  {preview.withErrors + preview.alreadyExist > 0
                    ? `${preview.readyToImport} produit(s) seront importés, ${preview.withErrors + preview.alreadyExist} ignorés.`
                    : `${preview.readyToImport} produit(s) prêts.`}
                </p>
              )}
              <button
                onClick={confirmImport}
                disabled={loadingImport || preview.readyToImport === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingImport ? "Importation…" : `Confirmer l'importation (${preview.readyToImport})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Done — processing with real-time progress ── */}
      {step === "done" && importResult && (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center space-y-5">
          {/* Icon — spinner while processing, checkmark or X when done */}
          {jobStatus === "COMPLETED" ? (
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${jobProgress.errors > 0 ? "bg-amber-50" : "bg-green-50"}`}>
              <svg className={`w-8 h-8 ${jobProgress.errors > 0 ? "text-amber-600" : "text-green-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          ) : jobStatus === "FAILED" ? (
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          ) : (
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-amber-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}

          {/* Title */}
          <p className="text-xl font-semibold font-heading text-text-primary">
            {jobStatus === "COMPLETED"
              ? (jobProgress.errors > 0 ? "Import terminé avec des erreurs" : "Import terminé avec succès !")
              : jobStatus === "FAILED"
              ? "Échec de l'import"
              : "Traitement en cours..."}
          </p>

          {/* Progress bar — during processing */}
          {jobStatus !== "COMPLETED" && jobStatus !== "FAILED" && (
            <div className="max-w-md mx-auto">
              <div className="flex items-center justify-between text-sm text-[#666] mb-2">
                <span>{jobProgress.processed} / {jobProgress.total || preview?.totalProducts || "?"} traité(s)</span>
                <span>{jobProgress.total > 0 ? Math.round((jobProgress.processed / jobProgress.total) * 100) : 0}%</span>
              </div>
              <div className="w-full h-3 bg-[#F0F0F0] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${jobProgress.total > 0 ? (jobProgress.processed / jobProgress.total) * 100 : 0}%`,
                    background: "linear-gradient(90deg, #1A1A1A, #444)",
                  }}
                />
              </div>
              <p className="text-xs text-[#999] mt-3 font-body">
                Le serveur vérifie chaque ligne (couleurs, catégories, etc.). Vous pouvez fermer cette page.
              </p>
            </div>
          )}

          {/* Results — when completed */}
          {jobStatus === "COMPLETED" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto">
                <div className="rounded-xl p-3 bg-bg-secondary border border-border">
                  <p className="text-2xl font-bold font-heading">{jobProgress.total}</p>
                  <p className="text-xs text-[#666]">Total</p>
                </div>
                <div className="rounded-xl p-3 bg-green-50 border border-green-200">
                  <p className="text-2xl font-bold text-green-700 font-heading">{jobProgress.success}</p>
                  <p className="text-xs text-green-600">Importés</p>
                </div>
                <div className={`rounded-xl p-3 border ${jobProgress.errors > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                  <p className={`text-2xl font-bold font-heading ${jobProgress.errors > 0 ? "text-red-700" : "text-green-700"}`}>{jobProgress.errors}</p>
                  <p className={`text-xs ${jobProgress.errors > 0 ? "text-red-600" : "text-green-600"}`}>Erreurs</p>
                </div>
              </div>

              {jobProgress.errorDraftId && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                  {jobProgress.errors} ligne(s) en erreur. Vous pouvez les corriger dans le brouillon.
                  <br />
                  <Link href={`/admin/produits/importer/brouillon/${jobProgress.errorDraftId}`} className="font-medium underline hover:text-amber-900 transition-colors">
                    Corriger les erreurs →
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Error — when failed */}
          {jobStatus === "FAILED" && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 max-w-lg mx-auto">
              {jobProgress.errorMessage || "Une erreur inattendue est survenue lors du traitement."}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-center gap-3">
            {jobStatus === "COMPLETED" || jobStatus === "FAILED" ? (
              <>
                <Link href="/admin/produits/importer/historique" className="btn-primary text-sm">
                  Voir l&apos;historique
                </Link>
                <button onClick={() => router.push("/admin/produits")} className="btn-secondary text-sm">Voir les produits</button>
                <button onClick={reset} className="btn-secondary text-sm">Nouvelle importation</button>
              </>
            ) : (
              <>
                <button onClick={() => router.push("/admin/produits")} className="btn-secondary text-sm">Voir les produits</button>
                <button onClick={reset} className="btn-secondary text-sm">Nouvelle importation</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: "neutral" | "green" | "red" }) {
  const colors = { neutral: "bg-bg-secondary text-text-primary", green: "bg-green-50 text-green-700", red: "bg-red-50 text-red-700" };
  return (
    <div className={`rounded-xl p-4 ${colors[color]} border border-border`}>
      <p className="text-2xl font-bold font-heading">{value}</p>
      <p className="text-xs mt-0.5 font-body opacity-80">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Missing Entities Panel — quick create
// ─────────────────────────────────────────────

const ENTITY_LABELS: Record<MissingEntity["type"], { label: string; plural: string; icon: string; action: string }> = {
  category: { label: "Catégorie", plural: "Catégories", icon: "📂", action: "create_category" },
  color: { label: "Couleur", plural: "Couleurs", icon: "🎨", action: "create_color" },
  subcategory: { label: "Sous-catégorie", plural: "Sous-catégories", icon: "📁", action: "create_subcategory" },
  composition: { label: "Composition", plural: "Compositions", icon: "⚗️", action: "create_composition" },
  country: { label: "Pays", plural: "Pays", icon: "🌍", action: "create_country" },
  season: { label: "Saison", plural: "Saisons", icon: "📅", action: "create_season" },
};

function MissingEntitiesPanel({ entities, onEntitiesCreated }: { entities: MissingEntity[]; onEntitiesCreated: () => void }) {
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<Set<string>>(new Set());
  const [autoReanalyzed, setAutoReanalyzed] = useState(false);
  const [creatingAll, setCreatingAll] = useState(false);
  const [colorHexes, setColorHexes] = useState<Record<string, string>>({});
  // Pattern image state per color name
  const [colorModes, setColorModes] = useState<Record<string, "hex" | "pattern">>({});
  const [colorPatterns, setColorPatterns] = useState<Record<string, string>>({});
  const [uploadingPattern, setUploadingPattern] = useState<Set<string>>(new Set());
  const patternInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // PFS mapping state
  const [pfsAttrs, setPfsAttrs] = useState<PfsAttributes | null>(null);
  const [pfsLoading, setPfsLoading] = useState(false);
  const [pfsColorRefs, setPfsColorRefs] = useState<Record<string, string>>({});
  const [pfsCategoryIds, setPfsCategoryIds] = useState<Record<string, string>>({});
  const [pfsCompositionRefs, setPfsCompositionRefs] = useState<Record<string, string>>({});
  const [showPfsMapping, setShowPfsMapping] = useState(false);

  // Fetch PFS attributes when mapping is toggled on
  useEffect(() => {
    if (!showPfsMapping || pfsAttrs) return;
    setPfsLoading(true);
    fetch("/api/admin/pfs-sync/attributes")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setPfsAttrs(data); })
      .catch(() => {})
      .finally(() => setPfsLoading(false));
  }, [showPfsMapping, pfsAttrs]);

  const grouped = entities.reduce<Record<string, MissingEntity[]>>((acc, e) => {
    (acc[e.type] ??= []).push(e);
    return acc;
  }, {});

  const remaining = entities.filter((e) => !created.has(`${e.type}:${e.name}`));

  // Auto re-analyze when all entities have been created (individual or batch)
  useEffect(() => {
    if (entities.length > 0 && remaining.length === 0 && created.size > 0 && !autoReanalyzed) {
      setAutoReanalyzed(true);
      onEntitiesCreated();
    }
  }, [entities.length, remaining.length, created.size, autoReanalyzed, onEntitiesCreated]);

  const handlePatternUpload = async (colorName: string, file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      alert("Format non supporté. Utilisez PNG, JPG ou WebP.");
      return;
    }
    if (file.size > 512 * 1024) {
      alert("Image trop lourde (max 500 KB).");
      return;
    }
    setUploadingPattern((prev) => new Set(prev).add(colorName));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        setColorPatterns((prev) => ({ ...prev, [colorName]: data.path }));
      }
    } catch {
      // silently ignore
    } finally {
      setUploadingPattern((prev) => { const s = new Set(prev); s.delete(colorName); return s; });
    }
  };

  const removePattern = async (colorName: string) => {
    const patternPath = colorPatterns[colorName];
    if (patternPath) {
      try {
        await fetch("/api/admin/colors/upload-pattern", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: patternPath }),
        });
      } catch { /* ignore */ }
    }
    setColorPatterns((prev) => { const n = { ...prev }; delete n[colorName]; return n; });
    // Reset file input
    const inp = patternInputRefs.current[colorName];
    if (inp) inp.value = "";
  };

  // Build PFS body fields for an entity
  const getPfsFields = (entity: MissingEntity): Record<string, string> => {
    const fields: Record<string, string> = {};
    if (entity.type === "color" && pfsColorRefs[entity.name]) {
      fields.pfsColorRef = pfsColorRefs[entity.name];
    }
    if (entity.type === "category" && pfsCategoryIds[entity.name]) {
      const catId = pfsCategoryIds[entity.name];
      fields.pfsCategoryId = catId;
      // Derive gender and family from PFS category
      const pfsCat = pfsAttrs?.categories.find((c) => c.id === catId);
      if (pfsCat) {
        fields.pfsGender = pfsCat.gender;
        fields.pfsFamilyId = pfsCat.family.id;
      }
    }
    if (entity.type === "composition" && pfsCompositionRefs[entity.name]) {
      fields.pfsCompositionRef = pfsCompositionRefs[entity.name];
    }
    return fields;
  };

  const createEntity = async (entity: MissingEntity, hex?: string) => {
    const key = `${entity.type}:${entity.name}`;
    if (created.has(key) || creating.has(key)) return;

    setCreating((prev) => new Set(prev).add(key));
    try {
      const body: Record<string, string> = {
        action: ENTITY_LABELS[entity.type].action,
        name: entity.name,
        ...getPfsFields(entity),
      };
      if (entity.type === "color") {
        const mode = colorModes[entity.name] ?? "hex";
        if (mode === "pattern" && colorPatterns[entity.name]) {
          body.patternImage = colorPatterns[entity.name];
        } else if (hex) {
          body.colorHex = hex;
        }
      }
      if (entity.type === "subcategory" && entity.parentCategoryName) {
        body.parentCategoryName = entity.parentCategoryName;
      }

      const res = await fetch("/api/admin/products/import/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setCreated((prev) => new Set(prev).add(key));
      }
    } catch {
      // silently ignore
    } finally {
      setCreating((prev) => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const createAll = async () => {
    setCreatingAll(true);
    // Create categories first so subcategories can reference them
    const sorted = [...remaining].sort((a, b) => {
      const order: Record<string, number> = { category: 0, color: 1, composition: 2, subcategory: 3 };
      return (order[a.type] ?? 9) - (order[b.type] ?? 9);
    });
    for (const entity of sorted) {
      await createEntity(entity, colorHexes[entity.name]);
    }
    setCreatingAll(false);
    // Auto re-analysis is handled by the useEffect when remaining.length === 0
  };

  const handleCreateSingle = async (entity: MissingEntity) => {
    await createEntity(entity, colorHexes[entity.name]);
  };

  // PFS select options builders
  const pfsColorOptions = pfsAttrs?.colors.map((c) => ({
    value: c.reference,
    label: `${c.labels?.fr || c.reference}`,
  })) ?? [];

  const pfsCategoryOptions = pfsAttrs?.categories.map((c) => ({
    value: c.id,
    label: `${c.labels?.fr || c.id} (${c.gender})`,
  })) ?? [];

  const pfsCompositionOptions = pfsAttrs?.compositions.map((c) => ({
    value: c.reference,
    label: c.labels?.fr || c.reference,
  })) ?? [];

  const hasPfsMappableEntities = entities.some((e) => e.type === "color" || e.type === "category" || e.type === "composition");

  return (
    <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-amber-50/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-text-primary font-heading text-sm">
                {remaining.length} {remaining.length > 1 ? "éléments manquants" : "élément manquant"}
              </h3>
              <p className="text-xs text-[#666] mt-0.5 font-body">
                Créez-les pour débloquer l'import — les traductions seront générées automatiquement
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasPfsMappableEntities && remaining.length > 0 && (
              <button
                onClick={() => setShowPfsMapping(!showPfsMapping)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                  showPfsMapping
                    ? "bg-bg-dark text-text-inverse border-bg-dark"
                    : "bg-bg-primary border-border text-text-primary hover:border-bg-dark"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                {showPfsMapping ? "Masquer PFS" : "Mapper PFS"}
              </button>
            )}
            {remaining.length > 0 && (
              <button
                onClick={createAll}
                disabled={creatingAll}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {creatingAll ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Création…
                  </span>
                ) : `Tout créer (${remaining.length})`}
              </button>
            )}
            {remaining.length === 0 && (
              <button onClick={onEntitiesCreated} className="btn-primary text-xs">
                Re-analyser le fichier
              </button>
            )}
          </div>
        </div>
      </div>

      {/* PFS loading / disabled notice */}
      {showPfsMapping && pfsLoading && (
        <div className="px-6 py-3 border-b border-border bg-bg-secondary flex items-center gap-2 text-xs text-[#666]">
          <span className="inline-block w-3 h-3 border-2 border-[#999] border-t-transparent rounded-full animate-spin" />
          Chargement des attributs Paris Fashion Shop…
        </div>
      )}
      {showPfsMapping && pfsAttrs?.pfsDisabled && (
        <div className="px-6 py-3 border-b border-border bg-bg-secondary text-xs text-[#666]">
          PFS non configuré — les correspondances ne seront pas enregistrées.
        </div>
      )}

      {/* Entity groups */}
      <div className="divide-y divide-border">
        {(Object.keys(ENTITY_LABELS) as MissingEntity["type"][]).map((type) => {
          const items = grouped[type];
          if (!items?.length) return null;
          const createdCount = items.filter((e) => created.has(`${e.type}:${e.name}`)).length;

          return (
            <div key={type} className="px-6 py-4">
              {/* Section header */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">{ENTITY_LABELS[type].icon}</span>
                <span className="text-xs font-semibold text-text-primary font-heading uppercase tracking-wide">
                  {ENTITY_LABELS[type].plural}
                </span>
                <span className="text-[10px] text-[#999] font-body">
                  {createdCount}/{items.length}
                </span>
                {createdCount === items.length && (
                  <span className="badge badge-success text-[10px] ml-1">Complet</span>
                )}
              </div>

              {/* Entity rows */}
              <div className={`gap-2 ${type === "color" ? "grid grid-cols-1 md:grid-cols-2" : "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`}>
                {items.map((entity) => {
                  const key = `${entity.type}:${entity.name}`;
                  const isCreated = created.has(key);
                  const isCreating = creating.has(key);
                  const mode = colorModes[entity.name] ?? "hex";
                  const patternPath = colorPatterns[entity.name];
                  const isUploading = uploadingPattern.has(entity.name);
                  const showPfsDropdown = showPfsMapping && !isCreated && pfsAttrs && !pfsAttrs.pfsDisabled &&
                    (type === "color" || type === "category" || type === "composition");

                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 transition-colors ${
                        isCreated
                          ? "bg-green-50/60 border border-green-200"
                          : "bg-bg-secondary border border-transparent hover:border-border"
                      }`}
                    >
                      {/* Status indicator */}
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isCreated ? "bg-green-100" : isCreating ? "bg-amber-100" : "bg-bg-primary border border-border"
                      }`}>
                        {isCreated ? (
                          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : isCreating ? (
                          <span className="inline-block w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <span className="text-xs text-[#999]">{ENTITY_LABELS[type].icon}</span>
                        )}
                      </div>

                      {/* Entity name */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${isCreated ? "text-green-700" : "text-text-primary"}`}>
                            {entity.name}
                          </span>
                          {entity.parentCategoryName && (
                            <span className="text-[11px] text-[#888] font-body">
                              dans {entity.parentCategoryName}
                            </span>
                          )}
                          <span className="text-[10px] text-[#999] font-body shrink-0">
                            {entity.usedBy} produit{entity.usedBy > 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Color picker (for color type only) */}
                      {type === "color" && !isCreated && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setColorModes((prev) => ({ ...prev, [entity.name]: mode === "hex" ? "pattern" : "hex" }))}
                            className="w-7 h-7 rounded-lg border border-border flex items-center justify-center cursor-pointer hover:border-bg-dark hover:bg-bg-primary transition-colors"
                            title={mode === "hex" ? "Passer en mode motif" : "Passer en mode couleur"}
                          >
                            <span className="text-xs">{mode === "hex" ? "🎨" : "🖼️"}</span>
                          </button>

                          {mode === "hex" ? (
                            <input
                              type="color"
                              value={colorHexes[entity.name] ?? "#9CA3AF"}
                              onChange={(e) => setColorHexes((prev) => ({ ...prev, [entity.name]: e.target.value }))}
                              className="w-7 h-7 rounded-lg border border-border cursor-pointer p-0.5"
                              title="Choisir la couleur"
                            />
                          ) : patternPath ? (
                            <div className="relative w-7 h-7 rounded-lg border border-border overflow-hidden group cursor-pointer">
                              <img src={patternPath} alt="motif" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removePattern(entity.name); }}
                                className="absolute inset-0 bg-black/50 text-text-inverse text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <label className={`w-7 h-7 rounded-lg border border-dashed border-[#BBB] flex items-center justify-center cursor-pointer hover:border-bg-dark transition-colors ${isUploading ? "opacity-50 pointer-events-none" : ""}`}>
                              {isUploading ? (
                                <span className="inline-block w-3 h-3 border-2 border-[#999] border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3.5 h-3.5 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                                </svg>
                              )}
                              <input
                                ref={(el) => { patternInputRefs.current[entity.name] = el; }}
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handlePatternUpload(entity.name, f);
                                }}
                              />
                            </label>
                          )}
                        </div>
                      )}

                      {/* Color swatch when created */}
                      {type === "color" && isCreated && (
                        <div className="shrink-0">
                          {patternPath ? (
                            <div className="w-7 h-7 rounded-lg border border-green-200 overflow-hidden">
                              <img src={patternPath} alt="motif" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div
                              className="w-7 h-7 rounded-lg border border-green-200"
                              style={{ backgroundColor: colorHexes[entity.name] ?? "#9CA3AF" }}
                            />
                          )}
                        </div>
                      )}

                      {/* PFS mapping dropdown */}
                      {showPfsDropdown && (
                        <div className="w-52 shrink-0">
                          {type === "color" && (
                            <CustomSelect
                              value={pfsColorRefs[entity.name] ?? ""}
                              onChange={(v) => setPfsColorRefs((prev) => ({ ...prev, [entity.name]: v }))}
                              options={[{ value: "", label: "— Couleur PFS —" }, ...pfsColorOptions]}
                              size="sm"
                              searchable
                              placeholder="Couleur PFS"
                            />
                          )}
                          {type === "category" && (
                            <CustomSelect
                              value={pfsCategoryIds[entity.name] ?? ""}
                              onChange={(v) => setPfsCategoryIds((prev) => ({ ...prev, [entity.name]: v }))}
                              options={[{ value: "", label: "— Catégorie PFS —" }, ...pfsCategoryOptions]}
                              size="sm"
                              searchable
                              placeholder="Catégorie PFS"
                            />
                          )}
                          {type === "composition" && (
                            <CustomSelect
                              value={pfsCompositionRefs[entity.name] ?? ""}
                              onChange={(v) => setPfsCompositionRefs((prev) => ({ ...prev, [entity.name]: v }))}
                              options={[{ value: "", label: "— Composition PFS —" }, ...pfsCompositionOptions]}
                              size="sm"
                              searchable
                              placeholder="Composition PFS"
                            />
                          )}
                        </div>
                      )}

                      {/* Create button */}
                      {!isCreated && (
                        <button
                          onClick={() => handleCreateSingle(entity)}
                          disabled={isCreating || (type === "color" && mode === "pattern" && !patternPath && !colorHexes[entity.name])}
                          className="shrink-0 text-xs px-3.5 py-1.5 rounded-lg font-medium transition-colors bg-bg-dark text-text-inverse hover:bg-bg-dark/80 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isCreating ? (
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                              Création…
                            </span>
                          ) : "Créer"}
                        </button>
                      )}
                      {isCreated && (
                        <span className="shrink-0 text-xs text-green-600 font-medium px-3.5 py-1.5">
                          Créé
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductPreviewRow({ product: p }: { product: PreviewProduct }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = p.status === "ok" ? "✓" : p.status === "warning" ? "⚠️" : "✗";
  const statusCls = p.status === "ok"
    ? "text-green-600 bg-green-50"
    : p.status === "warning"
    ? "text-amber-600 bg-amber-50"
    : "text-red-600 bg-red-50";

  return (
    <>
      <div
        className={`grid grid-cols-[auto_1fr_1fr_2fr_auto] gap-4 items-start px-6 py-3 cursor-pointer hover:bg-[#FAFAFA] transition-colors ${p.totalErrors > 0 ? "bg-red-50/20" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status */}
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${statusCls}`}>
          {statusIcon}
        </span>

        {/* Reference */}
        <div>
          <p className="font-mono text-sm font-medium text-text-primary">{p.reference}</p>
          {p.referenceExists && <p className="text-xs text-red-500">Déjà existante</p>}
        </div>

        {/* Name + Category */}
        <div>
          <p className="text-sm font-medium text-text-primary truncate">{p.name || "—"}</p>
          {p.category && (
            <p className={`text-xs ${p.categoryFound ? "text-[#666]" : "text-red-500"}`}>
              {p.category}{!p.categoryFound && " ✗"}
            </p>
          )}
        </div>

        {/* Variants compact */}
        <div className="flex flex-wrap gap-1">
          {p.variants.map((v, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${v.errors.length > 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-bg-secondary border-border text-[#444]"}`}
            >
              {!v.colorFound && <span>⚠️</span>}
              {v.color || "?"}
              <span className="text-[10px] opacity-60">{v.saleType === "PACK" ? `×${v.packQuantity ?? "?"}` : `${v.unitPrice}€`}</span>
            </span>
          ))}
        </div>

        {/* Error count */}
        <div className="text-right">
          {p.totalErrors > 0 ? (
            <span className="text-xs text-red-600 font-medium">{p.totalErrors} erreur{p.totalErrors > 1 ? "s" : ""}</span>
          ) : (
            <span className="text-xs text-green-600">OK</span>
          )}
          <div className="text-xs text-[#999] mt-0.5">{expanded ? "▲" : "▼"}</div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-6 pb-4 bg-[#FAFAFA] border-t border-border-light">
          <div className="grid gap-2 pt-3">
            {p.variants.map((v, i) => (
              <div key={i} className={`flex items-start gap-3 p-2 rounded-lg text-sm ${v.errors.length > 0 ? "bg-red-50" : "bg-bg-primary"}`}>
                <div className="w-1/4 font-medium text-text-primary">{v.color || "—"}</div>
                <div className="text-[#666]">{v.saleType}{v.saleType === "PACK" ? ` × ${v.packQuantity}` : ""} · {v.unitPrice}€ · stock: {v.stock}</div>
                {v.errors.length > 0 && (
                  <div className="ml-auto text-red-600 text-xs">{v.errors.join(" · ")}</div>
                )}
              </div>
            ))}
            {p.category && !p.categoryFound && (
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700 text-xs">⚠️ Catégorie &laquo;{p.category}&raquo; introuvable.</div>
            )}
            {p.composition && !p.compositionsFound && (
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700 text-xs">⚠️ Composition(s) introuvable(s) : {p.composition}</div>
            )}
            {p.subCategories && !p.subCategoriesFound && (
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700 text-xs">⚠️ Sous-catégorie(s) introuvable(s) : {p.subCategories}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
