import { redirect } from "next/navigation";

export default function CompositionsRedirect() {
  redirect("/admin/produits/attributs?onglet=compositions");
}
