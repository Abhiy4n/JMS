import { permanentRedirect } from "next/navigation";

export default function PaidUnpaidBillsPage() {
  permanentRedirect("/bills");
}