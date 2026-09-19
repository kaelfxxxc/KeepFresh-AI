// Item photos: where they are kept, and how a screen gets something <Image> can
// actually render.
//
// Photos go in the `inventory-images` bucket, one folder per user id — the exact
// shape that bucket's storage policies check (`auth.uid() = folder[1]`), so an
// upload that does not use this path is refused by the database rather than by
// us. Nothing here enforces ownership; the policies do.
//
// The bucket is private, so what is stored on an item is a *path* and a URL is
// signed on the way to the screen. Those mechanics live in `imageStorage`, which
// the avatar in `avatarService` shares; this module is only the item-photo end of
// them, so item reads and avatar reads cannot drift apart.

import { resolveImageUri, uniqueImagePath, uploadImage } from './imageStorage';

export const ITEM_IMAGE_BUCKET = 'inventory-images';

// Re-exported so importers have one place to reach for item photos.
export { directImageUri, isLocalFileUri } from './imageStorage';

/** Copy a picked file into the bucket and return the path it now lives at. */
export async function uploadItemImage(userId: string, uri: string): Promise<string> {
  return uploadImage(ITEM_IMAGE_BUCKET, uniqueImagePath(userId, uri), uri);
}

/**
 * Something renderable for a stored value, or `null` when there is nothing to
 * show — the caller then falls back to the category icon, which is a better
 * outcome than a broken image.
 */
export function resolveItemImageUri(value?: string | null): Promise<string | null> {
  return resolveImageUri(ITEM_IMAGE_BUCKET, value);
}
