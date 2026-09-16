// Item photos: where they are kept, and how a screen gets something <Image> can
// actually render.
//
// Photos go in the `inventory-images` bucket, one folder per user id — the exact
// shape that bucket's storage policies check (`auth.uid() = folder[1]`), so an
// upload that does not use this path is refused by the database rather than by
// us. Nothing here enforces ownership; the policies do.
//
// The bucket is private, so there is no permanent URL for a stored photo. What
// gets written onto the item is therefore the *path* inside the bucket, not a
// URL, and a URL is signed on the way to the screen. That also means the column
// holds two different things depending on where the item came from: one of our
// paths, or an ordinary https URL from a barcode provider. Every read treats it
// as "path or URL" and copes with both.

import { supabase } from '../lib/supabase';

export const ITEM_IMAGE_BUCKET = 'inventory-images';

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
 * the inventory list re-renders its rows — and signing is a network round trip.
 */
const signedUrls = new Map<string, SignedUrl>();

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
function extensionOf(uri: string): string {
  const match = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(uri);
  const ext = match?.[1]?.toLowerCase();
  return ext && MIME_BY_EXTENSION[ext] ? ext : 'jpg';
}

/**
 * Copy a picked file into the bucket and return the path it now lives at.
 *
 * Throws rather than returning null: every caller has to decide what to do about
 * a failed upload, and a silent `null` is how an item ends up saved with no photo
 * and nobody told why.
 *
 * No `upsert` — the name is unique, so a collision would mean two uploads raced
 * on one path, and overwriting whichever lost is not what either caller wanted.
 */
export async function uploadItemImage(userId: string, uri: string): Promise<string> {
  const ext = extensionOf(uri);
  const contentType = MIME_BY_EXTENSION[ext];
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${userId}/${unique}.${ext}`;

  const { error } = await supabase.storage
    .from(ITEM_IMAGE_BUCKET)
    .upload(path, { uri, name: path, type: contentType } as any, { contentType, upsert: false });

  if (error) throw error;
  return path;
}

/**
 * Something renderable for a stored value — the value itself for a URL or a
 * local file, a freshly signed URL for a path in the bucket, `null` if neither.
 *
 * `null` is a real answer: the caller falls back to the category icon, which is
 * a better outcome than a broken image.
 */
export async function resolveItemImageUri(value?: string | null): Promise<string | null> {
  const direct = directImageUri(value);
  if (direct) return direct;
  if (!value) return null;

  const cached = signedUrls.get(value);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.url;

  try {
    const { data, error } = await supabase.storage
      .from(ITEM_IMAGE_BUCKET)
      .createSignedUrl(value, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;

    signedUrls.set(value, {
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
