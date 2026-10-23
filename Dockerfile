# BMX na nuvem (Render free / Hugging Face Spaces). Só biblioteca padrão: não há pip install.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    BMX_CLOUD=1 BMX_BRAIN=gemini BMX_OPEN=0

RUN useradd --create-home --uid 10001 bmx
WORKDIR /app
# /app precisa ser do usuário bmx: o servidor grava state.json, voz_cache e o prontuário aqui.
RUN chown bmx:bmx /app
COPY --chown=bmx:bmx . /app
USER bmx

EXPOSE 10000
CMD ["python", "server.py"]
