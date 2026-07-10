---
title: Study OS
emoji: 📚
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# 📚 Study OS — Versão Web

Plataforma de estudos com planejamento, gamificação e integração com o banco
de questões público do ENEM — SPA em HTML/CSS/JS puro (sem build step) por
cima de uma API FastAPI.

> ⚠️ **Sobre a "IA" deste projeto**: os recursos de explicação de conteúdo,
> resumo, flashcards e análise de questões (`AIService` em
> `backend/app/main.py`) usam respostas geradas por template, não um modelo de
> linguagem de verdade — servem como estrutura pronta para plugar uma IA real
> (ex.: API da OpenAI/Anthropic) depois. A **correção de redação** é a exceção:
> ela já usa uma verificação gramatical real via [LanguageTool](https://languagetool.org)
> (API pública gratuita), mas não avalia argumentação/coesão como um professor
> faria — isso fica claro no feedback devolvido ao usuário.

## ✨ Funcionalidades

- Autenticação por JWT (registro/login)
- Dashboard com estatísticas reais (nível, XP, sequência, gráfico semanal)
- Anotações, tarefas e planos de estudo
- Questões reais de provas passadas do ENEM (2009–2023) via [api.enem.dev](https://enem.dev), somente leitura e sem depender do backend
- Redações com correção gramatical automática
- Agenda de provas
- Gamificação (níveis, XP, conquistas, sequência de estudo)
- Responsivo (desktop/tablet/mobile)

## 🚀 Rodando localmente

### Tudo junto (recomendado)

```bash
python3 start_all.py
```

Instala as dependências do backend (primeira vez), sobe a API FastAPI em
`http://localhost:8000` e o frontend em `http://localhost:3000`, e abre o
navegador. `CTRL+C` encerra os dois processos.

### Manual (dois terminais)

```bash
# Terminal 1 — backend
cd backend
pip install -r requirements.txt
# Linux com Python gerenciado pelo sistema (PEP 668)? use:
# pip install -r requirements.txt --break-system-packages
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Documentação (Swagger): http://localhost:8000/docs

# Terminal 2 — frontend
python3 server.py
# http://localhost:3000
```

Para rodar os testes do backend (`pytest`), instale as dependências de
desenvolvimento primeiro: `pip install -r backend/requirements-dev.txt`.

### Variáveis de ambiente do backend

Copie `backend/.env.example` para `backend/.env` e ajuste `SECRET_KEY`
(gere uma com `python -c "import secrets; print(secrets.token_hex(32))"`).
Sem isso o backend funciona, mas gera uma chave aleatória a cada restart —
todos os tokens de login emitidos antes ficam inválidos.

## 🐳 Docker (dois containers, para dev/produção "de verdade")

```bash
docker-compose up --build
```

Sobe o backend (`backend/Dockerfile`) e o frontend com nginx na frente
(`Dockerfile.frontend`) como containers separados — frontend em
`http://localhost`, backend em `http://localhost:8000`. Defina `SECRET_KEY`
no seu shell antes de subir (veja comentário em `docker-compose.yml`), senão
o backend gera uma chave aleatória a cada restart do container.

## 🤗 Deploy no Hugging Face Spaces

O Hugging Face Spaces (SDK Docker) só expõe **um** container/porta por Space,
então existe um `Dockerfile` na raiz do projeto separado do fluxo acima: ele
empacota backend e frontend no mesmo processo (o próprio `uvicorn` serve os
arquivos estáticos via `FRONTEND_DIR`, ver `backend/app/main.py`), escutando
na porta `7860` esperada pela plataforma.

1. Crie um Space novo em [huggingface.co/new-space](https://huggingface.co/new-space) com **SDK: Docker**.
2. Suba o conteúdo deste repositório para o Space (via `git push` ao remoto do
   Space, ou pelo upload de arquivos na aba "Files").
3. Em **Settings → Repository secrets**, defina `SECRET_KEY` (mesmo comando
   acima para gerar um valor aleatório). Sem isso o Space ainda funciona, mas
   invalida os logins a cada rebuild.
4. Aguarde o build — o Space fica acessível na URL padrão
   `https://huggingface.co/spaces/<seu-usuario>/<nome-do-space>`.

**Armazenamento é efêmero por padrão**: no tier gratuito, o SQLite em
`/app/data/study_os.db` some a cada rebuild/restart do Space, a não ser que
você ative "Persistent Storage" nas configurações do Space. Aceitável para
uma demo pública; para persistência real, ative esse recurso ou troque
`DATABASE_URL` por um Postgres gerenciado gratuito (ex.: [Supabase](https://supabase.com/database)
ou [Neon](https://neon.tech) — veja `backend/.env.example`). O driver já vem
no `requirements.txt`, então basta definir o secret `DATABASE_URL` com a
connection string do provedor escolhido.

## 🔧 Arquitetura

```
study-os-web/
├── start_all.py              # Sobe backend + frontend juntos (dev local)
├── server.py                 # Servidor estático do frontend (dev manual)
├── Dockerfile                # Imagem única (backend serve o frontend) — Hugging Face Spaces
├── Dockerfile.frontend        # Imagem só do frontend (nginx) — usada pelo docker-compose
├── docker-compose.yml        # Backend + frontend como containers separados (dev/prod local)
├── nginx.conf                 # Config do nginx usada por Dockerfile.frontend
├── index.html
├── css/styles.css
├── js/
│   ├── config.js              # Endpoints da API, feature flags, chaves de storage
│   ├── api.js                  # Cliente HTTP (JWT automático, timeout, erros)
│   ├── state.js                 # Estado reativo + persistência em localStorage
│   ├── components.js            # Componentes reutilizáveis (Card, Modal, Alert...)
│   ├── screens.js                # Telas (Login, Dashboard, Notas, Tarefas, Estatísticas...)
│   └── app.js                     # Router + bootstrap da aplicação
└── backend/
    ├── app/main.py             # API FastAPI (modelos, rotas, IA, gamificação)
    ├── requirements.txt        # Dependências de produção
    ├── requirements-dev.txt    # + pytest, para rodar a suíte de testes
    ├── tests/                  # Testes (pytest)
    └── .env.example             # Template de configuração
```

## ⚙️ Endpoints principais (prefixo `/api/v1`)

| Área | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET/PUT /auth/me`, `POST /auth/change-password`, `POST /auth/me/avatar` |
| Matérias | `GET/POST /subjects`, `DELETE /subjects/{id}` |
| Anotações | `GET/POST/PUT/DELETE /notes`, `POST /notes/{id}/summarize`, `POST /notes/scan` |
| Tarefas | `GET/POST/PUT/DELETE /tasks`, `PUT /tasks/{id}/complete` |
| Planos de estudo | `GET/POST /study-plans` |
| Questões | `GET /questions`, `POST /questions/{id}/analyze` |
| Provas | `GET/POST/PUT/DELETE /exams` |
| Redações | `GET/POST/PUT/DELETE /essays`, `POST /essays/{id}/correct` |
| Sessões de estudo | `GET/POST /study-sessions` |
| ENEM | `POST /enem/attempts`, `GET /enem/stats`, `GET/POST /enem/simulados` |
| IA | `POST /ai/explain`, `POST /ai/summarize`, `POST /ai/essay-correction`, `POST /ai/flashcards` |
| Estatísticas | `GET /stats`, `GET /achievements`, `GET /leaderboard` |

Documentação interativa completa (Swagger) sempre em `/docs` no backend.

## 🔐 Autenticação

```javascript
const response = await api.login('usuario', 'senha');   // token salvo em localStorage automaticamente
if (api.isAuthenticated()) { /* ... */ }
await api.logout();
```

## 📄 Licença

MIT — veja [LICENSE](LICENSE).
