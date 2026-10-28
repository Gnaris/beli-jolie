import { redirect } from "next/navigation";

export default function SystemeRedirect() {
  redirect("/admin/contact-client?onglet=systeme");
}
