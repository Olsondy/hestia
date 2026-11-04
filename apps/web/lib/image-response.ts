import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * Scheme stills are stored as lossless PNG (~1 MB at 1280×900). Browsers that accept WebP get a q82 WebP instead
 * (~50 KB, visually the same), which matters on slow and long-haul links. Conversions are memoised by content, so a
 * still is converted once per server process. Downloads (`attachment`) always get the original PNG.
 */
const cache = new Map<string, Uint8Array>();
const LIMIT = 64;

async function webp(png: Uint8Array) {
  const key = createHash('sha1').update(png).digest('hex');
  let out = cache.get(key);
  if (!out) {
    out = new Uint8Array(await sharp(png).webp({ quality: 82 }).toBuffer());
    cache.set(key, out);
    if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  }
  return out;
}

export async function stillResponse(request: Request, png: Uint8Array, headers: Record<string, string>, options: { download?: boolean } = {}) {
  const accepts = !options.download && /image\/webp/.test(request.headers.get('accept') ?? '');
  const body = accepts ? await webp(png).catch(() => null) : null;
  const bytes = body ?? png;
  return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': body ? 'image/webp' : 'image/png', 'Content-Length': String(bytes.length), Vary: 'Accept' } });
}
