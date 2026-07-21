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
import { PfsImportDrawer } from "./PfsImportDrawer";

export function AdminWidgetsRail({ children }: { children: React.ReactNode }) {
  return (
    <RightRailProvider>
      {children}
      <RightRail />
      <TranslationDrawer />
      <MarketplacesDrawer />
      <ImagesDrawer />
      <ShootingDrawer />
      <PfsImportDrawer />
    </RightRailProvider>
  );
}

export { useRightRail } from "./RightRailContext";
export type { RailWidgetId } from "./RightRailContext";
