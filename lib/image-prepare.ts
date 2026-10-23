/**
 * Client-side image preparation, run before a file is sent to Cloudinary.
 *
 * A modern phone photo is routinely 3–12 MB. Almost all of that is spent on
 * pixels the app never shows: the largest surface an inventory or service image
 * appears on is a card at roughly 700 CSS pixels. Decoding once in the browser,
 * scaling to the size actually stored, and re-encoding typically turns a 5 MB
 * upload into a ~300 KB one, which is the single biggest win available without
 * changing the upload architecture.
 *
 * Plain module, browser APIs only, and every step is optional: on a browser
 * without `createImageBitmap`, or when compression would make the file larger,
 * the original is sent untouched.
 */

/** Matches the bound the server applies on upload, so nothing is lost twice. */
export const MAX_UPLOAD_DIMENSION = 1600;

const QUALITY = 0.85;

/**
 * Below this, re-encoding costs more time than the smaller upload saves, so the
 * file is sent as-is and only a preview URL is created.
 */
const MIN_BYTES_TO_REENCODE = 400 * 1024;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export type PreparedImage = {
  /** What to actually send. */
  file: File;
  /** Object URL for an instant local preview, before the server responds. */
  previewUrl: string;
  originalBytes: number;
  bytes: number;
  resized: boolean;
  /** Bytes the server must still read on every save, or `null` if unknown. */
  savedBytes: number | null;
};

function passthrough(file: File): PreparedImage {
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    originalBytes: file.size,
    bytes: file.size,
    resized: false,
    savedBytes: null,
  };
}

/**
 * Returns the file to upload plus a local preview.
 *
 * `savedBytes` is the honest measure of the saving: Cloudinary may re-encode
 * further, and the app has no way to know that up front, so it reports only the
 * reduction it made itself and does not promise a number it cannot keep.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  if (typeof window === "undefined" || typeof createImageBitmap !== "function") return passthrough(file);
  if (!ALLOWED_TYPES.has(file.type)) return passthrough(file);

  const previewUrl = URL.createObjectURL(file);

  // Fast path: small enough that the transfer is not the bottleneck, so skip
  // the decode entirely and hand the file straight over.
  if (file.size <= MIN_BYTES_TO_REENCODE) {
    return {
      file,
      previewUrl,
      originalBytes: file.size,
      bytes: file.size,
      resized: false,
      savedBytes: null,
    };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    // `from-image` applies the EXIF rotation, so a portrait photo shot sideways
    // is not re-encoded lying on its side.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // An unsupported or corrupt image is still uploadable; the server does the
    // real format check.
    return {
      file,
      previewUrl,
      originalBytes: file.size,
      bytes: file.size,
      resized: false,
      savedBytes: null,
    };
  }

  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  if (longest <= MAX_UPLOAD_DIMENSION) {
    bitmap.close();
    return {
      file,
      previewUrl,
      originalBytes: file.size,
      bytes: file.size,
      resized: false,
      savedBytes: null,
    };
  }

  const scale = MAX_UPLOAD_DIMENSION / longest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    // WebP first, JPEG as the fallback: `toBlob` silently returns PNG when the
    // requested type is unsupported, and PNG is still an accepted upload.
    const blob = (await toBlob(canvas, "image/webp")) ?? (await toBlob(canvas, "image/jpeg"));
    if (!blob) throw new Error("no blob");

    // Compression made it bigger: a small, already-optimised PNG can grow when
    // re-encoded. Sending the original is then faster than sending this.
    if (blob.size >= file.size) {
      return {
        file,
        previewUrl,
        originalBytes: file.size,
        bytes: file.size,
        resized: false,
        savedBytes: null,
      };
    }

    const type = ALLOWED_TYPES.has(blob.type) ? blob.type : "image/jpeg";
    const prepared = new File([blob], replaceExtension(file.name, type), { type, lastModified: Date.now() });
    URL.revokeObjectURL(previewUrl);
    const nextPreviewUrl = URL.createObjectURL(prepared);

    return {
      file: prepared,
      previewUrl: nextPreviewUrl,
      originalBytes: file.size,
      bytes: prepared.size,
      resized: true,
      savedBytes: file.size - prepared.size,
    };
  } catch {
    return {
      file,
      previewUrl,
      originalBytes: file.size,
      bytes: file.size,
      resized: false,
      savedBytes: null,
    };
  } finally {
    bitmap.close();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality = QUALITY) {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

function replaceExtension(name: string, type: string) {
  const extension = type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "upload"}.${extension}`;
}

/** `1536` -> `1.5 KB`. Used for the "what we saved you" line under the preview. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
