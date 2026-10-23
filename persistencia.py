"""
Cópia das fichas no Upstash Redis (plano grátis), para os cadastros sobreviverem quando o Render
hiberna e o disco é apagado. Só liga com UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN.

  bmx:reg        registro de nomes e aparelhos (usuarios.json)
  bmx:pac:<pid>  {"files": {"10-Pacientes/P0001/...md": texto}, "estado": {"meta": ..., "dor": [...]}}

Ao ligar o servidor, restaurar() devolve tudo ao disco; depois de cada atendimento, agendar(pid)
envia a ficha (com 3 s de espera, para juntar gravações seguidas).
"""
import json
import os
import re
import sys
import threading
import urllib.request

import commands
import memory
import usuarios

URL = os.environ.get("UPSTASH_REDIS_REST_URL", "").strip().rstrip("/")
TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
ESPERA = 3.0
MAX_BYTES = 900_000   # o Upstash grátis aceita até 1 MB por requisição

_PID = re.compile(r"^[A-Za-z0-9_-]{2,24}$")
_lock = threading.Lock()
_pendentes = set()
_timer = None


def ativo():
    return bool((URL.startswith("https://") or URL.startswith("http://127.0.0.1")) and TOKEN)


def _cmd(*args):
    req = urllib.request.Request(URL, data=json.dumps(list(args)).encode("utf-8"), method="POST",
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8")).get("result")


def _avisar(msg):
    sys.stderr.write(f"  persistência: {msg}\n")


def _arquivos(pid):
    pasta = memory.paciente_dir(pid)
    achados = list(pasta.rglob("*.md")) if pasta.exists() else []
    ops = memory.VAULT / memory.ZONAS["operacoes"]
    if ops.exists():
        achados += list(ops.rglob(f"*— {pid}.md"))
    return achados


def _foto(pid):
    arquivos = {p.relative_to(memory.VAULT).as_posix(): p.read_text(encoding="utf-8", errors="replace")
                for p in _arquivos(pid)}
    estado = commands.load()["pacientes"].get(pid, {})
    return json.dumps({"files": arquivos, "estado": estado}, ensure_ascii=False)


def salvar(pid):
    foto = _foto(pid)
    if len(foto.encode("utf-8")) > MAX_BYTES:
        return _avisar(f"ficha {pid} passou de 900 KB; não enviada")
    _cmd("SET", f"bmx:pac:{pid}", foto)
    _cmd("SET", "bmx:reg", usuarios.exportar())


def _enviar():
    global _timer
    with _lock:
        pids = list(_pendentes)
        _pendentes.clear()
        _timer = None
    for pid in pids:
        try:
            salvar(pid)
        except Exception as e:  # noqa: BLE001  (rede fora do ar não pode derrubar o atendimento)
            _avisar(f"falha ao salvar {pid}: {str(e)[:120]}")


def agendar(pid):
    """Pede para copiar a ficha em breve. Sem Upstash configurado, não faz nada."""
    global _timer
    if not ativo() or not pid:
        return
    with _lock:
        _pendentes.add(pid)
        if _timer is None:
            _timer = threading.Timer(ESPERA, _enviar)
            _timer.daemon = True
            _timer.start()


def _seguro(rel, pid):
    """Só aceita arquivos da pasta do paciente ou de operações dele: nada de sair do cofre."""
    if ".." in rel.split("/") or rel.startswith("/") or not rel.endswith(".md"):
        return False
    return rel.startswith(f"{memory.ZONAS['pacientes']}/{pid}/") or (
        rel.startswith(f"{memory.ZONAS['operacoes']}/") and rel.endswith(f"— {pid}.md"))


def restaurar():
    """Devolve ao disco o que está no Upstash. Devolve quantas fichas voltaram."""
    if not ativo():
        return 0
    try:
        reg = _cmd("GET", "bmx:reg")
        if reg:
            usuarios.importar(reg)
        n = 0
        for chave in _cmd("KEYS", "bmx:pac:*") or []:
            pid = chave.rsplit(":", 1)[-1]
            bruto = _cmd("GET", chave)
            if not (bruto and _PID.match(pid)):
                continue
            foto = json.loads(bruto)
            for rel, texto in (foto.get("files") or {}).items():
                if _seguro(rel, pid):
                    destino = memory.VAULT / rel
                    destino.parent.mkdir(parents=True, exist_ok=True)
                    destino.write_text(texto, encoding="utf-8")
            if foto.get("estado"):
                commands.update_state(lambda s, p=pid, e=foto["estado"]: s["pacientes"].__setitem__(p, e))
            n += 1
        return n
    except Exception as e:  # noqa: BLE001
        _avisar(f"não consegui restaurar: {str(e)[:160]}")
        return 0
