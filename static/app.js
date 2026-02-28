
let map, poly, points=[], watchId=null, startTime=null;

function initMap(){
  map = L.map('map').setView([-15.78,-47.93],4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  poly = L.polyline([], {color:'lime'}).addTo(map);
  setTimeout(()=>{ map.invalidateSize(); },400);
}
initMap();

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
  if(watchId) navigator.geolocation.clearWatch(watchId);
  if(points.length<2) return alert("Poucos pontos");
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
