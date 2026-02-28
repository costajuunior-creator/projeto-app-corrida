import os, sqlite3, math
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List

DB = os.getenv("DB_PATH", "/tmp/corrida.db")

def db():
    conn = sqlite3.connect(DB, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB) or ".", exist_ok=True)
    conn = db()
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS runs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER,
        duration_ms INTEGER,
        distance_m REAL,
        pace_sec_per_km REAL
    )""")
    conn.commit()
    conn.close()

def haversine_m(a, b):
    R = 6371000.0
    dlat = math.radians(b["lat"] - a["lat"])
    dlon = math.radians(b["lng"] - a["lng"])
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])
    x = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(x))

class Point(BaseModel):
    lat: float
    lng: float

class RunIn(BaseModel):
    start_time: int
    end_time: int
    points: List[Point]

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.on_event("startup")
def startup():
    init_db()

@app.get("/")
def home():
    return FileResponse("static/index.html")

@app.post("/api/runs")
def save_run(body: RunIn):
    pts = [{"lat": p.lat, "lng": p.lng} for p in body.points]
    if len(pts) < 2:
        raise HTTPException(status_code=400, detail="Poucos pontos de GPS")
    dist = 0.0
    for i in range(1, len(pts)):
        dist += haversine_m(pts[i-1], pts[i])

    duration = max(0, body.end_time - body.start_time)
    pace = None
    if dist >= 50:  # só calcula ritmo se tem pelo menos 50m
        pace = (duration/1000.0) / (dist/1000.0)  # segundos por km

    conn = db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO runs(created_at, duration_ms, distance_m, pace_sec_per_km) VALUES(?,?,?,?)",
        (body.end_time//1000, duration, dist, pace),
    )
    conn.commit()
    run_id = c.lastrowid
    conn.close()

    return {"ok": True, "id": run_id, "duration_ms": duration, "distance_m": dist, "pace_sec_per_km": pace}

@app.get("/api/runs")
def list_runs():
    conn = db()
    rows = conn.execute(
        "SELECT id, created_at, duration_ms, distance_m, pace_sec_per_km FROM runs ORDER BY created_at DESC LIMIT 200"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
