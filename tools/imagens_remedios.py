"""Pesquisa e baixa miniaturas licenciadas do Wikimedia Commons para a UI.

Uso: python tools/imagens_remedios.py buscar
     python tools/imagens_remedios.py baixar
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "ui" / "remedios"
API = "https://commons.wikimedia.org/w/api.php"
AGENT = "BMX-medication-image-catalog/1.0 (educational local app; Wikimedia Commons attribution)"
QUERIES = {
    "dor_febre": ["paracetamol tablets", "dipyrone tablets", "acetaminophen bottle"],
    "antiinflamatorio": ["ibuprofen tablets", "ibuprofen blister", "ibuprofen bottle"],
    "reidratacao": ["oral rehydration salts", "oral rehydration solution", "ORS sachet"],
    "urticaria": ["loratadine tablets", "loratadine blister", "antihistamine tablets"],
    "alivio_tosse": ["cough lozenges", "cough syrup bottle", "throat lozenges"],
}


def api(params: dict) -> dict:
    query = urllib.parse.urlencode({"format": "json", "formatversion": "2", **params})
    request = urllib.request.Request(API + "?" + query, headers={"User-Agent": AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 3:
                raise
            time.sleep(2 ** attempt * 5)
    raise RuntimeError("Falha ao consultar Commons")


def clean(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()


def info(page: dict) -> dict | None:
    if "imageinfo" not in page:
        return None
    data = page["imageinfo"][0]
    meta = data.get("extmetadata", {})
    license_name = clean(meta.get("LicenseShortName", {}).get("value", ""))
    artist = clean(meta.get("Artist", {}).get("value", ""))
    if not data.get("thumburl") or not license_name:
        return None
    return {
        "title": page["title"],
        "url": data["thumburl"],
        "source": data["descriptionurl"],
        "license": license_name,
        "license_url": clean(meta.get("LicenseUrl", {}).get("value", "")),
        "artist": artist,
        "mime": data.get("thumbmime", ""),
    }


def search(term: str) -> list[dict]:
    result = api({"action": "query", "generator": "search", "gsrsearch": "filetype:bitmap " + term,
                  "gsrnamespace": 6, "gsrlimit": 12, "prop": "imageinfo",
                  "iiprop": "url|extmetadata|mime", "iiurlwidth": 480})
    return [item for page in result.get("query", {}).get("pages", []) if (item := info(page))]


def selected_info(titles: list[str]) -> list[dict]:
    found = []
    for start in range(0, len(titles), 25):
        result = api({"action": "query", "titles": "|".join(titles[start:start + 25]),
                      "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": 640})
        found.extend(item for page in result.get("query", {}).get("pages", []) if (item := info(page)))
    return found


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) != 2 or sys.argv[1] not in {"buscar", "baixar"}:
        raise SystemExit(__doc__)
    if sys.argv[1] == "buscar":
        for group, terms in QUERIES.items():
            for term in terms:
                print("\n", group, "|", term, flush=True)
                for item in search(term):
                    print(item["title"], "|", item["license"], "|", item["artist"][:60], flush=True)
        return
    selection = json.loads((DEST / "selecao.json").read_text(encoding="utf-8"))
    by_title = {item["title"]: item for item in selected_info([row["title"] for row in selection])}
    DEST.mkdir(parents=True, exist_ok=True)
    catalog = []
    for index, row in enumerate(selection, 1):
        item = by_title.get(row["title"])
        if not item:
            raise RuntimeError("Imagem ausente ou sem metadados: " + row["title"])
        if not re.search(r"CC0|CC BY|Public domain|Domínio público", item["license"], re.I):
            raise RuntimeError("Licença não aprovada: " + item["title"] + " | " + item["license"])
        ext = ".png" if item["mime"] == "image/png" else ".jpg"
        filename = f"{index:02d}{ext}"
        request = urllib.request.Request(item["url"], headers={"User-Agent": AGENT})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    content = response.read()
                break
            except urllib.error.HTTPError as exc:
                if exc.code != 429 or attempt == 3:
                    raise
                time.sleep(2 ** attempt * 5)
        if len(content) < 1000:
            raise RuntimeError("Arquivo pequeno demais: " + item["title"])
        (DEST / filename).write_bytes(content)
        catalog.append({"id": f"med-{index:02d}", "tema": row["tema"], "nome": row["nome"],
                        "arquivo": "remedios/" + filename, "descricao": row["descricao"],
                        "fonte": item["source"], "licenca": item["license"],
                        "licenca_url": item["license_url"], "autor": item["artist"] or "Wikimedia Commons"})
        print(filename, row["nome"], len(content), flush=True)
    (DEST / "catalogo.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
