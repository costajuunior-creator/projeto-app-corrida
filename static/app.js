
let map, poly, running=false, watchId=null, points=[], startTime=null, timer=null;

function initMap(){
  map=L.map('map').setView([-15.78,-47.93],4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  poly=L.polyline([], {color:'lime'}).addTo(map);
  setTimeout(()=>map.invalidateSize(),300);
}
initMap();

function toggleRun(){
  if(!running){ startRun(); }
  else{ stopRun(); }
}

function startRun(){
  running=true;
  mainBtn.className="stop";
  mainBtn.innerText="STOP";
  points=[]; poly.setLatLngs([]);
  startTime=Date.now();
  timer=setInterval(updateStats,500);

  watchId=navigator.geolocation.watchPosition(pos=>{
    const p={lat:pos.coords.latitude,lng:pos.coords.longitude};
    if(points.length>0){
      let jump=haversine(points[points.length-1],p);
      if(jump>50) return;
    }
    points.push(p);
    poly.addLatLng([p.lat,p.lng]);
    if(points.length===1) map.setView([p.lat,p.lng],16);
  },null,{enableHighAccuracy:true});
}

function stopRun(){
  running=false;
  mainBtn.className="start";
  mainBtn.innerText="START";
  navigator.geolocation.clearWatch(watchId);
  clearInterval(timer);
}

function updateStats(){
  let elapsed=Date.now()-startTime;
  let sec=Math.floor(elapsed/1000);
  time.innerText=Math.floor(sec/60)+":"+String(sec%60).padStart(2,"0");

  let dist=0;
  for(let i=1;i<points.length;i++) dist+=haversine(points[i-1],points[i]);

  if(dist<1000) distSpan=dist.toFixed(0)+" m";
  else distSpan=(dist/1000).toFixed(2)+" km";

  document.getElementById("dist").innerText=distSpan;

  if(dist>0){
    let pace=(elapsed/60000)/(dist/1000);
    document.getElementById("pace").innerText=Math.floor(pace)+":"+String(Math.round((pace%1)*60)).padStart(2,"0");
  }
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
