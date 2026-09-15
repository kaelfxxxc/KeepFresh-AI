// foodVisionService — turns a photo the user took or picked into the same
// `LookupResult` a barcode scan produces, by way of the food-vision edge
// function (which holds the Anthropic API key server-side).
//
// The point of matching `lookupBarcode`'s return type exactly is that the scan
// screen does not need a second code path: a photo that identifies a food is
// `found`, a photo with no food in it is `not_found`, a spent allowance is
// `limit_reached`, and all three are handled by the logic that already existed
// for barcodes.
//
// The one thing that is genuinely photo-specific is the encoding, and it happens
// here rather than in the screen: this module owns the base64 conversion and the
// size limits, so no caller has to know that a 5 MB JPEG becomes a 6.7 MB string.

import { invokeScanFunction } from './barcodeService';
import type { LookupResult } from './barcodeService';

/**
 * Anthropic accepts 10 MB of base64 per image; the edge function stops short of
 * that at 8 MB. Capping below the server's limit means an oversized photo is
 * refused locally, with wording the user can act on, instead of after a round
 * trip that ends in a bare `lookup_unavailable`.
 */
const MAX_BASE64_CHARS = 7_000_000;

/** Base64 is ~4/3 of the byte size, so this is the same ceiling pre-encoding. */
const MAX_BYTES = 5_000_000;

const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** What the edge function will accept — anything else is refused with a 415. */
const SUPPORTED_MEDIA_TYPES = new Set(Object.values(MEDIA_TYPES));

/**
 * Why a photo could not be sent at all, as opposed to what the server said about
 * it. Kept separate from `LookupResult` so the barcode flow's union — and every
 * switch over it — stays exactly as it was.
 */
export type PhotoLookupResult =
  | LookupResult
  | { status: 'invalid_image'; reason: string };

/** `file:///…/IMG_0042.JPG` or a picker asset's `fileName` → an Anthropic media type. */
function inferMediaType(uri: string, fileName?: string | null): string {
  const source = (fileName || uri).split('?')[0];
  const ext = source.slice(source.lastIndexOf('.') + 1).toLowerCase();
  return MEDIA_TYPES[ext] ?? 'image/jpeg';
}

/** Read a local picker URI into the base64 string the edge function expects. */
async function toBase64(
  uri: string,
  fileName?: string | null,
): Promise<{ base64: string; mediaType: string }> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`could not read the image (${res.status})`);
  const blob = await res.blob();

  if (blob.size > MAX_BYTES) {
    throw new Error('too_large');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });

  // `data:<media type>;base64,<payload>`. The blob's own type is authoritative
  // when it is one we can send — an Android picker can hand back a PNG for an
  // edited photo, or a generic type for a content:// URI — so it is used only
  // when recognised and the file's name decides otherwise.
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('unsupported_image_format');
  const declared = match[1].toLowerCase();
  return {
    base64: match[2],
    mediaType: SUPPORTED_MEDIA_TYPES.has(declared) ? declared : inferMediaType(uri, fileName),
  };
}

/**
 * Identify the food in a photo.
 *
 * Never throws. A photo that cannot be read or is too big comes back as
 * `invalid_image` with a reason worth showing the user; anything the server
 * could not answer comes back as `unavailable`, which callers already degrade to
 * manual entry.
 *
 * One AI scan is charged server-side per answered photo, against the same
 * allowance a barcode scan draws on — so `limit_reached` means the plan's monthly
 * scans are spent, and the caller should have checked `gates.aiScan` first.
 */
export async function recognizeFood(
  uri: string,
  fileName?: string | null,
): Promise<PhotoLookupResult> {
  if (!uri) {
    return { status: 'invalid_image', reason: 'No photo was selected.' };
  }

  let base64 = '';
  let mediaType = '';
  try {
    ({ base64, mediaType } = await toBase64(uri, fileName));
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'too_large') {
      return {
        status: 'invalid_image',
        reason: 'That photo is too large to analyze. Try a lower-resolution one.',
      };
    }
    if (message === 'unsupported_image_format') {
      return { status: 'invalid_image', reason: 'That file is not a supported image.' };
    }
    console.error('recognizeFood: could not read the picked image', err);
    return { status: 'invalid_image', reason: 'That photo could not be opened.' };
  }

  if (!base64) {
    return { status: 'invalid_image', reason: 'That photo came back empty.' };
  }
  if (base64.length > MAX_BASE64_CHARS) {
    return {
      status: 'invalid_image',
      reason: 'That photo is too large to analyze. Try a lower-resolution one.',
    };
  }

  return invokeScanFunction('food-vision', {
    image_base64: base64,
    media_type: mediaType,
  });
}
