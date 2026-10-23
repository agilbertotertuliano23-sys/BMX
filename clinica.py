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
import sys
import threading

import anatomia
import memory
import safety

PASTA = memory.VAULT / memory.ZONAS["conhecimento"] / "Clinica"
TABELA = PASTA / "queixas-de-entrada.json"

_CACHE = {"sig": None, "tab": None}
_LOCK = threading.Lock()


def carregar():
    with _LOCK:
        sig = anatomia._mtime(TABELA)
        if _CACHE["tab"] is None or sig != _CACHE["sig"]:
            try:
                tab = json.loads(TABELA.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                tab = {"queixas": [], "fontes": []}
            _CACHE.update(sig=sig, tab=tab)
        return _CACHE["tab"]


def identificar(message, limite=2):
    """Queixas de entrada citadas no relato, a mais específica (termo mais longo) primeiro."""
    norm = safety._norm(message)
    if not norm or norm.startswith("/") and not norm.startswith(("/sintoma", "/dor", "/triagem")):
        return []
    achadas = []
    for q in carregar()["queixas"]:
        termos = [t for t in q["termos"] if anatomia._tem(norm, t)]
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
        out.append(f"### {q['queixa']} (CIAP-2 {q['ciap2']})\n"
                   f"Costuma ser: {'; '.join(c['nome'] for c in q['causas_frequentes'])}.\n"
                   f"Não deixar passar: {'; '.join(c['nome'] for c in q['nao_perder'])}.\n"
                   f"Sinais de alerta: {'; '.join(q['sinais_de_alerta'])}.\n"
                   f"Perguntas que mais ajudam: {' '.join(q['perguntas_chave'])}")
    return "\n\n".join(out)


def validar():
    cat, _ = anatomia.carregar()
    ids = {s["id"] for s in cat.get("sintomas", [])}
    erros = []
    for q in carregar()["queixas"]:
        erros += [f"queixa {q['id']}: sintoma anatômico {s} não existe" for s in q["sintoma_anatomico"] if s not in ids]
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
