"""
Conversa, ajuda e retorno por fase da interface (atendimento, atlas 3D, painel do caso, demonstração guiada).

  entrar()               conta as conexões do paciente: o tutorial de cada tela aparece nas 3 primeiras;
  responder()            pergunta aberta sobre o que está na tela, sem abrir nem mexer no caso;
  registrar_feedback()   sugestão ou inconsistência apontada pela pessoa, em 30-Acessos/feedback.jsonl
                         (zona que nunca entra no grafo nem no contexto do modelo);
  dica_atlas()           diz ao modelo se já é hora de levar a conversa ao atlas 3D;
  pedir_atlas()          o modelo decide: só a marcação [atlas] no fim da resposta abre o atlas.
"""
import datetime
import json
import re
import threading
import uuid

import casos
import commands
import memory
import safety

TUTORIAL_VEZES = 3
FASES = {"atendimento": "Atendimento", "atlas": "Atlas 3D", "painel": "Painel do caso", "demo": "Demonstração guiada"}
TIPOS = ("sugestao", "inconsistencia")
MAX_PERGUNTA, MAX_CONTEXTO, MAX_FEEDBACK, MAX_RESPOSTA = 600, 3000, 1500, 1400
MAX_HISTORICO = 4
SEM_RESPOSTA = "Não consegui responder agora. Tente de novo em instantes ou conte isso na conversa do Atendimento."

_LOCK = threading.Lock()
_ATLAS = re.compile(r"\s*\[\s*atlas\s*\]", re.I)
_COLCHETES = re.compile(r"\s*\[[^\]\n]{1,60}\]")
_VISTO = {}   # (paciente, caso) -> (sinais checados, nível) do caso quando o atlas foi apresentado


# ── tutorial: conexões do paciente ───────────────────────────────
def entrar():
    """Uma conexão nova (o navegador abriu a sessão): conta e devolve quantas o paciente já fez."""
    def conta(d):
        t = commands._p(d).setdefault("tutorial", {"entradas": 0})
        t["entradas"] = int(t.get("entradas", 0)) + 1
        return t["entradas"]
    return {"entradas": commands.update_state(conta), "vezes": TUTORIAL_VEZES}


# ── quando levar ao atlas ────────────────────────────────────────
def sem_marca_atlas(texto):
    """A marcação [atlas] é para a interface, não para a voz nem para o registro."""
    return _ATLAS.sub("", texto or "").strip()


def _estado(caso):
    return (sum(1 for d in caso["discriminadores"] if d["estado"]), caso.get("nivel", ""))


def dica_atlas(caso):
    """Bloco do contexto: já há o que mostrar no corpo? A decisão final continua sendo do modelo."""
    if not caso:
        return ""
    checados, nivel = _estado(caso)
    visto = _VISTO.get((memory.paciente(), caso.get("caso")))
    cab = ("## Atlas 3D\nO atlas mostra no corpo, em uma aula curta, o que a pessoa contou, e depois abre o painel do caso. "
           "Ele só abre se você terminar a resposta com a marcação [atlas] (não é lida em voz alta).\n")
    if visto == (checados, nivel):
        return cab + "O atlas já foi apresentado neste caso e nada mudou desde então: não use [atlas]."
    if not caso.get("regiao"):
        return cab + ("Ainda não é hora: a queixa não tem região do corpo definida. Não use [atlas], a não ser que a pessoa "
                      "peça para ver no corpo e você já tenha entendido onde é.")
    if checados < 2 and not nivel:
        return cab + (f"Ainda não é hora: só {checados} sinal de risco foi checado e o nível não foi dado. Continue a "
                      "triagem e não use [atlas], a não ser que a pessoa peça para ver no corpo.")
    return cab + (f"Já há base para apresentar: a queixa está localizada e {checados} sinais de risco foram checados"
                  + (f", e o nível é {nivel}" if nivel else "") + ". Se ainda tiver uma pergunta importante a fazer, "
                  "faça-a e não use [atlas]. Se esta resposta fecha a triagem ou dá o nível, diga em uma frase que vai "
                  "mostrar no corpo e termine com [atlas].")


def pedir_atlas(texto, caso, alerta=None):
    """True se o modelo marcou [atlas] numa resposta normal: com alerta de emergência o 192 vem antes de qualquer aula."""
    if not (caso and _ATLAS.search(texto or "")) or alerta:
        return False
    atual = casos.obter(caso.get("caso")) or caso
    _VISTO[(memory.paciente(), caso.get("caso"))] = _estado(atual)
    return True


# ── pergunta aberta sobre a tela ─────────────────────────────────
_REGRAS = (
    "## Conversa dentro da tela: {nome}\n"
    "A pessoa está olhando a tela descrita em \"Na tela agora\" e fez uma pergunta sobre ela. Estas regras valem mais "
    "que o estilo falado da persona:\n"
    "- Responda só à pergunta, em português simples, em duas a cinco frases curtas, em texto corrido. O texto vai para a "
    "tela: sem marcações entre colchetes, sem markdown, sem listas. Explique o termo difícil na hora.\n"
    "- Ligue a resposta ao caso da pessoa quando o contexto trouxer o caso. Não invente fatos que ela não contou nem "
    "coisas que a tela não mostra; se a tela não traz a informação, diga isso e sugira perguntar na conversa do "
    "Atendimento ou a um profissional.\n"
    "- Isto não é triagem: não abra caso, não classifique nível e não investigue sintomas. Se a pessoa contar sintoma novo, "
    "piora ou algo de risco, peça para contar na conversa do Atendimento; sinal de alerta é 192.\n"
    "- Remédios: só o que a tela mostra, como informação geral, sem dose, lembrando de conferir alergias e condições da "
    "ficha com um farmacêutico ou médico.\n"
    "- Pode explicar o que cada botão e cada parte da tela faz.\n\n"
    "## Na tela agora\n{contexto}")


def _texto(valor, limite):
    return " ".join(str(valor or "").split())[:limite]


def _historico(lista):
    out = []
    for h in (lista if isinstance(lista, list) else [])[-MAX_HISTORICO:]:
        if isinstance(h, dict):
            q, a = _texto(h.get("q"), MAX_PERGUNTA), _texto(h.get("a"), MAX_RESPOSTA)
            if q and a:
                out.append((q, a))
    return out


def _limpar(texto):
    t = _COLCHETES.sub("", texto or "").replace("**", "").replace("*", "")
    t = re.sub(r"(?m)^\s*[#>-]+\s*", "", t)
    return t.strip()[:MAX_RESPOSTA]


def responder(fase, pergunta, contexto, historico, llm):
    """(resposta, alerta). `llm(sistema, mensagem)` devolve o texto inteiro; erros dela sobem como RuntimeError."""
    pergunta = _texto(pergunta, MAX_PERGUNTA)
    alerta = safety.check(pergunta)
    regras = _REGRAS.format(nome=FASES.get(fase, "BMX"), contexto=_texto(contexto, MAX_CONTEXTO) or "(sem descrição da tela)")
    sistema = "\n\n".join(b for b in (commands.context_block(pergunta, alerta), regras) if b)
    linhas = [f"Pessoa: {q}\nBMX: {a}" for q, a in _historico(historico)]
    mensagem = ("Conversa até agora:\n" + "\n".join(linhas) + "\n\n" if linhas else "") + f"Pergunta da pessoa: {pergunta}"
    return _limpar(llm(sistema, mensagem)) or SEM_RESPOSTA, alerta


# ── armazenamento: 20-Operacoes/Fases/{feedback,conversas}.jsonl ──
# Uma linha JSON por registro. Não é .md: não entra no grafo nem no contexto do modelo.
MAX_GUARDADAS = 200   # por paciente e por arquivo, para a cópia no Upstash (1 MB por ficha) não estourar


def _arquivo(nome):
    return memory.VAULT / memory.ZONAS["operacoes"] / "Fases" / f"{nome}.jsonl"


def _linhas(nome):
    try:
        brutas = _arquivo(nome).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for b in brutas:
        try:
            out.append(json.loads(b))
        except json.JSONDecodeError:
            continue
    return out


def _gravar(nome, linha):
    arq = _arquivo(nome)
    with _LOCK:
        arq.parent.mkdir(parents=True, exist_ok=True)
        with open(arq, "a", encoding="utf-8") as f:
            f.write(json.dumps(linha, ensure_ascii=False) + "\n")
    return linha


def _do(nome, pid):
    return [x for x in _linhas(nome) if x.get("paciente") == pid][-MAX_GUARDADAS:]


def _restaurar(nome, pid, lista):
    with _LOCK:
        tem = {x.get("id") for x in _linhas(nome)}
        novas = [x for x in (lista or []) if isinstance(x, dict) and x.get("paciente") == pid and x.get("id") not in tem]
        if novas:
            arq = _arquivo(nome)
            arq.parent.mkdir(parents=True, exist_ok=True)
            with open(arq, "a", encoding="utf-8") as f:
                for x in novas:
                    f.write(json.dumps(x, ensure_ascii=False) + "\n")
    return len(novas)


def _base(fase, contexto):
    ativo = casos.ativo()
    return {"id": uuid.uuid4().hex[:12], "em": datetime.datetime.now().isoformat(timespec="seconds"),
            "paciente": memory.paciente(), "fase": fase, "caso": (ativo or {}).get("caso", ""),
            "tela": _texto(contexto, 600)}


# ── sugestões e inconsistências ──────────────────────────────────
def registrar_feedback(fase, tipo, texto, contexto=""):
    """Grava o retorno da pessoa com o que estava na tela (para reproduzir a inconsistência)."""
    return _gravar("feedback", dict(_base(fase, contexto), tipo=tipo, texto=str(texto).strip()[:MAX_FEEDBACK]))


def feedback_do(pid):
    """O que este paciente enviou (vai junto da ficha para o Upstash)."""
    return _do("feedback", pid)


def feedback_restaurar(pid, lista):
    """Devolve ao disco o que o Upstash guardou e o disco apagou."""
    return _restaurar("feedback", pid, lista)


# ── conversas das fases ──────────────────────────────────────────
def registrar_conversa(fase, pergunta, resposta, contexto="", alerta=None):
    """Guarda cada pergunta feita na tela e a resposta do BMX."""
    return _gravar("conversas", dict(_base(fase, contexto), pergunta=_texto(pergunta, MAX_PERGUNTA),
                                     resposta=_texto(resposta, MAX_RESPOSTA), alerta=(alerta or {}).get("level", "")))


def conversa_do(pid):
    return _do("conversas", pid)


def conversa_restaurar(pid, lista):
    return _restaurar("conversas", pid, lista)


def historico(fase, limite=12):
    """As últimas trocas deste paciente numa fase (a conversa volta quando a pessoa reabre o chat)."""
    return [{"q": x.get("pergunta", ""), "a": x.get("resposta", ""), "em": x.get("em", "")}
            for x in _do("conversas", memory.paciente()) if x.get("fase") == fase][-limite:]
