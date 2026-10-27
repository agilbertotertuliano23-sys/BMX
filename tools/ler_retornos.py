"""
Lê o que as pessoas deixaram nas telas do BMX: sugestões e inconsistências (feedback) e, com --conversas, as perguntas
feitas em cada fase e as respostas do BMX.

    python tools/ler_retornos.py                 # do cofre local (BMX_VAULT do .env)
    python tools/ler_retornos.py --nuvem         # do Upstash: exporte UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN
    python tools/ler_retornos.py --conversas     # inclui as perguntas e respostas de cada fase
    python tools/ler_retornos.py --tipo inconsistencia --fase atlas

Só leitura: não altera nada.
"""
import argparse
import json
import os
import pathlib
import sys
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def _env():
    arq = RAIZ / ".env"
    for ln in (arq.read_text(encoding="utf-8").splitlines() if arq.exists() else []):
        if ln.strip() and not ln.startswith("#") and "=" in ln:
            k, _, v = ln.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _local():
    vault = pathlib.Path(os.environ.get("BMX_VAULT") or RAIZ / "vault")
    pasta = vault / "20-Operacoes" / "Fases"
    out = {"feedback": [], "conversas": []}
    for nome in out:
        arq = pasta / f"{nome}.jsonl"
        for ln in (arq.read_text(encoding="utf-8").splitlines() if arq.exists() else []):
            try:
                out[nome].append(json.loads(ln))
            except json.JSONDecodeError:
                continue
    return out


def _nuvem():
    url, token = os.environ.get("UPSTASH_REDIS_REST_URL", "").rstrip("/"), os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")
    if not (url and token):
        sys.exit("Defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no ambiente para ler da nuvem.")

    def cmd(*args):
        req = urllib.request.Request(url, data=json.dumps(list(args)).encode("utf-8"), method="POST",
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8")).get("result")

    out = {"feedback": [], "conversas": []}
    for chave in cmd("KEYS", "bmx:pac:*") or []:
        foto = json.loads(cmd("GET", chave) or "{}")
        for nome in out:
            out[nome] += foto.get(nome) or []
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nuvem", action="store_true")
    ap.add_argument("--conversas", action="store_true")
    ap.add_argument("--tipo", choices=["sugestao", "inconsistencia"])
    ap.add_argument("--fase")
    a = ap.parse_args()
    _env()
    dados = _nuvem() if a.nuvem else _local()
    fb = sorted((x for x in dados["feedback"] if (not a.tipo or x.get("tipo") == a.tipo) and (not a.fase or x.get("fase") == a.fase)),
                key=lambda x: x.get("em", ""))
    print(f"== Retornos: {len(fb)} ==")
    for x in fb:
        print(f"\n[{x.get('em', '')}] {x.get('paciente', '')} · {x.get('fase', '')} · {x.get('tipo', '')}"
              + (f" · caso {x['caso']}" if x.get("caso") else ""))
        print("  " + x.get("texto", ""))
        if x.get("tela"):
            print("  tela: " + x["tela"][:300])
    if a.conversas:
        cv = sorted((x for x in dados["conversas"] if not a.fase or x.get("fase") == a.fase), key=lambda x: x.get("em", ""))
        print(f"\n== Conversas por fase: {len(cv)} ==")
        for x in cv:
            print(f"\n[{x.get('em', '')}] {x.get('paciente', '')} · {x.get('fase', '')}"
                  + (f" · caso {x['caso']}" if x.get("caso") else "") + (f" · ALERTA {x['alerta']}" if x.get("alerta") else ""))
            print("  pessoa: " + x.get("pergunta", ""))
            print("  BMX:    " + x.get("resposta", ""))


if __name__ == "__main__":
    main()
