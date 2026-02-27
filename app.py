import os
import sqlite3
import hashlib
import hmac
import secrets
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from uuid import uuid4
from jose import jwt
from datetime import datetime, timedelta

# Render: /tmp is writable
DB = os.getenv("DB_PATH", "/tmp/corrida.db")

JWT_SECRET = os.getenv("JWT_SECRET", "TROQUE_ESSA_CHAVE_NO_RENDER")
JWT_ALG = "HS256"
JWT_EXPIRES_HOURS = 24 * 30

# Password hashing (PBKDF2-HMAC-SHA256)
PBKDF2_ITERS = int(os.getenv("PBKDF2_ITERS", "210000"))  # modern default
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
    conn.commit()
    conn.close()

def create_token(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=JWT_EXPIRES_HOURS)
    payload = {"sub": user_id, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

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

class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

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

    if not row:
        raise HTTPException(status_code=401, detail="Email ou senha inválidos")

    if not verify_password(body.password, row["pw_algo"], row["pw_salt"], row["pw_hash"]):
        raise HTTPException(status_code=401, detail="Email ou senha inválidos")

    token = create_token(row["id"])
    return {"ok": True, "token": token, "name": row["name"]}
