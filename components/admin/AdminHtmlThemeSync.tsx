"use client";

import { useEffect } from "react";
import type { AdminTheme } from "@/lib/admin-theme";

/**
 * Miroir de la classe `admin-dark` sur `<html>` pour permettre au CSS de
 * cibler la scrollbar du navigateur (elle vit sur html/body, hors du scope
 * de #admin-theme-wrapper). Pas de flash : la classe est aussi posée par
 * une balise <script> inline dans le layout admin.
 */
export default function AdminHtmlThemeSync({ theme }: { theme: AdminTheme }) {
  useEffect(() => {
    const html = document.documentElement;
    if (theme === "dark") html.classList.add("admin-dark");
    else html.classList.remove("admin-dark");
    return () => {
      html.classList.remove("admin-dark");
    };
  }, [theme]);
  return null;
}
