import { redirect } from "next/navigation";

export default function SaisonsRedirect() {
  redirect("/admin/produits/attributs?onglet=saisons");
}
