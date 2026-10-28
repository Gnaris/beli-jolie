import { redirect } from "next/navigation";

export default function InactiviteRedirect() {
  redirect("/admin/contact-client?onglet=inactivite");
}
