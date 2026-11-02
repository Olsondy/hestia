import { spawn } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A conversion that will not succeed by retrying the same bytes. */
export class DxfConversionError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export type DxfConverterOptions = {
  python?: string; script?: string; timeoutMs?: number; maxEntities?: number; maxOutputBytes?: number;
};

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
export const defaultDxfScript = fileURLToPath(new URL('../python/cadvec_dxf.py', import.meta.url));
export function defaultDxfPython() {
  return process.env.HESTIA_DXF_PYTHON || path.join(repoRoot, '.venv', 'dxf', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}
const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Runs the adapted cadvec converter in a separate Python process (`python -I`, isolated mode: no user site,
 * no PYTHON* environment, script directory not on sys.path). The drawing is copied into a private temporary
 * directory that is also the working directory, and removed afterwards. Wall-clock time and stdout are bounded;
 * the process is killed when either is exceeded. Never call this from a web request.
 */
export async function runDxfConverter(bytes: Uint8Array, options: DxfConverterOptions = {}): Promise<unknown> {
  const python = options.python ?? defaultDxfPython(), script = options.script ?? process.env.HESTIA_DXF_CONVERTER ?? defaultDxfScript;
  const timeoutMs = options.timeoutMs ?? positive(process.env.HESTIA_DXF_TIMEOUT_MS, 60_000);
  const maxEntities = options.maxEntities ?? positive(process.env.HESTIA_DXF_MAX_ENTITIES, 200_000);
  const maxOutput = options.maxOutputBytes ?? 8 * 1024 * 1024;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hestia-dxf-'));
  try {
    const input = path.join(directory, 'input.dxf');
    const handle = await open(input, 'wx', 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    const result = await new Promise<{ code: number | null; stdout: string; reason?: 'timeout' | 'output' }>((resolve, reject) => {
      const child = spawn(python, ['-I', script, input, '--max-entities', String(maxEntities)], {
        cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8', ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) },
      });
      const chunks: Buffer[] = []; let size = 0, reason: 'timeout' | 'output' | undefined;
      const timer = setTimeout(() => { reason = 'timeout'; child.kill('SIGKILL'); }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxOutput) { reason ??= 'output'; child.kill('SIGKILL'); return; }
        chunks.push(chunk);
      });
      child.stderr.resume(); // Diagnostic text from the converter is discarded; it may echo drawing contents.
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), reason }); });
    }).catch(() => { throw new DxfConversionError('CONVERTER_UNAVAILABLE', 'DXF 转换环境不可用，请联系管理员完成转换器安装。'); });
    if (result.reason === 'timeout') throw new DxfConversionError('CONVERSION_TIMEOUT', `DXF 转换超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已停止。请精简图纸后重新上传，或由企业成员辅助转换。`);
    if (result.reason === 'output') throw new DxfConversionError('CONVERTER_OUTPUT_TOO_LARGE', 'DXF 转换结果超出上限，请只保留户型平面后重新上传。');
    let parsed: { ok?: boolean; error?: { code?: unknown; message?: unknown } };
    try { parsed = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? ''); }
    catch { throw new DxfConversionError('CONVERTER_FAILED', 'DXF 转换异常结束，未得到结果。可由企业成员辅助转换。'); }
    if (parsed?.ok === false) {
      const code = typeof parsed.error?.code === 'string' && /^DXF_[A-Z_]{1,40}$/.test(parsed.error.code) ? parsed.error.code : 'CONVERTER_FAILED';
      throw new DxfConversionError(code, typeof parsed.error?.message === 'string' ? parsed.error.message.slice(0, 300) : 'DXF 转换失败。');
    }
    if (result.code !== 0 || parsed?.ok !== true) throw new DxfConversionError('CONVERTER_FAILED', 'DXF 转换异常结束，未得到结果。可由企业成员辅助转换。');
    return parsed;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
