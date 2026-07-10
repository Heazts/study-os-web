"""
Configuracao compartilhada dos testes.

Usa um banco SQLite temporario (nunca o study_os.db de desenvolvimento) e uma
SECRET_KEY fixa, definidos ANTES de importar app.main - o modulo cria a
engine/tabelas na hora do import, entao as variaveis de ambiente precisam
estar no lugar primeiro.
"""
import os
import shutil
import sys
import tempfile

_TEST_DB_DIR = tempfile.mkdtemp(prefix="study_os_test_")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_TEST_DB_DIR, 'test_study_os.db')}"
os.environ["SECRET_KEY"] = "test-secret-key-only-used-in-pytest"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from app.main import app, _rate_limit_hits


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    # O rate limiter e' um dict global em memoria (app.main._rate_limit_hits).
    # Sem limpar entre testes, chamadas de testes anteriores (ex.: varios
    # registros de usuario, todos com o mesmo client_host "testclient")
    # acabariam acionando o 429 em testes que nao tem nada a ver com rate
    # limiting, so' por causa da ordem em que os testes rodam.
    _rate_limit_hits.clear()
    yield


@pytest.fixture(scope="session", autouse=True)
def _cleanup_test_db():
    yield
    shutil.rmtree(_TEST_DB_DIR, ignore_errors=True)


_user_counter = 0


@pytest.fixture()
def auth_client(client):
    """Registra e loga um usuario novo (dados unicos por teste) e devolve o
    TestClient ja com o header Authorization configurado para esse usuario."""
    global _user_counter
    _user_counter += 1
    email = f"user{_user_counter}@example.com"
    username = f"user{_user_counter}"
    password = "senha12345"

    response = client.post("/api/v1/auth/register", json={
        "email": email,
        "username": username,
        "full_name": f"Usuario Teste {_user_counter}",
        "password": password
    })
    assert response.status_code == 200, response.text

    login = client.post("/api/v1/auth/login", data={"username": username, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client
