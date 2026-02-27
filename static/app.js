function setText(id, txt){ document.getElementById(id).innerText = txt; }
function show(id, yes=true){ document.getElementById(id).style.display = yes ? "" : "none"; }

let token = localStorage.getItem("token");

async function api(url, options = {}){
  options.headers = options.headers || {};
  if(token) options.headers["Authorization"] = "Bearer " + token;
  return fetch(url, options);
}

async function boot(){
  token = localStorage.getItem("token");
  if(!token) return;
  show("auth", false);
  show("app", true);
  const res = await api("/api/me");
  const me = await res.json();
  setText("who", me.name || "usuário");
}
boot();

function logout(){
  localStorage.removeItem("token");
  location.reload();
}

async function doRegister(){
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const name = document.getElementById("name").value.trim();
  const msg = document.getElementById("authMsg");
  msg.innerText = "";

  const res = await fetch("/api/register", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email, password, name})
  });

  const data = await res.json();
  if(!res.ok){
    msg.innerText = data.detail || "Erro no cadastro";
    return;
  }
  localStorage.setItem("token", data.token);
  location.reload();
}

async function doLogin(){
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const msg = document.getElementById("authMsg");
  msg.innerText = "";

  const res = await fetch("/api/login", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email, password})
  });

  const data = await res.json();
  if(!res.ok){
    msg.innerText = data.detail || "Erro no login";
    return;
  }
  localStorage.setItem("token", data.token);
  location.reload();
}

// MAPA + GPS
let map = L.map('map').setView([0,0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
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

function start(){
  token = localStorage.getItem("token");
  if(!token) return alert("Faça login primeiro.");
  if(!navigator.geolocation) return alert("Geolocalização não suportada");

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
      alert("Erro GPS: " + err.message);
      console.log(err);
    },
    {enableHighAccuracy:true, maximumAge: 1000, timeout: 15000}
  );

  alert("Iniciou! (se pedir permissão, aceite)");
}

async function finish(){
  if(watchId){ navigator.geolocation.clearWatch(watchId); watchId=null; }
  if(timer){ clearInterval(timer); timer=null; }
  if(!startTime) return alert("Nenhuma corrida em andamento");
  if(points.length < 2) return alert("Poucos pontos de GPS. Ande alguns metros e tente novamente.");

  token = localStorage.getItem("token");
  const payload = { start_time: startTime, end_time: Date.now(), points };

  const res = await api("/api/runs", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if(!res.ok){
    alert(data.detail || "Erro ao salvar corrida");
    return;
  }

  startTime = null;
  alert("Corrida salva! " + (data.distance_m/1000).toFixed(2) + " km");
  await loadRuns();
}

async function loadRuns(){
  const out = document.getElementById("output");
  out.style.display = "";
  out.innerHTML = "<b>Histórico</b><br>Carregando...";

  const res = await api("/api/runs");
  const runs = await res.json();

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
  const out = document.getElementById("output");
  out.style.display = "";
  out.innerHTML = "<b>Ranking</b><br>Carregando...";

  const res = await fetch("/api/ranking");
  const data = await res.json();

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
