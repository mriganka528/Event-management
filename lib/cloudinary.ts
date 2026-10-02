import "server-only";

import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const ALLOWED_FOLDERS = new Set(["general", "packages", "services", "inventory"]);
const MANAGED_PREFIX = "event-management/";

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY ?? process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return { cloudName, apiKey, apiSecret };
}

export async function validateCloudinaryImage(file: File) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) throw new Error("Upload a JPEG, PNG, WebP, or AVIF image.");
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error("Images must be smaller than 10 MB.");
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const isAvif = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (!isJpeg && !isPng && !isWebp && !isAvif) throw new Error("The uploaded file is not a valid image.");
}

export async function uploadCloudinaryImage(file: File, folder: string): Promise<UploadApiResponse> {
  if (!ALLOWED_FOLDERS.has(folder)) throw new Error("Invalid upload folder.");
  await validateCloudinaryImage(file);
  getCloudinaryConfig();
  const buffer = Buffer.from(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: `${MANAGED_PREFIX}${folder}`, resource_type: "image", overwrite: false, use_filename: false, unique_filename: true, transformation: [{ width: 2400, height: 2400, crop: "limit" }], quality: "auto:good" }, (error, result) => {
      if (error || !result) { reject(error ?? new Error("Cloudinary did not return an upload result.")); return; }
      resolve(result);
    });
    stream.end(buffer);
  });
}

export async function deleteCloudinaryImage(publicId: string | null | undefined) {
  if (!publicId || !publicId.startsWith(MANAGED_PREFIX) || publicId.includes("..")) return;
  try {
    getCloudinaryConfig();
    await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  } catch (error) {
    console.error("Cloudinary cleanup failed", error);
  }
}

export function assertCloudinaryAssetPair(imageUrl: string | null | undefined, publicId: string | null | undefined) {
  if (!publicId && !imageUrl) return;
  if (publicId && (!publicId.startsWith(MANAGED_PREFIX) || publicId.includes(".."))) throw new Error("Invalid Cloudinary asset reference.");
  if (imageUrl && publicId) {
    try {
      const path = decodeURIComponent(new URL(imageUrl).pathname);
      if (!path.endsWith(`/${publicId}`)) throw new Error("Cloudinary asset reference mismatch.");
    } catch {
      throw new Error("Invalid Cloudinary asset URL.");
    }
  }
}

export function getCloudinaryPublicConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  return cloudName ? { cloudName } : null;
}
