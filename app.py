import os
import sqlite3
import math
import hashlib
import hmac
import secrets
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from uuid import uuid4
from jose import jwt, JWTError
from datetime import datetime, timedelta

# Render: /tmp is writable
DB = os.getenv("DB_PATH", "/tmp/corrida.db")

JWT_SECRET = os.getenv("JWT_SECRET", "TROQUE_ESSA_CHAVE_NO_RENDER")
JWT_ALG = "HS256"
JWT_EXPIRES_HOURS = 24 * 30

# Password hashing PBKDF2-HMAC-SHA256 (no bcrypt limits)
PBKDF2_ITERS = int(os.getenv("PBKDF2_ITERS", "210000"))
SALT_BYTES = 16

def db():
    conn = sqlite3.connect(DB, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB) or ".", exist_ok=True)
    conn = db()
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      pw_algo TEXT,
      pw_salt TEXT,
      pw_hash TEXT,
      name TEXT
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS runs(
      id TEXT PRIMARY KEY,
      user_id TEXT,
      start_time INTEGER,
      duration_ms INTEGER,
      distance_m REAL
    )""")
    conn.commit()
    conn.close()

def create_token(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=JWT_EXPIRES_HOURS)
    payload = {"sub": user_id, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token inválido")
        return user_id
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido/expirado")

def get_user_id_from_auth(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sem token")
    token = authorization.split(" ", 1)[1].strip()
    return decode_token(token)

def pbkdf2_hash(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERS, dklen=32)

def make_password_record(password: str) -> tuple[str, str, str]:
    salt = secrets.token_bytes(SALT_BYTES)
    digest = pbkdf2_hash(password, salt)
    return ("pbkdf2_sha256", salt.hex(), digest.hex())

def verify_password(password: str, algo: str, salt_hex: str, hash_hex: str) -> bool:
    if algo != "pbkdf2_sha256":
        return False
    salt = bytes.fromhex(salt_hex)
    expected = bytes.fromhex(hash_hex)
    got = pbkdf2_hash(password, salt)
    return hmac.compare_digest(got, expected)

def haversine_m(a, b) -> float:
    R = 6371000.0
    dlat = math.radians(b["lat"] - a["lat"])
    dlon = math.radians(b["lng"] - a["lng"])
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])
    x = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(x))

class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class Point(BaseModel):
    lat: float
    lng: float
    acc: Optional[float] = None
    t: Optional[int] = None

class RunIn(BaseModel):
    start_time: int
    end_time: int
    points: List[Point]

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.exception_handler(Exception)
async def all_exceptions_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": str(exc), "path": str(request.url.path)},
    )

@app.on_event("startup")
def startup():
    init_db()

@app.get("/")
def home():
    return FileResponse("static/index.html")

@app.get("/api/health")
def health():
    try:
        conn = db()
        conn.execute("SELECT 1").fetchone()
        conn.close()
        return {"ok": True, "db": DB, "hash": "pbkdf2_sha256", "iters": PBKDF2_ITERS}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "db": DB, "message": str(e)})

@app.post("/api/register")
def register(body: RegisterIn):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Senha mínima 6 caracteres")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Nome é obrigatório")

    algo, salt_hex, hash_hex = make_password_record(body.password)

    conn = db()
    c = conn.cursor()
    try:
        c.execute(
            "INSERT INTO users(id,email,pw_algo,pw_salt,pw_hash,name) VALUES(?,?,?,?,?,?)",
            (str(uuid4()), body.email.lower(), algo, salt_hex, hash_hex, body.name.strip()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    finally:
        conn.close()

    return {"ok": True, "message": "Cadastro realizado! Agora faça login."}

@app.post("/api/login")
def login(body: LoginIn):
    conn = db()
    c = conn.cursor()
    row = c.execute(
        "SELECT id, pw_algo, pw_salt, pw_hash, name FROM users WHERE email=?",
        (body.email.lower(),),
    ).fetchone()
    conn.close()

    if not row or not verify_password(body.password, row["pw_algo"], row["pw_salt"], row["pw_hash"]):
        raise HTTPException(status_code=401, detail="Email ou senha inválidos")

    token = create_token(row["id"])
    return {"ok": True, "token": token, "name": row["name"]}

@app.get("/api/me")
def me(authorization: Optional[str] = Header(default=None)):
    user_id = get_user_id_from_auth(authorization)
    conn = db()
    c = conn.cursor()
    row = c.execute("SELECT id, email, name FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else {"id": user_id}

@app.post("/api/runs")
def save_run(body: RunIn, authorization: Optional[str] = Header(default=None)):
    user_id = get_user_id_from_auth(authorization)

    pts = []
    for p in body.points:
        if p.acc is not None and p.acc > 60:
            continue
        pts.append({"lat": p.lat, "lng": p.lng})

    if len(pts) < 2:
        raise HTTPException(status_code=400, detail="Poucos pontos de GPS")

    dist = 0.0
    for i in range(1, len(pts)):
        dist += haversine_m(pts[i-1], pts[i])

    duration = max(0, body.end_time - body.start_time)

    conn = db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO runs(id,user_id,start_time,duration_ms,distance_m) VALUES(?,?,?,?,?)",
        (str(uuid4()), user_id, body.start_time, duration, dist),
    )
    conn.commit()
    conn.close()

    return {"ok": True, "distance_m": dist, "duration_ms": duration}

@app.get("/api/runs")
def list_runs(authorization: Optional[str] = Header(default=None)):
    user_id = get_user_id_from_auth(authorization)
    conn = db()
    c = conn.cursor()
    rows = c.execute("""
      SELECT id, start_time, duration_ms, distance_m
      FROM runs
      WHERE user_id=?
      ORDER BY start_time DESC
    """, (user_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/ranking")
def ranking():
    conn = db()
    c = conn.cursor()
    rows = c.execute("""
      SELECT u.name as name, SUM(r.distance_m) as total_m
      FROM runs r
      JOIN users u ON u.id = r.user_id
      GROUP BY r.user_id
      ORDER BY total_m DESC
      LIMIT 50
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]
