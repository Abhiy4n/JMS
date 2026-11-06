import { permanentRedirect } from "next/navigation";

export default function PaidBillsPage() {
  permanentRedirect("/accounts/bills");
}
