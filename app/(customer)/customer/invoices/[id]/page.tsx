import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import { getInvoiceForCustomer } from "@/lib/invoices";
import { InvoiceDocument } from "@/components/invoices/invoice-document";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false, nocache: true },
};

export default async function CustomerInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getInvoiceForCustomer(id);
  if (!view) notFound();
  const { invoice, settings } = view;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href={`/customer/bookings/${invoice.bookingId}`} className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
            <ArrowLeft className="h-4 w-4" />Back to booking
          </Link>
          <h1 className="mt-3 flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <Receipt className="h-7 w-7 text-[var(--brand-dark)]" />
            Invoice {invoice.invoiceNumber}
          </h1>
          <p className="mt-1 text-[var(--muted)]">Review your invoice here, or download a PDF copy for your records.</p>
        </div>
        <InvoiceDownloadButton invoiceId={invoice.id} size="default" />
      </div>
      <InvoiceDocument invoice={invoice} settings={settings} />
    </div>
  );
}
