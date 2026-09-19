// User photos in the private storage buckets: how a picked file gets in, and how
// a stored value gets rendered.
//
// Two buckets hold a user's own photos — `inventory-images` for item shots and
// `avatars` for profile pictures — and both are private, so neither has a
// permanent URL. What gets written onto a row is therefore the *path* inside the
// bucket, and a URL is signed on the way to the screen.
//
// A row may still hold an ordinary https URL: a barcode provider's product shot,
// or — from builds before this module existed — an avatar saved as the output of
// `getPublicUrl`. Every read here treats the stored value as "path or URL", and
// recovers the second case rather than trusting it, because a public-bucket URL
// for a private bucket does not load at all. See `legacyPublicPath`.
//
// Ownership is not enforced here. The policies on `storage.objects` check
// `auth.uid() = folder[1]`, so an upload that does not use `<userId>/...` is
// refused by the database rather than by us.

import { supabase } from '../lib/supabase';

/**
 * A week. Long enough that the signature is not being renewed while someone
 * scrolls, short enough that a leaked URL stops working soon after.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Replace a signature this long before it lapses, so no render lands on a dead one. */
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

type SignedUrl = { url: string; expiresAt: number };

/**
 * Signatures already handed out this run of the app.
 *
 * Module-level because the same photo is asked for repeatedly — every scroll of
 * the inventory list re-renders its rows, and the avatar is on more than one
 * screen at once — and signing is a network round trip.
 *
 * Keyed by bucket as well as path: a signature is only valid for the bucket it
 * was made in, and both buckets can hold the same path shape.
 */
const signedUrls = new Map<string, SignedUrl>();

const cacheKey = (bucket: string, path: string) => `${bucket}/${path}`;

/**
 * The value itself, when <Image> can fetch it without help.
 *
 * A remote URL and a file that is still sitting on this device both render
 * directly, and answering synchronously is what keeps a stored URL from flashing
 * the fallback icon for a frame while a promise resolves.
 */
export function directImageUri(value?: string | null): string | null {
  if (!value) return null;
  return /^(https?:|file:|content:|data:|blob:|ph:|assets-library:)/i.test(value) ? value : null;
}

/** A picked file that still lives only on this device, and must be uploaded. */
export function isLocalFileUri(value?: string | null): boolean {
  return !!value && /^(file:|content:|blob:|ph:|assets-library:)/i.test(value);
}

/** The extension to store under, defaulting to jpg for a picker-cache path with none. */
export function imageExtension(uri: string): string {
  const match = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(uri);
  const ext = match?.[1]?.toLowerCase();
  return ext && MIME_BY_EXTENSION[ext] ? ext : 'jpg';
}

/**
 * A fresh `<userId>/<unique>.<ext>` path — the shape both buckets' policies check.
 *
 * Unique because nothing here overwrites: a name collision would mean two uploads
 * raced on one path, and replacing whichever lost is not what either caller
 * wanted. The caller that genuinely replaces a photo (the avatar) uploads to a
 * new path and deletes the old one, so that <Image> — which caches by URI — does
 * not keep showing the previous picture.
 */
export function uniqueImagePath(userId: string, uri: string): string {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${userId}/${unique}.${imageExtension(uri)}`;
}

/**
 * Copy a picked file into `bucket` under `path`, and return that path.
 *
 * Throws rather than returning null: every caller has to decide what to do about
 * a failed upload, and a silent `null` is how a row ends up saved with no photo
 * and nobody told why.
 */
export async function uploadImage(bucket: string, path: string, uri: string): Promise<string> {
  const contentType = MIME_BY_EXTENSION[imageExtension(uri)] ?? 'image/jpeg';

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, { uri, name: path, type: contentType } as any, { contentType, upsert: false });

  if (error) throw error;
  return path;
}

/**
 * Best-effort removal of a photo that has been replaced.
 *
 * Never throws and never returns anything: the row no longer references the
 * object either way, so a failure here is a storage-hygiene problem rather than
 * something the user needs to hear about. A remote URL is left alone — it was
 * never ours to delete.
 */
export async function deleteImage(bucket: string, path?: string | null): Promise<void> {
  if (!path || directImageUri(path)) return;
  // A signature for an object that no longer exists would 404 rather than fall
  // back, so the cached one goes too.
  signedUrls.delete(cacheKey(bucket, path));
  try {
    await supabase.storage.from(bucket).remove([path]);
  } catch {
    // Ignored on purpose — see above.
  }
}

/**
 * The object path inside `bucket` that a legacy public URL names, or null.
 *
 * `getPublicUrl` was the original way avatars were saved, and it never worked:
 * the bucket is private, so the URL it returns is refused and the photo is
 * invisible everywhere the row is read. The URL still names the object, so
 * reading the path back out of it lets the picture the row was always trying to
 * point at load properly — instead of leaving the user with initials they never
 * chose.
 */
function legacyPublicPath(bucket: string, value: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const at = value.indexOf(marker);
  if (at === -1) return null;
  const path = value.slice(at + marker.length).split(/[?#]/)[0];
  return path ? decodeURIComponent(path) : null;
}

/**
 * Something renderable for a stored value — the value itself for a local file or
 * a genuinely public URL, a freshly signed URL for a path in `bucket`, `null` if
 * neither.
 *
 * `null` is a real answer: the caller falls back to the category icon or the
 * user's initials, which is a better outcome than a broken image.
 */
export async function resolveImageUri(bucket: string, value?: string | null): Promise<string | null> {
  if (!value) return null;

  const direct = directImageUri(value);
  // A remote URL normally renders as it stands — unless it is a public-bucket
  // URL for one of our own private buckets, which is a path wearing a URL it
  // cannot honour.
  const path = direct ? legacyPublicPath(bucket, value) : value;
  if (direct && !path) return direct;
  if (!path) return null;

  const key = cacheKey(bucket, path);
  const cached = signedUrls.get(key);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.url;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;

    signedUrls.set(key, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  } catch {
    // Offline, or the object is gone. Either way there is nothing to show, and
    // an unhandled rejection here would take down the row that asked.
    return null;
  }
}
