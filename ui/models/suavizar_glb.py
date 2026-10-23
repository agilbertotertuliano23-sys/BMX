"""Subdivisão de Loop do Baymax, preservando UV e sem rachar nas costuras.

As costuras de UV duplicam vértices na mesma posição. A topologia e as posições
são calculadas na malha SOLDADA (por posição); os UVs andam na malha partida
(ponto médio). Assim os dois lados de uma costura recebem a mesma posição.

    py -3 -I suavizar_glb.py entrada.glb saida.glb [niveis=2]
"""
import json
import struct
import sys
from collections import defaultdict

import numpy as np

ENT, SAI = sys.argv[1], sys.argv[2]
NIVEIS = int(sys.argv[3]) if len(sys.argv) > 3 else 2

b = open(ENT, "rb").read()
jl = struct.unpack_from("<I", b, 12)[0]
js = json.loads(b[20:20 + jl])
binc = b[28 + jl:]


def acc(i):
    a = js["accessors"][i]
    v = js["bufferViews"][a["bufferView"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a["componentType"]]
    r = np.frombuffer(binc, dt, a["count"] * n, v.get("byteOffset", 0) + a.get("byteOffset", 0))
    return r.reshape(-1, n) if n > 1 else r


prim = js["meshes"][0]["primitives"][0]
P = acc(prim["attributes"]["POSITION"]).astype(np.float64)
UV = acc(prim["attributes"]["TEXCOORD_0"]).astype(np.float64)
TS = acc(prim["indices"]).astype(np.int64).reshape(-1, 3)

_, wid = np.unique(np.round(P, 5), axis=0, return_inverse=True)
wid = wid.reshape(-1)
W = np.zeros((wid.max() + 1, 3))
W[wid] = P


def nivel(W, wid, UV, TS):
    TW = wid[TS]
    opostos = defaultdict(list)                       # aresta soldada -> vértices opostos
    for a, b_, c in TW:
        for x, y, z in ((a, b_, c), (b_, c, a), (c, a, b_)):
            opostos[(min(x, y), max(x, y))].append(z)
    viz = defaultdict(set)
    borda_viz = defaultdict(list)
    for (x, y), op in opostos.items():
        viz[x].add(y); viz[y].add(x)
        if len(op) == 1:
            borda_viz[x].append(y); borda_viz[y].append(x)
    # regra dos vértices antigos
    NW = np.empty_like(W)
    for v in range(len(W)):
        if borda_viz.get(v):
            bv = borda_viz[v][:2]
            NW[v] = 0.75 * W[v] + 0.125 * W[bv].sum(0) if len(bv) == 2 else W[v]
            continue
        nb = list(viz[v]); n = len(nb)
        if n == 0:
            NW[v] = W[v]; continue
        beta = 3 / 16 if n == 3 else 3 / (8 * n)
        NW[v] = (1 - n * beta) * W[v] + beta * W[nb].sum(0)
    # pontos de aresta (soldados)
    idx_aresta, novos = {}, []
    for (x, y), op in opostos.items():
        if len(op) == 2:
            p = 0.375 * (W[x] + W[y]) + 0.125 * (W[op[0]] + W[op[1]])
        else:
            p = 0.5 * (W[x] + W[y])
        idx_aresta[(x, y)] = len(W) + len(novos)
        novos.append(p)
    NW = np.vstack([NW, np.array(novos)])
    # malha partida: um vértice novo por aresta partida, com UV no meio
    meio, nuv, nwid = {}, list(UV), list(wid)

    def ponto(sa, sb):
        k = (min(sa, sb), max(sa, sb))
        if k not in meio:
            meio[k] = len(nuv)
            nuv.append((UV[sa] + UV[sb]) / 2)
            wa, wb = wid[sa], wid[sb]
            nwid.append(idx_aresta[(min(wa, wb), max(wa, wb))])
        return meio[k]
    tris = []
    for a, b_, c in TS:
        ab, bc, ca = ponto(a, b_), ponto(b_, c), ponto(c, a)
        tris += [(a, ab, ca), (ab, b_, bc), (ca, bc, c), (ab, bc, ca)]
    return NW, np.array(nwid), np.array(nuv), np.array(tris, dtype=np.int64)


for i in range(NIVEIS):
    W, wid, UV, TS = nivel(W, wid, UV, TS)
    print(f"nivel {i + 1}: {len(UV)} vertices, {len(TS)} triangulos")

# normais suaves na malha soldada, copiadas para os dois lados das costuras
TW = wid[TS]
fn = np.cross(W[TW[:, 1]] - W[TW[:, 0]], W[TW[:, 2]] - W[TW[:, 0]])
NWn = np.zeros_like(W)
for k in range(3):
    np.add.at(NWn, TW[:, k], fn)
NWn /= np.maximum(np.linalg.norm(NWn, axis=1, keepdims=True), 1e-12)
POS = W[wid].astype(np.float32)
NOR = NWn[wid].astype(np.float32)
UVS = UV.astype(np.float32)
IND = TS.astype(np.uint32).reshape(-1)

# novo GLB: geometria nova + a mesma imagem
img_view = js["bufferViews"][js["images"][0]["bufferView"]]
img = binc[img_view.get("byteOffset", 0):img_view.get("byteOffset", 0) + img_view["byteLength"]]
partes, views = [], []
off = 0


def bloco(dados, target=None):
    global off
    d = dados if isinstance(dados, bytes) else dados.tobytes()
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(d)}
    if target:
        v["target"] = target
    views.append(v)
    partes.append(d + b"\0" * (-len(d) % 4))
    off += len(d) + (-len(d) % 4)
    return len(views) - 1


vp, vn, vu, vi, vimg = bloco(POS, 34962), bloco(NOR, 34962), bloco(UVS, 34962), bloco(IND, 34963), bloco(img)
js["bufferViews"] = views
js["accessors"] = [
    {"bufferView": vp, "componentType": 5126, "count": len(POS), "type": "VEC3",
     "min": POS.min(0).tolist(), "max": POS.max(0).tolist()},
    {"bufferView": vn, "componentType": 5126, "count": len(NOR), "type": "VEC3"},
    {"bufferView": vu, "componentType": 5126, "count": len(UVS), "type": "VEC2"},
    {"bufferView": vi, "componentType": 5125, "count": len(IND), "type": "SCALAR"}]
js["meshes"][0]["primitives"][0]["attributes"] = {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}
js["meshes"][0]["primitives"][0]["indices"] = 3
js["images"][0]["bufferView"] = vimg
js["buffers"] = [{"byteLength": off}]
js.setdefault("asset", {})["generator"] = "BMX suavizar_glb.py (Loop x%d) sobre o modelo original" % NIVEIS
jb = json.dumps(js, separators=(",", ":")).encode()
jb += b" " * (-len(jb) % 4)
corpo = b"".join(partes)
with open(SAI, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(corpo)))
    f.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
    f.write(struct.pack("<II", len(corpo), 0x004E4942) + corpo)
print("salvo", SAI, round((12 + 16 + len(jb) + len(corpo)) / 1e6, 2), "MB")
