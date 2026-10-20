const $ = selector => document.querySelector(selector);
document.querySelector('footer').textContent = 'Acesso protegido · A sessão expira após 12 horas.';
if (location.protocol === 'https:') document.querySelector('#setup-fields .field-help').textContent = 'Use o código de primeiro acesso fornecido na configuração do Zelo.';
let setup = false;
const error = message => { $("#login-error").textContent = message; $("#login-error").hidden = !message; };
try {
  const response = await fetch("/api/auth/status", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Não foi possível verificar o acesso. Atualize a página.");
  const status = await response.json();
  if (status.authenticated) location.replace("/");
  setup = !status.configured;
  if (status.provider === "supabase") {
    document.querySelector('label[for="username"]').textContent = "E-mail";
    $("#username").type = "email"; $("#username").placeholder = "seu@email.com";
    $("#login-description").textContent = setup ? "Crie sua conta de administrador no Supabase para proteger o Zelo." : "Entre com sua conta do Supabase para gerenciar o atendimento.";
  }
  for (const id of ["setup-fields", "confirm-field", "setup-help"]) $("#" + id).hidden = !setup;
  $("#setup-token").required = $("#confirm-password").required = setup;
  if (setup) {
    $("#login-title").textContent = "Seu espaço começa aqui.";
    if (status.provider !== "supabase") $("#login-description").textContent = "Crie sua conta de administrador para proteger o Zelo.";
    $("#password").minLength = 12; $("#password").autocomplete = "new-password";
    const token = new URLSearchParams(location.hash.slice(1)).get("setup");
    if (token && /^[a-f0-9]{64}$/.test(token)) $("#setup-token").value = token;
  }
  if (location.hash) history.replaceState(null, "", "/login");
  $("#login-submit").textContent = setup ? "Criar conta e entrar" : "Entrar no Zelo";
  $("#login-submit").disabled = false;
} catch (failure) { error(failure.message); }
$("#show-password").onclick = () => { const show = $("#password").type === "password"; $("#password").type = show ? "text" : "password"; $("#show-password").textContent = show ? "Ocultar" : "Mostrar"; $("#show-password").setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha"); $("#show-password").setAttribute("aria-pressed", String(show)); };
$("#login-form").onsubmit = async event => {
  event.preventDefault(); error("");
  if (setup && $("#password").value !== $("#confirm-password").value) return error("As senhas não coincidem.");
  $("#login-submit").disabled = true; $("#login-submit").textContent = "Aguarde…";
  try {
    const response = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("#username").value, password: $("#password").value, ...(setup ? { setupToken: $("#setup-token").value } : {}) }), signal: AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível entrar.");
    $("#password").value = $("#confirm-password").value = $("#setup-token").value = "";
    location.replace("/");
  } catch (failure) { error(failure.message); $("#login-submit").disabled = false; $("#login-submit").textContent = setup ? "Criar conta e entrar" : "Entrar no Zelo"; }
};
