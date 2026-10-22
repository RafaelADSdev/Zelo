import { fail } from "../core/settings.mjs";

export function qrMedia(file) {
  return file.mime.startsWith("image/")
    ? { image: file.bytes, mimetype: file.mime, caption: file.name }
    : { document: file.bytes, mimetype: file.mime, fileName: file.name };
}
export async function cloudMedia(config, file, phone, fetchImpl) {
  if (!["application/pdf", "image/jpeg", "image/png"].includes(file.mime)) throw fail("Para enviar pela Cloud API, use imagens JPG/PNG ou PDF. WebP está disponível no modo QR.", 409);
  if (file.mime.startsWith("image/") && file.size > 5 * 1024 * 1024) throw fail("A Cloud API aceita imagens de até 5 MB. Use uma imagem menor.", 409);
  const form = new FormData();
  form.set("messaging_product", "whatsapp"); form.set("type", file.mime);
  form.set("file", new Blob([file.bytes], { type: file.mime }), file.name);
  let response;
  try {
    response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/media`, {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${config.accessToken}` }, body: form, signal: AbortSignal.timeout(30000),
    });
  } catch { throw fail("Não foi possível carregar o arquivo na Meta.", 502); }
  let data; try { data = await response.json(); } catch { throw fail("A Meta não confirmou o carregamento do arquivo.", 502); }
  if (!response.ok || typeof data.id !== "string" || !data.id) throw fail("A Meta recusou o arquivo. Confira o formato, o tamanho e as permissões.", 502);
  const type = file.mime.startsWith("image/") ? "image" : "document";
  return { messaging_product: "whatsapp", to: phone, type, [type]: { id: data.id, ...(type === "document" ? { filename: file.name } : { caption: file.name }) } };
}
