const $ = selector => document.querySelector(selector);
export function syncConnectionMode(mode) {
  document.querySelectorAll('[data-whatsapp-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.whatsappMode === mode)));
}
export function initSettingsUi() {
  const tabs = [...document.querySelectorAll('[data-settings-tab]')];
  function selectTab(tab) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.onclick = () => selectTab(tab);
    tab.onkeydown = event => {
      const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : offset ? (index + offset + tabs.length) % tabs.length : -1;
      if (next < 0) return;
      event.preventDefault(); selectTab(tabs[next]); tabs[next].focus();
    };
  }
  document.querySelectorAll('[data-whatsapp-mode]').forEach(button => {
    button.onclick = () => {
      $('#whatsappMode').value = button.dataset.whatsappMode;
      $('#whatsappMode').dispatchEvent(new Event('change'));
    };
  });
}
export function renderConnectionPresentation(qr, config) {
  const mode = $('#whatsappMode').value, connected = qr.status === 'connected';
  const badge = $('#qr-connection-badge');
  badge.textContent = mode === 'cloud' ? (config.validatedAt ? 'Número validado' : 'Configurar Meta') : connected ? 'WhatsApp conectado' : ['connecting','reconnecting','qr'].includes(qr.status) ? 'Aguardando conexão' : 'Não conectado';
  badge.dataset.state = mode === 'cloud' ? (config.validatedAt ? 'connected' : 'disconnected') : qr.status;
  $('.qr-frame').dataset.state = qr.status;
  $('#qr-placeholder-help').textContent = connected ? 'Número vinculado a este ambiente.' : 'Gere um código e escaneie com o celular.';
  $('#qr-connect').hidden = connected;
}
