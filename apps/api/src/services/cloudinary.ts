import crypto from "crypto";
import { env } from "../config/env.js";

type SignableValue = string | number | boolean;

function buildCloudinarySignature(params: Record<string, SignableValue>) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${serialized}${env.CLOUDINARY_API_SECRET}`)
    .digest("hex");
}

export function getCloudinaryConfig() {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary is not configured");
  }

  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY
  };
}

export function createSignedUploadPayload(params: { folder: string; publicId?: string }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const uploadParams: Record<string, SignableValue> = {
    folder: params.folder,
    timestamp
  };

  if (params.publicId) {
    uploadParams.public_id = params.publicId;
  }

  return {
    timestamp,
    folder: params.folder,
    publicId: params.publicId,
    signature: buildCloudinarySignature(uploadParams),
    ...getCloudinaryConfig()
  };
}
