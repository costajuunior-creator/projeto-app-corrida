
import os, sqlite3, math, hashlib, hmac, secrets
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from uuid import uuid4
from jose import jwt, JWTError
from datetime import datetime, timedelta

DB = "/tmp/corrida.db"
JWT_SECRET = os.getenv("JWT_SECRET", "TROQUE_NO_RENDER")
JWT_ALG = "HS256"

def db():
    conn = sqlite3.connect(DB, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = db(); c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        pw_salt TEXT,
        pw_hash TEXT,
        name TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS runs(
        id TEXT PRIMARY KEY,
        user_id TEXT,
        start_time INTEGER,
        duration_ms INTEGER,
        distance_m REAL)""")
    conn.commit(); conn.close()

def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 210000)

def make_pw(pw):
    salt = secrets.token_bytes(16)
    return salt.hex(), hash_pw(pw, salt).hex()

def verify_pw(pw, salt_hex, hash_hex):
    return hmac.compare_digest(
        hash_pw(pw, bytes.fromhex(salt_hex)).hex(),
        hash_hex
    )

def token(uid):
    exp = datetime.utcnow() + timedelta(days=30)
    return jwt.encode({"sub": uid, "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)

def get_uid(auth):
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token inválido")
    try:
        return jwt.decode(auth.split()[1], JWT_SECRET, algorithms=[JWT_ALG])["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido")

def hav(a,b):
    R=6371000
    dlat=math.radians(b["lat"]-a["lat"])
    dlon=math.radians(b["lng"]-a["lng"])
    lat1,lat2=math.radians(a["lat"]),math.radians(b["lat"])
    x=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(x))

class Register(BaseModel):
    email: EmailStr; password: str; name: str

class Login(BaseModel):
    email: EmailStr; password: str

class Point(BaseModel):
    lat: float; lng: float

class Run(BaseModel):
    start_time: int; end_time: int; points: List[Point]

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.on_event("startup")
def start(): init_db()

@app.get("/")
def home(): return FileResponse("static/index.html")

@app.post("/api/register")
def register(body: Register):
    salt, h = make_pw(body.password)
    conn=db(); c=conn.cursor()
    try:
        c.execute("INSERT INTO users VALUES(?,?,?,?,?)",
            (str(uuid4()), body.email.lower(), salt, h, body.name))
        conn.commit()
    except:
        raise HTTPException(400,"Email já cadastrado")
    finally: conn.close()
    return {"ok":True}

@app.post("/api/login")
def login(body: Login):
    conn=db(); c=conn.cursor()
    row=c.execute("SELECT * FROM users WHERE email=?",
        (body.email.lower(),)).fetchone()
    conn.close()
    if not row or not verify_pw(body.password,row["pw_salt"],row["pw_hash"]):
        raise HTTPException(401,"Login inválido")
    return {"token":token(row["id"]), "name":row["name"]}

@app.post("/api/runs")
def save_run(body: Run, authorization: Optional[str]=Header(None)):
    uid=get_uid(authorization)
    pts=[{"lat":p.lat,"lng":p.lng} for p in body.points]
    if len(pts)<2: raise HTTPException(400,"Poucos pontos")
    dist=sum(hav(pts[i-1],pts[i]) for i in range(1,len(pts)))
    duration=body.end_time-body.start_time
    conn=db(); c=conn.cursor()
    c.execute("INSERT INTO runs VALUES(?,?,?,?,?)",
        (str(uuid4()),uid,body.start_time,duration,dist))
    conn.commit(); conn.close()
    return {"distance_m":dist,"duration_ms":duration}

@app.get("/api/runs")
def list_runs(authorization: Optional[str]=Header(None)):
    uid=get_uid(authorization)
    conn=db(); c=conn.cursor()
    rows=c.execute("SELECT * FROM runs WHERE user_id=? ORDER BY start_time DESC",(uid,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/ranking")
def ranking():
    conn=db(); c=conn.cursor()
    rows=c.execute("""
        SELECT u.name, SUM(r.distance_m) as total_m
        FROM runs r JOIN users u ON u.id=r.user_id
        GROUP BY r.user_id
        ORDER BY total_m DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]
