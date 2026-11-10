const destination = new URLSearchParams(location.search).get('next') === '/admin/access' ? '/admin/access' : '/';
const $ = selector => document.querySelector(selector);
const invitationToken = new URLSearchParams(location.hash.slice(1)).get("invite") || "";
const submitLabel = invitationToken ? "Ativar meu ambiente" : "Entrar no Zelo";
const error = message => { $("#login-error").textContent = message; $("#login-error").hidden = !message; };
try {
  const response = await fetch("/api/auth/status", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Não foi possível verificar o acesso. Atualize a página.");
  const status = await response.json();
  if (status.authenticated) location.replace(destination);
  if (status.provider === "supabase") {
    document.querySelector('label[for="username"]').textContent = "E-mail";
    $("#username").type = "email"; $("#username").placeholder = "seu@email.com";
  }
  if (status.inviteOnly) $("#login-description").textContent = "Acesse sua conta com o e-mail do convite. Para um novo acesso, fale com o administrador.";
  if (invitationToken) {
    const response = await fetch('/api/auth/invitation', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:invitationToken})});
    const invitation = await response.json(); if (!response.ok) throw new Error(invitation.error);
    $('#username').value = invitation.email; $('#username').readOnly = true;
    $('#confirm-field').hidden = false; $('#confirm-password').required = true;
    $('#password').minLength = 12; $('#password').autocomplete = 'new-password';
    $('#login-title').textContent = 'Seu Zelo está quase pronto.';
    $('#login-description').textContent = 'Defina sua senha para aceitar o convite. Se já tem uma conta com este e-mail, use sua senha atual.';
  }
  if (location.hash) history.replaceState(null, "", "/login");
  $("#login-submit").textContent = submitLabel;
  $("#login-submit").disabled = false;
} catch (failure) { error(failure.message); }
$("#show-password").onclick = () => { const show = $("#password").type === "password"; $("#password").type = show ? "text" : "password"; $("#show-password").textContent = show ? "Ocultar" : "Mostrar"; $("#show-password").setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha"); $("#show-password").setAttribute("aria-pressed", String(show)); };
$("#login-form").onsubmit = async event => {
  event.preventDefault(); error("");
  if (invitationToken && $("#password").value !== $("#confirm-password").value) return error("As senhas não coincidem.");
  $("#login-submit").disabled = true; $("#login-submit").textContent = "Aguarde…";
  try {
    const response = await fetch(invitationToken ? "/api/auth/accept" : "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("#username").value, password: $("#password").value, ...(invitationToken ? { token: invitationToken } : {}) }), signal: AbortSignal.timeout(55000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível entrar.");
    $("#password").value = $("#confirm-password").value = "";
    location.replace(destination);
  } catch (failure) { error(failure.message); $("#login-submit").disabled = false; $("#login-submit").textContent = submitLabel; }
};
