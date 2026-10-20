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
  if (!current.isMaster) return current;
  document.querySelector('#access-nav').hidden = false;
  const status = document.querySelector('#workspace-access-status');
  let accounts = [], generation = 0, lastInvitedEmail = '';
  const date = value => value ? new Date(Number(value)).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '—';
  const state = account => !account.enabled ? 'suspended' : account.pending ? (Number(account.expires) > Date.now() ? 'pending' : 'expired') : 'active';
  const labels = {active:'Ativa',pending:'Convite pendente',suspended:'Suspensa',expired:'Convite expirado'};
  function node(tag,className,text) { const item=document.createElement(tag); item.className=className; if(text!==undefined)item.textContent=text; return item; }
  function render() {
    document.querySelector('#access-total').textContent = accounts.length;
    for(const name of ['active','pending','suspended']) document.querySelector('#access-'+name).textContent = accounts.filter(account=>state(account)===name).length;
    const list = document.querySelector('#workspace-account-list'); list.replaceChildren();
    const query = document.querySelector('#access-search').value.trim().toLowerCase(), filter = document.querySelector('#access-filter').value;
    const visible = accounts.filter(account=>account.email.toLowerCase().includes(query) && (filter==='all' || state(account)===filter));
    document.querySelector('#access-result-count').textContent = `${visible.length} de ${accounts.length} conta${accounts.length===1?'':'s'}`;
    if(!visible.length) list.append(node('p','access-empty','Nenhuma conta encontrada para esta busca.'));
    for(const account of visible) {
      const master = account.userId === current.userId, situation = state(account);
      const row=node('div','workspace-account-row'), identity=node('div','access-account-identity'), avatar=node('span','access-avatar',account.email.slice(0,1).toUpperCase()), details=node('div','');
      details.append(node('strong','',account.email),node('small','',master?'Administrador master · sua conta':account.pending?'Convidado · ambiente ainda não ativado':'Usuário · ambiente individual'));
      details.append(node('small','access-account-date',account.pending?'Convite válido até '+date(account.expires):'Conta criada em '+date(account.created)));
      identity.append(avatar,details); row.append(identity);
      const controls=node('div','access-account-controls'), badge=node('span','access-state access-state-'+situation,master?'Master':labels[situation]); controls.append(badge);
      if(master) controls.append(node('span','access-protected','Conta protegida'));
      else {
        function button(label,run) {
          const item=node('button','secondary-button',label); item.type='button'; item.setAttribute('aria-label',label+' · '+account.email);
          item.onclick=async()=>{item.disabled=true;status.textContent='';try {await run();} catch(error){status.textContent=error.message;}finally{item.disabled=false;}};
          controls.append(item);
        }
        if(account.pending) {
          button('Gerar novo convite',()=>invite(account.email));
          if(account.enabled && situation==='pending') button('Cancelar convite',async()=>{await api('/api/workspace/access',{email:account.email,enabled:false});if(lastInvitedEmail===account.email)document.querySelector('#workspace-invite-result').hidden=true;await load();status.textContent='Convite cancelado. O link anterior não pode mais ser usado.';});
        } else button(account.enabled?'Suspender acesso':'Reativar acesso',async()=>{
          await api('/api/workspace/access',{email:account.email,enabled:!account.enabled});await load();
          status.textContent=account.enabled?'Acesso suspenso. Sessões encerradas e WhatsApp pausado. Os dados foram preservados.':'Acesso reativado. A pessoa pode entrar novamente.';
        });
      }
      row.append(controls); list.append(row);
    }
  }
  async function load() {
    const request=++generation, result=await api('/api/workspace/accounts');
    if(request!==generation)return;
    accounts=result;render();
  }
  async function invite(email) {
    document.querySelector('#workspace-invite-result').hidden=true;
    const result=await api('/api/workspace/invites',{email});
    document.querySelector('#workspace-invite-link').value=result.link;
    lastInvitedEmail=result.email;
    document.querySelector('#workspace-invite-result').hidden=false;
    status.textContent='Convite criado. Compartilhe o link com a pessoa. Válido por 48 horas, para um único uso.';
    await load();
  }
  document.querySelector('#access-search').addEventListener('input',render);
  document.querySelector('#access-filter').addEventListener('change',render);
  document.querySelector('#access-refresh').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{await load();status.textContent='Lista atualizada.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  };
  document.querySelector('#workspace-invite-form').onsubmit = async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; status.textContent = '';
    try {
      await invite(document.querySelector('#workspace-invite-email').value);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  document.querySelector('#workspace-copy-invite').onclick = async () => {
    try { await navigator.clipboard.writeText(document.querySelector('#workspace-invite-link').value); status.textContent = 'Link copiado.'; }
    catch { status.textContent = 'Selecione e copie o link acima.'; }
  };
  await load();
  return current;
}
