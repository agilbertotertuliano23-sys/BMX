"""
Cérebro pelo Gemini (API do Google AI Studio), por HTTP direto: só biblioteca padrão, nada para instalar.
Fala a mesma língua do runtime.py: status, latency, delta, usage, complete, error.

    GEMINI_API_KEY       chave do AI Studio (também aceita GOOGLE_API_KEY)
    BMX_GEMINI_MODEL     padrão gemini-2.5-flash (o plano gratuito é só da família Flash)
"""
import json
import os
import time
import urllib.error
import urllib.request

import cerebro_comum as comum

MODELO = os.environ.get("BMX_GEMINI_MODEL", "gemini-2.5-flash").strip()
BASE = os.environ.get("BMX_GEMINI_BASE", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
MAX_TOKENS = int(os.environ.get("BMX_MAX_TOKENS", "1500"))


def _chave():
    return (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()


def disponivel():
    return bool(_chave())


def _corpo(system, mensagens, pensar):
    cfg = {"maxOutputTokens": MAX_TOKENS}
    if not pensar:
        cfg["thinkingConfig"] = {"thinkingBudget": 0}     # a voz precisa de rapidez: sem pensar antes de responder
    return {
        "system_instruction": {"parts": [{"text": system or ""}]},
        "contents": [{"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]}
                     for m in comum.janela(mensagens)],
        "generationConfig": cfg,
    }


def _abrir(corpo):
    req = urllib.request.Request(
        f"{BASE}/models/{MODELO}:streamGenerateContent?alt=sse", data=json.dumps(corpo).encode("utf-8"),
        method="POST", headers={"content-type": "application/json", "x-goog-api-key": _chave()})
    return urllib.request.urlopen(req, timeout=60)


def _ler_erro(e):
    try:
        return (json.loads(e.read().decode("utf-8", "replace")).get("error") or {}).get("message") or ""
    except (ValueError, OSError):
        return ""


def _traduzir(codigo, bruta):
    if codigo in (401, 403) or (codigo == 400 and "api key" in bruta.lower()):
        return "A chave do Gemini (GEMINI_API_KEY) foi recusada: confira se está certa e ativa."
    if codigo == 404:
        return f"O modelo {MODELO} não existe para esta chave. Troque BMX_GEMINI_MODEL."
    if codigo == 429:
        return "O limite gratuito do Gemini foi atingido. Tente de novo em alguns instantes."
    return f"O Gemini respondeu {codigo}: {bruta[:160]}"


def run(message, session_id=None, system=None):
    comum.cancelar.clear()
    comum.em_curso.set()
    inicio = time.monotonic()
    sid, msgs = comum.abrir(session_id)
    msgs.append({"role": "user", "content": message})
    yield dict(t="status", model=MODELO, tools=0, mcp=[], permission="só leitura (sem ferramentas)",
               session_id=sid, runtime="gemini")
    texto, usado, motivo = [], {}, ""
    try:
        resposta = None
        for pensar in (False, True):
            try:
                resposta = _abrir(_corpo(system, msgs, pensar))
                break
            except urllib.error.HTTPError as e:
                bruta = _ler_erro(e)
                if not pensar and e.code == 400 and "thinking" in bruta.lower():
                    continue        # este modelo não deixa desligar o raciocínio: tenta de novo sem o ajuste
                yield dict(t="error", message=_traduzir(e.code, bruta))
                return
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                yield dict(t="error", message=f"Sem conexão com o Gemini: {str(e)[:120]}")
                return
        primeiro = True
        with resposta:
            for linha in resposta:
                if comum.cancelar.is_set():
                    break
                linha = linha.decode("utf-8", "replace").strip()
                if not linha.startswith("data:"):
                    continue
                try:
                    ev = json.loads(linha[5:])
                except ValueError:
                    continue
                usado = ev.get("usageMetadata") or usado
                motivo = (ev.get("promptFeedback") or {}).get("blockReason") or motivo
                for cand in ev.get("candidates") or []:
                    if cand.get("finishReason") not in (None, "STOP", "MAX_TOKENS", "FINISH_REASON_UNSPECIFIED"):
                        motivo = cand["finishReason"]
                    for parte in (cand.get("content") or {}).get("parts") or []:
                        if parte.get("text") and not parte.get("thought"):
                            if primeiro:
                                primeiro = False
                                yield dict(t="latency", ms=int((time.monotonic() - inicio) * 1000))
                            texto.append(parte["text"])
                            yield dict(t="delta", text=parte["text"])
        if not "".join(texto).strip():
            # bloqueado ou vazio (motivo: SAFETY, BLOCKLIST...): a tela nunca fica sem palavra
            yield dict(t="delta", text=comum.SEM_RESPOSTA)
        yield dict(t="usage", input_tokens=usado.get("promptTokenCount", 0),
                   output_tokens=usado.get("candidatesTokenCount", 0),
                   total_tokens=usado.get("totalTokenCount", 0))
        yield dict(t="complete", session_id=sid, ms=int((time.monotonic() - inicio) * 1000))
    finally:
        comum.fechar_turno(msgs, "".join(texto))
        comum.em_curso.clear()
