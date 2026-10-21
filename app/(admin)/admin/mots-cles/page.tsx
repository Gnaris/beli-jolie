import { redirect } from "next/navigation";

export default function MotsClesRedirect() {
  redirect("/admin/produits/attributs?onglet=mots-cles");
}
