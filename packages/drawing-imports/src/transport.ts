import { DomainError } from '../../contracts/src/project';
import { MAX_FLOORPLAN_BYTES, MAX_HOUSESPEC_BYTES } from '../../contracts/src/floorplan-imports';

async function readBounded(request: Request, limit: number, tooLarge: () => DomainError) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('INVALID_INPUT', '请求内容为空。');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw tooLarge(); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
const fileTooLarge = () => new DomainError('FILE_TOO_LARGE', `图纸文件不能超过 ${MAX_FLOORPLAN_BYTES / 1024 / 1024} MB。`, 413);

/** multipart/form-data with exactly `file` and `metadata`; actual streamed bytes are bounded, Content-Length is ignored. */
export async function readFloorplanUpload(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.startsWith('multipart/form-data;')) throw new DomainError('INVALID_CONTENT_TYPE', '请选择图纸文件后提交。', 415);
  const raw = await readBounded(request, MAX_FLOORPLAN_BYTES + 64 * 1024, fileTooLarge);
  let form: FormData;
  try { form = await new Response(raw, { headers: { 'content-type': contentType } }).formData(); }
  catch { throw new DomainError('INVALID_INPUT', '上传内容无法解析，请重新选择文件。'); }
  const file = form.get('file'), metadata = form.get('metadata');
  if (!(file instanceof File) || typeof metadata !== 'string' || metadata.length > 2000 || form.getAll('file').length !== 1
    || form.getAll('metadata').length !== 1 || [...form.keys()].some(key => !['file', 'metadata'].includes(key)))
    throw new DomainError('INVALID_INPUT', '图纸文件与上传信息不完整。');
  if (file.size > MAX_FLOORPLAN_BYTES) throw fileTooLarge();
  let input: unknown;
  try { input = JSON.parse(metadata); } catch { throw new DomainError('INVALID_INPUT', '上传信息无法解析。'); }
  return { input, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name };
}

/** JSON body for a member HouseSpec import; larger than the generic 64 KB API cap, still bounded. */
export async function readHouseSpecBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('INVALID_CONTENT_TYPE', '请使用 JSON 请求。', 415);
  const raw = await readBounded(request, MAX_HOUSESPEC_BYTES, () => new DomainError('INPUT_TOO_LARGE', '户型数据不能超过 1 MB。', 413));
  try { return JSON.parse(raw.toString('utf8')); } catch { throw new DomainError('INVALID_INPUT', '请求内容无法解析。'); }
}
