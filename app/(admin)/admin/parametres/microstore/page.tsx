import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCachedShopName, getCachedHasMicrostoreConfig } from "@/lib/cached-data";
import { decryptIfSensitive } from "@/lib/encryption";
import { decodeMicrostoreTokenExpiration } from "@/lib/microstore-auth";
import { setSiteConfig } from "@/lib/site-config-write";
import { SettingCard, CardsStack } from "@/components/admin/settings/SettingCard";
import MicrostoreConnectCard from "@/components/admin/settings/MicrostoreConnectCard";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Microstore — ${shopName} Admin` };
}

const IcoQr = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM19 14h2M14 19h2v2h-2zM19 19h2v2h-2z" />
  </svg>
);

const IcoInfo = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01M12 12v4" />
  </svg>
);

export default async function MicrostoreSettingsPage() {
  const [connected, enabledRow, expiresRow, maskRow] = await Promise.all([
    getCachedHasMicrostoreConfig(),
    prisma.siteConfig.findFirst({ where: { key: "microstore_enabled" }, select: { value: true } }),
    prisma.siteConfig.findFirst({
      where: { key: "microstore_expires_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { key: "microstore_mask_token" },
      select: { value: true },
    }),
  ]);
  const enabled = enabledRow?.value !== "false";

  // Rétro-compat : si `microstore_expires_at` n'existait pas encore (session
  // connectée avant l'ajout de cette clé), on décode le mask_token en base et
  // on backfille la clé une fois pour toutes.
  let expiresAtSec = expiresRow?.value ? Number(expiresRow.value) : null;
  if ((!expiresAtSec || !Number.isFinite(expiresAtSec)) && maskRow?.value) {
    try {
      const decrypted = decryptIfSensitive("microstore_mask_token", maskRow.value);
      const decoded = decodeMicrostoreTokenExpiration(decrypted);
      if (decoded) {
        expiresAtSec = decoded;
        await setSiteConfig("microstore_expires_at", String(decoded));
      }
    } catch {
      // ignore : on affichera juste "Session active" générique
    }
  }
  const expiresAtIso =
    expiresAtSec && Number.isFinite(expiresAtSec)
      ? new Date(expiresAtSec * 1000).toISOString()
      : null;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Fil d'ariane */}
      <nav className="text-xs text-text-muted font-body">
        <Link href="/admin/parametres?tab=marketplaces" className="hover:text-text-primary">
          Paramètres → Marketplaces
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text-primary font-medium">Microstore</span>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-slate-300/30 pointer-events-none" />
        <div className="relative px-6 py-8">
          <p className="font-body text-[10.5px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            Import de commandes
          </p>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary mt-2">
            Microstore
          </h1>
          <p className="font-body text-sm text-text-secondary mt-2 max-w-xl">
            Connectez votre compte Microstore une seule fois pour importer vos commandes directement dans votre admin. La connexion se fait par QR code, comme WhatsApp Web.
          </p>
          {connected && (
            <div className="mt-4">
              <Link
                href="/admin/commandes/microstore"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-text-primary text-text-inverse text-sm font-body font-bold hover:bg-text-primary/90 transition-colors"
              >
                Importer les commandes →
              </Link>
            </div>
          )}
        </div>
      </section>

      <CardsStack>
        <SettingCard
          icon={IcoQr}
          title="Connexion Microstore"
          description="Scannez le QR code depuis votre application mobile Microstore"
          accent="dark"
          status={
            connected
              ? { tone: "ok", label: "Connecté" }
              : { tone: "off", label: "Non connecté" }
          }
        >
          <MicrostoreConnectCard
            initiallyConnected={connected}
            initiallyEnabled={enabled}
            initialExpiresAtIso={expiresAtIso}
          />
        </SettingCard>

        <SettingCard
          icon={IcoInfo}
          title="Comment ça marche"
          description="Pas d'API classique — Microstore utilise un QR code de scan"
        >
          <ol className="space-y-3 text-sm text-text-secondary font-body list-decimal list-inside">
            <li>
              Cliquez sur <b>Connecter Microstore</b> pour afficher un QR code.
            </li>
            <li>
              Ouvrez l'<b>application mobile Microstore</b> sur votre téléphone.
            </li>
            <li>
              Dans l'app : menu → <b>« Se connecter à la version web »</b> → <b>scannez le QR</b> affiché ici.
            </li>
            <li>
              Un message vert « Connecté » s'affichera automatiquement.
            </li>
            <li>
              Vous pourrez ensuite <b>importer vos commandes</b> depuis la page « Commandes » de votre admin.
            </li>
          </ol>
          <div className="mt-4 p-3 rounded-xl bg-bg-secondary/50 border border-border-light text-xs text-text-muted">
            💡 La connexion reste valide <b>environ 1 an</b>. Si un jour l'import s'arrête de fonctionner, un bandeau rouge vous demandera simplement de re-scanner un nouveau QR.
          </div>
        </SettingCard>
      </CardsStack>
    </div>
  );
}
