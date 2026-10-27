import { DomainError } from '../../contracts/src/project';
import { MAX_UPLOAD_BYTES } from '../../contracts/src/underlay';

/** Bound actual streamed bytes before multipart parsing; Content-Length is never trusted. */
export async function readUnderlayUpload(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.startsWith('multipart/form-data;')) throw new DomainError('INVALID_CONTENT_TYPE', '请选择图像后提交。', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('INVALID_INPUT', '上传文件为空。');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_UPLOAD_BYTES + 64*1024) { await reader.cancel(); throw new DomainError('FILE_TOO_LARGE', '所选图像不能超过 12 MB。', 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), {headers:{'content-type':contentType}}).formData(); }
  catch { throw new DomainError('INVALID_INPUT', '上传内容无法解析，请重新选择文件。'); }
  const file = form.get('file'), metadata = form.get('metadata');
  if (!(file instanceof File) || typeof metadata !== 'string' || metadata.length > 20000 || form.getAll('file').length !== 1 || form.getAll('metadata').length !== 1 || [...form.keys()].some(key => !['file','metadata'].includes(key))) throw new DomainError('INVALID_INPUT', '文件与底图信息不完整。');
  if (file.size > MAX_UPLOAD_BYTES) throw new DomainError('FILE_TOO_LARGE', '所选图像不能超过 12 MB。', 413);
  let input: unknown;
  try { input = JSON.parse(metadata); } catch { throw new DomainError('INVALID_INPUT', '底图信息无法解析。'); }
  return { input, bytes: new Uint8Array(await file.arrayBuffer()), mediaType: file.type };
}
