export async function initWorkspace({ api }) {
  let current;
  try { current = await api('/api/workspace'); } catch { return; }
  document.querySelector('#workspace-email').textContent = current.email;
  document.querySelector('.local-label').lastChild.textContent = 'Ambiente privado';
  document.querySelector('.sidebar-bottom p').textContent = 'Seu WhatsApp, suas APIs e seus materiais ficam separados das outras contas.';
  const callback = document.querySelector('#callback-url');
  document.querySelector('#publicUrl').readOnly = true;
  for (const id of ['start-tunnel','stop-tunnel']) document.querySelector('#'+id).hidden = true;
  document.querySelector('#workspace-webhook-note').hidden = false;
  callback.value = current.webhookUrl;
  if (current.role !== 'owner') return;
  const panel = document.querySelector('#workspace-access'); panel.hidden = false;
  document.querySelector('#workspace-access-link').hidden = false;
  const status = document.querySelector('#workspace-access-status');
  async function load() {
    const list = document.querySelector('#workspace-account-list'); list.replaceChildren();
    for (const account of await api('/api/workspace/accounts')) {
      const row = document.createElement('div'); row.className = 'workspace-account-row';
      const details = document.createElement('div'), email = document.createElement('strong'), label = document.createElement('small');
      email.textContent = account.email;
      label.textContent = account.role === 'owner' ? 'Administrador · seu ambiente' : !account.enabled ? 'Acesso suspenso' : account.pending ? (Number(account.expires) > Date.now() ? 'Convite pendente' : 'Convite expirado') : 'Ambiente ativo';
      details.append(email,label); row.append(details);
      if (account.role !== 'owner') {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
        button.textContent = account.enabled ? 'Suspender acesso' : 'Reativar acesso';
        button.onclick = async () => {
          button.disabled = true; status.textContent = '';
          try { await api('/api/workspace/access',{email:account.email,enabled:!account.enabled}); await load(); status.textContent = account.enabled ? 'Acesso suspenso e WhatsApp pausado. Os dados foram preservados.' : 'Acesso reativado. A pessoa pode entrar novamente.'; }
          catch (error) { status.textContent = error.message; button.disabled = false; }
        };
        row.append(button);
      }
      list.append(row);
    }
  }
  document.querySelector('#workspace-invite-form').onsubmit = async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; status.textContent = '';
    try {
      const result = await api('/api/workspace/invites',{email:document.querySelector('#workspace-invite-email').value});
      document.querySelector('#workspace-invite-link').value = result.link;
      document.querySelector('#workspace-invite-result').hidden = false;
      status.textContent = 'Convite criado. Envie o link à pessoa. Ele vale por 48 horas e só pode ser usado uma vez.';
      await load();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  document.querySelector('#workspace-copy-invite').onclick = async () => {
    try { await navigator.clipboard.writeText(document.querySelector('#workspace-invite-link').value); status.textContent = 'Link copiado.'; }
    catch { status.textContent = 'Selecione e copie o link acima.'; }
  };
  await load();
}
