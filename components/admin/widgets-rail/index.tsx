"use client";

/**
 * Point de montage unique du rail droit + tous ses tiroirs.
 * À placer une seule fois dans le layout admin.
 */

import { RightRailProvider } from "./RightRailContext";
import { TranslationDrawer } from "./TranslationDrawer";
import { MarketplacesDrawer } from "./MarketplacesDrawer";
import { ImagesDrawer } from "./ImagesDrawer";
import { ShootingDrawer } from "./ShootingDrawer";
import { OrdersImportDrawer } from "./OrdersImportDrawer";
import { PfsAuditDrawer } from "./PfsAuditDrawer";
import { MicrostoreUploadDrawer } from "./MicrostoreUploadDrawer";
import { BulkMailDrawer } from "./BulkMailDrawer";

// Le FAB bottom-right (`<RightRail />`) est retiré : le déclencheur du menu
// vit désormais dans AdminHeaderWidgetLauncher, placé dans l'entête de page.
// On garde ici uniquement le provider + les drawers eux-mêmes.
export function AdminWidgetsRail({ children }: { children: React.ReactNode }) {
  return (
    <RightRailProvider>
      {children}
      <TranslationDrawer />
      <MarketplacesDrawer />
      <ImagesDrawer />
      <ShootingDrawer />
      <OrdersImportDrawer />
      <PfsAuditDrawer />
      <MicrostoreUploadDrawer />
      <BulkMailDrawer />
    </RightRailProvider>
  );
}

export { useRightRail } from "./RightRailContext";
export type { RailWidgetId } from "./RightRailContext";
