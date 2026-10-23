"""
Quem é quem na nuvem: nome -> ficha (paciente), aparelho -> ficha, PIN para entrar numa ficha existente.

  - o nome é comparado sem acento, caixa nem pontuação, e nomes parecidos pedem confirmação
    (para não duplicar a mesma pessoa);
  - cada aparelho recebe um identificador aleatório (cookie de 1 ano) ligado à ficha: o mesmo
    aparelho volta direto, sem perguntar o nome. O modelo do celular é só um rótulo, nunca a chave:
    dois celulares iguais não podem abrir o prontuário um do outro;
  - entrar numa ficha existente a partir de um aparelho novo exige o PIN criado no cadastro.

O registro fica em usuarios.json (BMX_USERS) e é copiado para o Upstash por persistencia.py.
"""
import datetime
import difflib
import hashlib
import hmac
import json
import os
import pathlib
import re
import secrets
import threading
import unicodedata
import uuid

import commands
import memory

ROOT = pathlib.Path(__file__).resolve().parent
ARQUIVO = pathlib.Path(os.environ.get("BMX_USERS", ROOT / "usuarios.json"))
_LOCK = threading.RLock()

PIN_RE = re.compile(r"^\d{4,6}$")
SEMELHANCA = 0.86
MAX_ITENS = 10
MAX_FICHAS = 200   # teto de fichas na nuvem: o disco e o Upstash grátis são pequenos


def _carregar():
    try:
        d = json.loads(ARQUIVO.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        d = {}
    d.setdefault("pacientes", {})
    d.setdefault("aparelhos", {})
    return d


def _gravar(d):
    tmp = ARQUIVO.with_name(f".{ARQUIVO.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, ARQUIVO)
    finally:
        tmp.unlink(missing_ok=True)


def exportar():
    with _LOCK:
        return json.dumps(_carregar(), ensure_ascii=False)


def importar(texto):
    """Restaura o registro vindo do Upstash (só se o arquivo local ainda não existe)."""
    with _LOCK:
        if ARQUIVO.exists():
            return False
        d = json.loads(texto)
        d.setdefault("pacientes", {})
        d.setdefault("aparelhos", {})
        _gravar(d)
        return True


# ── nomes ──────────────────────────────────────────────────────────────────

def normalizar(nome):
    s = unicodedata.normalize("NFKD", nome or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s).split())


def _parecidos(a, b):
    if difflib.SequenceMatcher(None, a, b).ratio() >= SEMELHANCA:
        return True
    ta, tb = set(a.split()), set(b.split())
    menor, maior = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return len(menor) >= 2 and menor <= maior   # "maria silva" dentro de "maria souza silva"


def buscar(nome):
    """('existe', pid) | ('parecido', [(pid, nome)]) | ('novo', None)."""
    norm = normalizar(nome)
    with _LOCK:
        pac = _carregar()["pacientes"]
    for pid, p in pac.items():
        if p["norm"] == norm:
            return "existe", pid
    quase = [(pid, p["nome"]) for pid, p in pac.items() if _parecidos(norm, p["norm"])]
    return ("parecido", quase) if quase else ("novo", None)


def nome_de(pid):
    with _LOCK:
        return (_carregar()["pacientes"].get(pid) or {}).get("nome", "")


def existe(pid):
    with _LOCK:
        return pid in _carregar()["pacientes"]


def total():
    with _LOCK:
        return len(_carregar()["pacientes"])


# ── PIN ────────────────────────────────────────────────────────────────────

def _hash_pin(pin, sal):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(sal), 200_000).hex()


def verificar_pin(pid, pin):
    with _LOCK:
        guardado = (_carregar()["pacientes"].get(pid) or {}).get("pin", "")
    sal, _, h = guardado.partition("$")
    if not (sal and h and PIN_RE.match(pin or "")):
        return False
    return hmac.compare_digest(_hash_pin(pin, sal), h)


# ── aparelhos ──────────────────────────────────────────────────────────────

def novo_aparelho():
    return secrets.token_urlsafe(24)


def vinculado(aparelho, pid):
    with _LOCK:
        return pid in (_carregar()["aparelhos"].get(aparelho) or {}).get("pids", [])


def ultimo(aparelho):
    """Ficha em que este aparelho entrou da última vez (se ainda existir)."""
    with _LOCK:
        d = _carregar()
        pid = (d["aparelhos"].get(aparelho) or {}).get("ultimo")
        return pid if pid in d["pacientes"] else None


def vincular(aparelho, pid, modelo=""):
    with _LOCK:
        d = _carregar()
        a = d["aparelhos"].setdefault(aparelho, {"pids": []})
        if pid not in a["pids"]:
            a["pids"].append(pid)
        a.update(ultimo=pid, modelo=(modelo or a.get("modelo", ""))[:60],
                 visto=datetime.datetime.now().isoformat(timespec="minutes"))
        _gravar(d)


# ── cadastro ───────────────────────────────────────────────────────────────

def _lista(texto):
    itens = [i.strip() for i in re.split(r"[;\n,]+", texto or "") if i.strip()]
    return itens[:MAX_ITENS]


def validar(dados):
    """Devolve (limpo, erro). Tudo é texto curto: nada além do que a ficha usa."""
    def txt(k, n):
        return " ".join(str(dados.get(k) or "").split())[:n]
    nome = txt("nome", 80)
    if len(normalizar(nome)) < 2:
        return None, "Informe o nome."
    pin = str(dados.get("pin") or "")
    if not PIN_RE.match(pin):
        return None, "O PIN precisa ter de 4 a 6 números."
    try:
        idade = int(dados.get("idade"))
    except (TypeError, ValueError):
        return None, "Informe a idade em anos."
    if not 0 <= idade <= 120:
        return None, "Idade fora do esperado (0 a 120)."
    sexo = txt("sexo", 20)
    if sexo and sexo.lower() not in ("feminino", "masculino", "outro", "prefiro não informar"):
        return None, "Escolha uma das opções de sexo."
    return dict(nome=nome, idade=idade, sexo=sexo, pin=pin, peso=txt("peso", 10), altura=txt("altura", 10),
                contato=txt("contato", 120), alergias=_lista(txt("alergias", 400)),
                remedios=_lista(txt("remedios", 400)), condicoes=_lista(txt("condicoes", 400))), ""


def _proximo_pid(d):
    usados = {int(m.group(1)) for p in d["pacientes"] if (m := re.match(r"^P(\d{4})$", p))}
    pasta = memory.VAULT / memory.ZONAS["pacientes"]
    if pasta.exists():
        usados |= {int(m.group(1)) for x in pasta.iterdir() if (m := re.match(r"^P(\d{4})$", x.name))}
    return f"P{(max(usados) + 1 if usados else 1):04d}"


def criar(dados, aparelho, modelo=""):
    """Cria a ficha (pasta, perfil e notas de alergia, remédio e condição) e liga o aparelho."""
    with _LOCK:
        d = _carregar()
        pid = _proximo_pid(d)
        sal = secrets.token_hex(16)
        d["pacientes"][pid] = dict(nome=dados["nome"], norm=normalizar(dados["nome"]),
                                   pin=f"{sal}${_hash_pin(dados['pin'], sal)}",
                                   criado=datetime.date.today().isoformat())
        _gravar(d)
    memory.usar_paciente(pid)
    commands.ensure_perfil(pid, dados["nome"])
    _dados_no_perfil(pid, dados)
    for tipo, itens in (("alergia", dados["alergias"]), ("medicamento", dados["remedios"]),
                        ("condicao", dados["condicoes"])):
        for item in itens:
            commands.write_note(tipo, item, "informado no cadastro")
    vincular(aparelho, pid, modelo)
    return pid


def _dados_no_perfil(pid, dados):
    f = memory.paciente_dir(pid) / f"{commands.PERFIL}.md"
    texto = f.read_text(encoding="utf-8")
    extra = [f"idade: {dados['idade']}"]
    for chave in ("sexo", "peso", "altura", "contato"):
        if dados[chave]:
            extra.append(f"{'contato_emergencia' if chave == 'contato' else chave}: {dados[chave]}")
    texto = texto.replace("origem: paciente\n", "origem: paciente\n" + "\n".join(extra) + "\n", 1)
    linhas = ["## Dados básicos", f"- Idade: {dados['idade']} anos"]
    for rotulo, chave in (("Sexo", "sexo"), ("Peso", "peso"), ("Altura", "altura"),
                          ("Contato de emergência", "contato")):
        if dados[chave]:
            linhas.append(f"- {rotulo}: {dados[chave]}")
    f.write_text(texto.rstrip() + "\n\n" + "\n".join(linhas) + "\n", encoding="utf-8")
