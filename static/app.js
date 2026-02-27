function showMsg(text){
  document.getElementById("msg").innerText = text;
}

async function readJsonOrText(res){
  const txt = await res.text();
  try { return {kind:"json", data: JSON.parse(txt), raw: txt}; }
  catch(e){ return {kind:"text", data: txt, raw: txt}; }
}

function parseError(parsed, status){
  if(parsed.kind === "json"){
    const data = parsed.data || {};
    if(typeof data.detail === "string") return data.detail;
    if(Array.isArray(data.detail)) return data.detail.map(d => d.msg || JSON.stringify(d)).join(" | ");
    if(typeof data.message === "string") return data.message;
    return JSON.stringify(data);
  }
  return `HTTP ${status}\n` + (parsed.data || "(sem resposta)");
}

async function health(){
  showMsg("Testando servidor...");
  const res = await fetch("/api/health");
  const parsed = await readJsonOrText(res);
  if(res.ok){
    showMsg("OK: " + (parsed.kind==="json" ? JSON.stringify(parsed.data) : parsed.data));
  } else {
    showMsg(parseError(parsed, res.status));
  }
}

async function registerUser(){
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const name = document.getElementById("name").value.trim();

  showMsg("Cadastrando...");

  const res = await fetch("/api/register",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email,password,name})
  });

  const parsed = await readJsonOrText(res);

  if(!res.ok){
    showMsg(parseError(parsed, res.status));
    return;
  }

  if(parsed.kind === "json"){
    showMsg(parsed.data.message || "Cadastro realizado! Agora faça login.");
  } else {
    showMsg("Cadastro OK, mas resposta não-JSON:\n" + parsed.data);
  }
}

async function login(){
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  showMsg("Entrando...");

  const res = await fetch("/api/login",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email,password})
  });

  const parsed = await readJsonOrText(res);

  if(!res.ok){
    showMsg(parseError(parsed, res.status));
    return;
  }

  if(parsed.kind === "json"){
    showMsg("Login OK! Token recebido.\nBem-vindo, " + (parsed.data.name || ""));
  } else {
    showMsg("Login OK, mas resposta não-JSON:\n" + parsed.data);
  }
}
