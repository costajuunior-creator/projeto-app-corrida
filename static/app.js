
let map, poly, points=[], watchId=null, startTime=null;

function initMap(){
  map=L.map('map').setView([-15.78,-47.93],4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  poly=L.polyline([], {color:'lime'}).addTo(map);
  setTimeout(()=>map.invalidateSize(),400);
}
initMap();

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
  alert("Login OK");
}

function startRun(){
  points=[]; poly.setLatLngs([]);
  startTime=Date.now();
  watchId=navigator.geolocation.watchPosition(pos=>{
    const p={lat:pos.coords.latitude,lng:pos.coords.longitude};
    console.log("GPS:",p.lat,p.lng);
    points.push(p);
    poly.addLatLng([p.lat,p.lng]);
    if(points.length===1) map.setView([p.lat,p.lng],16);
  });
}

async function finishRun(){
  navigator.geolocation.clearWatch(watchId);
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
  alert("Salvo");
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
