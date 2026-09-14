"use client";

import { useRef, useState } from "react";
import Image from "@/components/ui/SmartImage";
import { updateBrandBranding } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

/**
 * Édite l'identité visuelle et les réseaux sociaux exposés à Google.
 *
 * - Logo carré 512×512 → utilisé dans le JSON-LD Organization (vignette Google
 *   à côté du nom de la marque) + fallback de l'image Open Graph.
 * - Image de partage 1200×630 dédiée (optionnelle) → si l'admin veut une visuel
 *   spécifique pour Facebook/WhatsApp/LinkedIn, autre que le logo.
 * - Réseaux sociaux : liens `sameAs` du schema Organization. Google peut
 *   afficher un carrousel de profils sous la fiche marque.
 */

type SocialKey =
  | "social_facebook_url"
  | "social_instagram_url"
  | "social_pinterest_url"
  | "social_tiktok_url"
  | "social_youtube_url"
  | "social_linkedin_url"
  | "social_twitter_url";

interface Props {
  initialLogoUrl: string;
  initialOgImageUrl: string;
  initialSocials: Partial<Record<SocialKey, string>>;
}

const SOCIAL_FIELDS: Array<{ key: SocialKey; label: string; placeholder: string }> = [
  { key: "social_instagram_url", label: "Instagram",   placeholder: "https://www.instagram.com/beliandjolie" },
  { key: "social_facebook_url",  label: "Facebook",    placeholder: "https://www.facebook.com/beliandjolie" },
  { key: "social_pinterest_url", label: "Pinterest",   placeholder: "https://www.pinterest.com/beliandjolie" },
  { key: "social_tiktok_url",    label: "TikTok",      placeholder: "https://www.tiktok.com/@beliandjolie" },
  { key: "social_youtube_url",   label: "YouTube",     placeholder: "https://www.youtube.com/@beliandjolie" },
  { key: "social_linkedin_url",  label: "LinkedIn",    placeholder: "https://www.linkedin.com/company/beliandjolie" },
  { key: "social_twitter_url",   label: "X (Twitter)", placeholder: "https://x.com/beliandjolie" },
];

export default function BrandBrandingConfig({ initialLogoUrl, initialOgImageUrl, initialSocials }: Props) {
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [ogImageUrl, setOgImageUrl] = useState(initialOgImageUrl);
  const [socials, setSocials] = useState<Partial<Record<SocialKey, string>>>(initialSocials);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function handleUploadLogo(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/admin/logo/image", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Erreur", message: data.error || "Erreur upload" });
        return;
      }
      setLogoUrl(data.url as string);
      toast({ type: "success", title: "Chargé", message: "Le logo est prêt — pensez à enregistrer." });
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de l'upload." });
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUploadLogo(file);
    e.target.value = "";
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateBrandBranding({ logoUrl, ogImageUrl, socials });
      if (result.success) {
        toast({ type: "success", title: "Enregistré", message: "Identité mise à jour." });
      } else {
        toast({ type: "error", title: "Erreur", message: result.error || "Erreur" });
      }
    } catch {
      toast({ type: "error", title: "Erreur", message: "Erreur lors de la sauvegarde." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Logo ───────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Logo de marque (pour Google)
        </label>
        <p className="text-xs text-text-muted font-body mb-3">
          Image carrée qui apparaît à côté du nom de votre boutique dans les résultats Google et dans les partages sur les réseaux. Idéalement <strong>512×512&nbsp;px</strong>, fond neutre. Différent du favicon (icône d&apos;onglet).
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-border bg-bg-secondary flex-shrink-0">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Logo de marque"
                fill
                className="object-contain p-2"
                unoptimized
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-bg-tertiary">
                <p className="text-text-muted text-xs font-body text-center px-2">
                  Aucun logo
                </p>
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-bg-dark text-text-inverse hover:bg-primary-hover transition-colors disabled:opacity-50 font-body"
              >
                {logoUrl ? "Changer" : "Ajouter"}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl("")}
                  disabled={uploading || saving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[#EF4444]/30 text-[#EF4444] hover:bg-[#EF4444]/5 transition-colors disabled:opacity-50 font-body"
                >
                  Retirer
                </button>
              )}
            </div>
            <p className="text-xs text-text-secondary font-body max-w-xs">
              JPG, PNG, WEBP ou SVG. Max 5&nbsp;Mo. Redimensionné automatiquement en 512×512.
            </p>
          </div>
        </div>
      </div>

      {/* ── Image OG dédiée (optionnelle) ─────────────────────────────── */}
      <div>
        <label htmlFor="og-image-url" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Image de partage sur les réseaux (optionnel)
        </label>
        <p className="text-xs text-text-muted font-body mb-2">
          Lien vers une image spécifique affichée quand quelqu&apos;un partage votre boutique sur WhatsApp, Facebook, LinkedIn, Slack. Idéalement <strong>1200×630&nbsp;px</strong>. Laissez vide pour utiliser une image générée automatiquement à partir de votre nom.
        </p>
        <input
          id="og-image-url"
          type="url"
          value={ogImageUrl}
          onChange={(e) => setOgImageUrl(e.target.value)}
          placeholder="https://…"
          className="field-input"
        />
      </div>

      {/* ── Sociaux ───────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Comptes officiels sur les réseaux sociaux
        </label>
        <p className="text-xs text-text-muted font-body mb-3">
          Vos vrais profils publics. Google peut afficher un carrousel de liens vers vos comptes sous votre fiche marque. Laissez vide les réseaux où vous n&apos;êtes pas — envoyer un lien inexistant fait plus de mal que de bien.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SOCIAL_FIELDS.map((f) => (
            <div key={f.key}>
              <label
                htmlFor={`social-${f.key}`}
                className="block text-xs font-body font-medium text-text-secondary mb-1"
              >
                {f.label}
              </label>
              <input
                id={`social-${f.key}`}
                type="url"
                value={socials[f.key] ?? ""}
                onChange={(e) => setSocials((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="field-input"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || uploading}
          className="btn-primary px-5 disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
