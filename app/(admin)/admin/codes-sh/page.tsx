import { redirect } from "next/navigation";

export default function CodesShRedirect() {
  redirect("/admin/produits/attributs?onglet=codes-sh");
}
