let map = L.map('map').setView([-15.78,-47.93],4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let poly = L.polyline([], {color:'lime'}).addTo(map);

setTimeout(()=>{map.invalidateSize();},400);

let points=[];
let startTime=null;
let watchId=null;

function start(){
  watchId=navigator.geolocation.watchPosition((pos)=>{
    console.log("GPS:",pos.coords.latitude,pos.coords.longitude,pos.coords.accuracy);
    const p={lat:pos.coords.latitude,lng:pos.coords.longitude};
    points.push(p);
    poly.addLatLng([p.lat,p.lng]);
    if(points.length===1) map.setView([p.lat,p.lng],16);
  });
}
start();