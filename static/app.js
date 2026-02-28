let map, poly, running=false, watchId=null, points=[], startTime=null, timer=null;
let lastAccepted = null;

function initMap(){
  map = L.map('map').setView([-15.78,-47.93],4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19}).addTo(map);
  poly = L.polyline([], {color:'lime'}).addTo(map);
  setTimeout(()=>map.invalidateSize(), 350);
}
initMap();

function fmtTime(ms){
  let s=Math.floor(ms/1000);
  let m=Math.floor(s/60);
  return m+":"+String(s%60).padStart(2,"0");
}
function haversine(a,b){
  const R=6371000;
  const dLat=(b.lat-a.lat)*Math.PI/180;
  const dLon=(b.lng-a.lng)*Math.PI/180;
  const lat1=a.lat*Math.PI/180;
  const lat2=b.lat*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function updateStats(){
  if(!startTime) return;
  const elapsed = Date.now()-startTime;
  document.getElementById("time").innerText = fmtTime(elapsed);

  let dist=0;
  for(let i=1;i<points.length;i++) dist+=haversine(points[i-1], points[i]);

  document.getElementById("dist").innerText = dist < 1000 ? `${dist.toFixed(0)} m` : `${(dist/1000).toFixed(2)} km`;

  if(dist >= 50){
    const pace = (elapsed/1000) / (dist/1000); // sec/km
    const pm = Math.floor(pace/60);
    const ps = Math.round(pace%60);
    document.getElementById("pace").innerText = `${pm}:${String(ps).padStart(2,"0")}`;
  } else {
    document.getElementById("pace").innerText = "--";
  }
}

function toggleRun(){
  if(!running) startRun();
  else stopRun();
}

function startRun(){
  if(!navigator.geolocation) return alert("Seu celular não suporta GPS.");
  running=true;
  document.getElementById("mainBtn").classList.remove("start");
  document.getElementById("mainBtn").classList.add("stop");
  document.getElementById("mainBtn").innerText="STOP";

  points=[];
  lastAccepted = null;
  poly.setLatLngs([]);
  startTime = Date.now();
  if(timer) clearInterval(timer);
  timer = setInterval(updateStats, 500);

  watchId = navigator.geolocation.watchPosition((pos)=>{
    const p = {lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || null, t: Date.now()};

    // filtro anti-salto: ignora saltos > 50m entre pontos
    if(lastAccepted){
      const jump = haversine(lastAccepted, p);
      if(jump > 50) return;
    }
    lastAccepted = {lat:p.lat, lng:p.lng};

    points.push({lat:p.lat, lng:p.lng});
    poly.addLatLng([p.lat, p.lng]);
    if(points.length===1) map.setView([p.lat,p.lng], 16);
  }, (err)=>{
    console.log(err);
    alert("Erro GPS: " + err.message);
  }, {enableHighAccuracy:true, maximumAge:1000, timeout:15000});
}

async function stopRun(){
  running=false;
  document.getElementById("mainBtn").classList.remove("stop");
  document.getElementById("mainBtn").classList.add("start");
  document.getElementById("mainBtn").innerText="START";

  if(watchId) navigator.geolocation.clearWatch(watchId);
  if(timer) clearInterval(timer);

  if(!startTime) return;
  if(points.length < 2){
    alert("Poucos pontos de GPS. Ande alguns metros e tente de novo.");
    startTime=null;
    return;
  }

  const payload = {start_time: startTime, end_time: Date.now(), points};
  startTime=null;

  const res = await fetch("/api/runs", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(()=>null);
  if(!res.ok){
    alert((data && (data.detail||data.message)) || "Erro ao salvar");
    return;
  }
  alert("Corrida salva!");
  loadHistory();
}

function clearUI(){
  document.getElementById("historyCard").style.display="none";
}

async function loadHistory(){
  const card = document.getElementById("historyCard");
  const list = document.getElementById("list");
  card.style.display="";
  list.innerText = "Carregando...";

  const res = await fetch("/api/runs");
  const data = await res.json().catch(()=>[]);

  if(!res.ok){
    list.innerText = "Erro ao carregar histórico.";
    return;
  }

  if(!data.length){
    list.innerText = "Ainda não tem corridas salvas.";
    return;
  }

  const lines = data.map(r=>{
    const dt = new Date(r.created_at*1000).toLocaleString();
    const km = (r.distance_m/1000).toFixed(2);
    const t = fmtTime(r.duration_ms);
    let pace = "--";
    if(r.pace_sec_per_km){
      const pm = Math.floor(r.pace_sec_per_km/60);
      const ps = Math.round(r.pace_sec_per_km%60);
      pace = `${pm}:${String(ps).padStart(2,"0")}`;
    }
    return `${dt} — ${km} km — ${t} — ritmo ${pace}/km`;
  });

  list.innerText = lines.join("\n");
}
