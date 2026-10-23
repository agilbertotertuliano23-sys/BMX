"""
Queixas de entrada do BMX: relato -> queixa principal -> o que costuma ser e o que não pode passar.

A tabela (40-Conhecimento/Clinica/queixas-de-entrada.json) junta o que mais
leva gente a pronto-socorro, UPA e UBS, com o código CIAP-2 do motivo da
consulta, causas frequentes e graves (CID-10), sinais de alerta e as
perguntas que mais separam uma causa da outra. O modelo usa isso para
escolher a próxima pergunta, não para dar diagnóstico.

    python clinica.py validar      confere ligações com o catálogo anatômico
    python clinica.py nota         gera a nota "Queixas de entrada"
    python clinica.py testar <relato>
"""
import datetime
import json
import re
import sys
import threading

import anatomia
import memory
import safety

PASTA = memory.VAULT / memory.ZONAS["conhecimento"] / "Clinica"
TABELA = PASTA / "queixas-de-entrada.json"
INVESTIGACAO = PASTA / "investigacao.json"
PACOTE = memory.ROOT / "vault" / memory.ZONAS["conhecimento"] / "Clinica"

_CACHE = {"sig": None, "tab": None}
_INV_CACHE = {"sig": None, "tab": None}
_LOCK = threading.Lock()


def carregar():
    with _LOCK:
        sig = (anatomia._mtime(PACOTE / TABELA.name), anatomia._mtime(TABELA))
        if _CACHE["tab"] is None or sig != _CACHE["sig"]:
            try:
                tab = json.loads((PACOTE / TABELA.name).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                tab = {"queixas": [], "fontes": []}
            if TABELA.resolve() != (PACOTE / TABELA.name).resolve() and TABELA.exists():
                try:
                    local = json.loads(TABELA.read_text(encoding="utf-8"))
                    por_id = {q["id"]: q for q in local.get("queixas", [])}
                    ids = {q["id"] for q in tab["queixas"]}
                    tab["queixas"] = [por_id.get(q["id"], q) for q in tab["queixas"]]
                    tab["queixas"].extend(q for q in local.get("queixas", []) if q["id"] not in ids)
                    tab["fontes"] = list(dict.fromkeys(tab["fontes"] + local.get("fontes", [])))
                except (OSError, json.JSONDecodeError, KeyError):
                    pass
            _CACHE.update(sig=sig, tab=tab)
        return _CACHE["tab"]


def carregar_investigacao():
    """Guias educativos com fontes auditáveis, sem dados da pessoa."""
    with _LOCK:
        fonte = INVESTIGACAO if INVESTIGACAO.exists() else PACOTE / INVESTIGACAO.name
        sig = anatomia._mtime(fonte)
        if _INV_CACHE["tab"] is None or sig != _INV_CACHE["sig"]:
            try:
                tab = json.loads(fonte.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                tab = {"fontes": {}, "medicamentos": {}, "queixas": {}}
            _INV_CACHE.update(sig=sig, tab=tab)
        return _INV_CACHE["tab"]


def guia(qid):
    """Combina perguntas do catálogo com pistas pesquisadas, sem pontuar hipóteses."""
    q = next((x for x in carregar()["queixas"] if x["id"] == qid), None)
    if not q:
        return None
    inv = carregar_investigacao()
    detalhe = inv["queixas"].get(qid, {})
    pistas = detalhe.get("pistas") or [
        {"rotulo": f"Pergunta {i + 1}", "pergunta": p,
         "por_que": "A resposta ajuda o profissional a distinguir causas com sintomas parecidos."}
        for i, p in enumerate(q["perguntas_chave"][:3])]
    ids = detalhe.get("medicamentos", [])
    fontes = [dict(id=f, **inv["fontes"][f]) for f in detalhe.get("fontes", []) if f in inv["fontes"]]
    return dict(id=qid, queixa=q["queixa"], termos=q["termos"],
                pistas=pistas, cuidado=detalhe.get("cuidado", "Se piorar ou surgir um sinal de alerta, procure atendimento."),
                possibilidades=[{"nome": x["nome"], "tipo": tipo}
                                for tipo, campo in (("comum", "causas_frequentes"), ("atenção", "nao_perder"))
                                for x in q[campo]],
                medicamentos=[dict(id=i, **inv["medicamentos"][i],
                                   referencias=[dict(id=f, **inv["fontes"][f])
                                                for f in inv["medicamentos"][i]["fontes"] if f in inv["fontes"]])
                              for i in ids if i in inv["medicamentos"]],
                fontes=fontes)


def identificar(message, limite=2):
    """Queixas de entrada citadas no relato, a mais específica (termo mais longo) primeiro."""
    norm = safety._norm(message)
    if not norm or norm.startswith("/") and not norm.startswith(("/sintoma", "/dor", "/triagem")):
        return []
    achadas = []
    for q in carregar()["queixas"]:
        termos = [t for t in q["termos"] if anatomia._tem(norm, t)]
        for grupo in q.get("grupos", []):
            palavras = safety._norm(grupo).split()
            if len(palavras) != 2:
                continue
            padrao = re.compile(r"\b" + re.escape(palavras[0]) + r"\w*\b(?:\s+\w+){0,3}\s+\b" + re.escape(palavras[1]) + r"\w*\b")
            for m in padrao.finditer(norm):
                if not anatomia._negado(norm, m.start()) and not re.search(r"\b(nao|nem|sem)\b", m.group()):
                    termos.append(grupo)
                    break
        if termos:
            achadas.append((max(map(len, termos)), q))
    achadas.sort(key=lambda par: -par[0])
    return [q for _, q in achadas[:limite]]


def resumo(queixas):
    """Versão curta para a interface e para o registro do atendimento."""
    return [dict(id=q["id"], queixa=q["queixa"], ciap2=q["ciap2"],
                 nao_perder=[c["nome"] for c in q["nao_perder"]][:4],
                 sinais_de_alerta=q["sinais_de_alerta"][:4]) for q in queixas]


def contexto(queixas):
    if not queixas:
        return ""
    out = ["## Queixa de entrada (tabela local)",
           "Use para escolher a próxima pergunta e checar os sinais de alerta. As causas listadas são o que "
           "costuma aparecer com essa queixa, não o diagnóstico desta pessoa; não as liste para o usuário."]
    for q in queixas:
        g = guia(q["id"])
        out.append(f"### {q['queixa']}" + (f" (CIAP-2 {q['ciap2']})" if q.get("ciap2") else "") + "\n"
                   f"Costuma ser: {'; '.join(c['nome'] for c in q['causas_frequentes'])}.\n"
                   f"Não deixar passar: {'; '.join(c['nome'] for c in q['nao_perder'])}.\n"
                   f"Sinais de alerta: {'; '.join(q['sinais_de_alerta'])}.\n"
                   f"Perguntas que mais ajudam: {' '.join(q['perguntas_chave'])}\n"
                   + ("Pistas pesquisadas: " + " ".join(
                       f"{p['pergunta']} ({p['por_que']})" for p in g["pistas"][:2]) + "\n" if g else "")
                   + "Medicamentos: apresente apenas como tema para conferir com profissional ou farmacêutico; "
                     "não prescreva, não dê dose e não sugira medicamento se houver sinal de alerta. "
                   + ("Cuidados: " + " ".join(m["cautelas"] for m in g["medicamentos"]) if g else ""))
    return "\n\n".join(out)


def validar():
    cat, _ = anatomia.carregar()
    ids = {s["id"] for s in cat.get("sintomas", [])}
    erros = []
    for q in carregar()["queixas"]:
        erros += [f"queixa {q['id']}: sintoma anatômico {s} não existe" for s in q["sintoma_anatomico"] if s not in ids]
    inv = carregar_investigacao()
    qids = {q["id"] for q in carregar()["queixas"]}
    for qid, detalhe in inv["queixas"].items():
        if qid not in qids:
            erros.append(f"investigação: queixa {qid} não existe")
        for mid in detalhe.get("medicamentos", []):
            if mid not in inv["medicamentos"]:
                erros.append(f"investigação {qid}: medicamento {mid} não existe")
        for fid in detalhe.get("fontes", []):
            if fid not in inv["fontes"]:
                erros.append(f"investigação {qid}: fonte {fid} não existe")
    for mid, med in inv["medicamentos"].items():
        for fid in med.get("fontes", []):
            if fid not in inv["fontes"]:
                erros.append(f"medicamento {mid}: fonte {fid} não existe")
    return erros


def gerar_nota():
    tab = carregar()
    cat, _ = anatomia.carregar()
    sint = {s["id"]: s for s in cat.get("sintomas", [])}
    reg = cat.get("regioes", {})
    linhas = []
    for q in tab["queixas"]:
        regioes = []
        for s in q["sintoma_anatomico"]:
            regioes += [r for r in sint.get(s, {}).get("regioes", []) if r not in regioes]
        linhas.append(
            f"## {q['queixa']}\n"
            f"- **CIAP-2:** {q['ciap2']} · **frequência:** {q['frequencia']}\n"
            f"- **costuma ser:** " + "; ".join(f"{c['nome']} ({c['cid10']})" for c in q["causas_frequentes"]) + "\n"
            f"- **não deixar passar:** " + "; ".join(f"{c['nome']} ({c['cid10']})" for c in q["nao_perder"]) + "\n"
            f"- **sinais de alerta:** " + "; ".join(q["sinais_de_alerta"]) + "\n"
            f"- **perguntas-chave:** " + " ".join(q["perguntas_chave"]) + "\n"
            + ("- **regiões:** " + ", ".join(f"[[Região — {reg[r]['nome']}]]" for r in regioes if r in reg) + "\n" if regioes else ""))
    aviso = "> Nota gerada a partir de `queixas-de-entrada.json` (`python clinica.py nota`). Edite a tabela, não esta nota.\n\n"
    texto = (f"---\ntype: clinica\ngerado: queixas-de-entrada.json\nupdated: {datetime.date.today().isoformat()}\n---\n\n"
             "# Queixas de entrada\n\n" + aviso
             + "O que mais leva gente ao pronto-socorro, à UPA e à UBS, e como cada queixa se abre. "
               "Ver [[Anatomia — Índice]].\n\n" + "\n".join(linhas)
             + "\n## Fontes\n" + "\n".join(f"- {f}" for f in tab["fontes"]) + "\n")
    f = PASTA / "Queixas de entrada.md"
    f.write_text(texto, encoding="utf-8")
    return f


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = sys.argv[1:]
    if not args or args[0] == "validar":
        erros = validar()
        print("\n".join(erros) or f"tabela ok: {len(carregar()['queixas'])} queixas")
        sys.exit(1 if erros else 0)
    if args[0] == "nota":
        print(gerar_nota())
    elif args[0] == "testar" and len(args) >= 2:
        print(contexto(identificar(" ".join(args[1:]))) or "nenhuma queixa de entrada reconhecida")
    else:
        print(__doc__)
