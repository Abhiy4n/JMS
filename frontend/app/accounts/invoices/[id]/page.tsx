import { redirect } from "next/navigation";

export default async function RemovedInvoicePortfolio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/bills?customer=${encodeURIComponent(id)}`);
}
