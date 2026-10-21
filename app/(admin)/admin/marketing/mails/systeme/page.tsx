import { redirect } from "next/navigation";

export default function SystemeRedirect() {
  redirect("/admin/marketing?onglet=systeme");
}
