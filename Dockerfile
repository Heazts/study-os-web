# Imagem unica (backend + frontend no mesmo processo), pensada para o
# Hugging Face Spaces (SDK Docker): a plataforma so' expoe UM container/porta
# por Space, entao aqui o proprio uvicorn serve tanto a API (/api/...) quanto
# os arquivos estaticos do frontend (via FRONTEND_DIR, ver backend/app/main.py).
#
# Para desenvolvimento local com dois containers separados (mais parecido com
# producao "de verdade", com nginx na frente do frontend), use
# `docker-compose up`, que usa Dockerfile.frontend + backend/Dockerfile.

FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ ./app/
COPY index.html ./frontend/index.html
COPY css/ ./frontend/css/
COPY js/ ./frontend/js/

ENV FRONTEND_DIR=/app/frontend
# SQLite em /app/data: HF Spaces (tier gratuito) usa armazenamento efemero —
# os dados somem a cada rebuild/restart do Space, a nao ser que voce ative
# "Persistent Storage" nas configuracoes do Space. Aceitavel para uma demo
# publica; defina DATABASE_URL para outro destino se precisar de persistencia.
ENV DATABASE_URL=sqlite:////app/data/study_os.db

# Hugging Face Spaces roda o container como usuario nao-root.
RUN mkdir -p /app/data \
    && useradd -m -u 1000 appuser \
    && chown -R appuser:appuser /app
USER appuser

# Porta padrao esperada pelo SDK Docker do Hugging Face Spaces (tambem
# declarada em app_port no frontmatter do README.md).
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:7860/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
