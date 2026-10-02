import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/route-guards";
import { AuthError } from "@/lib/route-guards";
import { uploadCloudinaryImage } from "@/lib/cloudinary";
import { rateLimitApi, rejectCrossSiteMutation, rejectOversizedBody, withNoStore } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const oversized = rejectOversizedBody(request, 12 * 1024 * 1024);
  if (oversized) return oversized;
  if ((request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "multipart/form-data") return withNoStore(NextResponse.json({ error: "Content-Type must be multipart/form-data." }, { status: 415 }));
  try {
    // Identity + approval + admin role + MFA are all enforced here, so an
    // authenticated-but-unapproved account cannot use this route to store files.
    const user = await requireApiAdmin();
    const limited = rateLimitApi(request, "cloudinary-upload", { limit: 30, windowMs: 10 * 60_000, keySuffix: user.id });
    if (limited) return limited;
    const formData = await request.formData();
    const file = formData.get("file");
    const folder = formData.get("folder");

    if (!(file instanceof File)) {
      return withNoStore(NextResponse.json({ error: "Choose an image to upload." }, { status: 400 }));
    }

    const result = await uploadCloudinaryImage(file, typeof folder === "string" ? folder : "general");
    return withNoStore(NextResponse.json({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    }));
  } catch (error) {
    if (error instanceof AuthError) {
      return withNoStore(NextResponse.json({ error: error.code === "UNAUTHENTICATED" ? "Sign in to continue." : "You are not authorized to perform this action." }, { status: error.code === "UNAUTHENTICATED" ? 401 : 403 }));
    }
    const message = error instanceof Error ? error.message : "Image upload failed.";
    const status = message.includes("not configured") ? 503 : message.includes("Upload") || message.includes("Images") || message.includes("folder") ? 400 : 500;
    return withNoStore(NextResponse.json({ error: status === 500 ? "Image upload failed. Please try again." : message }, { status }));
  }
}
