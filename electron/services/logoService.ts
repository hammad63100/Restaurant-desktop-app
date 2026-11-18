import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

const MAX_BYTES = 512 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * The shop logo lives in a file, not in the settings table.
 *
 * It used to be a base64 data URL inside a single settings value — up to 2 MB of
 * text pulled out of SQLite and into memory on every invoice, and copied into every
 * backup in full. A file is read once per print and echoed by path.
 *
 * `settings.shop_logo` now holds one of two things:
 *   * a `data:` URL, from a database written by an older build — still rendered, and
 *     migrated to a file the first time the logo is saved;
 *   * a path relative to the logo directory (`logo.png`) — the normal case.
 */
export function createLogoService(directory: () => string) {
  function logoDirectory(): string {
    const target = directory();
    mkdirSync(target, { recursive: true });
    return target;
  }

  /** Turns a stored value into something an <img src> or a print window can use. */
  function resolve(stored: string | null): string | null {
    if (!stored) return null;

    // An older database: the logo is still inline. Render it as-is.
    if (stored.startsWith('data:')) return stored;

    const filePath = path.join(logoDirectory(), path.basename(stored));
    if (!existsSync(filePath)) return null;

    const extension = path.extname(filePath).slice(1).toLowerCase();
    const mime = MIME_BY_EXTENSION[extension];
    if (!mime) return null;

    return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
  }

  return {
    resolve,

    /**
     * Copies the chosen image in and returns the value to store. A file that is too
     * large is refused rather than silently accepted and then slow to print.
     */
    save(sourcePath: string): string {
      const extension = path.extname(sourcePath).slice(1).toLowerCase();
      if (!MIME_BY_EXTENSION[extension]) {
        throw new AppError('VALIDATION_ERROR', 'Choose a PNG, JPG or WebP image');
      }

      const bytes = readFileSync(sourcePath);
      if (bytes.byteLength > MAX_BYTES) {
        throw new AppError(
          'VALIDATION_ERROR',
          `That image is ${Math.round(bytes.byteLength / 1024)} KB. Please use one under ${
            MAX_BYTES / 1024
          } KB.`,
        );
      }

      // One fixed name per extension would leave stale files behind, so the name
      // carries the extension only and any previous logo is overwritten.
      const fileName = `shop-logo.${extension}`;
      writeFileSync(path.join(logoDirectory(), fileName), bytes);

      logInfo(`Shop logo saved (${Math.round(bytes.byteLength / 1024)} KB)`);
      return fileName;
    },

    /** A data URL chosen in an older build, moved into the logo directory. */
    adoptLegacyDataUrl(dataUrl: string): string {
      const match = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(dataUrl);
      if (!match) return dataUrl;

      const extension = match[2] === 'jpeg' ? 'jpg' : (match[2] ?? 'png');
      const bytes = Buffer.from(match[3] ?? '', 'base64');
      if (bytes.byteLength > MAX_BYTES) return dataUrl;

      const fileName = `shop-logo.${extension}`;
      writeFileSync(path.join(logoDirectory(), fileName), bytes);
      return fileName;
    },
  };
}

export type LogoService = ReturnType<typeof createLogoService>;
