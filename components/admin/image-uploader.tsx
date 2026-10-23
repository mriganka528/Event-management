"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Check, CloudUpload, ImagePlus, LoaderCircle, Trash2, TriangleAlert, Zap } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { formatBytes, prepareImageForUpload } from "@/lib/image-prepare";
import { cn } from "@/lib/utils";

type ImageUploaderProps = {
  name?: string;
  publicIdName?: string;
  folder: string;
  label: string;
  defaultUrl?: string | null;
  defaultPublicId?: string | null;
  required?: boolean;
  /**
   * Called whenever the attached image changes.
   *
   * The value lives in two React-controlled hidden inputs, so writing it fires
   * no DOM event and an enclosing `<form>` never hears about it. A form that
   * enables its save button on change would otherwise stay disabled after the
   * one edit that mattered most — attaching or removing an image.
   */
  onValueChange?: () => void;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(",");

/**
 * Cloudinary upload field with a drag-and-drop target.
 *
 * The file is streamed to `/api/admin/uploads`, which is the single place the
 * Cloudinary API key and secret are used. Nothing here ever stores a
 * hand-typed or externally hosted URL: the hidden inputs are only ever written
 * from a successful Cloudinary response, which is what keeps the saved row
 * inside the managed `event-management/` folder the server validates.
 *
 * Progress is written into the field rather than raised as a toast. The upload
 * used to announce itself with a `toast.loading` that sat over the form for the
 * whole round trip: on a large photo that is several seconds of a popup
 * covering the very card being filled in, it stacks up when two images are
 * attached one after the other, and it leaves the field itself looking idle —
 * the spinner in the button said "Uploading…" and the line underneath still read
 * "Drag an image here, or browse". The status now lives where the operator is
 * already looking, and only the outcome is worth interrupting them for.
 */
export function ImageUploader({
  name = "imageUrl",
  publicIdName = "imagePublicId",
  folder,
  label,
  defaultUrl = null,
  defaultPublicId = null,
  required = false,
  onValueChange,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [publicId, setPublicId] = useState(defaultPublicId ?? "");
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A local object URL shown the moment the file is chosen, before the server
   * has seen it. Without it the field stays empty for the whole round trip, which
   * reads as "nothing happened" on a large photo.
   */
  const [preview, setPreview] = useState<string | null>(null);
  const [savedBytes, setSavedBytes] = useState<number | null>(null);
  // Drag events fire per child element, so a counter avoids the classic flicker
  // where `dragleave` from an inner node cancels an active drag.
  const dragDepth = useRef(0);
  const previewRef = useRef<string | null>(null);

  // Object URLs are a manual resource: one leaked per upload adds up over a
  // long admin session. The ref, rather than the state, is what the cleanup
  // reads, so the effect does not need to re-subscribe on every preview.
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const resetFileInput = useCallback(() => {
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  /** The single point every attached-image change funnels through. */
  function setImage(nextUrl: string, nextPublicId: string) {
    setUrl(nextUrl);
    setPublicId(nextPublicId);
    onValueChange?.();
  }

  /**
   * Replaces the local preview, releasing the URL it supersedes.
   *
   * Deliberately not named `use…`: it is a plain helper called from inside
   * `upload`, and a `use` prefix would have the hooks lint treat it as a hook
   * called outside a component.
   */
  function swapPreview(next: string | null) {
    if (previewRef.current && previewRef.current !== next) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next;
    setPreview(next);
  }

  function releasePreview() {
    swapPreview(null);
    setSavedBytes(null);
  }

  /** Cheap local checks so an obvious mistake never costs a round trip. */
  function validateBeforeUpload(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) return "Choose a JPEG, PNG, WebP, or AVIF image.";
    if (file.size <= 0) return "That file is empty.";
    if (file.size > MAX_IMAGE_BYTES) return "Images must be smaller than 10 MB.";
    return null;
  }

  async function upload(file: File) {
    const localError = validateBeforeUpload(file);
    if (localError) {
      setError(localError);
      toast.error(localError);
      resetFileInput();
      return;
    }

    setError(null);

    // Shrink before sending. A phone photo is typically several megabytes and
    // almost none of those pixels are ever displayed, so the transfer — not the
    // Cloudinary call — was the slow part.
    setPreparing(true);
    let prepared;
    try {
      prepared = await prepareImageForUpload(file);
    } catch {
      prepared = null;
    }
    setPreparing(false);

    const payload = prepared?.file ?? file;
    swapPreview(prepared ? prepared.previewUrl : URL.createObjectURL(file));
    setSavedBytes(prepared?.savedBytes ?? null);

    setUploading(true);
    const formData = new FormData();
    formData.set("file", payload);
    formData.set("folder", folder);

    try {
      const response = await fetch("/api/admin/uploads", { method: "POST", body: formData });
      const result = (await response.json().catch(() => null)) as { url?: string; publicId?: string; error?: string } | null;

      if (!response.ok) {
        // A redirect to the sign-in page is HTML, not JSON, so the status is the
        // only honest signal available in that case.
        if (!result) throw new Error(response.status === 401 || response.status === 403 ? "Your session expired. Sign in again to upload images." : "Image upload failed. Please try again.");
        throw new Error(result.error ?? "Image upload failed.");
      }
      if (!result?.url || !result.publicId) throw new Error("Cloudinary did not return an image reference. Please try again.");

      setImage(result.url, result.publicId);
      // The stored URL supersedes the local preview; releasing it stops the
      // object URL from outliving the asset it stood in for.
      releasePreview();
      toast.success("Image uploaded to Cloudinary.");
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Image upload failed.";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
      resetFileInput();
    }
  }

  /** Accepts a drop of files, folders, or both, and ignores non-images. */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (uploading || preparing) return;

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    // Only one asset can be attached to a record, so the first image wins and
    // the rest are reported rather than silently discarded.
    const image = files.find((file) => ACCEPTED_TYPES.includes(file.type));
    if (!image) {
      const message = "That drop contains no JPEG, PNG, WebP, or AVIF image.";
      setError(message);
      toast.error(message);
      return;
    }
    if (files.length > 1) toast(`Only the first of ${files.length} dropped files was uploaded.`);
    void upload(image);
  }

  function clearImage() {
    setImage("", "");
    setError(null);
    releasePreview();
    toast.success("Image removed from this form. Save to apply the change.");
  }

  const busy = uploading || preparing;
  const shown = url || preview;
  /**
   * What the field is doing right now, or null when it is idle. Kept beside the
   * hint line instead of in a popup so it cannot cover the form, and so it is
   * read out rather than only being seen.
   */
  const status = preparing ? "Optimising the image before upload…" : uploading ? "Uploading image to Cloudinary…" : null;

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>

      <input type="hidden" name={name} value={url} />
      <input type="hidden" name={publicIdName} value={publicId} />

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          if (!busy) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={handleDrop}
        className={cn(
          "flex flex-wrap items-center gap-4 rounded-2xl border-2 border-dashed p-4 transition",
          dragging ? "border-[var(--brand)] bg-[var(--brand-softer)]" : "border-[var(--line-strong)] bg-[var(--surface-muted)]",
          busy && "pointer-events-none opacity-70",
        )}
      >
        {shown ? (
          <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl bg-[var(--surface)]">
            <Image src={shown} alt="Uploaded preview" fill sizes="128px" unoptimized className="object-cover" />
            {busy ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                <LoaderCircle className="h-6 w-6 animate-spin" />
              </span>
            ) : null}
          </div>
        ) : (
          <div
            className={cn(
              "flex h-24 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-[var(--surface)] text-[var(--muted)] transition",
              dragging && "text-[var(--brand-dark)]",
            )}
          >
            {busy ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <ImagePlus className="h-7 w-7" />}
            {dragging && !busy ? <span className="text-[10px] font-semibold uppercase tracking-wide">Drop it</span> : null}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
              {busy ? (preparing ? "Optimising…" : "Uploading…") : url ? "Replace" : "Upload image"}
            </Button>
            {url || preview ? (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={clearImage}>
                <Trash2 className="h-4 w-4" />Remove
              </Button>
            ) : null}
          </div>
          {/* One line, swapped rather than stacked: the hint while the field is
              idle, the live status while it is working. */}
          {status ? (
            <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs font-medium text-[var(--brand-dark)]">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {status}
            </p>
          ) : (
            <p className={cn("text-xs transition", dragging ? "font-medium text-[var(--brand-dark)]" : "text-[var(--muted)]")}>
              {dragging ? "Release to upload to Cloudinary." : "Drag an image here, or browse. JPEG, PNG, WebP, or AVIF up to 10 MB."}
            </p>
          )}
          {savedBytes && savedBytes > 0 ? (
            <p className="flex items-center gap-1 text-xs font-medium text-[var(--success-text)]">
              <Zap className="h-3.5 w-3.5" />
              Optimised before sending — {formatBytes(savedBytes)} less to upload.
            </p>
          ) : null}
        </div>
      </div>

      {url ? (
        <p className="flex flex-wrap items-center gap-1 text-xs text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          <span>Cloudinary image ready</span>
          <span className="truncate text-[var(--muted)]">{publicId}</span>
        </p>
      ) : required ? (
        <p className="text-xs text-[var(--muted)]">An image is required. Drop one here to continue.</p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1 text-xs text-red-700">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
