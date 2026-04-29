"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import Image from "next/image";
import { createClaim } from "@/app/actions/client/claims";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";

const REASONS = [
  { value: "DEFECTIVE", label: "Défectueux" },
  { value: "WRONG_ITEM", label: "Mauvais article" },
  { value: "MISSING", label: "Manquant" },
  { value: "DAMAGED", label: "Endommagé" },
  { value: "OTHER", label: "Autre" },
];

interface Order {
  id: string;
  orderNumber: string;
  items: { id: string; productName: string; quantity: number }[];
}

interface ImagePreview {
  file: File;
  url: string;
}

const MAX_IMAGES = 5;

export default function ClaimForm({ orders, preselectedOrderId }: { orders: Order[]; preselectedOrderId?: string }) {
  const [type, setType] = useState<"ORDER_CLAIM" | "GENERAL">(preselectedOrderId ? "ORDER_CLAIM" : "GENERAL");
  const [orderId, setOrderId] = useState(preselectedOrderId || "");
  const [description, setDescription] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<string, { quantity: number; reason: string; reasonDetail: string }>>({});
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedOrder = orders.find((o) => o.id === orderId);

  function toggleItem(itemId: string) {
    setSelectedItems((prev) => {
      if (prev[itemId]) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: { quantity: 1, reason: "DEFECTIVE", reasonDetail: "" } };
    });
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_IMAGES} images.`);
      return;
    }

    const toAdd = files.slice(0, remaining);
    const newPreviews: ImagePreview[] = toAdd.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));

    setImages((prev) => [...prev, ...newPreviews]);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].url);
      copy.splice(index, 1);
      return copy;
    });
  }

  async function uploadImages(): Promise<string[]> {
    if (images.length === 0) return [];

    const formData = new FormData();
    for (const img of images) {
      formData.append("images", img.file);
    }

    const res = await fetch("/api/client/claims/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Erreur upload");
    }

    const data = await res.json();
    return data.paths as string[];
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;

    const items = type === "ORDER_CLAIM"
      ? Object.entries(selectedItems).map(([orderItemId, data]) => ({
          orderItemId,
          quantity: data.quantity,
          reason: data.reason,
          reasonDetail: data.reasonDetail || undefined,
        }))
      : undefined;

    startTransition(async () => {
      try {
        setUploading(true);
        const imagePaths = await uploadImages();
        setUploading(false);

        const result = await createClaim({
          type,
          orderId: type === "ORDER_CLAIM" ? orderId : undefined,
          description,
          items: items && items.length > 0 ? items : undefined,
          imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
        });

        if (result.success && result.claimId) {
          toast.success("Réclamation créée avec succès");
          router.push(`/espace-pro/reclamations/${result.claimId}`);
        } else {
          toast.error(result.error || "Erreur");
        }
      } catch {
        setUploading(false);
        toast.error("Erreur lors de l'envoi des images.");
      }
    });
  }

  const orderOptions = [
    { value: "", label: "Sélectionnez une commande" },
    ...orders.map((o) => ({ value: o.id, label: o.orderNumber })),
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Type selection */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
        <h3 className="font-heading font-bold text-text-primary mb-1">Type de réclamation</h3>
        <p className="text-xs text-text-muted font-body mb-4">
          Sélectionnez si votre réclamation concerne une commande spécifique ou un sujet général.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {([
            { key: "ORDER_CLAIM" as const, label: "Liée à une commande", desc: "Problème avec un ou plusieurs articles", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
            { key: "GENERAL" as const, label: "Générale", desc: "Question, suggestion, autre demande", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
          ]).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => { setType(t.key); if (t.key === "GENERAL") { setOrderId(""); setSelectedItems({}); } }}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center ${
                type === t.key
                  ? "border-[#1A1A1A] bg-[#1A1A1A]/[0.03]"
                  : "border-border hover:border-[#1A1A1A]/20"
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                type === t.key ? "bg-[#1A1A1A] text-white" : "bg-bg-secondary text-text-muted"
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={t.icon} />
                </svg>
              </div>
              <span className={`text-sm font-semibold font-body ${type === t.key ? "text-text-primary" : "text-text-muted"}`}>
                {t.label}
              </span>
              <span className="text-xs text-text-muted/70 font-body leading-tight">{t.desc}</span>
              {type === t.key && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#1A1A1A] flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Order + items selection */}
      {type === "ORDER_CLAIM" && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <h3 className="font-heading font-bold text-text-primary mb-1">Commande concernée</h3>
            <p className="text-xs text-text-muted font-body mb-3">
              Sélectionnez la commande concernée par votre réclamation.
            </p>
            <CustomSelect
              value={orderId}
              onChange={(v) => { setOrderId(v); setSelectedItems({}); }}
              options={orderOptions}
              placeholder="Sélectionnez une commande"
            />
          </div>

          {selectedOrder && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">
                  Articles concernés
                </p>
                <p className="text-xs text-text-muted font-body">
                  Cochez les articles qui posent problème
                </p>
              </div>
              <div className="space-y-2">
                {selectedOrder.items.map((item) => {
                  const isSelected = !!selectedItems[item.id];
                  return (
                    <div
                      key={item.id}
                      className={`border-2 rounded-xl transition-all overflow-hidden ${
                        isSelected ? "border-[#1A1A1A] bg-[#1A1A1A]/[0.02]" : "border-border hover:border-[#1A1A1A]/15"
                      }`}
                    >
                      <label className="flex items-center gap-3 p-3.5 cursor-pointer">
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? "bg-[#1A1A1A] border-[#1A1A1A]" : "border-border"
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(item.id)}
                          className="sr-only"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-body font-medium text-text-primary truncate">{item.productName}</p>
                          <p className="text-xs text-text-muted font-body">Quantité commandée : {item.quantity}</p>
                        </div>
                      </label>

                      {/* Detail fields when selected */}
                      {isSelected && (
                        <div className="px-3.5 pb-3.5 pt-0 border-t border-border/50">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                            <div className="sm:col-span-2">
                              <label className="block text-xs text-text-muted font-body mb-1">Motif</label>
                              <CustomSelect
                                value={selectedItems[item.id].reason}
                                onChange={(v) => setSelectedItems((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], reason: v },
                                }))}
                                options={REASONS}
                                size="sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-text-muted font-body mb-1">Quantité</label>
                              <input
                                type="number"
                                min={1}
                                max={item.quantity}
                                value={selectedItems[item.id].quantity}
                                onChange={(e) => setSelectedItems((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], quantity: parseInt(e.target.value) || 1 },
                                }))}
                                className="w-full border border-border bg-bg-primary px-3 py-1.5 text-sm rounded-lg font-body text-text-primary focus:outline-none focus:border-[#1A1A1A]"
                              />
                            </div>
                          </div>
                          {selectedItems[item.id].reason === "OTHER" && (
                            <div className="mt-3">
                              <label className="block text-xs text-text-muted font-body mb-1">Précisez le motif</label>
                              <input
                                type="text"
                                value={selectedItems[item.id].reasonDetail}
                                onChange={(e) => setSelectedItems((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], reasonDetail: e.target.value },
                                }))}
                                placeholder="Décrivez le problème..."
                                className="w-full border border-border bg-bg-primary px-3 py-1.5 text-sm rounded-lg font-body text-text-primary focus:outline-none focus:border-[#1A1A1A]"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Description */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
        <h3 className="font-heading font-bold text-text-primary mb-1">Description du problème</h3>
        <p className="text-xs text-text-muted font-body mb-3">
          Décrivez le problème rencontré avec le plus de détails possible.
        </p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Décrivez votre problème en détail..."
          rows={5}
          className="w-full border border-border bg-bg-primary px-4 py-3 text-sm rounded-xl text-text-primary font-body resize-none focus:outline-none focus:border-[#1A1A1A] transition-colors"
        />
        <p className="text-xs text-text-muted/60 font-body mt-1 text-right">
          {description.length} caractère{description.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Images upload */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm">
        <h3 className="font-heading font-bold text-text-primary mb-1">Pièces jointes</h3>
        <p className="text-xs text-text-muted font-body mb-4">
          Ajoutez des photos pour illustrer le problème (max {MAX_IMAGES} images, 5 Mo chacune).
        </p>

        {/* Image previews */}
        {images.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-4">
            {images.map((img, index) => (
              <div key={index} className="relative group aspect-square rounded-xl overflow-hidden border border-border bg-bg-secondary">
                <Image
                  src={img.url}
                  alt={`Pièce jointe ${index + 1}`}
                  fill
                  className="object-cover"
                  unoptimized
                />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#1A1A1A]/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload button */}
        {images.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center gap-2 hover:border-[#1A1A1A]/30 hover:bg-bg-secondary/50 transition-all cursor-pointer"
          >
            <div className="w-10 h-10 rounded-lg bg-bg-secondary flex items-center justify-center">
              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-sm font-body text-text-muted">
              Cliquez pour ajouter des photos
            </span>
            <span className="text-xs font-body text-text-muted/50">
              JPG, PNG ou WEBP — {images.length}/{MAX_IMAGES} images
            </span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleImageSelect}
          className="hidden"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={!description.trim() || (type === "ORDER_CLAIM" && !orderId) || isPending}
        className="w-full flex items-center justify-center gap-2 px-4 py-3.5 text-sm font-semibold font-body bg-[#1A1A1A] text-white rounded-xl hover:bg-[#333] disabled:opacity-40 transition-colors shadow-sm"
      >
        {isPending ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {uploading ? "Envoi des images..." : "Création en cours..."}
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            Envoyer la réclamation
          </>
        )}
      </button>
    </form>
  );
}
