import { inspectNumbers, phoneNumber, formatPhone } from '/broadcast-import.js';
const $ = id => document.getElementById(id);
export function initBroadcastNumberCheck({ api }) {
  const area = document.createElement('div'); area.className = 'broadcast-number-check';
  area.innerHTML = '<button id="broadcast-check-numbers" type="button" class="secondary-button">Verificar números no WhatsApp</button><p class="hint">Consulta pela conexão QR Code, sem enviar mensagens. Um número encontrado ainda precisa da confirmação de entrega após o envio.</p><p id="broadcast-number-check-status" role="status" aria-live="polite" class="hint"></p><details id="broadcast-number-check-results" hidden><summary>Resultado da verificação</summary><ul></ul><button id="broadcast-remove-missing" type="button" class="quiet-button" hidden>Remover números não encontrados</button></details>';
  $('broadcast-contacts').closest('details').before(area);
  const button = $('broadcast-check-numbers'), status = $('broadcast-number-check-status'), details = $('broadcast-number-check-results'), remove = $('broadcast-remove-missing');
  let results = [], version = 0, checkedSource = '';
  const invalidate = () => { version++; results = []; details.hidden = true; status.textContent = ''; };
  $('broadcast-phones').addEventListener('input', invalidate);
  button.addEventListener('click', async () => {
    const source = $('broadcast-phones').value, parsed = inspectNumbers(source.split(/[\n;,]+/).map(phone => [phone.trim()]).filter(row => row[0]));
    if (!parsed.phones.length || parsed.phones.length > 500 || parsed.invalid.length) { status.textContent = 'Adicione de 1 a 500 números e corrija os inválidos antes de verificar.'; return; }
    const check = ++version; button.disabled = true; results = []; details.hidden = true; status.textContent = 'Consultando o WhatsApp…';
    try {
      for (let index = 0; index < parsed.phones.length; index += 5) {
        const response = await api('/api/whatsapp/check-numbers', { phones: parsed.phones.slice(index, index + 5) });
        if (check !== version || source !== $('broadcast-phones').value) { status.textContent = 'A lista mudou. Verifique os números novamente.'; return; }
        results.push(...response.numbers); status.textContent = `${results.length} de ${parsed.phones.length} números consultados…`;
      }
      const list = details.querySelector('ul'); list.replaceChildren();
      for (const item of results) {
        const row = document.createElement('li'); row.textContent = `${formatPhone(item.phone, '')} · ${item.exists === true ? 'Encontrado' + (item.whatsappPhone !== item.phone ? ` · WhatsApp usa ${formatPhone(item.whatsappPhone, '')}` : '') : item.exists === false ? 'Não encontrado no WhatsApp' : 'Consulta indisponível: ' + item.error}`; list.append(row);
      }
      const found = results.filter(item => item.exists === true).length, missing = results.filter(item => item.exists === false).length;
      status.textContent = `${found} encontrados · ${missing} não encontrados · ${results.length - found - missing} sem resposta. O envio usa o número confirmado pelo WhatsApp.`;
      checkedSource = source; remove.hidden = !missing; details.hidden = false; details.open = missing > 0;
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  remove.addEventListener('click', () => {
    if ($('broadcast-phones').value !== checkedSource) { invalidate(); status.textContent = 'A lista mudou. Verifique os números novamente.'; return; }
    const missing = new Set(results.filter(item => item.exists === false).map(item => item.phone));
    $('broadcast-phones').value = $('broadcast-phones').value.split(/[\n;,]+/).map(value => value.trim()).filter(value => value && !missing.has(phoneNumber(value) || value)).join('\n');
    $('broadcast-phones').dispatchEvent(new Event('input', { bubbles: true })); status.textContent = 'Números não encontrados removidos. Os demais contatos foram preservados.';
  });
}
