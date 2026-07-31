import type { DrawerShellProps } from "@/components/admin/widgets-rail/DrawerShell";
import type { MarketplaceKey } from "@/lib/marketplaces-brand";

export function marketplaceDrawerAccent(key: MarketplaceKey): DrawerShellProps["accent"] {
  switch (key) {
    case "pfs":
      return "indigo";
    case "ankorstore":
      return "sky";
    case "efashion":
      return "rose";
    case "faire":
      return "amber";
    case "microstore":
      return "cyan";
  }
}
