"""
Claude Code runtime for BMX — o agente pessoal de saúde.

Base: jarvis-claude-code (Itsme23476). Mudanças do BMX: roda no Windows (PATH
com os.pathsep, saída lida em UTF-8), tira ANTHROPIC_* do ambiente para a conta
nunca sair da assinatura, e o cérebro é só leitura — pesquisa na web e lê o
prontuário, mas não executa shell nem escreve arquivos.

The brain is your own `claude` CLI, running headless (`claude -p`) with
`--output-format stream-json`. That means it authenticates the same way your
normal Claude Code sessions do — your subscription, no API key, no per-token
billing — and it keeps the same tools, MCP servers, skills and CLAUDE.md
context that the interactive CLI has.

Never pass --bare: it forces ANTHROPIC_API_KEY auth and would bypass the
subscription this whole dashboard is built around.
"""
import collections
import json
import os
import shlex
import shutil
import subprocess
import threading
import time
import uuid

import memory

_ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("BMX_MODEL", "").strip()
# O modelo trabalha dentro de 40-Conhecimento: lê o catálogo anatômico e os
# guias com Read/Grep, mas não abre pacientes nem acessos por conta própria;
# o que ele sabe do paciente ativo chega pelo contexto montado no servidor.
_CONHECIMENTO = memory.VAULT / memory.ZONAS["conhecimento"]
WORKDIR = os.path.expanduser(os.environ.get("BMX_WORKDIR") or (
    str(_CONHECIMENTO) if _CONHECIMENTO.exists() else str(memory.VAULT)))
# Um agente de saúde não precisa de shell nem de escrita: as anotações do
# prontuário são gravadas pelos comandos locais (commands.py), não pelo modelo.
# Em `claude -p` uma ferramenta fora da lista é negada em silêncio, sem prompt.
PERMISSION = os.environ.get("BMX_PERMISSION", "default").strip()
ALLOWED_TOOLS = os.environ.get("BMX_ALLOWED_TOOLS", "WebSearch,WebFetch,Read,Glob,Grep").strip()
DISALLOWED_TOOLS = os.environ.get("BMX_DISALLOWED_TOOLS", "Bash,Edit,Write,NotebookEdit").strip()
RUNTIME = os.environ.get("BMX_RUNTIME", "auto").strip().lower()   # auto|claude|mock
# Cérebro: auto (o `claude` do PC; sem ele, como na nuvem, a API que tiver chave) | claude | anthropic | gemini | mock
BRAIN = os.environ.get("BMX_BRAIN", "auto").strip().lower()
IDLE_TIMEOUT = int(os.environ.get("BMX_TIMEOUT", "180"))
RAW_LOG = os.environ.get("BMX_RAW_LOG", "").strip()

# O CLI prefere em silêncio uma ANTHROPIC_API_KEY herdada ao login da assinatura
# (ideia do ethanplusai/jarvis). CLAUDECODE é tirado para o `claude` filho não
# se recusar a rodar quando o servidor foi aberto de dentro do Claude Code.
_SCRUB_PREFIXES = ("ANTHROPIC_", "CLAUDE_CODE_")
_SCRUB_KEYS = {"CLAUDECODE"}


def child_env():
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(_SCRUB_PREFIXES) and k not in _SCRUB_KEYS}
    home = os.path.expanduser("~")
    extra = [os.path.join(home, ".local", "bin"), os.path.join(home, ".npm-global", "bin")]
    if os.name != "nt":
        extra += ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    env["PATH"] = os.pathsep.join(dict.fromkeys([env.get("PATH", "")] + extra))
    env["PYTHONIOENCODING"] = "utf-8"
    return env

# One Claude subprocess at a time: session state is shared, and the browser
# Escape key must be able to kill real backend work, not just the fetch.
EXECUTION_LOCK = threading.RLock()
_ACTIVE_PROC = None
_ACTIVE_LOCK = threading.Lock()

# Hook chatter and internal bookkeeping the HUD should never render.
_NOISE_SUBTYPES = {"hook_started", "hook_response", "post_turn_summary",
                   "compact_boundary", "mcp_status"}


def cancel_active():
    import cerebro_comum                 # cérebros por API: avisa o laço da resposta para parar
    if cerebro_comum.em_curso.is_set():
        cerebro_comum.cancelar.set()
        return True
    with _ACTIVE_LOCK:
        proc = _ACTIVE_PROC
    if proc is None or proc.poll() is not None:
        return False
    try:
        proc.terminate()
        return True
    except Exception:
        return False


def valid_session(sid):
    """Claude Code session ids are UUIDs."""
    try:
        return bool(sid) and str(uuid.UUID(str(sid))) == str(sid).lower()
    except (ValueError, AttributeError, TypeError):
        return False


def _claude_base():
    configured = os.environ.get("CLAUDE_CMD", "").strip()
    if configured:
        return shlex.split(configured, posix=os.name != "nt")
    exe = shutil.which("claude")
    if exe:
        return [exe]
    for local in ("~/.local/bin/claude.exe", "~/.local/bin/claude"):
        local = os.path.expanduser(local)
        if os.path.exists(local):
            return [local]
    return ["claude"]


def _can_launch():
    try:
        p = subprocess.run(_claude_base() + ["--version"], cwd=WORKDIR, text=True,
                           encoding="utf-8", errors="replace", env=child_env(),
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        return p.returncode == 0, (p.stdout or p.stderr).strip()
    except Exception as e:  # noqa: BLE001
        return False, str(e)


_PROBE = {"at": 0.0, "result": None}


def _probe():
    """`claude --version` custa ~1 s no Windows; o status é pedido a cada 20 s."""
    if _PROBE["result"] is None or time.monotonic() - _PROBE["at"] > 60:
        _PROBE.update(at=time.monotonic(), result=_can_launch())
    return _PROBE["result"]


_MOTIVO_API = {}


def _api(kind):
    """Módulo do cérebro por API, carregado sob demanda (o da Anthropic precisa do SDK instalado)."""
    import importlib
    try:
        return importlib.import_module("cerebro_" + kind)
    except ImportError as e:
        _MOTIVO_API[kind] = f"{kind}: faltou instalar ({e})"
        return None


def _api_pronta(kind):
    m = _api(kind)
    return bool(m and m.disponivel())


def runtime_kind():
    """'claude' (CLI da assinatura), 'anthropic', 'gemini' ou 'mock' (sem cérebro)."""
    if RUNTIME in ("mock", "claude"):
        return RUNTIME
    if BRAIN in ("anthropic", "gemini"):
        return BRAIN if _api_pronta(BRAIN) else "mock"
    if BRAIN == "mock":
        return "mock"
    ok, _ = _probe()
    if ok or BRAIN == "claude":
        return "claude" if ok else "mock"
    return next((k for k in ("anthropic", "gemini") if _api_pronta(k)), "mock")   # auto, sem o `claude`


def version():
    kind = runtime_kind()
    if kind in ("anthropic", "gemini"):
        return _api(kind).MODELO
    ok, detail = _probe()
    return detail if ok else "unavailable"


def modelo():
    kind = runtime_kind()
    return _api(kind).MODELO if kind in ("anthropic", "gemini") else (MODEL or "Claude default")


def ferramentas():
    return ALLOWED_TOOLS if runtime_kind() == "claude" else "nenhuma (o contexto vem do servidor)"


def descricao():
    kind = runtime_kind()
    if kind == "claude":
        return f"Claude Code {version()} — sua assinatura, sem chave de API"
    if kind == "anthropic":
        return f"API da Anthropic — {modelo()}"
    if kind == "gemini":
        return f"API do Gemini — {modelo()}"
    return "MOCK — sem cérebro: o claude não foi achado e nenhuma chave de API está configurada"


def build_command(message, session_id=None, system=None):
    cmd = _claude_base() + [
        "-p", message,
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
    ]
    if valid_session(session_id):
        cmd += ["--resume", str(session_id)]
    if MODEL:
        cmd += ["--model", MODEL]
    if PERMISSION:
        cmd += ["--permission-mode", PERMISSION]
    if ALLOWED_TOOLS:
        cmd += ["--allowedTools", ALLOWED_TOOLS]
    if DISALLOWED_TOOLS:
        cmd += ["--disallowedTools", DISALLOWED_TOOLS]
    # Sem MCP: o BMX não usa os conectores da conta, e subir 8 servidores MCP a
    # cada pergunta custa segundos e RAM. BMX_MCP=1 devolve os conectores.
    if os.environ.get("BMX_MCP", "0") != "1":
        cmd += ["--strict-mcp-config"]
    # Sem as configurações de usuário (plugins, hooks, memória entre sessões como
    # o claude-mem): num agente de saúde, contexto de outra conversa vazando para
    # a resposta é erro clínico. O login da assinatura não depende disso.
    sources = os.environ.get("BMX_SETTING_SOURCES", "project,local").strip()
    if sources:
        cmd += ["--setting-sources", sources]
    if system:
        cmd += ["--append-system-prompt", system]
    return cmd


def _short(value, limit=90):
    """Collapse a tool input dict into one readable line for the action log."""
    if isinstance(value, dict):
        for key in ("command", "query", "prompt", "file_path", "pattern", "path", "url"):
            if key in value and isinstance(value[key], str):
                value = value[key]
                break
        else:
            value = json.dumps(value)
    text = " ".join(str(value).split())
    return text[:limit] + ("…" if len(text) > limit else "")


def run_claude(message, session_id=None, system=None):
    with EXECUTION_LOCK:
        yield from _run_locked(message, session_id, system)


def _run_locked(message, session_id=None, system=None):
    global _ACTIVE_PROC
    started = time.monotonic()
    cmd = build_command(message, session_id, system)

    os.makedirs(WORKDIR, exist_ok=True)
    try:
        proc = subprocess.Popen(cmd, cwd=WORKDIR, text=True, bufsize=1,
                                encoding="utf-8", errors="replace",
                                stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=child_env())
        with _ACTIVE_LOCK:
            _ACTIVE_PROC = proc
    except FileNotFoundError:
        raise RuntimeError("claude CLI not found. Install Claude Code or set CLAUDE_CMD.")

    q = collections.deque()
    lock = threading.Lock()
    done = threading.Event()
    errbuf = collections.deque(maxlen=120)
    raw = None
    if RAW_LOG:
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(os.path.expanduser(RAW_LOG), flags, 0o600)
        raw = os.fdopen(fd, "w", encoding="utf-8", errors="replace")

    def pump_out():
        try:
            for ln in proc.stdout:
                if raw:
                    raw.write(ln); raw.flush()
                with lock:
                    q.append(ln)
        finally:
            done.set()

    def pump_err():
        try:
            for ln in proc.stderr:
                errbuf.append(ln.rstrip())
        except Exception:
            pass

    threading.Thread(target=pump_out, daemon=True).start()
    threading.Thread(target=pump_err, daemon=True).start()

    emitted_session = session_id
    last_usage = {}
    streamed_text = False       # partial deltas arrived -> ignore final text blocks
    text_seen = False
    first = True
    last = time.monotonic()

    try:
        while not done.is_set() or q:
            line = None
            with lock:
                if q:
                    line = q.popleft()
            if line is None:
                if proc.poll() is not None and done.is_set():
                    break
                if time.monotonic() - last > IDLE_TIMEOUT:
                    proc.kill()
                    yield dict(t="error", message=(
                        f"O Claude ficou {IDLE_TIMEOUT}s sem responder e foi parado. "
                        + " | ".join(list(errbuf)[-3:]))[:400])
                    return
                time.sleep(0.04)
                continue
            last = time.monotonic()
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue

            kind = ev.get("type")
            sid = ev.get("session_id")
            if valid_session(sid):
                emitted_session = sid

            if kind == "system":
                if ev.get("subtype") == "init":
                    yield dict(t="status", model=ev.get("model") or MODEL or "Claude default",
                               tools=len(ev.get("tools") or []),
                               mcp=[s.get("name") for s in (ev.get("mcp_servers") or [])],
                               permission=ev.get("permissionMode") or PERMISSION,
                               session_id=sid, runtime="claude")
                continue

            if kind == "rate_limit_event":
                info = ev.get("rate_limit_info") or {}
                yield dict(t="ratelimit", status=info.get("status"),
                           window=info.get("rateLimitType"), resets=info.get("resetsAt"))
                continue

            if kind == "stream_event":
                inner = ev.get("event") or {}
                if inner.get("type") == "content_block_delta":
                    delta = inner.get("delta") or {}
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        if first:
                            first = False
                            yield dict(t="latency", ms=int((time.monotonic() - started) * 1000))
                        streamed_text = True
                        text_seen = True
                        yield dict(t="delta", text=delta["text"])
                continue

            if kind == "assistant":
                u = (ev.get("message") or {}).get("usage") or {}
                if u:
                    last_usage = u
                for block in (ev.get("message") or {}).get("content") or []:
                    btype = block.get("type")
                    if btype == "text" and not streamed_text and block.get("text"):
                        if first:
                            first = False
                            yield dict(t="latency", ms=int((time.monotonic() - started) * 1000))
                        text_seen = True
                        yield dict(t="delta", text=block["text"])
                    elif btype == "tool_use":
                        yield dict(t="tool", phase="use", name=block.get("name", "tool"),
                                   input=_short(block.get("input", "")))
                continue

            if kind == "user":
                for block in (ev.get("message") or {}).get("content") or []:
                    if block.get("type") == "tool_result":
                        yield dict(t="tool", phase="result",
                                   ok=not block.get("is_error"),
                                   name=block.get("name", ""))
                continue

            if kind == "result":
                usage = ev.get("usage") or last_usage or {}
                if ev.get("subtype") != "success" and not text_seen:
                    yield dict(t="error", message=str(ev.get("result") or "Claude returned an error")[:400])
                    return
                if not text_seen and ev.get("result"):
                    yield dict(t="delta", text=str(ev["result"]))
                    text_seen = True
                yield dict(t="usage",
                           input_tokens=usage.get("input_tokens", 0),
                           output_tokens=usage.get("output_tokens", 0),
                           total_tokens=(usage.get("input_tokens", 0) + usage.get("output_tokens", 0)))
                yield dict(t="complete", session_id=emitted_session,
                           ms=ev.get("duration_ms") or int((time.monotonic() - started) * 1000))
                return

        rc = proc.wait(timeout=5)
        if rc != 0:
            yield dict(t="error", message=(" | ".join(list(errbuf)[-6:])
                                           or f"claude exited with code {rc}")[:500])
            return
        if not text_seen:
            yield dict(t="delta", text="Terminei, mas sem resposta em texto.")
        yield dict(t="complete", session_id=emitted_session,
                   ms=int((time.monotonic() - started) * 1000))
    finally:
        try:
            if raw:
                raw.close()
        except Exception:
            pass
        if proc.poll() is None:
            proc.terminate()
        with _ACTIVE_LOCK:
            if _ACTIVE_PROC is proc:
                _ACTIVE_PROC = None


def run_mock(message, session_id=None, system=None):
    ok, detail = _can_launch()
    yield dict(t="error", message=("O Claude Code não está acessível a partir deste processo. "
                                   "Instale-o ou defina CLAUDE_CMD com o executável; ou use uma API: "
                                   "BMX_BRAIN=gemini (GEMINI_API_KEY) ou BMX_BRAIN=anthropic (ANTHROPIC_API_KEY). "
                                   f"Diagnóstico: {detail[:200]} {'; '.join(_MOTIVO_API.values())}"[:420]))


def run(message, session_id=None, system=None):
    kind = runtime_kind()
    if kind in ("anthropic", "gemini"):
        try:
            yield from _api(kind).run(message, session_id, system)
        except Exception as e:  # noqa: BLE001
            yield dict(t="error", message=f"não consegui usar o cérebro {kind}: {e}")
        return
    if kind != "claude":
        yield from run_mock(message, session_id, system)
        return
    try:
        yield from run_claude(message, session_id, system)
    except Exception as e:  # noqa: BLE001
        yield dict(t="error", message=f"não consegui iniciar o Claude: {e}")
