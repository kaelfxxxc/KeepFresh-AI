// Profile photos.
//
// An avatar goes in the `avatars` bucket, one folder per user id — the shape that
// bucket's storage policies check (`auth.uid() = folder[1]`). The bucket is
// private, so what is written onto `profiles.avatar_url` is a *path*, never the
// output of `getPublicUrl`: that returns a URL the bucket refuses, which is why
// a photo uploaded from Profile used to vanish everywhere it was read back.
//
// The signing side is shared with item photos, in `imageStorage`.

import { deleteImage, uniqueImagePath, resolveImageUri, uploadImage } from './imageStorage';

export const AVATAR_BUCKET = 'avatars';

/**
 * Store a picked photo as the caller's avatar and return the path it now lives
 * at, ready to be written onto `profiles.avatar_url`.
 *
 * A fresh path each time rather than one fixed `avatar.jpg`: <Image> caches by
 * URI, so overwriting an object in place would leave the old photo on screen
 * everywhere it is already rendered. The photo being replaced is deleted
 * afterwards, best-effort, so the bucket does not accumulate them.
 */
export async function uploadAvatar(
  userId: string,
  uri: string,
  previous?: string | null
): Promise<string> {
  const path = await uploadImage(AVATAR_BUCKET, uniqueImagePath(userId, uri), uri);
  if (previous && previous !== path) await deleteImage(AVATAR_BUCKET, previous);
  return path;
}

/** A signed URL for a stored avatar, or `null` when there is nothing to show. */
export function resolveAvatarUri(value?: string | null): Promise<string | null> {
  return resolveImageUri(AVATAR_BUCKET, value);
}
