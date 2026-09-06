import { uploadAttachment } from "../api";
import type { TradeSetup, TradeSetupImage } from "./types";

function isDataUrl(value: string | undefined) {
  return Boolean(value?.startsWith("data:image/"));
}

async function migrateImage(image: TradeSetupImage | null): Promise<{ image: TradeSetupImage | null; changed: boolean }> {
  if (!image || !isDataUrl(image.url)) return { image, changed: false };
  const response = await fetch(image.url);
  const blob = await response.blob();
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
  const file = new File([blob], image.name || `legacy-setup-chart.${extension}`, { type: blob.type });
  const uploaded = await uploadAttachment(file);
  return { image: { ...image, url: uploaded.signedUrl, storagePath: uploaded.path, name: file.name, mime: file.type }, changed: true };
}

export async function migrateLegacySetupImages(setups: TradeSetup[]) {
  let changed = false;
  const migrated: TradeSetup[] = [];
  for (const setup of setups) {
    try {
      const cover = await migrateImage(setup.coverImage);
      const images = [] as TradeSetupImage[];
      for (const image of setup.images) {
        const result = await migrateImage(image);
        images.push(result.image as TradeSetupImage);
        changed ||= result.changed;
      }
      changed ||= cover.changed;
      migrated.push({ ...setup, coverImage: cover.image, images, image: cover.image?.url ?? null, photos: images.map((image) => ({ id: image.id, url: image.url, caption: image.caption, storagePath: image.storagePath })) });
    } catch {
      migrated.push(setup);
    }
  }
  return { setups: migrated, changed };
}

