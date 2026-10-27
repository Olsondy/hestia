import path from 'node:path';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Production object storage can implement the same interface; no vendor is configured here. */
export interface PrivateFileStore { put(key: string, bytes: Uint8Array): Promise<void>; read(key: string): Promise<Buffer>; remove(key: string): Promise<void>; }
const keyPattern = /^projects\/[0-9a-f-]{36}\/resources\/[0-9a-f-]{36}\.png$/;
export class LocalPrivateFileStore implements PrivateFileStore {
  readonly root: string;
  constructor(root: string) {
    if (!root) throw new Error('PRIVATE_STORAGE_PATH is required');
    this.root = path.resolve(root);
    if (this.root.split(path.sep).includes('public')) throw new Error('Private storage must not be inside a public directory');
  }
  private file(key: string) {
    if (!keyPattern.test(key)) throw new Error('Invalid private storage key');
    const result = path.resolve(this.root, ...key.split('/'));
    if (!result.startsWith(this.root + path.sep)) throw new Error('Private storage boundary violation');
    return result;
  }
  async put(key: string, bytes: Uint8Array) {
    const target = this.file(key), temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  read(key: string) { return readFile(this.file(key)); }
  async remove(key: string) { await unlink(this.file(key)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export function privateStore() { return new LocalPrivateFileStore(process.env.PRIVATE_STORAGE_PATH || ''); }
