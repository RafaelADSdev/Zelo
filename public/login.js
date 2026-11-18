const destination = new URLSearchParams(location.search).get('next') === '/admin/access' ? '/admin/access' : '/';
const $ = selector => document.querySelector(selector);
const invitationToken = new URLSearchParams(location.hash.slice(1)).get("invite") || "";
const submitLabel = invitationToken ? "Ativar meu ambiente" : "Entrar no Zelo";
function error(message, invalidFields = []) {
  $("#login-error").textContent = message;
  $("#login-error").hidden = !message;
  for (const selector of ["#username", "#password", "#confirm-password"]) {
    const field = $(selector);
    if (invalidFields.includes(selector)) {
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", "login-error");
    } else {
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
    }
  }
}
try {
  const response = await fetch("/api/auth/status", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Não foi possível verificar o acesso. Atualize a página.");
  const status = await response.json();
  if (status.authenticated) location.replace(destination);
  if (status.provider === "supabase") {
    document.querySelector('label[for="username"]').textContent = "E-mail";
    $("#username").type = "email"; $("#username").placeholder = "seu@email.com";
  }
  if (status.inviteOnly) $("#login-description").textContent = "Use o e-mail do seu convite. Para pedir acesso, fale com o administrador.";
  if (invitationToken) {
    const response = await fetch('/api/auth/invitation', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:invitationToken}),signal:AbortSignal.timeout(10000)});
    const invitation = await response.json(); if (!response.ok) throw new Error(invitation.error || 'Não foi possível validar o convite. Abra novamente o link que você recebeu.');
    $('#username').value = invitation.email; $('#username').readOnly = true;
    $('#confirm-field').hidden = false; $('#confirm-password').required = true;
    $('#password').minLength = 12; $('#password').autocomplete = 'new-password';
    $('#login-title').textContent = 'Aceitar convite';
    $('#login-description').textContent = 'Defina sua senha para aceitar o convite. Se já tem uma conta com este e-mail, use sua senha atual.';
  }
  if (location.hash) history.replaceState(null, "", "/login");
  $("#login-submit").textContent = submitLabel;
  $("#login-submit").disabled = false;
} catch (failure) {
  error(failure instanceof TypeError || failure instanceof SyntaxError || failure.name === 'TimeoutError'
    ? 'Não foi possível verificar o acesso. Confira sua conexão e atualize a página.' : failure.message);
  $("#login-submit").textContent = submitLabel;
}
$("#show-password").onclick = () => { const show = $("#password").type === "password"; $("#password").type = show ? "text" : "password"; $("#show-password").textContent = show ? "Ocultar" : "Mostrar"; $("#show-password").setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha"); $("#show-password").setAttribute("aria-pressed", String(show)); };
$("#login-form").addEventListener("input", event => {
  if (event.target.getAttribute("aria-invalid") === "true") error("");
});
$("#login-form").onsubmit = async event => {
  event.preventDefault();
  if ($("#login-submit").disabled) return;
  error("");
  if (invitationToken && $("#password").value !== $("#confirm-password").value) {
    error("As senhas não coincidem. Repita a senha no campo de confirmação.", ["#confirm-password"]);
    $("#confirm-password").focus();
    return;
  }
  $("#login-submit").disabled = true; $("#login-submit").textContent = invitationToken ? "Ativando acesso…" : "Entrando…";
  try {
    const response = await fetch(invitationToken ? "/api/auth/accept" : "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("#username").value, password: $("#password").value, ...(invitationToken ? { token: invitationToken } : {}) }), signal: AbortSignal.timeout(55000) });
    const result = await response.json();
    if (!response.ok) {
      const invalidLogin = response.status === 401 && !invitationToken;
      if (invalidLogin) {
        error(`${result.error || "Não foi possível entrar."} Confira os dados da sua conta.`, ["#username", "#password"]);
      } else {
        error(result.error || "Não foi possível concluir o acesso. Tente novamente.");
      }
      return;
    }
    $("#password").value = $("#confirm-password").value = "";
    location.replace(destination);
  } catch {
    error("Não foi possível concluir o acesso. Confira sua conexão e tente novamente.");
  } finally {
    $("#login-submit").disabled = false; $("#login-submit").textContent = submitLabel;
  }
};
