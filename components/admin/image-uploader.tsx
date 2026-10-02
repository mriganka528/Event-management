"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";

type ImageUploaderProps = {
  name?: string;
  publicIdName?: string;
  folder: string;
  label: string;
  defaultUrl?: string | null;
  defaultPublicId?: string | null;
  required?: boolean;
};

export function ImageUploader({
  name = "imageUrl",
  publicIdName = "imagePublicId",
  folder,
  label,
  defaultUrl = null,
  defaultPublicId = null,
  required = false,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [publicId, setPublicId] = useState(defaultPublicId ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("folder", folder);
    const toastId = toast.loading("Uploading image…");

    try {
      const response = await fetch("/api/admin/uploads", { method: "POST", body: formData });
      const payload = (await response.json()) as { url?: string; publicId?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? "Image upload failed.");
      setUrl(payload.url);
      setPublicId(payload.publicId ?? "");
      toast.success("Image uploaded successfully.", { id: toastId });
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Image upload failed.";
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clearImage() {
    setUrl("");
    setPublicId("");
    setError(null);
    toast.success("Image removed from this form.");
  }

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}{required ? <span className="text-red-600"> *</span> : null}</span>
      <input type="hidden" name={name} value={url} />
      <input type="hidden" name={publicIdName} value={publicId} />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] p-3">
        {url ? (
          <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl bg-[var(--surface)]">
            <Image src={url} alt="Uploaded preview" fill sizes="128px" unoptimized className="object-cover" />
          </div>
        ) : (
          <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-xl bg-[var(--surface)] text-[var(--muted)]">
            <ImagePlus className="h-7 w-7" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {uploading ? "Uploading…" : url ? "Replace" : "Upload image"}
          </Button>
          {url ? <Button type="button" size="sm" variant="ghost" onClick={clearImage}><Trash2 className="h-4 w-4" />Remove</Button> : null}
        </div>
      </div>
      {url ? <p className="flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" />Cloudinary image ready</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
