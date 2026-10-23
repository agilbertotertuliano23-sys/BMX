"""Acrescenta ao corpo 3D do BMX estruturas que o BodyParts3D (masculino) não tem, vindas do conjunto
feminino do Human Reference Atlas / HuBMAP (3d-vh-f-united.glb, CC BY 4.0, Browne e Schlehlein, 2023).

Uso: python tools/anexar_hubmap.py <caminho/3d-vh-f-united.glb>

Só entram as malhas listadas em ESTRUTURAS. O arquivo de 212 MB nunca é carregado inteiro: lê-se o índice
(JSON) e, de cada malha pedida, só as faixas do bloco binário. As malhas são movidas para o sistema de
coordenadas do corpo masculino (metros, Y para cima, pés em y=0) e gravadas nas regiões
ui/models/anatomia/regioes/*.glb, com o nome da estrutura do catálogo. Rodar de novo é seguro.
Se `python anatomia.py exportar` for refeito, rode este script depois: o export apaga estas regiões.
"""
import json
import pathlib
import struct
import sys

import numpy as np

RAIZ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
import anatomia  # noqa: E402

REGIOES = RAIZ / "ui" / "models" / "anatomia" / "regioes"
MALHAS = RAIZ / "vault" / "40-Conhecimento" / "Anatomia" / "malhas.json"
BIB = "human-atlas"

# Corpo masculino (BodyParts3D) x corpo feminino (HuBMAP): alturas 1,719 m e 1,666 m.
ESCALA = 1.719 / 1.666
# Pelve: o reto existe inteiro nos dois modelos e serve de âncora; depois sobe 5,5 cm e recua 4 cm para o
# útero ficar sobre e atrás da bexiga (a bexiga e o reto masculinos são mais posteriores que os femininos).
PELVE = np.array([0.002, 0.852 + 0.055, 0.061 - 0.040])
# Joelho: pés alinhados (y) e o resto pelo centro do corpo.
CENTRO_F = np.array([-0.006, 0.038, -0.058])
CENTRO_M = np.array([-0.001, 0.860, 0.001])

# slug do catálogo -> região, camada, transformação e as malhas do HuBMAP (por lado)
ESTRUTURAS = {
    "utero": dict(regioes=["suprapubica"], camada="orgaos", mov="pelve", nome="Útero", lados={
        "centro": ["VH_F_body_of_uterus", "VH_F_fundus_of_uterus", "VH_F_lower_uterine_segment", "VH_F_cervix"]}),
    "ovario-direito": dict(regioes=["fossa-iliaca-direita"], camada="orgaos", mov="pelve", nome="Ovário direito",
                           lados={"direito": ["VH_F_right_ovary"]}),
    "ovario-esquerdo": dict(regioes=["fossa-iliaca-esquerda"], camada="orgaos", mov="pelve", nome="Ovário esquerdo",
                            lados={"esquerdo": ["VH_F_left_ovary"]}),
    "colon-sigmoide": dict(regioes=["fossa-iliaca-esquerda", "suprapubica"], camada="orgaos", mov="pelve",
                           nome="Cólon sigmoide", lados={"centro": ["VH_F_sigmoid_colon"]}),
    "lca": dict(regioes=["coxa-joelho"], camada="ossos", mov="joelho", nome="Ligamento cruzado anterior", lados={
        "direito": ["VH_F_anterior_cruciate_ligament_of_knee_R"],
        "esquerdo": ["VH_F_anterior_cruciate_ligament_of_knee_L"]}),
}
_TIPOS = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NCOMP = {"SCALAR": 1, "VEC3": 3}


class Glb:
    """Leitor preguiçoso: só o índice fica em memória."""

    def __init__(self, caminho):
        self.f = open(caminho, "rb")
        self.f.read(12)
        n, _ = struct.unpack("<I4s", self.f.read(8))
        self.g = json.loads(self.f.read(n))
        self.f.read(8)
        self.base = self.f.tell()
        self.nos = {nd["name"]: nd for nd in self.g["nodes"] if "mesh" in nd and "name" in nd}

    def acessor(self, i):
        a = self.g["accessors"][i]
        v = self.g["bufferViews"][a["bufferView"]]
        dtype, nc = _TIPOS[a["componentType"]], _NCOMP[a["type"]]
        tam = np.dtype(dtype).itemsize * nc
        self.f.seek(self.base + v.get("byteOffset", 0) + a.get("byteOffset", 0))
        passo = v.get("byteStride")
        if passo and passo != tam:   # intercalado: lê o bloco e fatia
            bruto = np.frombuffer(self.f.read(passo * a["count"]), dtype=np.uint8).reshape(a["count"], passo)
            return np.ascontiguousarray(bruto[:, :tam]).view(dtype).reshape(a["count"], nc)
        return np.frombuffer(self.f.read(a["count"] * tam), dtype=dtype).reshape(a["count"], nc)

    def malha(self, nome):
        pos, nor, idx, base = [], [], [], 0
        for p in self.g["meshes"][self.nos[nome]["mesh"]]["primitives"]:
            P = self.acessor(p["attributes"]["POSITION"]).astype(np.float32)
            N = (self.acessor(p["attributes"]["NORMAL"]).astype(np.float32) if "NORMAL" in p["attributes"]
                 else np.tile(np.float32([0, 1, 0]), (len(P), 1)))
            I = self.acessor(p["indices"]).reshape(-1).astype(np.uint32)
            pos.append(P); nor.append(N); idx.append(I + base); base += len(P)
        return np.concatenate(pos), np.concatenate(nor), np.concatenate(idx)


def ler_regiao(caminho):
    """Lê um GLB gravado por anatomia._glb: devolve (nós, materiais)."""
    with open(caminho, "rb") as f:
        f.read(12)
        n, _ = struct.unpack("<I4s", f.read(8))
        g = json.loads(f.read(n))
        f.read(8)
        corpo = f.read()

    def arr(i, ncomp, dtype):
        a = g["accessors"][i]
        ini = g["bufferViews"][a["bufferView"]]["byteOffset"]
        bruto = np.frombuffer(corpo[ini:ini + a["count"] * ncomp * np.dtype(dtype).itemsize], dtype=dtype)
        return (bruto.reshape(-1, ncomp) if ncomp > 1 else bruto).copy()

    nos = []
    for nd in g["nodes"]:
        p = g["meshes"][nd["mesh"]]["primitives"][0]
        nos.append([nd["name"], nd.get("extras", {}), p["material"], arr(p["attributes"]["POSITION"], 3, np.float32),
                    arr(p["attributes"]["NORMAL"], 3, np.float32), arr(p["indices"], 1, np.uint32)])
    return nos, g["materials"]


def mover(pos, mov, lado, ref):
    p = pos.astype(np.float64)
    if mov == "pelve":
        return (ESCALA * p + PELVE).astype(np.float32)
    # joelho: corpo inteiro por pés e centro, depois encaixa na articulação masculina do mesmo lado
    base = ESCALA * (p - CENTRO_F) + CENTRO_M
    alvo = ref.get(lado)
    if alvo is not None:
        base += np.array(alvo) - base.mean(0)
    return base.astype(np.float32)


def caixa(posicoes):
    lo, hi = np.min([p.min(0) for p in posicoes], axis=0), np.max([p.max(0) for p in posicoes], axis=0)
    return [round(float(x), 4) for x in (lo + hi) / 2], round(float(np.linalg.norm(hi - lo) / 2), 4)


def main(caminho):
    hub = Glb(caminho)
    malhas = json.loads(MALHAS.read_text(encoding="utf-8"))
    bib = malhas["bibliotecas"][BIB]
    # centro do joelho masculino por lado (a patela marca a frente da articulação)
    patela = bib["estruturas"]["patela"].get("lados", {})
    joelho = {l: [c[0], c[1] - 0.025, c[2] - 0.03] for l, c in patela.items()}

    novos = {}
    for slug, e in ESTRUTURAS.items():
        pos_l, nor_l, idx_l, base, lados = [], [], [], 0, {}
        for lado, nomes in e["lados"].items():
            partes = []
            for nome in nomes:
                P, N, I = hub.malha(nome)
                P = mover(P, e["mov"], lado, joelho)
                pos_l.append(P); nor_l.append(N); idx_l.append(I + base); base += len(P); partes.append(P)
            lados[lado] = caixa(partes)[0]
        pos, nor, idx = np.concatenate(pos_l), np.concatenate(nor_l), np.concatenate(idx_l).astype(np.uint32)
        centro, raio = caixa([pos])
        novos[slug] = (pos, nor, idx, centro, raio, lados)
        print(f"{slug:16} {len(pos):6d} vértices  centro {centro}  raio {raio}")

    # regiões: lê, troca os nós com o mesmo nome, regrava
    for regiao in sorted({r for e in ESTRUTURAS.values() for r in e["regioes"]}):
        arq = REGIOES / f"{regiao}.glb"
        nos, mats = ler_regiao(arq)
        mat_da_camada = {n[1].get("camada"): n[2] for n in nos}
        slugs_aqui = [s for s, e in ESTRUTURAS.items() if regiao in e["regioes"]]
        nos = [n for n in nos if n[0] not in slugs_aqui]
        for s in slugs_aqui:
            e = ESTRUTURAS[s]
            pos, nor, idx = novos[s][:3]
            nos.append((s, {"nome": e["nome"], "camada": e["camada"], "fma": "", "fonte": "HuBMAP"},
                        mat_da_camada.get(e["camada"], 0), pos, nor, idx))
        tam = anatomia._glb([tuple(n) for n in nos], mats, arq)
        centro, raio = caixa([n[3] for n in nos])
        r = bib["regioes"][regiao]
        r["estruturas"] = list(dict.fromkeys(r["estruturas"] + slugs_aqui))
        r["centro"], r["raio"] = centro, raio
        print(f"regiao {regiao:24} {tam / 1e6:5.1f} MB · {len(nos)} estruturas")

    for s, e in ESTRUTURAS.items():
        pos, nor, idx, centro, raio, lados = novos[s]
        bib["estruturas"][s] = dict(fma="", nome=e["nome"], camada=e["camada"],
                                    arquivos=[f"regioes/{r}.glb" for r in e["regioes"]],
                                    partes={l: n for l, n in e["lados"].items()}, centro=centro, raio=raio,
                                    lados={l: c for l, c in lados.items() if l != "centro"}, fonte="HuBMAP feminino")
        if s in bib["faltando"]:
            bib["faltando"].remove(s)
    bib["fontes_extras"] = {"hubmap-feminino": {
        "arquivo": "3d-vh-f-united.glb", "licenca": "CC BY 4.0",
        "autores": "Browne e Schlehlein, Human Reference Atlas / HuBMAP, 2023",
        "url": "https://lod.humanatlas.io/ref-organ/united-female/v1.5",
        "nota": "Malhas femininas movidas para o corpo masculino por escala e âncora; posição aproximada, uso educativo."}}
    MALHAS.write_text(json.dumps(malhas, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    atr = RAIZ / "ui" / "models" / "anatomia" / "ATTRIBUTION.md"
    texto = atr.read_text(encoding="utf-8") if atr.exists() else "# Anatomia 3D\n"
    if "HuBMAP" not in texto:
        atr.write_text(texto.rstrip() + "\n\nÚtero, ovários, cólon sigmoide e ligamento cruzado anterior vêm do conjunto "
                       "feminino do Human Reference Atlas / HuBMAP (3d-vh-f-united.glb v1.5), CC BY 4.0, Browne e "
                       "Schlehlein, 2023 (https://lod.humanatlas.io/ref-organ/united-female/v1.5), movidos para o corpo "
                       "masculino por escala e âncora (`python tools/anexar_hubmap.py`). Posição aproximada; uso "
                       "educativo, não clínico.\n", encoding="utf-8")
    print("faltando agora:", len(bib["faltando"]), "estruturas")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
