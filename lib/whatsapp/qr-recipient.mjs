import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { fail } from '../core/settings.mjs';
import { normalizeBroadcastPhone } from './broadcast-preview.mjs';

export async function resolveQrRecipient(socket, jid) {
  if (jid.endsWith('@lid')) return jid;
  const phone = jid.split('@')[0], candidates = [jid];
  // Brazilian WhatsApp accounts can still use the phone format without the ninth digit.
  if (/^55\d{2}9\d{8}$/.test(phone)) candidates.push(`${phone.slice(0, 4)}${phone.slice(5)}@s.whatsapp.net`);
  else if (/^55\d{2}[6-9]\d{7}$/.test(phone)) candidates.push(`${phone.slice(0, 4)}9${phone.slice(4)}@s.whatsapp.net`);
  let results;
  try { results = await socket.onWhatsApp(...candidates); }
  catch { throw fail('Não foi possível consultar este número no WhatsApp. Nenhuma mensagem foi enviada; confira a conexão e tente novamente.', 502); }
  if (!Array.isArray(results) || results.some(item => !item || typeof item.exists !== 'boolean' || typeof item.jid !== 'string')) throw fail('O WhatsApp não respondeu corretamente à consulta do número. Nenhuma mensagem foi enviada.', 502);
  const matches = results.filter(item => item.exists && /^\d{7,15}@s\.whatsapp\.net$/.test(jidNormalizedUser(item.jid || '')) && normalizeBroadcastPhone(item.jid.split('@')[0]) === normalizeBroadcastPhone(phone));
  const found = matches.find(item => jidNormalizedUser(item.jid) === jid) || matches[0];
  if (found) return jidNormalizedUser(found.jid);
  if (results.some(item => item.exists)) throw fail('O WhatsApp retornou um destinatário diferente do número consultado. Confira o contato antes de enviar.', 502);
  throw Object.assign(fail('Número não encontrado no WhatsApp. Confira DDI, DDD e número antes de enviar.'), { recipientNotFound: true });
}
