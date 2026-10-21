import { redirect } from "next/navigation";

export default function InactiviteRedirect() {
  redirect("/admin/marketing?onglet=inactivite");
}
