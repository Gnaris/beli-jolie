"use client";

/**
 * Point de montage unique du rail droit + tous ses tiroirs.
 * À placer une seule fois dans le layout admin.
 */

import { RightRailProvider } from "./RightRailContext";
import { RightRail } from "./RightRail";
import { TranslationDrawer } from "./TranslationDrawer";
import { MarketplacesDrawer } from "./MarketplacesDrawer";
import { ImagesDrawer } from "./ImagesDrawer";
import { ShootingDrawer } from "./ShootingDrawer";
import { EmailsDrawer } from "./EmailsDrawer";
import { OrdersImportDrawer } from "./OrdersImportDrawer";
import { PfsAuditDrawer } from "./PfsAuditDrawer";
import { MicrostoreUploadDrawer } from "./MicrostoreUploadDrawer";

export function AdminWidgetsRail({ children }: { children: React.ReactNode }) {
  return (
    <RightRailProvider>
      {children}
      <RightRail />
      <TranslationDrawer />
      <MarketplacesDrawer />
      <ImagesDrawer />
      <ShootingDrawer />
      <EmailsDrawer />
      {/* Un seul drawer d'import commandes — gère PFS + eFashion en parallèle.
          Il accepte aussi les clés legacy "pfs-import" / "efashion-import" pour
          garantir la rétrocompat avec les points d'ouverture existants. */}
      <OrdersImportDrawer />
      <PfsAuditDrawer />
      <MicrostoreUploadDrawer />
    </RightRailProvider>
  );
}

export { useRightRail } from "./RightRailContext";
export type { RailWidgetId } from "./RightRailContext";
