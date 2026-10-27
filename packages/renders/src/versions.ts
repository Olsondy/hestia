import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const bytesHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function repositoryFile(name: string) { return path.resolve(process.cwd(), name); }
export const fontFile = () => repositoryFile('assets/fonts/tsanger-yuyang/仓耳渔阳体W02.ttf');
async function sourceHash(names: string[]) {
  const digest = createHash('sha256');
  for (const name of names) digest.update(name).update((await readFile(repositoryFile(name), 'utf8')).replace(/\r\n/g, '\n'));
  return digest.digest('hex');
}
/** Changes to shared geometry/assets cannot silently satisfy a job frozen under older code. */
export async function renderVersions() {
  const catalogFiles = (await readdir(repositoryFile('packages/catalog/src'))).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')).sort().map(name => `packages/catalog/src/${name}`);
  const sceneFiles = (await readdir(repositoryFile('packages/scene-runtime/src'))).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')).sort().map(name => `packages/scene-runtime/src/${name}`);
  const assetVersion = await sourceHash([...catalogFiles,
    'example/prototypes/projects/src/sample/model.js', 'example/prototypes/projects/src/sample/soft-styles.js',
    'example/prototypes/projects/src/sample/textures.js']);
  const rendererCode = await sourceHash([...sceneFiles, 'packages/contracts/src/scene.ts', 'packages/contracts/src/catalog.ts', 'packages/contracts/src/styles.ts', 'packages/styles/src/catalog.ts', 'packages/renders/src/image.ts', 'packages/renders/src/label.ts']);
  const manifest = JSON.parse(await readFile(repositoryFile('package.json'), 'utf8'));
  const three = JSON.parse(await readFile(repositoryFile('node_modules/three/package.json'), 'utf8')).version;
  return { assetVersion, rendererVersion: hash({ format: 'hestia-static-v1', rendererCode,
    packages: { three, sharp: manifest.dependencies.sharp, playwright: manifest.devDependencies['@playwright/test'] },
    font: bytesHash(await readFile(fontFile())) }) };
}
