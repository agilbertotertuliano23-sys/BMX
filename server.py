"""
BMX — agente pessoal de saúde, dirigido pelo Claude Code.
Base: jarvis-claude-code (Itsme23476) — HUD + grafo de memória + voz.

    python server.py      (ou start.bat)

The brain is your own `claude` CLI, so this inherits your subscription, your
tools, your MCP servers and your CLAUDE.md. The memory is a folder of markdown
you can open in Obsidian. Nothing is hosted; it binds to localhost only.
"""
import json
import re
import mimetypes
import os
import pathlib
import secrets
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = pathlib.Path(__file__).resolve().parent
UI = ROOT / "ui"

# O console do Windows (cp1252) quebra no banner com acentos e "─".
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

_env = ROOT / ".env"
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import anatomia    # noqa: E402
import casos       # noqa: E402
import clinica     # noqa: E402
import commands    # noqa: E402
import memory      # noqa: E402
import nuvem       # noqa: E402
import painel      # noqa: E402
import registro    # noqa: E402
import runtime     # noqa: E402
import safety      # noqa: E402
import voice       # noqa: E402

# O registro do Windows às vezes diz que .js é text/plain, e o navegador recusa
# módulo ES com MIME errado. Fixa os tipos que a interface usa.
for _ext, _type in {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                    ".glb": "model/gltf-binary", ".svg": "image/svg+xml", ".json": "application/json",
                    ".html": "text/html", ".webp": "image/webp"}.items():
    mimetypes.add_type(_type, _ext)

PORT = int(os.environ.get("BMX_PORT") or (os.environ.get("PORT") if nuvem.CLOUD else None) or 8740)
API_TOKEN = secrets.token_urlsafe(32)
RUN_LOCK = threading.Lock()
MAX_JSON = 1024 * 1024
MAX_AUDIO = 12 * 1024 * 1024
SESSION = {"id": None, "ultima": ""}   # ultima: última fala do BMX, para ler "sim"/"não" curtos


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("BMX_VERBOSE"):
            sys.stderr.write("  " + (fmt % args) + "\n")

    def _seg(self, cookie=None):
        for k, v in nuvem.cabecalhos_seguranca():
            self.send_header(k, v)
        if cookie:
            self.send_header("Set-Cookie", cookie)

    def _json(self, body, code=200, cookie=None):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._seg(cookie)
        self.end_headers()
        self.wfile.write(data)

    def _bytes(self, data, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._seg()
        self.end_headers()
        self.wfile.write(data)

    def _redirect(self, to, cookie=None):
        self.send_response(302)
        self.send_header("Location", to)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self._seg(cookie)
        self.end_headers()

    def _ip(self):
        return nuvem.ip_cliente(self.headers, self.client_address[0])

    def _logado(self):
        return nuvem.logado(self.headers.get("Cookie", ""))

    def _login(self, raw):
        """POST /login (só nuvem). Limite de tentativas antes de olhar a senha."""
        ip = self._ip()
        if nuvem.login_bloqueado(ip):
            return self._json({"error": "muitas tentativas"}, 429)
        try:
            senha = str(json.loads(raw or b"{}").get("senha") or "")
        except (json.JSONDecodeError, UnicodeDecodeError, AttributeError):
            return self._json({"error": "JSON inválido"}, 400)
        if not nuvem.senha_ok(senha, ip):
            registro.acesso("login_falhou")
            return self._json({"error": "senha incorreta"}, 401)
        registro.acesso("login")
        return self._json({"ok": True}, cookie=nuvem.novo_cookie())

    def _read(self, limit):
        n = int(self.headers.get("Content-Length", 0))
        if n < 0 or n > limit:
            raise ValueError("body too large")
        return self.rfile.read(n) if n else b""

    def _host_ok(self):
        return nuvem.host_ok(self.headers.get("Host", ""), PORT)

    def _origin_ok(self):
        return nuvem.origin_ok(self.headers.get("Origin", ""), PORT)

    def _token_ok(self):
        supplied = self.headers.get("X-BMX-Token", "")
        return bool(supplied) and secrets.compare_digest(supplied, API_TOKEN)

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/healthz":   # sonda do host: sem Host fixo, sem login, sem dados
            return self._bytes(b"ok", "text/plain")
        if not self._host_ok():
            return self._json({"error": "invalid host"}, 403)
        if nuvem.CLOUD:
            if p == "/login":
                return self._bytes(nuvem.LOGIN_HTML.encode("utf-8"), "text/html; charset=utf-8")
            if p == "/logout":
                return self._redirect("/login", cookie=nuvem.cookie_apagar())
            if not self._logado():
                if p.startswith("/api/") or p == "/ficha":
                    return self._json({"error": "unauthorized"}, 401)
                return self._redirect("/login")

        if p == "/api/status":
            g = memory.graph_view()
            return self._json(dict(
                runtime=runtime.runtime_kind(), version=runtime.version(),
                model=runtime.modelo(), permission=runtime.PERMISSION,
                workdir="nuvem" if nuvem.CLOUD else runtime.WORKDIR,
                vault="nuvem" if nuvem.CLOUD else g["vault"], notes=g["total"],
                links=len(g["links"]), voice=voice.describe(),
                listener=voice.describe_stt(), stt=voice.stt_kind(),
                server_stt=voice.stt_kind() in ("whisper", "fish"),
                server_voice=voice.available(), session=SESSION["id"]))

        if p == "/api/graph":
            force = parse_qs(urlparse(self.path).query).get("force", ["0"])[0] == "1"
            return self._json(memory.graph_view(force=force))

        if p == "/api/caso":
            cid = parse_qs(urlparse(self.path).query).get("id", [""])[0]
            return self._json(painel.dados(cid))

        if p == "/ficha":
            q = parse_qs(urlparse(self.path).query)
            cid = q.get("caso", [""])[0]
            html = painel.ficha_html(cid, q.get("hipoteses", ["0"])[0] == "1")
            if not html:
                return self._bytes("Caso não encontrado.".encode("utf-8"), "text/plain; charset=utf-8", 404)
            registro.acesso("ficha", caso=cid)
            return self._bytes(html.encode("utf-8"), "text/html; charset=utf-8")

        if p == "/api/note":
            title = parse_qs(urlparse(self.path).query).get("id", [""])[0].lower()
            for n in memory.build_graph()["nodes"]:
                if n["id"] == title:
                    registro.acesso("leitura_nota", nota=n["file"])
                    return self._json(n)
            return self._json({"error": "not found"}, 404)

        rel = "index.html" if p == "/" else p.lstrip("/")
        f = (UI / rel).resolve()
        if not f.is_relative_to(UI.resolve()) or not f.is_file():
            return self._bytes(b"not found", "text/plain", 404)
        data = f.read_bytes()
        if f.suffix == ".html":
            data = data.replace(b"__BMX_TOKEN__", API_TOKEN.encode())
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype == "application/json":
            ctype += "; charset=utf-8"
        return self._bytes(data, ctype)

    def do_POST(self):
        p = urlparse(self.path).path
        if not self._host_ok() or not self._origin_ok():
            return self._json({"error": "origin rejected"}, 403)
        if nuvem.CLOUD and p == "/login":
            try:
                return self._login(self._read(4096))
            except (TypeError, ValueError):
                return self._json({"error": "body too large"}, 413)
        if not self._logado() or not self._token_ok():
            return self._json({"error": "unauthorized"}, 401)
        if nuvem.uso_excedido(p):
            return self._json({"error": "limite de uso atingido, aguarde alguns minutos"}, 429)
        ctype = self.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if p in {"/api/run", "/api/speak", "/api/new", "/api/cancel"} and ctype != "application/json":
            return self._json({"error": "application/json required"}, 415)
        try:
            raw = self._read(MAX_AUDIO if p == "/api/listen" else MAX_JSON)
        except (TypeError, ValueError):
            return self._json({"error": "body too large"}, 413)

        if p == "/api/speak":
            try:
                text = (json.loads(raw or b"{}").get("text") or "").strip()
                return self._bytes(voice.speak(text), "audio/mpeg")
            except Exception as e:  # noqa: BLE001
                return self._json({"error": str(e)[:200]}, 503)

        if p == "/api/listen":
            try:
                return self._json({"text": voice.transcribe(raw, self.headers.get("Content-Type", "audio/webm"))})
            except Exception as e:  # noqa: BLE001
                return self._json({"error": str(e)[:400], "text": ""}, 503)

        if p == "/api/new":
            runtime.cancel_active()
            SESSION.update(id=None, ultima="")
            registro.novo_atendimento()
            casos.soltar()
            registro.acesso("nova_conversa")
            return self._json({"ok": True})

        if p == "/api/cancel":
            stopped = runtime.cancel_active()
            SESSION["id"] = None
            registro.novo_atendimento()
            registro.acesso("cancelar", interrompeu=stopped)
            return self._json({"ok": True, "stopped": stopped})

        if p == "/api/run":
            if not RUN_LOCK.acquire(blocking=False):
                return self._json({"error": "O BMX ainda está respondendo a pergunta anterior"}, 409)
            try:
                return self._stream(raw)
            finally:
                RUN_LOCK.release()

        return self._json({"error": "no such endpoint"}, 404)

    def _stream(self, raw):
        try:
            payload = json.loads(raw or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._json({"error": "JSON inválido (envie em UTF-8)"}, 400)
        message = (payload.get("message") or "").strip()
        if not message:
            return self._json({"error": "empty message"}, 400)
        if nuvem.CLOUD and len(message) > nuvem.MAX_MENSAGEM:
            return self._json({"error": "mensagem longa demais"}, 413)
        if payload.get("fresh"):
            SESSION["id"] = None

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(ev):
            self.wfile.write((json.dumps(ev) + "\n").encode())
            self.wfile.flush()

        original, comando = message, commands.nome(message)
        alert = safety.check(message)
        if alert:
            emit(dict(t="alert", **alert))

        cmd = commands.handle(message)
        if cmd:
            if cmd.get("alert"):
                emit(dict(t="alert", **cmd["alert"]))
            if cmd.get("note"):
                emit(dict(t="note", message=cmd["note"]))
            if cmd.get("fresh"):
                SESSION.update(id=None, ultima="")
                registro.novo_atendimento()
                casos.soltar()
            if cmd.get("message") is None:
                registro.acesso("comando", comando=comando, alerta=(alert or {}).get("level"))
            if cmd.get("focus"):
                emit(dict(t="focus", id=str(cmd["focus"]).lower()))
            if cmd.get("graph"):
                emit(dict(t="graph"))
            if cmd.get("caso"):
                emit(dict(t="caso", id=cmd["caso"], como="comando"))
            if cmd.get("ficha"):
                emit(dict(t="ficha", url=cmd["ficha"]))
            if cmd.get("message") is None:
                delay = float(cmd.get("delay") or 0)
                for event in cmd.get("events", []):
                    if delay and event.get("phase") == "result":
                        time.sleep(delay)
                        delay = 0
                    emit(event)
                emit(dict(t="delta", text=cmd.get("reply", "Done.")))
                emit(dict(t="complete", ms=0))
                return
            message = cmd["message"]

        # Relato -> estruturas anatômicas: a interface destaca, o modelo explica.
        rel = anatomia.relacionar(original)
        queixas = clinica.identificar(original)
        if queixas:
            emit(dict(t="queixa", queixas=clinica.resumo(queixas)))
        if rel:
            emit(dict(t="anatomia", regiao3d=anatomia.regiao_3d(rel["regioes"][0]) if rel["regioes"] else None, **rel))
        # Caso: o ativo, um aberto da mesma queixa/região (retoma) ou um novo (PRD, etapa 2).
        if comando in (None, "sintoma", "dor", "triagem"):
            caso, como = casos.resolver(original, queixas, rel)
        else:
            caso, como = casos.ativo(), "ativo"
        if caso:
            emit(dict(t="caso", id=caso["caso"], como=como, titulo=caso.get("queixa", "")))
        system = "\n\n".join(b for b in (commands.context_block(message, alert, rel, queixas),
                                         casos.contexto(caso, como)) if b) or None
        usadas = [n["title"] for n in memory.relevant(message)]
        hit = memory.top_match(message)
        if hit:
            emit(dict(t="focus", id=hit))
        resposta, status = [], "ok"
        try:
            for ev in runtime.run(message, SESSION["id"], system):
                if ev.get("t") == "delta":
                    resposta.append(ev.get("text") or "")
                if ev.get("t") == "complete" and runtime.valid_session(ev.get("session_id")):
                    SESSION["id"] = ev["session_id"]
                if ev.get("t") == "error":
                    SESSION["id"] = None
                    status = "erro"
                emit(ev)
        except (BrokenPipeError, ConnectionResetError):
            status = "interrompido"
        except Exception as e:  # noqa: BLE001
            status = "erro"
            try:
                emit(dict(t="error", message=str(e)[:300]))
            except OSError:
                pass
        # Operações e acessos ficam no cofre mesmo quando a resposta falha.
        try:
            registro.acesso("comando" if comando else "pergunta", comando=comando, status=status,
                            alerta=(alert or {}).get("level"), notas=len(usadas),
                            queixa=",".join(q["id"] for q in queixas),
                            estruturas=len(rel["estruturas"]) if rel else 0)
            texto = "".join(resposta) or f"(sem resposta: {status})"
            atendimento, analise = registro.turno(original, texto, alert, usadas, rel, comando,
                                                  clinica.resumo(queixas), caso["titulo"] if caso else None)
            if caso:
                dor = re.match(r"/dor\s+(\d{1,2})", original)
                casos.turno(caso, original, texto, atendimento, alert, queixas, rel, analise,
                            SESSION.get("ultima", ""),
                            int(dor.group(1)) if dor and int(dor.group(1)) <= 10 else None)
                memory.build_graph(force=True)
                emit(dict(t="caso", id=caso["caso"], como="atualizado", titulo=caso.get("queixa", "")))
            SESSION["ultima"] = texto
        except (OSError, ValueError) as e:
            sys.stderr.write(f"  registro falhou: {e}\n")


def main():
    commands.ensure_perfil()
    registro.acesso("servidor_inicio", porta=PORT)
    kind = runtime.runtime_kind()
    g = memory.graph_view(force=True)
    brain = runtime.descricao()
    print(f"""
  BMX · agente pessoal de saúde
  ────────────────────────────────────────────────
  cérebro      {brain}
  ferramentas  {runtime.ferramentas()} (sem shell, sem escrita)
  modelo       {runtime.modelo()}
  grafo        {g['total']} notas do caso · {len(g['links'])} ligações · paciente {g['paciente']}
  memória      {g['memoria']} notas no total (com guias e anatomia)
               {g['vault']}
  pensa em     {runtime.WORKDIR} (só leitura)
  voz          {voice.describe()}
  escuta       {voice.describe_stt()}
  abrir        http://localhost:{PORT}
""", flush=True)
    nuvem.validar_config()
    srv = ThreadingHTTPServer(("0.0.0.0" if nuvem.CLOUD else "127.0.0.1", PORT), Handler)
    if not nuvem.CLOUD and os.environ.get("BMX_OPEN", "1") != "0":
        webbrowser.open(f"http://localhost:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  BMX desligado.")
        srv.shutdown()


if __name__ == "__main__":
    main()
