import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const password = randomBytes(24).toString('hex');
const secret = randomBytes(32).toString('hex');
try {
  await writeFile(new URL('../.env', import.meta.url), `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://hestia:${password}@127.0.0.1:54329/hestia\nBETTER_AUTH_SECRET=${secret}\nBETTER_AUTH_URL=http://127.0.0.1:3000\nPRIVATE_STORAGE_PATH=./private-data\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created local .env. No model credentials configured.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env preserved.');
}
