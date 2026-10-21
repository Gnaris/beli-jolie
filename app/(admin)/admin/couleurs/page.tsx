import { redirect } from "next/navigation";

export default function CouleursRedirect() {
  redirect("/admin/produits/attributs?onglet=couleurs");
}
