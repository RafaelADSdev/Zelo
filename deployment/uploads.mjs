import { randomUUID } from 'node:crypto';
import { fail } from '../lib/core/settings.mjs';
const lifetime = 15 * 60000, chunkSize = 2 * 1024 * 1024;
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function createUploads(catalog, clock = Date.now) {
  const uploads = new Map();
  function clean() {
    for (const [id, value] of uploads) if (!value.saving && value.expires <= clock()) uploads.delete(id);
  }
  function item(id, owner) {
    clean();
    const value = uploads.get(id);
    if (!value || value.owner !== owner) throw fail('Envio expirado. Selecione o arquivo novamente.', 404);
    return value;
  }
  return {
    start(input, owner) {
      clean();
      if (!idPattern.test(input?.productId || '') || typeof input.name !== 'string' || !input.name.length || input.name.length > 180 || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(input.mime) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > (input.mime === 'application/pdf' ? 50 : 10) * 1024 * 1024) throw fail('Arquivo inválido. Use imagens até 10 MB ou PDFs até 50 MB.');
      const { uploadId, productId, name, mime, size } = input;
      if (uploadId !== undefined && (typeof uploadId !== 'string' || !idPattern.test(uploadId))) throw fail('Identificador de envio inválido.');
      const id = uploadId ?? randomUUID();
      const current = uploads.get(id);
      if (current) {
        item(id, owner);
        if (current.productId !== productId || current.name !== name || current.mime !== mime || current.size !== size) throw fail('O arquivo desta tentativa mudou. Selecione-o novamente.', 409);
        current.expires = clock() + lifetime;
        return { id, chunkSize, received: current.received };
      }
      if ([...uploads.values()].filter(value => !value.result).length >= 3) throw fail('Conclua ou cancele os envios em andamento e tente novamente.', 429);
      uploads.set(id, { owner, productId, name, mime, size, chunks: [], received: 0, expires: clock() + lifetime, resumable: uploadId !== undefined });
      return { id, chunkSize, received: 0 };
    },
    append(id, owner, offset, bytes) {
      const value = item(id, owner);
      if (offset !== value.received) throw fail('A ordem das partes mudou. Tente retomar o envio.', 409);
      if (!bytes.length || bytes.length > chunkSize || value.received + bytes.length > value.size) throw fail('Parte de arquivo inválida.', 413);
      value.chunks.push(bytes);
      value.received += bytes.length;
      value.expires = clock() + lifetime;
      return { received: value.received };
    },
    cancel(id, owner) {
      clean();
      const value = uploads.get(id);
      if (value?.owner === owner && !value.saving && !value.result) uploads.delete(id);
    },
    async finish(id, owner) {
      const value = item(id, owner);
      if (value.result) return value.result;
      if (value.received !== value.size) throw fail('Arquivo incompleto.', 409);
      if (value.saving) return value.saving;
      const save = async () => {
        const result = await catalog.upload(value.productId, Buffer.concat(value.chunks), value.name, value.mime);
        if (!value.resumable) uploads.delete(id);
        else {
          value.result = result;
          value.chunks = [];
          value.expires = clock() + lifetime;
        }
        return result;
      };
      value.saving = save();
      try { return await value.saving; }
      finally { value.saving = null; }
    },
  };
}
