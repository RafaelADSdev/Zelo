const standalone = matchMedia('(display-mode: standalone)');
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
let installation, appInstalled = false;
const container = document.createElement('div'); container.className = 'pwa-tools';
const button = document.createElement('button'); button.type = 'button'; button.className = 'pwa-install'; button.hidden = true; button.textContent = 'Instalar Zelo';
const status = document.createElement('span'); status.className = 'pwa-network'; status.role = 'status'; status.hidden = navigator.onLine;
status.textContent = 'Sem conexão';
const help = document.createElement('p'); help.className = 'pwa-install-help'; help.hidden = true; help.id = 'pwa-install-help'; help.role = 'status';
container.append(status, button, help);
(document.querySelector('.main-topbar') || document.querySelector('.login-install-tools') || document.querySelector('.login-card'))?.append(container);
const installed = () => appInstalled || standalone.matches || navigator.standalone === true;
function sync() { button.hidden = installed() || (!installation && !ios); button.textContent = installation ? 'Instalar Zelo' : 'Adicionar à tela inicial'; container.hidden = button.hidden && status.hidden && help.hidden; }
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installation = event; sync(); });
window.addEventListener('appinstalled', () => { appInstalled = true; installation = undefined; help.hidden = true; sync(); });
standalone.addEventListener('change', sync);
button.onclick = async () => {
  if (!installation) { help.textContent = 'No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.'; help.hidden = !help.hidden; button.setAttribute('aria-expanded', String(!help.hidden)); button.setAttribute('aria-controls', help.id); return; }
  button.disabled = true;
  try { await installation.prompt(); await installation.userChoice; installation = undefined; sync(); }
  catch { help.textContent = 'Use a opção de instalar no menu do navegador.'; help.hidden = false; }
  finally { button.disabled = false; }
};
window.addEventListener('online', () => { status.hidden = true; sync(); });
window.addEventListener('offline', () => { status.hidden = false; sync(); });
sync();
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
  // Installation is progressive enhancement; a failed registration never blocks login.
});
