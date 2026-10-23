"""
Cérebro pela API da Anthropic, com o SDK oficial (`pip install anthropic`). Fala a mesma língua do
runtime.py: status, latency, delta, usage, complete, error.

    ANTHROPIC_API_KEY      chave de API (console.anthropic.com), paga por uso
    BMX_ANTHROPIC_MODEL    padrão claude-sonnet-5-5: rápido e bom para interpretar casos. Para o mais
                           capaz, use claude-opus-5-5 (mais lento e mais caro)
    BMX_FALLBACK=off       desliga o reenvio automático a outro modelo quando o primeiro recusa

O modelo não usa ferramentas aqui: o servidor já monta persona, ficha fixa, caso e notas relevantes no
prompt de sistema. O SDK repete sozinho os erros passageiros (429, 5xx, conexão).
"""
import os
import time

import anthropic

import cerebro_comum as comum

MODELO = os.environ.get("BMX_ANTHROPIC_MODEL", "claude-sonnet-5-5").strip()
MAX_TOKENS = int(os.environ.get("BMX_MAX_TOKENS", "1500"))
FALLBACK = os.environ.get("BMX_FALLBACK", "on").strip().lower() != "off"
_cliente = None


def disponivel():
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def cliente():
    global _cliente
    if _cliente is None:
        _cliente = anthropic.Anthropic(timeout=90.0)       # chave e base_url vêm do ambiente
    return _cliente


def _parametros(system, mensagens, simples=False):
    p = dict(model=MODELO, max_tokens=MAX_TOKENS, system=system or "", messages=comum.janela(mensagens))
    if not simples:
        p["thinking"] = {"type": "between_tools"}      # sem pensar antes de responder: a voz precisa de rapidez
        p["output_config"] = {"effort": "low"}
    return p


def _tentativas(system, mensagens):
    """Do melhor para o mais simples: se a API recusar um parâmetro opcional, cai para o seguinte."""
    c = cliente()
    if FALLBACK:
        yield lambda: c.beta.messages.stream(betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                                             **_parametros(system, mensagens))
    yield lambda: c.messages.stream(**_parametros(system, mensagens))
    yield lambda: c.messages.stream(**_parametros(system, mensagens, simples=True))


def _eventos(abrir, texto, inicio):
    primeiro = True
    with abrir() as fluxo:
        for pedaco in fluxo.text_stream:
            if comum.cancelar.is_set():
                return None
            if primeiro:
                primeiro = False
                yield dict(t="latency", ms=int((time.monotonic() - inicio) * 1000))
            texto.append(pedaco)
            yield dict(t="delta", text=pedaco)
        return fluxo.get_final_message()


def run(message, session_id=None, system=None):
    comum.cancelar.clear()
    comum.em_curso.set()
    inicio = time.monotonic()
    sid, msgs = comum.abrir(session_id)
    msgs.append({"role": "user", "content": message})
    yield dict(t="status", model=MODELO, tools=0, mcp=[], permission="só leitura (sem ferramentas)",
               session_id=sid, runtime="anthropic")
    texto, final, ultimo = [], None, None
    try:
        for abrir in _tentativas(system, msgs):
            try:
                final = yield from _eventos(abrir, texto, inicio)
                ultimo = None
                break
            except (anthropic.BadRequestError, TypeError) as e:
                if texto:
                    raise
                ultimo = e          # parâmetro recusado pela API ou desconhecido do SDK instalado: forma mais simples
        if ultimo is not None:
            raise ultimo
        if final is not None and final.stop_reason == "refusal" and not "".join(texto).strip():
            yield dict(t="delta", text=comum.SEM_RESPOSTA)
        elif not "".join(texto).strip() and not comum.cancelar.is_set():
            yield dict(t="delta", text=comum.SEM_RESPOSTA)
        if final is not None:
            yield dict(t="usage", input_tokens=final.usage.input_tokens, output_tokens=final.usage.output_tokens,
                       total_tokens=final.usage.input_tokens + final.usage.output_tokens)
        yield dict(t="complete", session_id=sid, ms=int((time.monotonic() - inicio) * 1000))
    except anthropic.AuthenticationError:
        yield dict(t="error", message="A chave da Anthropic (ANTHROPIC_API_KEY) foi recusada: confira se está certa e ativa.")
    except anthropic.PermissionDeniedError:
        yield dict(t="error", message="A chave da Anthropic não tem permissão para este modelo.")
    except anthropic.NotFoundError:
        yield dict(t="error", message=f"O modelo {MODELO} não foi encontrado. Troque BMX_ANTHROPIC_MODEL.")
    except anthropic.RateLimitError:
        yield dict(t="error", message="O limite de uso da Anthropic foi atingido. Tente de novo em instantes.")
    except anthropic.BadRequestError as e:
        yield dict(t="error", message=f"A Anthropic recusou o pedido: {str(e.message)[:200]}")
    except anthropic.APIStatusError as e:
        yield dict(t="error", message=f"A Anthropic respondeu {e.status_code}: {str(e.message)[:160]}")
    except anthropic.APIConnectionError:
        yield dict(t="error", message="Sem conexão com a API da Anthropic.")
    finally:
        comum.fechar_turno(msgs, "".join(texto))
        comum.em_curso.clear()
