"""
Study OS - Backend API
Plataforma completa para estudantes com IA, planejamento e gamificacao
"""

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, JSON, text, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship, joinedload
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timedelta
from collections import defaultdict
import base64
import bcrypt
import httpx
import jwt
import os
import io
import re
import secrets
import time
import unicodedata
from PIL import Image

# Configuracoes
#
# SECRET_KEY NUNCA deve ter um valor padrao fixo e conhecido publicamente:
# qualquer pessoa que leia este codigo-fonte (e' open-source) saberia a chave
# usada para assinar/validar tokens JWT em qualquer instalacao que "esquecesse"
# de configurar a variavel de ambiente, permitindo forjar tokens de login para
# qualquer usuario. Se SECRET_KEY nao estiver definida, geramos uma aleatoria
# a cada start (os tokens emitidos antes de um restart deixam de ser validos,
# o que e um preco aceitavel comparado a um segredo previsivel).
SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    SECRET_KEY = secrets.token_hex(32)
    print(
        "\n[AVISO DE SEGURANCA] Variavel de ambiente SECRET_KEY nao definida. "
        "Gerando uma chave aleatoria valida apenas para esta execucao — todos "
        "os tokens JWT emitidos serao invalidados no proximo restart. "
        "Defina SECRET_KEY em backend/.env (ou na env do container) para producao.\n"
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Se definida, o backend tambem serve o frontend estatico (index.html/css/js)
# a partir deste diretorio, no mesmo processo/porta. So' usado pela imagem
# Docker unificada (Dockerfile na raiz do projeto), pensada para plataformas
# como o Hugging Face Spaces que expoem apenas um container/porta por app.
# Em desenvolvimento local (start_all.py ou docker-compose com dois
# containers) essa variavel nao e definida e o backend continua so' como API.
FRONTEND_DIR = os.environ.get("FRONTEND_DIR")

# Database
#
# Antes este caminho era fixo no codigo, ignorando a variavel de ambiente
# DATABASE_URL que o docker-compose.yml ja definia. Na pratica isso fazia o
# banco em Docker gravar em ./study_os.db (dentro do container, fora do volume
# nomeado montado em /app/data) — ou seja, os dados eram perdidos toda vez que
# o container era recriado, mesmo com um volume "persistente" configurado.
SQLALCHEMY_DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./study_os.db")
_IS_SQLITE = SQLALCHEMY_DATABASE_URL.startswith("sqlite:///")
if _IS_SQLITE:
    _db_path = SQLALCHEMY_DATABASE_URL.removeprefix("sqlite:///")
    _db_dir = os.path.dirname(_db_path)
    if _db_dir:
        os.makedirs(_db_dir, exist_ok=True)

# check_same_thread e' uma opcao especifica do driver sqlite3 - passa-la para
# outro driver (psycopg2, no caso de DATABASE_URL apontar para Postgres)
# quebra a conexao com TypeError na primeira query. Por isso so' e' aplicada
# quando o banco e' mesmo sqlite.
#
# pool_pre_ping testa a conexao (SELECT leve) antes de reusa-la do pool: bancos
# Postgres gratuitos (Supabase, Neon) derrubam conexoes ociosas depois de
# alguns minutos, e sem isso a primeira query apos um periodo sem uso falhava
# com "server closed the connection unexpectedly" em vez de simplesmente abrir
# uma conexao nova.
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False} if _IS_SQLITE else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Password hashing

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")

app = FastAPI(
    title="Study OS API",
    description="Plataforma completa para estudantes",
    version="1.0.0"
)

# CORS
#
# allow_origins=["*"] combinado com allow_credentials=True e' uma configuracao
# insegura: para atender a esse par, o middleware passa a refletir de volta
# qualquer Origin recebido (em vez do literal "*"), o que permite que
# QUALQUER site faca requisicoes autenticadas com credenciais (cookies) contra
# esta API. Como a autenticacao aqui e' via header "Authorization: Bearer"
# (nao cookies), nao precisamos de allow_credentials — desativa-lo fecha essa
# brecha sem quebrar nada.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# nginx.conf ja aplica estes mesmos headers quando o frontend e' servido por
# tras do nginx (docker-compose), mas essa e' so' uma das formas de rodar o
# projeto: no deploy unificado (Dockerfile da raiz, pensado para o Hugging
# Face Spaces) e' o proprio uvicorn/FastAPI quem serve tudo, sem nginx na
# frente - sem isto aqui, esses deploys ficavam sem nenhum destes headers.
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

# ============================================================
# MODELS (SQLAlchemy)
# ============================================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    username = Column(String, unique=True, index=True)
    full_name = Column(String)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)
    is_premium = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Gamificacao
    level = Column(Integer, default=1)
    xp = Column(Integer, default=0)
    streak_days = Column(Integer, default=0)
    total_study_time = Column(Integer, default=0)

    # Perfil
    avatar_url = Column(String, nullable=True)

    # Relacionamentos
    subjects = relationship("Subject", back_populates="user")
    notes = relationship("Note", back_populates="user")
    tasks = relationship("Task", back_populates="user")
    study_sessions = relationship("StudySession", back_populates="user")
    achievements = relationship("UserAchievement", back_populates="user")
    exam_schedule = relationship("Exam", back_populates="user")
    essays = relationship("Essay", back_populates="user")
    enem_attempts = relationship("EnemAttempt", back_populates="user")
    enem_simulados = relationship("EnemSimulado", back_populates="user")

class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    color = Column(String, default="#4A90D9")
    icon = Column(String, default="book")
    user_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="subjects")
    notes = relationship("Note", back_populates="subject")
    tasks = relationship("Task", back_populates="subject")
    questions = relationship("Question", back_populates="subject")

class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    content = Column(Text)
    summary = Column(Text, nullable=True)
    mind_map = Column(JSON, nullable=True)
    flashcards = Column(JSON, nullable=True)
    ocr_text = Column(Text, nullable=True)
    image_url = Column(String, nullable=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="notes")
    subject = relationship("Subject", back_populates="notes")

class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(Text, nullable=True)
    due_date = Column(DateTime, nullable=True, index=True)
    priority = Column(String, default="medium")
    status = Column(String, default="pending", index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="tasks")
    subject = relationship("Subject", back_populates="tasks")

class StudySession(Base):
    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    duration = Column(Integer)
    pomodoro_cycles = Column(Integer, default=0)
    date = Column(DateTime, default=datetime.utcnow, index=True)
    notes = Column(Text, nullable=True)

    user = relationship("User", back_populates="study_sessions")

class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    text = Column(Text)
    options = Column(JSON)
    explanation = Column(Text)
    subject_id = Column(Integer, ForeignKey("subjects.id"), index=True)
    difficulty = Column(String, default="medium")
    topic = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    subject = relationship("Subject", back_populates="questions")

class Exam(Base):
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    subject = Column(String)
    date = Column(DateTime, index=True)
    location = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="exam_schedule")

class Essay(Base):
    __tablename__ = "essays"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    content = Column(Text)
    feedback = Column(Text, nullable=True)
    score = Column(Float, nullable=True)
    corrections = Column(JSON, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="essays")

class Achievement(Base):
    __tablename__ = "achievements"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    description = Column(String)
    icon = Column(String)
    xp_reward = Column(Integer, default=100)
    condition_type = Column(String)
    condition_value = Column(Integer)

class UserAchievement(Base):
    __tablename__ = "user_achievements"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    achievement_id = Column(Integer, ForeignKey("achievements.id"))
    earned_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="achievements")
    achievement = relationship("Achievement")

class StudyPlan(Base):
    __tablename__ = "study_plans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    title = Column(String)
    goal = Column(String)
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    daily_hours = Column(Float, default=2.0)
    schedule = Column(JSON)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class EnemAttempt(Base):
    __tablename__ = "enem_attempts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    year = Column(Integer, index=True)
    discipline = Column(String, index=True)
    question_index = Column(Integer)
    selected_letter = Column(String)
    correct_letter = Column(String)
    is_correct = Column(Boolean, index=True)
    time_spent_seconds = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User", back_populates="enem_attempts")

class EnemSimulado(Base):
    __tablename__ = "enem_simulados"

    # Um registro por simulado FINALIZADO (não por questão, como EnemAttempt) —
    # é o que alimenta o histórico/evolução do usuário ao longo do tempo, algo
    # que as estatísticas agregadas por disciplina (EnemAttempt/enem/stats) não
    # mostravam: dava pra ver a % de acerto geral em Matemática, mas não "como
    # fui no simulado de terça vs no de quinta".
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    year = Column(Integer)
    discipline = Column(String)
    total_questions = Column(Integer)
    correct_count = Column(Integer)
    time_spent_seconds = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User", back_populates="enem_simulados")

Base.metadata.create_all(bind=engine)

# create_all NAO adiciona indices/colunas em tabelas sqlite que ja existem no
# disco (study_os.db de instalacoes anteriores), entao garantimos os indices
# de performance via SQL bruto e idempotente (IF NOT EXISTS) sem tocar nos
# dados existentes.
_INDEXES_TO_ENSURE = [
    ("ix_notes_user_id", "notes", "user_id"),
    ("ix_notes_subject_id", "notes", "subject_id"),
    ("ix_tasks_user_id", "tasks", "user_id"),
    ("ix_tasks_subject_id", "tasks", "subject_id"),
    ("ix_tasks_status", "tasks", "status"),
    ("ix_tasks_due_date", "tasks", "due_date"),
    ("ix_study_sessions_user_id", "study_sessions", "user_id"),
    ("ix_study_sessions_date", "study_sessions", "date"),
    ("ix_exams_user_id", "exams", "user_id"),
    ("ix_exams_date", "exams", "date"),
    ("ix_essays_user_id", "essays", "user_id"),
    ("ix_questions_subject_id", "questions", "subject_id"),
    ("ix_user_achievements_user_id", "user_achievements", "user_id"),
    ("ix_study_plans_user_id", "study_plans", "user_id"),
    ("ix_enem_attempts_user_id", "enem_attempts", "user_id"),
    ("ix_enem_attempts_year", "enem_attempts", "year"),
    ("ix_enem_attempts_discipline", "enem_attempts", "discipline"),
    ("ix_enem_attempts_is_correct", "enem_attempts", "is_correct"),
    ("ix_enem_attempts_created_at", "enem_attempts", "created_at"),
    ("ix_enem_simulados_user_id", "enem_simulados", "user_id"),
    ("ix_enem_simulados_created_at", "enem_simulados", "created_at"),
]

with engine.begin() as conn:
    for index_name, table_name, column_name in _INDEXES_TO_ENSURE:
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name}({column_name})"))

# ============================================================
# PYDANTIC SCHEMAS
# ============================================================

class UserCreate(BaseModel):
    email: str
    username: str
    full_name: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v):
        if not EMAIL_REGEX.match(v):
            raise ValueError("Email invalido")
        return v

    @field_validator("username")
    @classmethod
    def validate_username(cls, v):
        return validate_username_value(v)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v):
        return validate_full_name_value(v)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError("A senha precisa ter pelo menos 8 caracteres")
        return v

class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    full_name: str
    level: int
    xp: int
    streak_days: int
    is_premium: bool
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v):
        if v is not None and not EMAIL_REGEX.match(v):
            raise ValueError("Email invalido")
        return v

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v):
        return validate_full_name_value(v)

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < 8:
            raise ValueError("A nova senha precisa ter pelo menos 8 caracteres")
        return v

class SubjectCreate(BaseModel):
    name: str
    color: Optional[str] = "#4A90D9"
    icon: Optional[str] = "book"

class SubjectResponse(BaseModel):
    id: int
    name: str
    color: str
    icon: str

    class Config:
        from_attributes = True

class NoteCreate(BaseModel):
    title: str
    content: str
    subject_id: Optional[int] = None

class NoteResponse(BaseModel):
    id: int
    title: str
    content: str
    summary: Optional[str]
    flashcards: Optional[List[Dict]]
    subject_id: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    priority: Optional[Literal["low", "medium", "high"]] = "medium"
    subject_id: Optional[int] = None

class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    due_date: Optional[datetime]
    priority: str
    status: str
    subject_id: Optional[int]

    class Config:
        from_attributes = True

class QuestionResponse(BaseModel):
    id: int
    text: str
    options: List[Dict[str, Any]]
    explanation: str
    subject_id: int
    difficulty: str
    topic: Optional[str]

    class Config:
        from_attributes = True

class ExamCreate(BaseModel):
    title: str
    subject: str
    date: datetime
    location: Optional[str] = None
    notes: Optional[str] = None

class ExamResponse(BaseModel):
    id: int
    title: str
    subject: str
    date: datetime
    location: Optional[str]

    class Config:
        from_attributes = True

class EssayCreate(BaseModel):
    title: str
    content: str

class EssayResponse(BaseModel):
    id: int
    title: str
    content: str
    feedback: Optional[str]
    score: Optional[float]
    corrections: Optional[List[Dict]]

    class Config:
        from_attributes = True

class StudyPlanCreate(BaseModel):
    title: str
    goal: str
    start_date: datetime
    end_date: datetime
    daily_hours: Optional[float] = 2.0
    subjects: List[str]

class StudyPlanResponse(BaseModel):
    id: int
    title: str
    goal: str
    schedule: Dict
    is_active: bool

    class Config:
        from_attributes = True

class StudySessionCreate(BaseModel):
    subject_id: Optional[int] = None
    duration: int
    pomodoro_cycles: Optional[int] = 0
    notes: Optional[str] = None

    @field_validator("duration")
    @classmethod
    def validate_duration(cls, v):
        # Sem limite, um POST direto com duration=999999999 inflava
        # total_study_time, o grafico semanal e o XP (xp_earned = duration//10)
        # numa unica chamada. 600 min (10h) cobre qualquer sessao real de estudo.
        if v < 1 or v > 600:
            raise ValueError("duration precisa estar entre 1 e 600 minutos")
        return v

class EnemAttemptCreate(BaseModel):
    year: int
    discipline: str
    question_index: int
    selected_letter: str
    correct_letter: str
    is_correct: bool
    time_spent_seconds: int = 0

class EnemDisciplineStats(BaseModel):
    discipline: str
    attempts: int
    correct: int
    accuracy: float

class EnemStatsResponse(BaseModel):
    total_attempts: int
    total_correct: int
    accuracy: float
    by_discipline: List[EnemDisciplineStats]

class EnemSimuladoCreate(BaseModel):
    year: int
    discipline: str
    total_questions: int
    correct_count: int
    time_spent_seconds: int = 0

    @field_validator("total_questions")
    @classmethod
    def validate_total_questions(cls, v):
        if v < 1 or v > 200:
            raise ValueError("total_questions precisa estar entre 1 e 200")
        return v

    @field_validator("correct_count")
    @classmethod
    def validate_correct_count(cls, v):
        if v < 0:
            raise ValueError("correct_count nao pode ser negativo")
        return v

    @field_validator("time_spent_seconds")
    @classmethod
    def validate_time_spent(cls, v):
        if v < 0:
            raise ValueError("time_spent_seconds nao pode ser negativo")
        return v

    @model_validator(mode="after")
    def validate_correct_not_greater_than_total(self):
        if self.correct_count > self.total_questions:
            raise ValueError("correct_count nao pode ser maior que total_questions")
        return self

class EnemSimuladoResponse(BaseModel):
    id: int
    year: int
    discipline: str
    total_questions: int
    correct_count: int
    time_spent_seconds: int
    created_at: datetime

    class Config:
        from_attributes = True

class StatsResponse(BaseModel):
    total_study_time: int
    streak_days: int
    level: int
    xp: int
    xp_to_next: int
    subjects_count: int
    notes_count: int
    tasks_completed: int
    tasks_pending: int
    questions_answered: int
    average_score: float
    weekly_study_hours: List[Dict[str, Any]]
    subject_distribution: List[Dict[str, Any]]

class AIExplainRequest(BaseModel):
    content: str
    subject: Optional[str] = None
    level: Optional[str] = "intermediate"

class AIExplainResponse(BaseModel):
    explanation: str
    key_points: List[str]
    examples: List[str]
    related_topics: List[str]

class AISummaryRequest(BaseModel):
    content: str
    max_length: Optional[int] = 500

class AISummaryResponse(BaseModel):
    summary: str
    mind_map: Dict[str, Any]
    flashcards: List[Dict[str, Any]]

class AIEssayCorrectionRequest(BaseModel):
    essay_id: int
    content: str

class AIEssayCorrectionResponse(BaseModel):
    score: float
    feedback: str
    corrections: List[Dict[str, Any]]
    suggestions: List[str]

class AIQuestionAnalysisRequest(BaseModel):
    question_id: int
    selected_option: int
    user_answer: Optional[str] = None

class AIQuestionAnalysisResponse(BaseModel):
    is_correct: bool
    explanation: str
    why_correct: str
    why_incorrect: List[str]
    related_concepts: List[str]

class AIFlashcardsRequest(BaseModel):
    content: str

class AIFlashcardsResponse(BaseModel):
    flashcards: List[Dict[str, Any]]

# ============================================================
# DEPENDENCIES
# ============================================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _truncate_for_bcrypt(password: str) -> bytes:
    # bcrypt so aceita ate 72 bytes; truncamos de forma consistente no hash
    # e na verificacao para nunca estourar ValueError com senhas longas.
    return password.encode("utf-8")[:72]

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(_truncate_for_bcrypt(plain_password), hashed_password.encode("utf-8"))

def get_password_hash(password):
    hashed = bcrypt.hashpw(_truncate_for_bcrypt(password), bcrypt.gensalt())
    return hashed.decode("utf-8")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Não foi possível validar suas credenciais",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

# ============================================================
# VALIDACAO DE CONTEUDO (nome de usuario)
# ============================================================

# Lista de bloqueio basica de termos ofensivos/palavroes comuns em portugues e
# ingles. Isto e um filtro HEURISTICO simples (blocklist), NAO e 100% preciso:
# pode ter falsos positivos (palavras legitimas parecidas) e falsos negativos
# (variacoes/leetspeak/gírias novas nao cobertas). Para moderacao robusta de
# verdade seria necessario um servico dedicado.
OFFENSIVE_TERMS = {
    # portugues
    "arrombado", "arrombada", "babaca", "bosta", "buceta", "burro", "burra",
    "caralho", "corno", "cretino", "cretina", "cu", "desgraca", "desgracado",
    "desgracada", "estupido", "estupida", "filho da puta", "foda", "fodase",
    "fdp", "idiota", "imbecil", "merda", "otario", "otaria", "porra", "puta",
    "putinha", "retardado", "retardada", "vagabundo", "vagabunda", "viado",
    "vsf", "pqp", "krl", "safado", "safada", "escroto", "escrota", "nazista",
    "pedofilo", "pedofila", "vadia",
    # ingles
    "asshole", "bastard", "bitch", "bullshit", "crap", "cunt", "damn",
    "dick", "douchebag", "fag", "faggot", "fuck", "fucker", "idiot",
    "moron", "nigger", "nigga", "prick", "pussy", "retard", "shit",
    "slut", "whore",
}

def _normalize_for_offensive_check(text: str) -> str:
    # minusculas + remove acentos, pra comparar de forma consistente
    # (ex.: "Estúpido" -> "estupido")
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))

def contains_offensive_language(text: str) -> bool:
    """Checa se o texto contem algum termo da blocklist como PALAVRA INTEIRA
    (word boundary), nao como substring solta - isso evita falso positivo tipo
    "Cuiaba" disparando por conter uma substring parecida com um termo da lista.
    Heuristico e simples: nao cobre todas as variacoes possiveis."""
    if not text:
        return False
    normalized = _normalize_for_offensive_check(text)
    for term in OFFENSIVE_TERMS:
        pattern = r"\b" + re.escape(term) + r"\b"
        if re.search(pattern, normalized):
            return True
    return False

FULL_NAME_MAX_LENGTH = 100
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")

def validate_full_name_value(v: Optional[str]) -> Optional[str]:
    """Usado tanto no cadastro (full_name obrigatorio) quanto na edicao de
    perfil (full_name opcional) - por isso aceita e repassa None. Antes, so' o
    cadastro checava linguagem impropria; editar o perfil depois de criar a
    conta (PUT /auth/me) nao passava por nenhuma validacao."""
    if v is None:
        return v
    v = v.strip()
    if not v:
        raise ValueError("Nome nao pode ser vazio")
    if len(v) > FULL_NAME_MAX_LENGTH:
        raise ValueError(f"Nome muito longo (maximo de {FULL_NAME_MAX_LENGTH} caracteres)")
    if _CONTROL_CHARS_RE.search(v):
        raise ValueError("Nome contem caracteres invalidos")
    if contains_offensive_language(v):
        raise ValueError("Nome contem linguagem impropria")
    return v

USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 254  # o frontend usa o proprio email como username (ver api.js register())
_USERNAME_INVALID_CHARS_RE = re.compile(r"[\x00-\x1f\x7f\s]")

def validate_username_value(v: str) -> str:
    # Sem regex de formato (tipo so' alfanumerico): o frontend manda o email
    # como username, entao "@" e "." precisam continuar validos aqui. Ainda
    # assim vale barrar tamanho absurdo, espacos/caracteres de controle, e
    # linguagem ofensiva - o username aparece publicamente (sem login) no
    # /api/v1/leaderboard.
    v = v.strip()
    if len(v) < USERNAME_MIN_LENGTH or len(v) > USERNAME_MAX_LENGTH:
        raise ValueError(f"Nome de usuario precisa ter entre {USERNAME_MIN_LENGTH} e {USERNAME_MAX_LENGTH} caracteres")
    if _USERNAME_INVALID_CHARS_RE.search(v):
        raise ValueError("Nome de usuario nao pode conter espacos ou caracteres de controle")
    if contains_offensive_language(v):
        raise ValueError("Nome de usuario contem linguagem impropria")
    return v

# ============================================================
# RATE LIMITING (simples, em memoria) — protege /auth/* de forca bruta
# ============================================================
# Nao substitui um rate limiter de verdade (ex.: Redis) atras de varios
# workers/processos em producao, mas bloqueia o cenario mais comum: um script
# tentando muitas senhas/contas seguidas direto contra a API.

_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_MAX_ATTEMPTS = 10
_rate_limit_hits: Dict[str, List[float]] = defaultdict(list)

def _enforce_rate_limit(bucket: str, identifier: str, max_attempts: int = _RATE_LIMIT_MAX_ATTEMPTS, window_seconds: int = _RATE_LIMIT_WINDOW_SECONDS):
    key = f"{bucket}:{identifier}"
    now = time.monotonic()
    cutoff = now - window_seconds
    hits = _rate_limit_hits[key]
    while hits and hits[0] < cutoff:
        hits.pop(0)
    if len(hits) >= max_attempts:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Aguarde um minuto e tente novamente.")
    hits.append(now)

# ============================================================
# SERVICOS DE IA
# ============================================================

class AIService:
    @staticmethod
    def explain_content(content: str, subject: str = None, level: str = "intermediate") -> AIExplainResponse:
        explanations = {
            "beginner": f"Vou explicar isso de forma bem simples!\n\n{content}\n\nImagine que isso e como aprender a andar de bicicleta - comecamos devagar e vamos ganhando confianca.",
            "intermediate": f"Entendendo o conceito: {content}\n\nEste e um topico intermediario que requer atencao aos detalhes. Vamos analisar passo a passo.",
            "advanced": f"Analise aprofundada: {content}\n\nNivel avancado - considerando nuances teoricas e aplicacoes praticas complexas."
        }

        return AIExplainResponse(
            explanation=explanations.get(level, explanations["intermediate"]),
            key_points=[
                "Conceito fundamental identificado",
                "Relacao com topicos anteriores",
                "Aplicacao pratica no dia a dia",
                "Ponto de atencao para provas"
            ],
            examples=[
                "Exemplo 1: Situacao do cotidiano",
                "Exemplo 2: Caso pratico resolvido",
                "Exemplo 3: Aplicacao em provas anteriores"
            ],
            related_topics=["Topico relacionado A", "Topico relacionado B", "Pre-requisito importante"]
        )

    @staticmethod
    def generate_summary(content: str, max_length: int = 500) -> AISummaryResponse:
        summary = f"Resumo gerado pela IA:\n\n{content[:max_length]}...\n\n[Resumo conciso com os pontos principais extraidos do conteudo]"

        mind_map = {
            "central": "Tema Principal",
            "branches": [
                {"name": "Conceito 1", "children": ["Subtopico 1.1", "Subtopico 1.2"]},
                {"name": "Conceito 2", "children": ["Subtopico 2.1", "Subtopico 2.2"]},
                {"name": "Conceito 3", "children": ["Subtopico 3.1"]}
            ]
        }

        flashcards = [
            {"front": "O que e [conceito principal]?", "back": "Definicao completa aqui...", "difficulty": "medium"},
            {"front": "Qual a formula/principio fundamental?", "back": "Formula: X = Y + Z", "difficulty": "hard"},
            {"front": "Exemplo pratico:", "back": "Situacao do cotidiano ilustrando o conceito", "difficulty": "easy"},
            {"front": "Erro comum a evitar:", "back": "Explicacao do erro e como evita-lo", "difficulty": "medium"}
        ]

        return AISummaryResponse(summary=summary, mind_map=mind_map, flashcards=flashcards)

    @staticmethod
    async def correct_essay(content: str) -> AIEssayCorrectionResponse:
        # Correcao REAL de gramatica/ortografia/pontuacao via LanguageTool
        # (https://languagetool.org), que tem uma API publica gratuita e sem
        # necessidade de chave/cadastro. Isso substitui a versao anterior, que
        # so devolvia texto fixo (as mesmas 3 "correcoes" de exemplo pra
        # qualquer redacao, e uma nota calculada so pelo tamanho do texto, sem
        # nenhuma relacao com a qualidade real do que foi escrito).
        #
        # Limitacao honesta: isso pega erros de gramatica/ortografia/pontuacao
        # de verdade, mas nao avalia argumentacao, coesao tematica ou adequacao
        # ao tema como um corretor humano (ou uma IA generativa) faria - LanguageTool
        # e um verificador de regras linguisticas, nao um avaliador de redacao
        # completo. Documentado tambem pro usuario via "feedback".
        text = content[:15000]  # limite defensivo de tamanho pra API publica

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    "https://api.languagetool.org/v2/check",
                    data={"text": text, "language": "pt-BR"}
                )
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError:
            # Antes isso devolvia erro 502 pro usuario ("nao foi possivel
            # corrigir") sempre que o LanguageTool estivesse fora do ar, lento
            # ou bloqueado pela rede do usuario - na pratica isso fazia a
            # funcionalidade inteira parecer quebrada. Preferimos degradar
            # (estimativa local, claramente identificada como tal) a falhar
            # sem devolver nada util.
            return AIService._offline_essay_estimate(text)

        matches = payload.get("matches", [])
        corrections = []
        for m in matches:
            offset = m.get("offset", 0)
            length = m.get("length", 0)
            replacements = m.get("replacements") or []
            corrections.append({
                "type": (m.get("rule", {}).get("category", {}) or {}).get("name") or m.get("rule", {}).get("issueType", "outro"),
                "line": text.count("\n", 0, offset) + 1,
                "original": text[offset:offset + length],
                "correction": replacements[0]["value"] if replacements else "(sem sugestao)",
                "explanation": m.get("message", "")
            })

        words = max(1, len(text.split()))
        errors_per_100_words = len(matches) / words * 100
        score = round(max(0, min(1000, 1000 - errors_per_100_words * 45)))

        seen_messages = set()
        suggestions = []
        for m in matches:
            msg = m.get("message", "")
            if msg and msg not in seen_messages:
                seen_messages.add(msg)
                suggestions.append(msg)
            if len(suggestions) >= 5:
                break
        if not suggestions:
            suggestions = ["Nenhum problema de gramatica, ortografia ou pontuacao encontrado pelo verificador automatico."]

        feedback = (
            f"Verificacao automatica de gramatica/ortografia/pontuacao (LanguageTool): "
            f"{len(matches)} ponto(s) encontrado(s) em {words} palavras. "
            f"Nota estimada com base na densidade de erros: {score}/1000. "
            f"Esta correcao NAO avalia argumentacao, coesao tematica ou adequacao ao tema "
            f"como um professor faria - e so um verificador linguistico automatico."
        )

        return AIEssayCorrectionResponse(
            score=score,
            feedback=feedback,
            corrections=corrections,
            suggestions=suggestions
        )

    @staticmethod
    def _offline_essay_estimate(text: str) -> AIEssayCorrectionResponse:
        # Usado só quando o LanguageTool esta inacessivel (fora do ar, lento
        # demais, ou bloqueado pela rede local). Isto NAO verifica gramatica -
        # e' apenas uma estimativa por estrutura (tamanho, paragrafos, tamanho
        # medio de frase), deixada bem clara no feedback pro usuario nao achar
        # que e' uma correcao de verdade.
        words = text.split()
        word_count = len(words)
        sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
        sentence_count = max(1, len(sentences))
        paragraphs = [p for p in text.split("\n") if p.strip()]

        score = 500
        if word_count >= 150:
            score += 200
        elif word_count >= 80:
            score += 100
        if len(paragraphs) >= 4:
            score += 100
        elif len(paragraphs) >= 2:
            score += 50
        avg_words_per_sentence = word_count / sentence_count
        if 10 <= avg_words_per_sentence <= 25:
            score += 100
        score = max(0, min(950, score))  # nunca 1000: deixa claro que e' so' estimativa

        return AIEssayCorrectionResponse(
            score=score,
            feedback=(
                f"Não foi possível conectar ao serviço de verificação gramatical agora, "
                f"então esta é uma ESTIMATIVA aproximada por estrutura ({word_count} palavras, "
                f"{len(paragraphs)} parágrafo(s)) — não verifica gramática/ortografia de verdade. "
                f"Tente corrigir de novo em alguns instantes para a checagem completa."
            ),
            corrections=[],
            suggestions=["O serviço de correção gramatical está temporariamente indisponível — tente novamente em instantes."]
        )

    @staticmethod
    def analyze_question(question: Question, selected_option: int) -> AIQuestionAnalysisResponse:
        correct_idx = next((i for i, opt in enumerate(question.options) if opt.get("is_correct")), 0)
        is_correct = selected_option == correct_idx

        why_incorrect = []
        if not is_correct:
            why_incorrect = [
                f"A alternativa {selected_option + 1} confunde [conceito X] com [conceito Y]",
                "Erro comum: nao considerar o contexto historico",
                "Dica: revise o capitulo sobre este topico especifico"
            ]

        return AIQuestionAnalysisResponse(
            is_correct=is_correct,
            explanation=question.explanation,
            why_correct=f"A alternativa {correct_idx + 1} esta correta porque: {question.explanation}",
            why_incorrect=why_incorrect,
            related_concepts=["Conceito relacionado 1", "Conceito relacionado 2", "Pre-requisito"]
        )

    @staticmethod
    def generate_study_plan(goal: str, subjects: List[str], start_date: datetime, end_date: datetime, daily_hours: float) -> Dict:
        total_days = (end_date - start_date).days
        schedule = []

        for day in range(total_days):
            current_date = start_date + timedelta(days=day)
            day_subjects = []

            if current_date.weekday() < 5:
                num_subjects = min(len(subjects), 3)
                for i in range(num_subjects):
                    subject_idx = (day + i) % len(subjects)
                    day_subjects.append({
                        "subject": subjects[subject_idx],
                        "duration": int(daily_hours * 60 / num_subjects),
                        "topics": [f"Topico {j+1} de {subjects[subject_idx]}" for j in range(2)]
                    })
            else:
                day_subjects.append({
                    "subject": "Revisao Geral",
                    "duration": int(daily_hours * 60),
                    "topics": ["Revisar conteudos da semana", "Resolver exercicios"]
                })

            schedule.append({
                "date": current_date.isoformat(),
                "subjects": day_subjects,
                "total_duration": int(daily_hours * 60)
            })

        return {"schedule": schedule, "total_days": total_days, "goal": goal}

ai_service = AIService()

# ============================================================
# GAMIFICACAO
# ============================================================

class GamificationService:
    XP_PER_LEVEL = 1000

    @staticmethod
    def add_xp(user: User, amount: int, db: Session):
        user.xp += amount
        new_level = (user.xp // GamificationService.XP_PER_LEVEL) + 1
        if new_level > user.level:
            user.level = new_level
        db.commit()

    @staticmethod
    def check_achievements(user: User, db: Session):
        achievements = db.query(Achievement).all()
        earned_ids = {
            ua.achievement_id
            for ua in db.query(UserAchievement).filter(UserAchievement.user_id == user.id).all()
        }
        earned = []

        for ach in achievements:
            if ach.id in earned_ids:
                continue

            condition_met = False
            if ach.condition_type == "streak" and user.streak_days >= ach.condition_value:
                condition_met = True
            elif ach.condition_type == "study_time" and user.total_study_time >= ach.condition_value:
                condition_met = True
            elif ach.condition_type == "level" and user.level >= ach.condition_value:
                condition_met = True

            if condition_met:
                user_ach = UserAchievement(user_id=user.id, achievement_id=ach.id)
                db.add(user_ach)
                GamificationService.add_xp(user, ach.xp_reward, db)
                earned.append(ach)

        db.commit()
        return earned

    @staticmethod
    def calculate_stats(user: User, db: Session) -> StatsResponse:
        subjects_count = db.query(Subject).filter(Subject.user_id == user.id).count()
        notes_count = db.query(Note).filter(Note.user_id == user.id).count()
        tasks_completed = db.query(Task).filter(Task.user_id == user.id, Task.status == "completed").count()
        tasks_pending = db.query(Task).filter(Task.user_id == user.id, Task.status != "completed").count()

        questions_answered = tasks_completed * 5
        average_score = 75.0

        # Janelas alinhadas à meia-noite (não a "agora"): antes, usar
        # datetime.utcnow() - timedelta(days=i) como início da janela do dia i
        # fazia com que o dia "hoje" (i=0) exigisse sessões com data >= agora,
        # ou seja, no futuro — praticamente sempre 0 — e os demais dias
        # ficavam deslocados por não baterem com a virada de dia real.
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        weekly_study_hours = []
        for i in range(6, -1, -1):
            day_start = today_start - timedelta(days=i)
            day_end = day_start + timedelta(days=1)
            sessions = db.query(StudySession).filter(
                StudySession.user_id == user.id,
                StudySession.date >= day_start,
                StudySession.date < day_end
            ).all()
            total = sum(s.duration for s in sessions) / 60
            weekly_study_hours.append({
                "day": day_start.strftime("%a"),
                "hours": round(total, 1)
            })

        subject_distribution = []
        subjects = db.query(Subject).filter(Subject.user_id == user.id).all()
        for subj in subjects:
            sessions = db.query(StudySession).filter(
                StudySession.user_id == user.id,
                StudySession.subject_id == subj.id
            ).all()
            total = sum(s.duration for s in sessions)
            subject_distribution.append({
                "subject": subj.name,
                "minutes": total,
                "color": subj.color
            })

        return StatsResponse(
            total_study_time=user.total_study_time,
            streak_days=user.streak_days,
            level=user.level,
            xp=user.xp,
            xp_to_next=GamificationService.XP_PER_LEVEL - (user.xp % GamificationService.XP_PER_LEVEL),
            subjects_count=subjects_count,
            notes_count=notes_count,
            tasks_completed=tasks_completed,
            tasks_pending=tasks_pending,
            questions_answered=questions_answered,
            average_score=average_score,
            weekly_study_hours=weekly_study_hours,
            subject_distribution=subject_distribution
        )

gamification_service = GamificationService()

# ============================================================
# SEED DATA
# ============================================================

def seed_data():
    db = SessionLocal()
    try:
        if db.query(Achievement).count() == 0:
            achievements = [
                Achievement(name="Primeiros Passos", description="Complete sua primeira tarefa", icon="target", xp_reward=50, condition_type="study_time", condition_value=1),
                Achievement(name="Consistencia", description="Estude 7 dias seguidos", icon="fire", xp_reward=200, condition_type="streak", condition_value=7),
                Achievement(name="Maratonista", description="Estude 30 dias seguidos", icon="trophy", xp_reward=500, condition_type="streak", condition_value=30),
                Achievement(name="Cerebro em Acao", description="Acumule 10 horas de estudo", icon="brain", xp_reward=150, condition_type="study_time", condition_value=600),
                Achievement(name="Mestre do Conhecimento", description="Chegue ao nivel 10", icon="crown", xp_reward=1000, condition_type="level", condition_value=10),
            ]
            for ach in achievements:
                db.add(ach)
            db.commit()

        if db.query(Question).count() == 0:
            questions = [
                Question(
                    text="Qual e a capital do Brasil?",
                    options=[
                        {"text": "Sao Paulo", "is_correct": False},
                        {"text": "Rio de Janeiro", "is_correct": False},
                        {"text": "Brasilia", "is_correct": True},
                        {"text": "Salvador", "is_correct": False}
                    ],
                    explanation="Brasilia foi inaugurada em 21 de abril de 1960 como nova capital do Brasil, substituindo o Rio de Janeiro.",
                    subject_id=1,
                    difficulty="easy",
                    topic="Geografia"
                ),
                Question(
                    text="Qual e o valor de x na equacao 2x + 4 = 12?",
                    options=[
                        {"text": "2", "is_correct": False},
                        {"text": "4", "is_correct": True},
                        {"text": "6", "is_correct": False},
                        {"text": "8", "is_correct": False}
                    ],
                    explanation="Para resolver: 2x + 4 = 12 -> 2x = 8 -> x = 4.",
                    subject_id=2,
                    difficulty="easy",
                    topic="Algebra"
                ),
                Question(
                    text="Na fotossintese, qual gas e absorvido pelas plantas?",
                    options=[
                        {"text": "Oxigenio", "is_correct": False},
                        {"text": "Nitrogenio", "is_correct": False},
                        {"text": "Dioxido de Carbono", "is_correct": True},
                        {"text": "Hidrogenio", "is_correct": False}
                    ],
                    explanation="As plantas absorvem CO2 e convertem-no em glicose atraves da fotossintese.",
                    subject_id=3,
                    difficulty="medium",
                    topic="Biologia"
                )
            ]
            for q in questions:
                db.add(q)
            db.commit()
    finally:
        db.close()

seed_data()

# ============================================================
# ROUTES - AUTH
# ============================================================

@app.post("/api/v1/auth/register", response_model=UserResponse)
def register(user: UserCreate, request: Request, db: Session = Depends(get_db)):
    _enforce_rate_limit("register", request.client.host if request.client else "unknown")

    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Este email já está cadastrado")

    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Este nome de usuário já está em uso")

    hashed_password = get_password_hash(user.password)
    new_user = User(
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        hashed_password=hashed_password
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/v1/auth/login")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    client_host = request.client.host if request.client else "unknown"
    _enforce_rate_limit("login", client_host)
    _enforce_rate_limit("login-user", form_data.username)
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    # Nunca devolver hashed_password ao cliente: serializamos o usuário
    # através do UserResponse, que expõe apenas campos seguros.
    return {"access_token": access_token, "token_type": "bearer", "user": UserResponse.model_validate(user)}

@app.get("/api/v1/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.put("/api/v1/auth/me", response_model=UserResponse)
def update_profile(payload: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    updates = payload.dict(exclude_unset=True)
    if "email" in updates and updates["email"] != current_user.email:
        existing = db.query(User).filter(User.email == updates["email"]).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email ja esta em uso")
    for key, value in updates.items():
        setattr(current_user, key, value)
    db.commit()
    db.refresh(current_user)
    return current_user

@app.post("/api/v1/auth/change-password")
def change_password(payload: PasswordChange, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _enforce_rate_limit("change-password", str(current_user.id))
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Senha atual incorreta")
    current_user.hashed_password = get_password_hash(payload.new_password)
    db.commit()
    return {"message": "Senha atualizada com sucesso"}

@app.post("/api/v1/auth/me/avatar", response_model=UserResponse)
async def upload_avatar(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8MB no upload cru, antes de comprimir
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="O arquivo precisa ser uma imagem")

    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Imagem muito grande (limite de 8MB)")

    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        image = Image.open(io.BytesIO(raw))  # verify() consome o arquivo; reabre pra processar
    except Exception:
        raise HTTPException(status_code=400, detail="Nao foi possivel ler essa imagem. Tente outro arquivo.")

    image = image.convert("RGB")
    image.thumbnail((256, 256))

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=82)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")

    current_user.avatar_url = f"data:image/jpeg;base64,{encoded}"
    db.commit()
    db.refresh(current_user)
    return current_user

# ============================================================
# ROUTES - SUBJECTS
# ============================================================

@app.post("/api/v1/subjects", response_model=SubjectResponse)
def create_subject(subject: SubjectCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_subject = Subject(**subject.dict(), user_id=current_user.id)
    db.add(db_subject)
    db.commit()
    db.refresh(db_subject)
    return db_subject

@app.get("/api/v1/subjects", response_model=List[SubjectResponse])
def get_subjects(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Subject).filter(Subject.user_id == current_user.id).all()

@app.delete("/api/v1/subjects/{subject_id}")
def delete_subject(subject_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    subject = db.query(Subject).filter(Subject.id == subject_id, Subject.user_id == current_user.id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Matéria não encontrada")

    # SQLite nao aplica ON DELETE por padrao nesta conexao, e o modelo nao
    # declara cascade — sem isso, apagar uma materia deixava notes/tasks com
    # subject_id apontando para uma linha que nao existe mais (FK orfa).
    # Preferimos "desvincular" (subject_id = NULL) a apagar em cascata: o
    # usuario perde a categorizacao, nao o conteudo.
    db.query(Note).filter(Note.subject_id == subject_id, Note.user_id == current_user.id).update({"subject_id": None})
    db.query(Task).filter(Task.subject_id == subject_id, Task.user_id == current_user.id).update({"subject_id": None})

    db.delete(subject)
    db.commit()
    return {"message": "Matéria removida"}

# ============================================================
# ROUTES - NOTES
# ============================================================

@app.post("/api/v1/notes", response_model=NoteResponse)
def create_note(note: NoteCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_note = Note(**note.dict(), user_id=current_user.id)
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

@app.get("/api/v1/notes", response_model=List[NoteResponse])
def get_notes(subject_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Note).filter(Note.user_id == current_user.id)
    if subject_id:
        query = query.filter(Note.subject_id == subject_id)
    return query.order_by(Note.created_at.desc()).all()

@app.get("/api/v1/notes/{note_id}", response_model=NoteResponse)
def get_note(note_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Anotação não encontrada")
    return note

@app.put("/api/v1/notes/{note_id}", response_model=NoteResponse)
def update_note(note_id: int, note_update: NoteCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Anotação não encontrada")

    for key, value in note_update.dict(exclude_unset=True).items():
        setattr(note, key, value)
    note.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(note)
    return note

@app.delete("/api/v1/notes/{note_id}")
def delete_note(note_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Anotação não encontrada")
    db.delete(note)
    db.commit()
    return {"message": "Anotação removida"}

@app.post("/api/v1/notes/{note_id}/summarize", response_model=AISummaryResponse)
def summarize_note(note_id: int, request: AISummaryRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Anotação não encontrada")

    # So' premia XP na primeira vez que a nota ganha um resumo - o usuario pode
    # gerar de novo (ex.: pra tentar um resumo diferente) sem re-farmar XP a
    # cada chamada.
    is_first_summary = note.summary is None

    result = ai_service.generate_summary(note.content, request.max_length)
    note.summary = result.summary
    note.mind_map = result.mind_map
    note.flashcards = result.flashcards
    db.commit()
    if is_first_summary:
        gamification_service.add_xp(current_user, 50, db)
    return result

# ============================================================
# ROUTES - TASKS
# ============================================================

@app.post("/api/v1/tasks", response_model=TaskResponse)
def create_task(task: TaskCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_task = Task(**task.dict(), user_id=current_user.id)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task

@app.get("/api/v1/tasks", response_model=List[TaskResponse])
def get_tasks(status: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Task).filter(Task.user_id == current_user.id)
    if status:
        query = query.filter(Task.status == status)
    return query.order_by(Task.due_date.asc()).all()

@app.put("/api/v1/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, task_update: TaskCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    for key, value in task_update.dict(exclude_unset=True).items():
        setattr(task, key, value)
    db.commit()
    db.refresh(task)
    return task

@app.put("/api/v1/tasks/{task_id}/complete")
def complete_task(task_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")

    # Sem essa checagem, chamar esta rota repetidas vezes na MESMA tarefa ja
    # concluida rendia 30 XP de novo a cada chamada - um jeito trivial de
    # farmar XP infinito (script batendo nesta rota em loop) sem nem precisar
    # criar tarefas novas.
    if task.status == "completed":
        return {"message": "Tarefa já estava concluída", "xp_earned": 0}

    task.status = "completed"
    task.completed_at = datetime.utcnow()
    db.commit()
    gamification_service.add_xp(current_user, 30, db)
    gamification_service.check_achievements(current_user, db)
    return {"message": "Tarefa concluída", "xp_earned": 30}

@app.delete("/api/v1/tasks/{task_id}")
def delete_task(task_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    db.delete(task)
    db.commit()
    return {"message": "Tarefa removida"}

# ============================================================
# ROUTES - STUDY PLAN
# ============================================================

@app.post("/api/v1/study-plans", response_model=StudyPlanResponse)
def create_study_plan(plan: StudyPlanCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    schedule = ai_service.generate_study_plan(
        plan.goal, plan.subjects, plan.start_date, plan.end_date, plan.daily_hours
    )

    db_plan = StudyPlan(
        user_id=current_user.id,
        title=plan.title,
        goal=plan.goal,
        start_date=plan.start_date,
        end_date=plan.end_date,
        daily_hours=plan.daily_hours,
        schedule=schedule
    )
    db.add(db_plan)
    db.commit()
    db.refresh(db_plan)
    return db_plan

@app.get("/api/v1/study-plans", response_model=List[StudyPlanResponse])
def get_study_plans(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(StudyPlan).filter(StudyPlan.user_id == current_user.id).all()

# ============================================================
# ROUTES - QUESTIONS
# ============================================================

@app.get("/api/v1/questions", response_model=List[QuestionResponse])
def get_questions(subject_id: Optional[int] = None, difficulty: Optional[str] = None, 
                  topic: Optional[str] = None, limit: int = 10,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Question)
    if subject_id:
        query = query.filter(Question.subject_id == subject_id)
    if difficulty:
        query = query.filter(Question.difficulty == difficulty)
    if topic:
        query = query.filter(Question.topic == topic)
    return query.limit(limit).all()

@app.post("/api/v1/questions/{question_id}/analyze", response_model=AIQuestionAnalysisResponse)
def analyze_question(question_id: int, request: AIQuestionAnalysisRequest, 
                     current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    question = db.query(Question).filter(Question.id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Questão não encontrada")

    result = ai_service.analyze_question(question, request.selected_option)
    if result.is_correct:
        gamification_service.add_xp(current_user, 20, db)
    return result

# ============================================================
# ROUTES - EXAMS
# ============================================================

@app.post("/api/v1/exams", response_model=ExamResponse)
def create_exam(exam: ExamCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_exam = Exam(**exam.dict(), user_id=current_user.id)
    db.add(db_exam)
    db.commit()
    db.refresh(db_exam)
    return db_exam

@app.get("/api/v1/exams", response_model=List[ExamResponse])
def get_exams(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Exam).filter(Exam.user_id == current_user.id).order_by(Exam.date.asc()).all()

@app.put("/api/v1/exams/{exam_id}", response_model=ExamResponse)
def update_exam(exam_id: int, exam_update: ExamCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == current_user.id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Prova não encontrada")
    for key, value in exam_update.dict(exclude_unset=True).items():
        setattr(exam, key, value)
    db.commit()
    db.refresh(exam)
    return exam

@app.delete("/api/v1/exams/{exam_id}")
def delete_exam(exam_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id, Exam.user_id == current_user.id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Prova não encontrada")
    db.delete(exam)
    db.commit()
    return {"message": "Prova removida"}

# ============================================================
# ROUTES - ESSAYS
# ============================================================

@app.post("/api/v1/essays", response_model=EssayResponse)
def create_essay(essay: EssayCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_essay = Essay(**essay.dict(), user_id=current_user.id)
    db.add(db_essay)
    db.commit()
    db.refresh(db_essay)
    return db_essay

@app.get("/api/v1/essays", response_model=List[EssayResponse])
def get_essays(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Essay).filter(Essay.user_id == current_user.id).order_by(Essay.created_at.desc()).all()

@app.put("/api/v1/essays/{essay_id}", response_model=EssayResponse)
def update_essay(essay_id: int, essay_update: EssayCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    essay = db.query(Essay).filter(Essay.id == essay_id, Essay.user_id == current_user.id).first()
    if not essay:
        raise HTTPException(status_code=404, detail="Redação não encontrada")
    essay.title = essay_update.title
    essay.content = essay_update.content
    # Editar o texto invalida a correção anterior — score/feedback antigos
    # não refletem mais o conteúdo atual.
    essay.score = None
    essay.feedback = None
    essay.corrections = None
    db.commit()
    db.refresh(essay)
    return essay

@app.delete("/api/v1/essays/{essay_id}")
def delete_essay(essay_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    essay = db.query(Essay).filter(Essay.id == essay_id, Essay.user_id == current_user.id).first()
    if not essay:
        raise HTTPException(status_code=404, detail="Redação não encontrada")
    db.delete(essay)
    db.commit()
    return {"message": "Redação removida"}

@app.post("/api/v1/essays/{essay_id}/correct", response_model=AIEssayCorrectionResponse)
async def correct_essay(essay_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Diferente da maioria das rotas com XP idempotente, esta chama uma API
    # externa gratuita (LanguageTool) em TODA chamada, mesmo quando a XP nao e'
    # mais concedida - sem rate limit, um script batendo aqui em loop consumia
    # a cota publica do LanguageTool sem limite, arriscando o servico inteiro
    # ser bloqueado (por IP) para todos os usuarios do app.
    _enforce_rate_limit("essay-correct", str(current_user.id), max_attempts=5, window_seconds=60)

    essay = db.query(Essay).filter(Essay.id == essay_id, Essay.user_id == current_user.id).first()
    if not essay:
        raise HTTPException(status_code=404, detail="Redação não encontrada")

    # So' premia XP na primeira correcao - alem de fechar a brecha de farm de
    # XP (chamar a rota em loop na mesma redacao), evita bater sem necessidade
    # no servico externo gratuito (LanguageTool) pra reprocessar o mesmo texto.
    is_first_correction = essay.score is None

    result = await ai_service.correct_essay(essay.content)
    essay.score = result.score
    essay.feedback = result.feedback
    essay.corrections = result.corrections
    db.commit()
    if is_first_correction:
        gamification_service.add_xp(current_user, 100, db)
    return result

# ============================================================
# ROUTES - STUDY SESSIONS
# ============================================================

@app.post("/api/v1/study-sessions")
def create_study_session(session: StudySessionCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_session = StudySession(**session.dict(), user_id=current_user.id)
    db.add(db_session)
    current_user.total_study_time += session.duration

    last_session = db.query(StudySession).filter(
        StudySession.user_id == current_user.id
    ).order_by(StudySession.date.desc()).first()

    if last_session:
        days_diff = (datetime.utcnow() - last_session.date).days
        if days_diff == 1:
            current_user.streak_days += 1
        elif days_diff > 1:
            current_user.streak_days = 1
    else:
        current_user.streak_days = 1

    db.commit()
    db.refresh(db_session)

    xp_earned = session.duration // 10
    gamification_service.add_xp(current_user, xp_earned, db)
    gamification_service.check_achievements(current_user, db)

    return {"session": db_session, "xp_earned": xp_earned, "streak": current_user.streak_days}

@app.get("/api/v1/study-sessions")
def get_study_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(StudySession).filter(StudySession.user_id == current_user.id).order_by(StudySession.date.desc()).all()

# ============================================================
# ROUTES - ENEM (simulado com questões reais via api.enem.dev)
# ============================================================
# O modelo EnemAttempt e' preenchido aqui, questão por questão, conforme o
# usuário responde o simulado no frontend (ver QuestionsScreen). Isso é o que
# alimenta as estatísticas reais de desempenho no ENEM (por área/ano), que
# antes não existiam mesmo com a tabela e os índices já criados.

@app.post("/api/v1/enem/attempts")
def record_enem_attempt(attempt: EnemAttemptCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Cada resposta certa rende XP - sem limite, um script poderia bater nesta
    # rota em loop (sem nem abrir o simulado de verdade) pra farmar XP infinito.
    # 60/min e' bem folgado pra uso real (mais rapido que qualquer humano
    # respondendo questoes de boa fe) mas barra um loop automatizado.
    _enforce_rate_limit("enem-attempt", str(current_user.id), max_attempts=60, window_seconds=60)

    db_attempt = EnemAttempt(**attempt.dict(), user_id=current_user.id)
    db.add(db_attempt)
    db.commit()
    db.refresh(db_attempt)
    if attempt.is_correct:
        gamification_service.add_xp(current_user, 5, db)
    return {"message": "Resposta registrada"}

@app.get("/api/v1/enem/stats", response_model=EnemStatsResponse)
def get_enem_stats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    attempts = db.query(EnemAttempt).filter(EnemAttempt.user_id == current_user.id).all()
    total_attempts = len(attempts)
    total_correct = sum(1 for a in attempts if a.is_correct)
    accuracy = (total_correct / total_attempts * 100) if total_attempts else 0.0

    by_discipline_raw: Dict[str, Dict[str, int]] = defaultdict(lambda: {"attempts": 0, "correct": 0})
    for a in attempts:
        bucket = by_discipline_raw[a.discipline]
        bucket["attempts"] += 1
        if a.is_correct:
            bucket["correct"] += 1

    by_discipline = [
        EnemDisciplineStats(
            discipline=discipline,
            attempts=data["attempts"],
            correct=data["correct"],
            accuracy=(data["correct"] / data["attempts"] * 100) if data["attempts"] else 0.0
        )
        for discipline, data in by_discipline_raw.items()
    ]

    return EnemStatsResponse(
        total_attempts=total_attempts,
        total_correct=total_correct,
        accuracy=round(accuracy, 1),
        by_discipline=by_discipline
    )

@app.post("/api/v1/enem/simulados", response_model=EnemSimuladoResponse)
def record_enem_simulado(payload: EnemSimuladoCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Chamado uma unica vez, quando o usuario encerra um simulado (ver
    # finishQuiz no frontend) - bem mais folgado que o limite de tentativas por
    # questao, ja que aqui so' esperamos 1 chamada por simulado completo.
    _enforce_rate_limit("enem-simulado", str(current_user.id), max_attempts=20, window_seconds=60)

    db_simulado = EnemSimulado(**payload.dict(), user_id=current_user.id)
    db.add(db_simulado)
    db.commit()
    db.refresh(db_simulado)
    return db_simulado

@app.get("/api/v1/enem/simulados", response_model=List[EnemSimuladoResponse])
def get_enem_simulados(limit: int = 20, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    safe_limit = max(1, min(limit, 100))
    return db.query(EnemSimulado).filter(EnemSimulado.user_id == current_user.id).order_by(EnemSimulado.created_at.desc()).limit(safe_limit).all()

# ============================================================
# ROUTES - AI
# ============================================================

@app.post("/api/v1/ai/explain", response_model=AIExplainResponse)
def ai_explain(request: AIExplainRequest, current_user: User = Depends(get_current_user)):
    return ai_service.explain_content(request.content, request.subject, request.level)

@app.post("/api/v1/ai/summarize", response_model=AISummaryResponse)
def ai_summarize(request: AISummaryRequest, current_user: User = Depends(get_current_user)):
    return ai_service.generate_summary(request.content, request.max_length)

@app.post("/api/v1/ai/essay-correction", response_model=AIEssayCorrectionResponse)
async def ai_essay_correction(request: AIEssayCorrectionRequest, current_user: User = Depends(get_current_user)):
    return await ai_service.correct_essay(request.content)

@app.post("/api/v1/ai/flashcards", response_model=AIFlashcardsResponse)
def ai_flashcards(request: AIFlashcardsRequest, current_user: User = Depends(get_current_user)):
    return AIFlashcardsResponse(flashcards=ai_service.generate_summary(request.content).flashcards)

# ============================================================
# ROUTES - STATS & GAMIFICATION
# ============================================================

@app.get("/api/v1/stats", response_model=StatsResponse)
def get_stats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return gamification_service.calculate_stats(current_user, db)

@app.get("/api/v1/achievements")
def get_achievements(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_achievements = db.query(UserAchievement).options(joinedload(UserAchievement.achievement)).filter(UserAchievement.user_id == current_user.id).all()
    all_achievements = db.query(Achievement).all()
    earned_ids = {ua.achievement_id for ua in user_achievements}

    return {
        "earned": [
            {
                "id": ua.achievement.id,
                "name": ua.achievement.name,
                "description": ua.achievement.description,
                "icon": ua.achievement.icon,
                "earned_at": ua.earned_at
            } for ua in user_achievements
        ],
        "available": [
            {
                "id": ach.id,
                "name": ach.name,
                "description": ach.description,
                "icon": ach.icon,
                "xp_reward": ach.xp_reward
            } for ach in all_achievements if ach.id not in earned_ids
        ]
    }

@app.get("/api/v1/leaderboard")
def get_leaderboard(db: Session = Depends(get_db)):
    # Rota publica, sem autenticacao - devolvia "username", mas no frontend o
    # username E' o proprio email do usuario (ver register() em api.js), entao
    # isto expunha o email real de todo mundo no top 10 para qualquer visitante
    # nao autenticado. full_name e' a informacao pensada para aparecer
    # publicamente (e' o mesmo campo ja validado contra linguagem impropria).
    users = db.query(User).order_by(User.xp.desc()).limit(10).all()
    return [
        {
            "rank": i + 1,
            "name": u.full_name,
            "level": u.level,
            "xp": u.xp,
            "streak_days": u.streak_days
        } for i, u in enumerate(users)
    ]

# ============================================================
# OCR & SCANNER
# ============================================================

@app.post("/api/v1/notes/scan")
async def scan_note(file: UploadFile = File(...), subject_id: Optional[int] = None,
                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB — evita ler um arquivo gigante inteiro pra memoria
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Arquivo muito grande (limite de 10MB)")
    ocr_text = f"[Texto extraido por OCR da imagem: {file.filename}]\n\n"
    ocr_text += "Conteudo reconhecido:\n"
    ocr_text += "- Conceito principal identificado\n"
    ocr_text += "- Formulas matematicas detectadas\n"
    ocr_text += "- Diagramas reconhecidos\n"

    note = Note(
        title=f"Scan: {file.filename}",
        content=ocr_text,
        ocr_text=ocr_text,
        image_url=f"/uploads/{file.filename}",
        subject_id=subject_id,
        user_id=current_user.id
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    gamification_service.add_xp(current_user, 25, db)
    return {"note": note, "ocr_text": ocr_text}

# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health_check():
    return {"status": "healthy", "version": "1.0.0", "service": "Study OS API"}

@app.get("/")
def root():
    if FRONTEND_DIR:
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
    return {
        "message": "Study OS API",
        "version": "1.0.0",
        "docs": "/docs",
        "features": [
            "IA para explicacoes",
            "Resumos e flashcards",
            "Planejamento automatico",
            "Scanner OCR",
            "Banco de questoes",
            "Simulados",
            "Correcao de redacao",
            "Pomodoro",
            "Gamificacao",
            "Estatisticas"
        ]
    }

# Precisa vir depois de todas as rotas /api/... acima: montagens sao
# avaliadas na ordem de registro, e uma rota exata como /api/v1/auth/login
# so' "vence" um mount em /js ou /css porque nao ha conflito de prefixo — mas
# manter isso no final do arquivo evita qualquer ambiguidade futura.
if FRONTEND_DIR and os.path.isdir(FRONTEND_DIR):
    app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="frontend-css")
    app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="frontend-js")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
