"""
Comandos do BMX + o contexto injetado em toda pergunta.

Base: commands.py do jarvis-claude-code, sem as demos do JARVIS. Os comandos
de cadastro (/alergia, /medicamento, /condicao, /sintoma, /consulta, /exame)
escrevem notas de verdade em 10-Pacientes/<paciente>/Registros/, então o grafo
cresce e o BMX passa a levar a nota em conta. O modelo nunca escreve no
prontuário: só estes comandos (e o registro.py, para operações e acessos).
"""
import datetime
import json
import os
import pathlib
import re
import threading
import uuid

import anatomia
import clinica
import memory
import safety

ROOT = pathlib.Path(__file__).resolve().parent
STATE_FILE = pathlib.Path(os.environ.get("BMX_STATE", ROOT / "state.json"))
PERSONA_FILE = ROOT / "persona.md"
PERFIL = "Perfil de saúde"
_LOCK = threading.Lock()
_PID = re.compile(r"^[A-Za-z0-9_-]{2,24}$")


def _load_unlocked():
    try:
        d = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        d = {}
    d.setdefault("paciente", memory.paciente())
    d.setdefault("pacientes", {})
    if "meta" in d or "dor" in d:   # state.json de antes das zonas: era tudo de um paciente só
        p = d["pacientes"].setdefault(d["paciente"], {"meta": "", "dor": []})
        meta, dor = d.pop("meta", ""), d.pop("dor", [])
        p["meta"] = p["meta"] or meta
        p["dor"] = (dor + p["dor"])[-50:]
    return d


def load():
    with _LOCK:
        return _load_unlocked()


def _p(d):
    """Meta e escala de dor do paciente ativo: nada disso vaza para outro paciente."""
    return d["pacientes"].setdefault(d["paciente"], {"meta": "", "dor": []})


def update_state(mutator):
    with _LOCK:
        d = _load_unlocked()
        result = mutator(d)
        tmp = STATE_FILE.with_name(f".{STATE_FILE.name}.{uuid.uuid4().hex}.tmp")
        try:
            tmp.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            os.replace(tmp, STATE_FILE)
        finally:
            tmp.unlink(missing_ok=True)
        return result


memory.set_paciente(load()["paciente"])


def persona():
    try:
        return PERSONA_FILE.read_text(encoding="utf-8")
    except OSError:
        return "Você é o BMX, um agente pessoal de saúde. Responda em português do Brasil."


def context_block(message="", alert=None, rel=None, queixas=()):
    """Persona + alerta + ficha fixa + queixa de entrada + anatomia do relato + notas do cofre."""
    p = _p(load())
    out = [persona()]
    if alert:
        out.append(safety.instruction(alert))
    out.append(f"## Hoje\n{datetime.date.today().strftime('%d/%m/%Y')} · paciente ativo {memory.paciente()}")
    core = memory.core_context()
    if core:
        out.append(core)
    if p["meta"]:
        out.append(f"## Meta de saúde do paciente\n{p['meta']}")
    if p["dor"]:
        ult = p["dor"][-1]
        out.append(f"## Última escala de dor registrada\n{ult['nivel']}/10 em {ult['em']}")
    clin = clinica.contexto(queixas)
    if clin:
        out.append(clin)
    anat = anatomia.contexto(rel)
    if anat:
        out.append(anat)
    recall = memory.context_for(message)
    if recall:
        out.append(recall)
    return "\n\n".join(out)


# ── prontuário ───────────────────────────────────────────────────
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f\[\]#^]+')


def _safe_title(text, limit=60):
    t = " ".join(_UNSAFE.sub(" ", text).split()).strip(" .")
    return t[:limit].rstrip(" .") or "sem título"


def ensure_perfil(pid=None, nome=""):
    pid = pid or memory.paciente()
    pasta = memory.paciente_dir(pid)
    pasta.mkdir(parents=True, exist_ok=True)
    f = pasta / f"{PERFIL}.md"
    if not f.exists():
        f.write_text(
            f"---\ntype: perfil\npaciente: {pid}\nnome: {nome}\norigem: paciente\n"
            f"updated: {datetime.date.today().isoformat()}\n---\n\n"
            f"# {PERFIL}\n\nFicha central do paciente {pid}. Toda nota do prontuário liga aqui.\n"
            "Idade, peso, altura e tipo sanguíneo podem ser escritos neste arquivo.\n\n"
            "Guias de apoio: [[Guia — Escala de dor]], [[Guia — Onde procurar atendimento]],\n"
            "[[Guia — Sinais de alerta]], [[Guia — Números úteis]].\n", encoding="utf-8")


def write_note(kind, label, body):
    """Cria (ou acrescenta a) uma nota `Tipo — rótulo` ligada ao perfil, em Registros/."""
    ensure_perfil()
    title = f"{kind.capitalize()} — {_safe_title(label)}"
    pasta = memory.paciente_dir() if memory.legado() else memory.paciente_dir() / "Registros"
    pasta.mkdir(parents=True, exist_ok=True)
    f = pasta / f"{title}.md"
    hoje = datetime.date.today()
    linha = f"- {hoje.strftime('%d/%m/%Y')}: {body.strip()}"
    if f.exists():
        text = f.read_text(encoding="utf-8")
        text = re.sub(r"(?m)^updated: .*$", f"updated: {hoje.isoformat()}", text, count=1)
        f.write_text(text.rstrip() + "\n" + linha + "\n", encoding="utf-8")
    else:
        f.write_text(
            f"---\ntype: {kind}\npaciente: {memory.paciente()}\norigem: paciente\n"
            f"registrado_por: comando\nupdated: {hoje.isoformat()}\n---\n\n# {title}\n\n"
            f"Parte do [[{PERFIL}]].\n\n{linha}\n", encoding="utf-8")
    memory.build_graph(force=True)
    return title


# ── comandos ─────────────────────────────────────────────────────
_CMD = re.compile(
    r"^\s*/(novo|ajuda|help|limpar|status|alergia|medicamento|remedio|condicao|sintoma|consulta|exame|"
    r"dor|triagem|emergencia|meta|prontuario|recall|grafo|paciente|casos|caso|ficha)\b\s*(.*)$", re.I | re.S)

_TELEFONES = ("SAMU 192 · Bombeiros 193 · CVV 188 (apoio emocional, 24 h) · "
              "Disque-Intoxicação 0800 722 6001")


def nome(message):
    """Nome do comando (para a trilha de acessos), ou None se não for comando."""
    m = _CMD.match(message or "")
    return m.group(1).lower() if m else None


def _help():
    return """Comandos do BMX:
/triagem — começar uma triagem guiada
/dor <0-10> — registrar a escala de dor
/sintoma <relato> — anotar um sintoma e avaliar
/alergia <substância> — anotar uma alergia no prontuário
/medicamento <nome e dose> — anotar um remédio em uso
/condicao <condição> — anotar uma condição de saúde
/consulta <resumo> — anotar uma consulta ou orientação médica
/exame <nome, resultado> — anotar um exame
/meta <texto> — meta de saúde (ex.: dormir 8 h)
/prontuario <busca> — procurar no prontuário
/paciente — listar pacientes · /paciente <ID> [nome] — trocar ou criar
/caso — caso em foco · /caso novo <queixa> · /caso <ID> — escolher · /casos — listar
/caso encerrar <desfecho> · /ficha [hipoteses] — ficha para levar à consulta
/emergencia — números de emergência
/grafo — recarregar o prontuário · /novo — nova conversa · /status · /limpar

O resto vai para o BMX, com as notas do seu prontuário anexadas."""


def _casos(cmd, arg):
    """Comandos de caso (PRD RF-05 e RF-14). Abrir/retomar automático acontece no servidor."""
    import casos
    import clinica
    nivel = lambda c: casos.NOME_NIVEL.get(c.get("nivel", ""), "a definir")  # noqa: E731
    if cmd == "casos":
        todos = casos.listar(todos=True)
        if not todos:
            return dict(message=None, note="casos", reply="Nenhum caso ainda. Conte o que está sentindo e eu abro um.")
        foco = (casos.ativo() or {}).get("caso")
        return dict(message=None, note="casos", reply="Casos do paciente " + memory.paciente() + ":\n" + "\n".join(
            f"{'▸' if c['caso'] == foco else '·'} {c['caso']} — {c.get('queixa', '')} · {c.get('status', '')} · "
            f"nível {nivel(c)} · {c.get('updated', '')}" for c in todos))

    if cmd == "ficha":
        c = casos.ativo() or (casos.listar() or [None])[0]
        if not c:
            return dict(message=None, note="ficha", reply="Ainda não há caso para montar a ficha.")
        extra = "&hipoteses=1" if "hip" in arg.lower() else ""
        return dict(message=None, note=f"ficha {c['caso']}", ficha=f"/ficha?caso={c['caso']}{extra}",
                    reply=f"Ficha para consulta do caso {c['caso']} ({c.get('queixa', '')}) pronta: "
                          f"/ficha?caso={c['caso']}{extra} — abra e use Imprimir para salvar em PDF.")

    sub, _, resto = arg.partition(" ")
    if sub.lower() == "novo":
        if not resto.strip():
            return dict(message=None, note="caso", reply="Diga a queixa depois de /caso novo.")
        import anatomia
        qs, rel = clinica.identificar(resto), anatomia.relacionar(resto)
        c = casos.abrir(qs[0] if qs else None, rel, resto, None if qs or rel else resto)
        casos.selecionar(c["caso"])
        return dict(message=None, note=f"caso {c['caso']}", graph=True, caso=c["caso"],
                    reply=f"Caso {c['caso']} aberto: {c.get('queixa', '')}. As próximas conversas entram nele.")
    if sub.lower() == "encerrar":
        c = casos.ativo() or (casos.listar() or [None])[0]
        if not c:
            return dict(message=None, note="caso", reply="Não há caso aberto para encerrar.")
        status = "encaminhado" if re.search(r"encaminh", resto, re.I) else "resolvido"
        c = casos.encerrar(c, resto or "encerrado pelo usuário", status)
        return dict(message=None, note=f"caso {c['caso']} {status}", graph=True, caso=c["caso"],
                    reply=f"Caso {c['caso']} marcado como {status}.")
    if sub:
        c = casos.obter(sub)
        if not c:
            return dict(message=None, note="caso", reply=f"Não achei o caso {sub}. Use /casos para ver a lista.")
        casos.selecionar(c["caso"])
        return dict(message=None, note=f"caso {c['caso']}", caso=c["caso"],
                    reply=f"Caso em foco: {c['caso']} — {c.get('queixa', '')} ({c.get('status', '')}, nível {nivel(c)}).")
    c = casos.ativo()
    if not c:
        return dict(message=None, note="caso", reply="Nenhum caso em foco. Conte o que está sentindo, "
                                                     "use /caso novo <queixa> ou /casos para escolher.")
    pend = [d["sinal"] for d in c["discriminadores"] if not d["estado"]]
    return dict(message=None, note=f"caso {c['caso']}", caso=c["caso"], reply=(
        f"{c['caso']} — {c.get('queixa', '')} · desde {c.get('inicio', '')} · {c.get('status', '')} · "
        f"nível {nivel(c)} · dor máxima {c.get('dor_max') or '—'} · {len(c['linha'])} registros na linha do tempo"
        + (f"\nAinda não checado: {'; '.join(pend[:4])}" if pend else "")))


def handle(message, runner=None):
    m = _CMD.match(message or "")
    if not m:
        return None
    cmd, arg = m.group(1).lower(), m.group(2).strip()
    d = load()
    p = _p(d)

    if cmd in ("ajuda", "help"):
        return dict(message=None, reply=_help(), note="comandos")

    if cmd == "limpar":
        return dict(message=None, reply="Tela limpa. A conversa continua.", note="limpar")

    if cmd == "novo":
        return dict(fresh=True, message=arg or "Cumprimente em uma frase curta, como o BMX.", note="nova conversa")

    if cmd == "status":
        import runtime
        g = memory.build_graph()
        return dict(message=None, note="status", reply=(
            f"{runtime.descricao()} · modelo={runtime.modelo()} · "
            f"ferramentas={runtime.ferramentas()} · paciente={memory.paciente()} · "
            f"memória={g['total']} notas"))

    if cmd == "emergencia":
        return dict(message=None, note="emergência", alert=dict(
            level="emergencia", title="Números de emergência",
            phones=[dict(name="SAMU", number="192"), dict(name="Bombeiros", number="193"),
                    dict(name="CVV", number="188"), dict(name="Intoxicação", number="0800 722 6001")]),
            reply="[calm] Em emergência médica, ligue cento e noventa e dois, o SAMU. " + _TELEFONES)

    if cmd == "grafo":
        g = memory.build_graph(force=True)
        hub = g["hubs"][0]["title"] if g["hubs"] else "—"
        return dict(message=None, note="prontuário recarregado", graph=True, reply=(
            f"Cofre em {g['vault']} · paciente {g['paciente']}: {g['total']} notas, "
            f"{len(g['links'])} ligações. Centro: {hub}."))

    if cmd == "paciente":
        if not arg:
            linhas = [f"{'▸' if pid == memory.paciente() else '·'} {pid}" + (f" — {n}" if n else "")
                      for pid, n in memory.listar_pacientes()]
            return dict(message=None, note="pacientes", reply="Pacientes no cofre:\n" + "\n".join(linhas))
        pid, _, nome_p = arg.partition(" ")
        pid = pid.upper()
        if not _PID.match(pid):
            return dict(message=None, note="paciente", reply="Use um ID simples, como P0002.")
        if memory.legado():
            return dict(message=None, note="paciente",
                        reply="Este cofre ainda não tem zonas (10-Pacientes). Aponte BMX_VAULT para o cofre Baymax.")
        novo = not memory.paciente_dir(pid).exists()
        ensure_perfil(pid, nome_p.strip())
        update_state(lambda s: s.__setitem__("paciente", pid))
        memory.set_paciente(pid)
        memory.build_graph(force=True)
        return dict(message=None, fresh=True, graph=True, note=f"paciente {pid}",
                    reply=("Paciente criado e ativo: " if novo else "Paciente ativo: ") + pid
                    + ". Conversa nova: nada do paciente anterior entra aqui.")

    if cmd in ("caso", "casos", "ficha"):
        return _casos(cmd, arg)

    if cmd in ("prontuario", "recall"):
        if not arg:
            return dict(message=None, reply="Diga o que procurar no prontuário.", note="busca")
        hits = memory.search(arg)
        if not hits:
            return dict(message=None, reply=f"Nada no prontuário com “{arg}”.", note="busca vazia")
        body = "\n".join(f"· {h['title']}  [{h['type']}]\n  {h['snippet'][:110].rstrip()}…" for h in hits)
        return dict(message=None, note=f"busca: {arg[:40]}", focus=hits[0]["title"],
                    reply=f"No prontuário:\n{body}")

    if cmd in ("alergia", "medicamento", "remedio", "condicao", "consulta", "exame"):
        kind = "medicamento" if cmd == "remedio" else cmd
        if not arg:
            notes = [n["title"] for n in memory.build_graph()["nodes"] if n["type"] == kind]
            return dict(message=None, note=f"{kind}: leitura",
                        reply=("\n".join(f"- {t}" for t in notes) or f"Nenhum registro de {kind} ainda."))
        label = arg.split(",")[0] if kind != "consulta" else datetime.date.today().strftime("%d-%m-%Y")
        title = write_note(kind, label, arg)
        return dict(message=(f'Acabei de registrar no prontuário: {kind} "{arg}". Confirme em uma frase '
                             f'curta e, se isso conflitar com algo da ficha, avise.'),
                    note=f"prontuário: {title}", focus=title, graph=True)

    if cmd == "sintoma":
        if not arg:
            return dict(message=None, reply="Me conte o que está sentindo depois de /sintoma.", note="sintoma")
        title = write_note("sintoma", arg.split(",")[0], arg)
        return dict(message=(f'Sintoma relatado e anotado no prontuário: "{arg}". Comece a triagem: '
                             f'faça só a próxima pergunta mais importante.'),
                    note=f"prontuário: {title}", focus=title, graph=True)

    if cmd == "dor":
        mm = re.match(r"(\d{1,2})", arg)
        if not mm or int(mm.group(1)) > 10:
            return dict(message=None, reply="Em uma escala de zero a dez, como você classificaria a sua dor?",
                        note="escala de dor")
        nivel = int(mm.group(1))
        em = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M")

        def registra(s):
            q = _p(s)
            q["dor"] = (q["dor"] + [{"nivel": nivel, "em": em}])[-50:]
        update_state(registra)
        resto = arg[mm.end():].strip()
        return dict(message=(f"Na escala de dor, estou em {nivel} de 10." + (f" {resto}" if resto else "")
                             + " Continue a triagem a partir disso."), note=f"dor {nivel}/10")

    if cmd == "triagem":
        return dict(message=("Quero fazer uma triagem. " + arg if arg else
                             "Quero fazer uma triagem. Comece com a primeira pergunta."), note="triagem")

    if cmd == "meta":
        if not arg:
            return dict(message=None, reply=p["meta"] or "Nenhuma meta de saúde definida.", note="meta")
        if arg.lower() in ("limpar", "apagar"):
            update_state(lambda s: _p(s).__setitem__("meta", ""))
            return dict(message=None, reply="Meta apagada.", note="meta apagada")
        update_state(lambda s: _p(s).__setitem__("meta", arg))
        return dict(message=f'Minha meta de saúde agora é: "{arg}". Confirme em uma frase e dê uma dica para começar.',
                    note="meta definida")
    return None
