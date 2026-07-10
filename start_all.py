#!/usr/bin/env python3
"""
Study OS — inicializador único
Sobe o backend (FastAPI/uvicorn) e o frontend (servidor estático) juntos,
e encerra os dois de uma vez com CTRL+C.
"""

import os
import sys
import subprocess
import time
import signal
import socket
import webbrowser

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_PORT = int(os.environ.get("PORT", "3002"))
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "8000"))

processes = []


def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.connect_ex(("127.0.0.1", port)) == 0


def cleanup(*_):
    print("\n\n🛑 Encerrando Study OS...")
    for p in processes:
        if p.poll() is None:
            p.terminate()
    sys.exit(0)


def ensure_backend_deps():
    """Instala as dependências do backend se ainda não estiverem instaladas."""
    try:
        import fastapi  # noqa
        import uvicorn  # noqa
        import sqlalchemy  # noqa
        import jwt  # noqa
        import bcrypt  # noqa
        return True
    except ImportError:
        print("📦 Instalando dependências do backend (primeira execução)...")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--break-system-packages",
             "-r", os.path.join(BACKEND_DIR, "requirements.txt")],
        )
        return result.returncode == 0


def main():
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    print("\n" + "=" * 60)
    print("  📚 Study OS — iniciando backend + frontend")
    print("=" * 60 + "\n")

    if not ensure_backend_deps():
        print("⚠️  Não foi possível instalar as dependências do backend.")
        print("    Rode manualmente: cd backend && pip install -r requirements.txt")
        sys.exit(1)

    # Backend (FastAPI / uvicorn)
    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "0.0.0.0", "--port", str(BACKEND_PORT)],
        cwd=BACKEND_DIR,
    )
    processes.append(backend_proc)
    print(f"✅ Backend rodando em: http://localhost:{BACKEND_PORT}")
    print(f"   Documentação (Swagger): http://localhost:{BACKEND_PORT}/docs\n")

    time.sleep(2)

    # Frontend (servidor estático simples)
    if is_port_in_use(FRONTEND_PORT):
        print(f"⚠️  A porta {FRONTEND_PORT} já está em uso. O frontend não será iniciado novamente.")
        print("   Feche a instância antiga ou use outra porta definindo PORT=XXXX.")
    else:
        frontend_proc = subprocess.Popen(
            [sys.executable, "server.py"],
            cwd=ROOT,
            env={**os.environ, "PORT": str(FRONTEND_PORT)},
        )
        processes.append(frontend_proc)

    print(f"✅ Frontend rodando em: http://localhost:{FRONTEND_PORT}\n")
    print("⌨️  Pressione CTRL+C para parar os dois servidores\n")
    print("=" * 60 + "\n")

    try:
        while True:
            time.sleep(1)
            for p in processes:
                if p.poll() is not None:
                    print("⚠️  Um dos servidores parou inesperadamente. Encerrando tudo.")
                    cleanup()
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
