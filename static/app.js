function showMsg(text){
  document.getElementById("msg").innerText = text;
}

function parseError(data){
  if(!data) return "Erro";
  if(typeof data === "string") return data;
  if(typeof data.detail === "string") return data.detail;
  if(Array.isArray(data.detail)){
    return data.detail.map(d => d.msg || JSON.stringify(d)).join(" | ");
  }
  try { return JSON.stringify(data); } catch(e){ return "Erro"; }
}

async function register(){
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const name = document.getElementById("name").value;

  const res = await fetch("/api/register",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email,password,name})
  });

  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    showMsg(parseError(data));
    return;
  }

  showMsg("Cadastro realizado! Agora faça login.");
}

async function login(){
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const res = await fetch("/api/login",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email,password})
  });

  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    showMsg(parseError(data));
    return;
  }

  showMsg("Login realizado com sucesso!");
}
