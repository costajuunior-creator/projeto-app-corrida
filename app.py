import os
import sqlite3
import hashlib
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from uuid import uuid4
from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta

# Render: /tmp is writable. Override with DB_PATH env if desired.
DB = os.getenv("DB_PATH", "/tmp/corrida.db")

JWT_SECRET = os.getenv("JWT_SECRET", "TROQUE_ESSA_CHAVE_NO_RENDER")
JWT_ALG = "HS256"
JWT_EXPIRES_HOURS = 24 * 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

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
      password_hash TEXT,
      name TEXT
    )""")
    conn.commit()
    conn.close()

def create_token(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=JWT_EXPIRES_HOURS)
    payload = {"sub": user_id, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def pw_fingerprint(pw: str) -> str:
    """
    ✅ Fix definitivo do limite de 72 bytes do bcrypt:
    - converte senha em um digest SHA-256 (64 hex chars)
    - depois aplica bcrypt nesse digest (tamanho fixo)
    """
    return hashlib.sha256(pw.encode("utf-8")).hexdigest()

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
        return {"ok": True, "db": DB}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "db": DB, "message": str(e)})

@app.post("/api/register")
def register(body: RegisterIn):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Senha mínima 6 caracteres")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Nome é obrigatório")

    digest = pw_fingerprint(body.password)

    conn = db()
    c = conn.cursor()
    try:
        c.execute(
            "INSERT INTO users(id,email,password_hash,name) VALUES(?,?,?,?)",
            (str(uuid4()), body.email.lower(), pwd_context.hash(digest), body.name.strip()),
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
        "SELECT id, password_hash, name FROM users WHERE email=?",
        (body.email.lower(),),
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="Email ou senha inválidos")

    digest = pw_fingerprint(body.password)
    if not pwd_context.verify(digest, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Email ou senha inválidos")

    token = create_token(row["id"])
    return {"ok": True, "token": token, "name": row["name"]}
