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
import { OrdersImportDrawer } from "./OrdersImportDrawer";
import { PfsAuditDrawer } from "./PfsAuditDrawer";
import { MicrostoreUploadDrawer } from "./MicrostoreUploadDrawer";
import { BulkMailDrawer } from "./BulkMailDrawer";

// Desktop : le déclencheur du menu vit dans AdminHeaderWidgetLauncher (header
// de page). Sur mobile/tablette (< lg) l'entête est masquée, on remet donc
// le FAB bottom-right historique via `<RightRail />` scopé `< lg`.
export function AdminWidgetsRail({ children }: { children: React.ReactNode }) {
  return (
    <RightRailProvider>
      {children}
      <div className="lg:hidden">
        <RightRail />
      </div>
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
