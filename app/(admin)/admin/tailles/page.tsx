import { redirect } from "next/navigation";

export default function TaillesRedirect() {
  redirect("/admin/produits/attributs?onglet=tailles");
}
