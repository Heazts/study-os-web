import app.main as main_module


# ============================================================
# AUTH
# ============================================================

def test_health_check(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"


def test_register_rejects_weak_password(client):
    resp = client.post("/api/v1/auth/register", json={
        "email": "weak@example.com", "username": "weakuser",
        "full_name": "Weak User", "password": "123"
    })
    assert resp.status_code == 422


def test_register_open_when_registration_code_not_configured(client, monkeypatch):
    monkeypatch.delenv("REGISTRATION_CODE", raising=False)
    resp = client.post("/api/v1/auth/register", json={
        "email": "semrestricao@example.com", "username": "semrestricao@example.com",
        "full_name": "Sem Restricao", "password": "senha12345"
    })
    assert resp.status_code == 200


def test_register_rejects_missing_or_wrong_registration_code(client, monkeypatch):
    monkeypatch.setenv("REGISTRATION_CODE", "codigo-secreto")

    missing = client.post("/api/v1/auth/register", json={
        "email": "semcodigo@example.com", "username": "semcodigo@example.com",
        "full_name": "Sem Codigo", "password": "senha12345"
    })
    assert missing.status_code == 403

    wrong = client.post("/api/v1/auth/register", json={
        "email": "codigoerrado@example.com", "username": "codigoerrado@example.com",
        "full_name": "Codigo Errado", "password": "senha12345",
        "registration_code": "chute-qualquer"
    })
    assert wrong.status_code == 403


def test_register_accepts_correct_registration_code(client, monkeypatch):
    monkeypatch.setenv("REGISTRATION_CODE", "codigo-secreto")
    resp = client.post("/api/v1/auth/register", json={
        "email": "codigocerto@example.com", "username": "codigocerto@example.com",
        "full_name": "Codigo Certo", "password": "senha12345",
        "registration_code": "codigo-secreto"
    })
    assert resp.status_code == 200


def test_register_rejects_invalid_email(client):
    resp = client.post("/api/v1/auth/register", json={
        "email": "not-an-email", "username": "bademailuser",
        "full_name": "Bad Email", "password": "senha12345"
    })
    assert resp.status_code == 422


def test_register_rejects_duplicate_email(client):
    payload = {"email": "dup@example.com", "username": "dupuser1",
               "full_name": "Dup User", "password": "senha12345"}
    first = client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 200

    second = client.post("/api/v1/auth/register", json=dict(payload, username="dupuser2"))
    assert second.status_code == 400


def test_cors_allows_only_configured_origins(client):
    allowed = client.get("/health", headers={"Origin": "https://heazts.github.io"})
    assert allowed.headers.get("access-control-allow-origin") == "https://heazts.github.io"

    blocked = client.get("/health", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in blocked.headers


def test_me_requires_authentication(client):
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_login_rate_limited_after_repeated_failures(client):
    client.post("/api/v1/auth/register", json={
        "email": "ratelimit@example.com", "username": "ratelimituser",
        "full_name": "Rate Limit", "password": "senha12345"
    })
    last_status = None
    for _ in range(15):
        last_status = client.post(
            "/api/v1/auth/login",
            data={"username": "ratelimituser", "password": "wrongpassword"}
        ).status_code
    assert last_status == 429


def test_register_rejects_offensive_full_name(client):
    resp = client.post("/api/v1/auth/register", json={
        "email": "nome1@example.com", "username": "nome1user",
        "full_name": "Joao Idiota", "password": "senha12345"
    })
    assert resp.status_code == 422


def test_register_rejects_offensive_username(client):
    resp = client.post("/api/v1/auth/register", json={
        "email": "nome2@example.com", "username": "otario",
        "full_name": "Nome Normal", "password": "senha12345"
    })
    assert resp.status_code == 422


def test_register_rejects_full_name_too_long(client):
    resp = client.post("/api/v1/auth/register", json={
        "email": "nome3@example.com", "username": "nome3user",
        "full_name": "A" * 101, "password": "senha12345"
    })
    assert resp.status_code == 422


def test_update_profile_rejects_offensive_full_name(auth_client):
    resp = auth_client.put("/api/v1/auth/me", json={"full_name": "Otario Supremo"})
    assert resp.status_code == 422

    # o perfil original nao deve ter sido alterado
    me = auth_client.get("/api/v1/auth/me")
    assert "Otario" not in me.json()["full_name"]


def test_update_profile_accepts_clean_full_name(auth_client):
    resp = auth_client.put("/api/v1/auth/me", json={"full_name": "Nome Atualizado"})
    assert resp.status_code == 200
    assert resp.json()["full_name"] == "Nome Atualizado"


# ============================================================
# SUBJECTS / NOTES / TASKS
# ============================================================

def test_delete_subject_unlinks_notes_and_tasks(auth_client):
    subject = auth_client.post("/api/v1/subjects", json={"name": "Historia"})
    assert subject.status_code == 200
    subject_id = subject.json()["id"]

    note = auth_client.post("/api/v1/notes", json={
        "title": "Nota", "content": "Conteudo", "subject_id": subject_id
    })
    assert note.status_code == 200
    note_id = note.json()["id"]

    delete = auth_client.delete(f"/api/v1/subjects/{subject_id}")
    assert delete.status_code == 200

    fetched = auth_client.get(f"/api/v1/notes/{note_id}")
    assert fetched.status_code == 200
    assert fetched.json()["subject_id"] is None


def test_task_priority_validation(auth_client):
    resp = auth_client.post("/api/v1/tasks", json={
        "title": "Tarefa invalida", "priority": "urgentissimo"
    })
    assert resp.status_code == 422


def test_complete_task_is_idempotent(auth_client):
    created = auth_client.post("/api/v1/tasks", json={"title": "Estudar Matematica"})
    assert created.status_code == 200
    task_id = created.json()["id"]

    first = auth_client.put(f"/api/v1/tasks/{task_id}/complete")
    assert first.status_code == 200
    assert first.json()["xp_earned"] == 30

    second = auth_client.put(f"/api/v1/tasks/{task_id}/complete")
    assert second.status_code == 200
    assert second.json()["xp_earned"] == 0


# ============================================================
# ESSAY CORRECTION (LanguageTool mockado + fallback offline)
# ============================================================

def test_essay_correction_uses_mocked_grammar_check(auth_client, monkeypatch):
    async def fake_correct_essay(content):
        return main_module.AIEssayCorrectionResponse(
            score=850, feedback="ok", corrections=[], suggestions=["tudo certo"]
        )
    monkeypatch.setattr(main_module.ai_service, "correct_essay", fake_correct_essay)

    create = auth_client.post("/api/v1/essays", json={
        "title": "Teste", "content": "Texto de teste da redacao."
    })
    assert create.status_code == 200
    essay_id = create.json()["id"]

    result = auth_client.post(f"/api/v1/essays/{essay_id}/correct")
    assert result.status_code == 200
    assert result.json()["score"] == 850

    # Segunda correcao nao deve quebrar (so' nao premia XP de novo - a
    # idempotencia de XP em si e' testada indiretamente aqui, o essencial e'
    # que a rota continua funcionando normalmente numa segunda chamada).
    result2 = auth_client.post(f"/api/v1/essays/{essay_id}/correct")
    assert result2.status_code == 200


def test_essay_correction_is_rate_limited(auth_client, monkeypatch):
    async def fake_correct_essay(content):
        return main_module.AIEssayCorrectionResponse(
            score=700, feedback="ok", corrections=[], suggestions=[]
        )
    monkeypatch.setattr(main_module.ai_service, "correct_essay", fake_correct_essay)

    create = auth_client.post("/api/v1/essays", json={
        "title": "Teste", "content": "Texto de teste da redacao."
    })
    essay_id = create.json()["id"]

    last_status = None
    for _ in range(10):
        last_status = auth_client.post(f"/api/v1/essays/{essay_id}/correct").status_code
    assert last_status == 429


def test_offline_essay_estimate_scores_longer_structured_text_higher():
    short_text = "Texto curto."
    short_result = main_module.AIService._offline_essay_estimate(short_text)
    assert short_result.score < 950
    assert "estimativa" in short_result.feedback.lower()

    long_text = "\n".join([
        "Paragrafo um com bastante conteudo relevante para o tema proposto. " * 5,
        "Paragrafo dois continuando a argumentacao com mais detalhes. " * 5,
        "Paragrafo tres trazendo contrapontos importantes para reflexao. " * 5,
        "Paragrafo quatro com a conclusao do texto e proposta de intervencao. " * 5,
    ])
    long_result = main_module.AIService._offline_essay_estimate(long_text)
    assert long_result.score > short_result.score
    assert long_result.score <= 950


# ============================================================
# ENEM - tentativas, estatisticas e historico de simulados
# ============================================================

def test_enem_attempt_and_stats(auth_client):
    resp = auth_client.post("/api/v1/enem/attempts", json={
        "year": 2022, "discipline": "matematica", "question_index": 1,
        "selected_letter": "A", "correct_letter": "A",
        "is_correct": True, "time_spent_seconds": 30
    })
    assert resp.status_code == 200

    stats = auth_client.get("/api/v1/enem/stats")
    assert stats.status_code == 200
    data = stats.json()
    assert data["total_attempts"] == 1
    assert data["total_correct"] == 1
    assert data["by_discipline"][0]["discipline"] == "matematica"


def test_enem_simulado_history_created_and_listed(auth_client):
    create = auth_client.post("/api/v1/enem/simulados", json={
        "year": 2022, "discipline": "matematica",
        "total_questions": 10, "correct_count": 7, "time_spent_seconds": 600
    })
    assert create.status_code == 200

    history = auth_client.get("/api/v1/enem/simulados")
    assert history.status_code == 200
    items = history.json()
    assert len(items) == 1
    assert items[0]["correct_count"] == 7
    assert items[0]["total_questions"] == 10


def test_enem_simulado_rejects_correct_count_above_total(auth_client):
    resp = auth_client.post("/api/v1/enem/simulados", json={
        "year": 2022, "discipline": "matematica",
        "total_questions": 5, "correct_count": 10, "time_spent_seconds": 100
    })
    assert resp.status_code == 422


def test_enem_simulados_ordered_most_recent_first(auth_client):
    auth_client.post("/api/v1/enem/simulados", json={
        "year": 2021, "discipline": "linguagens",
        "total_questions": 5, "correct_count": 2, "time_spent_seconds": 300
    })
    auth_client.post("/api/v1/enem/simulados", json={
        "year": 2023, "discipline": "matematica",
        "total_questions": 8, "correct_count": 6, "time_spent_seconds": 400
    })

    history = auth_client.get("/api/v1/enem/simulados").json()
    assert len(history) == 2
    assert history[0]["year"] == 2023
    assert history[1]["year"] == 2021


# ============================================================
# LEADERBOARD (rota publica, sem autenticacao)
# ============================================================

def test_leaderboard_does_not_expose_username_or_email(auth_client):
    # O frontend usa o proprio email como username (ver register() em
    # api.js), entao a rota publica (sem autenticacao) nao pode devolver nem
    # "username" nem "email" - so' "name" (full_name, ja validado contra
    # linguagem impropria). Checa a forma da resposta em vez de um usuario
    # especifico, ja que o banco de teste e' compartilhado entre os testes do
    # arquivo inteiro e o top-10 por xp varia conforme a ordem de execucao.
    resp = auth_client.get("/api/v1/leaderboard")
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) >= 1
    for entry in entries:
        assert set(entry.keys()) == {"rank", "name", "level", "xp", "streak_days"}
        assert "@" not in entry["name"]
