# 📚 Study OS

Plataforma pessoal de estudos com planejamento, gamificação e integração com
o banco de questões público do ENEM.

**Acesse em: https://heazts.github.io/study-os-web/**

> Cadastro é por convite — precisa do código de acesso para criar conta.

## ✨ Funcionalidades

- Autenticação por JWT (registro/login)
- Dashboard com estatísticas reais (nível, XP, sequência, gráfico semanal)
- Anotações, tarefas e planos de estudo
- Questões reais de provas passadas do ENEM (2009–2023) via [api.enem.dev](https://enem.dev)
- Redações com correção gramatical automática
- Agenda de provas
- Gamificação (níveis, XP, conquistas, sequência de estudo)
- Responsivo (desktop/tablet/mobile)

> ⚠️ **Sobre a "IA" deste projeto**: os recursos de explicação de conteúdo,
> resumo, flashcards e análise de questões usam respostas geradas por
> template, não um modelo de linguagem de verdade. A **correção de redação**
> é a exceção: usa verificação gramatical real via [LanguageTool](https://languagetool.org),
> mas não avalia argumentação/coesão como um professor faria — isso fica
> claro no feedback devolvido ao usuário.

<details>
<summary><strong>Detalhes técnicos</strong> (rodar localmente, deploy, arquitetura, endpoints)</summary>

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

Copie `backend/.env.example` para `backend/.env` e ajuste:
- `SECRET_KEY` — gere uma com `python -c "import secrets; print(secrets.token_hex(32))"`. Sem isso o backend funciona, mas gera uma chave aleatória a cada restart — todos os tokens de login emitidos antes ficam inválidos.
- `REGISTRATION_CODE` — se definida, exige esse código na tela de cadastro (uso pessoal/privado). Em branco, cadastro fica aberto.

## 🐳 Docker (dois containers, para dev/produção "de verdade")

```bash
docker-compose up --build
```

Sobe o backend (`backend/Dockerfile`) e o frontend com nginx na frente
(`Dockerfile.frontend`) como containers separados — frontend em
`http://localhost`, backend em `http://localhost:8000`. Defina `SECRET_KEY`
no seu shell antes de subir (veja comentário em `docker-compose.yml`), senão
o backend gera uma chave aleatória a cada restart do container.

## 🌐 Deploy 100% grátis (frontend no GitHub Pages + backend no Render)

Como o GitHub Pages só serve arquivos estáticos (não roda Python), o projeto
é pensado para rodar com frontend e backend em lugares separados:

**Frontend (GitHub Pages)**: Settings → Pages → Source: "Deploy from a
branch" → Branch: `main`, pasta `/ (root)`. Fica em
`https://<seu-usuario>.github.io/<repo>/`.

**Backend (Render)**: o Render tem tier gratuito real para Web Services
(750h/mês, o serviço "dorme" depois de 15 min sem uso — a primeira
requisição depois disso demora um pouco mais pra responder).

1. Crie o banco primeiro (Supabase ou Neon, veja abaixo) e tenha a connection string em mãos.
2. Em [render.com](https://render.com), **New +** → **Blueprint** → conecte
   este repositório. O `render.yaml` na raiz já configura o Web Service
   (`rootDir: backend`, build/start commands, `SECRET_KEY` gerada
   automaticamente) — só falta colar `DATABASE_URL` e `REGISTRATION_CODE`
   quando pedido.
3. Aguarde o deploy. A URL fica algo como `https://study-os-backend.onrender.com`.
4. Edite `js/config.js`: troque o placeholder pela URL real do seu Web
   Service, commit e push.

> **Nota sobre o Hugging Face Spaces**: o `Dockerfile` na raiz do projeto e a
> imagem unificada (backend + frontend no mesmo processo) foram pensados
> originalmente pra lá, mas a partir de julho de 2026 o SDK Docker do HF
> Spaces passou a exigir plano **PRO** mesmo no free tier (mudança recente e
> sem aviso oficial da própria Hugging Face). Se você tiver PRO ou essa
> política mudar de novo, o `Dockerfile` continua funcionando normalmente —
> as instruções antigas ficam abaixo.

<details>
<summary>Deploy no Hugging Face Spaces (requer plano PRO atualmente)</summary>

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

</details>

**Armazenamento é efêmero em qualquer uma dessas opções**: tanto o Render
quanto o HF Spaces (sem "Persistent Storage") apagam o SQLite a cada
rebuild/restart. Para persistência real, troque `DATABASE_URL` por um
Postgres gerenciado gratuito (ex.: [Supabase](https://supabase.com/database)
ou [Neon](https://neon.tech) — veja `backend/.env.example`). O driver já vem
no `requirements.txt`, então basta definir a variável `DATABASE_URL` com a
connection string do provedor escolhido.

## 🔒 Segurança

- **Cadastro por convite**: com `REGISTRATION_CODE` definida no backend, só
  quem souber o código consegue criar conta — pensado pra instância pessoal,
  não pra uso público geral.
- **CORS restrito**: só as origens listadas em `CORS_ORIGINS` (por padrão, o
  GitHub Pages deste projeto + localhost) podem chamar a API pelo navegador.
- **Rate limiting** em rotas sensíveis (login, cadastro, troca de senha,
  correção de redação) contra força bruta e abuso de APIs externas gratuitas.
- **Senhas com bcrypt**, tokens JWT assinados com `SECRET_KEY` própria.
- **Headers de segurança** (CSP, HSTS, X-Frame-Options, etc.) tanto na API
  (middleware) quanto no HTML (meta tags, já que o GitHub Pages não permite
  configurar headers HTTP customizados).
- **Sem PII em rotas públicas**: o leaderboard (sem autenticação) mostra só
  nome de exibição, nunca email/username.

## 🔧 Arquitetura

```
study-os-web/
├── start_all.py              # Sobe backend + frontend juntos (dev local)
├── server.py                 # Servidor estático do frontend (dev manual)
├── Dockerfile                # Imagem única (backend serve o frontend) — Hugging Face Spaces (requer PRO)
├── Dockerfile.frontend        # Imagem só do frontend (nginx) — usada pelo docker-compose
├── docker-compose.yml        # Backend + frontend como containers separados (dev/prod local)
├── render.yaml                # Blueprint do Render — deploy grátis do backend (ver seção de deploy)
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

</details>

## 📄 Licença

MIT — veja [LICENSE](LICENSE).
