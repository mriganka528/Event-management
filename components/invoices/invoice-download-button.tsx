"use client";

import { useState } from "react";
import { AlertCircle, Download, LoaderCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * PDF download with visible progress.
 *
 * A plain `<Link>` to the route gave the customer nothing to look at while the
 * server queried the invoice and laid out the document — on a slow connection it
 * looked like the click had been ignored, so people clicked again. Fetching the
 * file here means the button can say what is happening, and a failure is
 * reported next to the control instead of replacing the page with JSON.
 */
export function InvoiceDownloadButton({
  invoiceId,
  label = "Download PDF",
  className,
  variant = "outline",
  size = "sm",
}: {
  invoiceId: string;
  label?: string;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/download`, { credentials: "same-origin" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "The invoice could not be prepared. Try again.");
      }
      const blob = await response.blob();
      // The server names the file; fall back to the invoice id if a proxy strips
      // the header rather than downloading a file called "download".
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const fileName = match?.[1] ?? `invoice-${invoiceId.slice(0, 8)}.pdf`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking immediately can cancel the download in some browsers; one tick
      // after the click is enough and does not leak the blob for long.
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The invoice could not be prepared.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className={className}>
      <Button type="button" variant={variant} size={size} onClick={() => void download()} disabled={loading}>
        {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
        {loading ? "Preparing PDF…" : label}
      </Button>
      {error ? (
        <span className="mt-2 flex items-start gap-1.5 text-xs text-[var(--danger-text)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </span>
      ) : null}
    </span>
  );
}
