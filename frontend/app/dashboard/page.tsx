import { redirect } from "next/navigation";

// Business Sources lives at /business-sources (Individual / Company / Dynamic create form).
// Keep /dashboard as the post-login entry so it lands on that page.
export default function DashboardPage() {
  redirect("/business-sources");
}
