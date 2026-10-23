import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { getInvoiceForAdmin } from "@/lib/invoices";
import { InvoiceDocument } from "@/components/invoices/invoice-document";
import { InvoiceDownloadButton } from "@/components/invoices/invoice-download-button";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getInvoiceForAdmin(id);
  if (!view) notFound();
  const { invoice, settings } = view;

  return (
    <main className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/admin/invoices" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
            <ArrowLeft className="h-4 w-4" />All invoices
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Invoice {invoice.invoiceNumber}</h1>
          <p className="mt-1 text-[var(--muted)]">Preview the document, print it, or download the PDF.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/bookings/${invoice.bookingId}`}>
            <Button variant="outline">
              <ExternalLink className="mr-2 h-4 w-4" />Open booking
            </Button>
          </Link>
          <InvoiceDownloadButton invoiceId={invoice.id} />
        </div>
      </div>
      <InvoiceDocument invoice={invoice} settings={settings} />
      <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <Download className="h-3.5 w-3.5" />
        The PDF is generated on demand. This page is the fastest way to check the figures.
      </p>
    </main>
  );
}
