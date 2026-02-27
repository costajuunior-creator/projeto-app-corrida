function $(id){ return document.getElementById(id); }
function setText(id, txt){ $(id).innerText = txt; }
function show(id, yes=true){ $(id).style.display = yes ? "" : "none"; }

let token = localStorage.getItem("token") || null;

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
    if(typeof data.error === "string" || typeof data.message === "string") return JSON.stringify(data);
    return JSON.stringify(data);
  }
  return `HTTP ${status}\n` + (parsed.data || "(sem resposta)");
}

async function api(url, options = {}){
  options.headers = options.headers || {};
  if(token) options.headers["Authorization"] = "Bearer " + token;
  return fetch(url, options);
}

async function health(){
  $("authMsg").innerText = "Testando servidor...";
  const res = await fetch("/api/health");
  const parsed = await readJsonOrText(res);
  $("authMsg").innerText = res.ok ? ("OK: " + JSON.stringify(parsed.data)) : parseError(parsed, res.status);
}

async function boot(){
  token = localStorage.getItem("token");
  if(!token) return;
  show("auth", false);
  show("app", true);
  const res = await api("/api/me");
  const parsed = await readJsonOrText(res);
  if(!res.ok){
    // token expirado ou inválido
    localStorage.removeItem("token");
    token = null;
    show("auth", true);
    show("app", false);
    $("authMsg").innerText = "Sessão expirou. Faça login novamente.";
    return;
  }
  setText("who", parsed.data.name || "usuário");
}
boot();

function logout(){
  localStorage.removeItem("token");
  location.reload();
}

async function doRegister(){
  const email = $("email").value.trim();
  const password = $("password").value;
  const name = $("name").value.trim();
  $("authMsg").innerText = "Cadastrando...";

  const res = await fetch("/api/register",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email,password,name})
  });

  const parsed = await readJsonOrText(res);
  if(!res.ok){
    $("authMsg").innerText = parseError(parsed, res.status);
    return;
  }
  $("authMsg").innerText = parsed.data.message || "Cadastro OK. Agora faça login.";
}

async function doLogin(){
  const email = $("email").value.trim();
  const password = $("password").value;
  $("authMsg").innerText = "Entrando...";

  const res = await fetch("/api/login",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email,password})
  });

  const parsed = await readJsonOrText(res);
  if(!res.ok){
    $("authMsg").innerText = parseError(parsed, res.status);
    return;
  }
  localStorage.setItem("token", parsed.data.token);
  location.reload();
}

// ======= MAPA + GPS =======
let map = L.map('map').setView([-15.78, -47.93], 4); // Brasil
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
let poly = L.polyline([], {color:'lime'}).addTo(map);

let points = [];
let startTime = null;
let watchId = null;
let timer = null;

function havKm(a,b){
  const R=6371;
  const dLat=(b.lat-a.lat)*Math.PI/180;
  const dLon=(b.lng-a.lng)*Math.PI/180;
  const lat1=a.lat*Math.PI/180;
  const lat2=b.lat*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function fmt(ms){
  let s=Math.floor(ms/1000);
  let m=Math.floor(s/60);
  return m+":"+String(s%60).padStart(2,"0");
}
function updateUI(){
  if(!startTime) return;
  let distKm = 0;
  for(let i=1;i<points.length;i++) distKm += havKm(points[i-1], points[i]);
  let ms = Date.now() - startTime;
  setText("time", fmt(ms));
  setText("km", distKm.toFixed(2));

  if(distKm >= 0.05){
    let pace = (ms/60000)/distKm;
    let pm = Math.floor(pace);
    let ps = Math.round((pace-pm)*60);
    if(ps === 60){ ps=0; pm+=1; }
    setText("pace", pm + ":" + String(ps).padStart(2,"0"));
  } else {
    setText("pace", "--");
  }
}

function startRun(){
  token = localStorage.getItem("token");
  if(!token) return alert("Faça login primeiro.");
  if(!navigator.geolocation) return alert("Geolocalização não suportada");

  $("runMsg").innerText = "";
  points = [];
  poly.setLatLngs([]);
  startTime = Date.now();
  setText("time","0:00"); setText("km","0.00"); setText("pace","--");

  if(timer) clearInterval(timer);
  timer = setInterval(updateUI, 500);

  watchId = navigator.geolocation.watchPosition(
    (pos)=>{
      const p = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy,
        t: Date.now()
      };
      if(p.acc && p.acc > 60) return;
      points.push(p);
      poly.addLatLng([p.lat, p.lng]);
      map.setView([p.lat, p.lng], 16);
      updateUI();
    },
    (err)=>{
      $("runMsg").innerText = "Erro GPS: " + err.message;
      console.log(err);
    },
    {enableHighAccuracy:true, maximumAge: 1000, timeout: 15000}
  );

  $("runMsg").innerText = "Iniciou! (se pedir permissão, aceite)";
}

async function finishRun(){
  if(watchId){ navigator.geolocation.clearWatch(watchId); watchId=null; }
  if(timer){ clearInterval(timer); timer=null; }

  if(!startTime) return alert("Nenhuma corrida em andamento");
  if(points.length < 2) return alert("Poucos pontos de GPS. Ande alguns metros e tente novamente.");

  const payload = { start_time: startTime, end_time: Date.now(), points };

  $("runMsg").innerText = "Salvando corrida...";

  const res = await api("/api/runs", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });

  const parsed = await readJsonOrText(res);
  if(!res.ok){
    $("runMsg").innerText = parseError(parsed, res.status);
    return;
  }

  startTime = null;
  const km = (parsed.data.distance_m/1000).toFixed(2);
  $("runMsg").innerText = "Corrida salva! " + km + " km";
  await loadRuns();
}

async function loadRuns(){
  const out = $("output");
  out.style.display = "";
  out.innerHTML = "<b>Histórico</b><br><span style='opacity:.8'>Carregando...</span>";

  const res = await api("/api/runs");
  const parsed = await readJsonOrText(res);

  if(!res.ok){
    out.innerHTML = "<b>Histórico</b><br><span style='opacity:.8'>" + parseError(parsed, res.status) + "</span>";
    return;
  }

  const runs = parsed.data || [];
  if(!runs.length){
    out.innerHTML = "<b>Histórico</b><br><span style='opacity:.8'>Ainda não tem corridas salvas.</span>";
    return;
  }

  let html = "<b>Histórico</b><br>";
  for(const r of runs){
    const km = (r.distance_m/1000).toFixed(2);
    const min = Math.round(r.duration_ms/60000);
    html += `${new Date(r.start_time).toLocaleString()} — ${km} km — ${min} min<br>`;
  }
  out.innerHTML = html;
}

async function loadRanking(){
  const out = $("output");
  out.style.display = "";
  out.innerHTML = "<b>Ranking</b><br><span style='opacity:.8'>Carregando...</span>";

  const res = await fetch("/api/ranking");
  const parsed = await readJsonOrText(res);

  if(!res.ok){
    out.innerHTML = "<b>Ranking</b><br><span style='opacity:.8'>" + parseError(parsed, res.status) + "</span>";
    return;
  }

  const data = parsed.data || [];
  if(!data.length){
    out.innerHTML = "<b>Ranking</b><br><span style='opacity:.8'>Sem dados ainda.</span>";
    return;
  }

  let html = "<b>Ranking</b><br>";
  data.forEach((r,i)=>{
    const nome = r.name || "Sem nome";
    const km = (r.total_m/1000).toFixed(2);
    html += `#${i+1} — ${nome} — ${km} km<br>`;
  });
  out.innerHTML = html;
}
