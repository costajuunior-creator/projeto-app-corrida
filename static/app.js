
let map, poly, points=[], watchId=null, startTime=null, timer=null;

function initMap(){
  map=L.map('map').setView([-15.78,-47.93],4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  poly=L.polyline([], {color:'lime'}).addTo(map);
  setTimeout(()=>map.invalidateSize(),400);
}

async function register(){
  await fetch("/api/register",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      email:email.value,
      password:password.value,
      name:name.value})});
  alert("Cadastrado");
}

async function login(){
  let res=await fetch("/api/login",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      email:email.value,
      password:password.value})});
  let data=await res.json();
  localStorage.setItem("token",data.token);
  loginCard.style.display="none";
  app.style.display="";
  initMap();
}

function format(ms){
  let s=Math.floor(ms/1000);
  let m=Math.floor(s/60);
  return m+":"+String(s%60).padStart(2,"0");
}

function startRun(){
  points=[]; poly.setLatLngs([]);
  startTime=Date.now();
  timer=setInterval(()=>{
    let elapsed=Date.now()-startTime;
    time.innerText=format(elapsed);
  },500);

  watchId=navigator.geolocation.watchPosition(pos=>{
    const p={lat:pos.coords.latitude,lng:pos.coords.longitude};
    points.push(p);
    poly.addLatLng([p.lat,p.lng]);
    if(points.length===1) map.setView([p.lat,p.lng],16);

    let dist=0;
    for(let i=1;i<points.length;i++){
      dist+=haversine(points[i-1],points[i]);
    }
    km.innerText=(dist/1000).toFixed(2);
  });
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

async function finishRun(){
  navigator.geolocation.clearWatch(watchId);
  clearInterval(timer);
  await fetch("/api/runs",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer "+localStorage.getItem("token")
    },
    body:JSON.stringify({
      start_time:startTime,
      end_time:Date.now(),
      points
    })
  });
  alert("Corrida salva");
}

async function loadRuns(){
  let res=await fetch("/api/runs",{
    headers:{Authorization:"Bearer "+localStorage.getItem("token")}});
  let data=await res.json();
  output.innerText=JSON.stringify(data,null,2);
}

async function loadRanking(){
  let res=await fetch("/api/ranking");
  let data=await res.json();
  output.innerText=JSON.stringify(data,null,2);
}
