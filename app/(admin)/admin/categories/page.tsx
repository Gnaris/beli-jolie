import { redirect } from "next/navigation";

// L'ancienne URL /admin/categories redirige vers l'URL unifiée des attributs.
// Fusion décidée 2026-10-21 — toute la gestion des attributs produits vit
// désormais sous /admin/produits/attributs avec un query `?onglet=`.
export default function CategoriesRedirect() {
  redirect("/admin/produits/attributs?onglet=categories");
}
