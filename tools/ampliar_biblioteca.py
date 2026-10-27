"""
Amplia a biblioteca anatômica do BMX sem baixar nada: reagrupa as malhas que já estão nos GLBs de camada
(BodyParts3D 4.0 via Human Atlas) em estruturas novas (valvas, cavidades do coração, tronco encefálico, partes
do olho, vias biliares, vértebras lombares...) e grava:

  ui/models/anatomia/estruturas/<id>.glb       uma malha por estrutura, no mesmo espaço do corpo (metros, Y para cima)
  vault/40-Conhecimento/Anatomia/ampliacao.json estruturas novas + índice de malhas (anatomia.carregar() junta ao catálogo)

    python tools/ampliar_biblioteca.py            gera tudo
    python tools/ampliar_biblioteca.py listar     mostra quantas malhas cada regra achou (sem gravar)

O catálogo escrito à mão (catalogo-anatomico.json) e o malhas.json do `anatomia.py exportar` não são tocados.
"""
import datetime
import json
import os
import pathlib
import re
import struct
import sys

import numpy as np

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
_env = RAIZ / ".env"   # como o server.py: é o .env que diz onde está o cofre (BMX_VAULT)
if _env.exists():
    for _ln in _env.read_text(encoding="utf-8").splitlines():
        _ln = _ln.strip()
        if _ln and not _ln.startswith("#") and "=" in _ln:
            _k, _, _v = _ln.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
import anatomia  # noqa: E402

CAMADAS = RAIZ / "ui" / "models" / "anatomia" / "camadas"
SAIDA = RAIZ / "ui" / "models" / "anatomia" / "estruturas"
AMPLIACAO = anatomia.PASTA / "ampliacao.json"

# (id, nome, nome_en, sistema, camada, regiões, regra sobre o nome da malha, descrição)
N = [
    # ── coração e grandes vasos ─────────────────────────────────────────────────────────────
    ("valva-mitral", "Valva mitral", "mitral valve", "cardiovascular", "orgaos", ["torax"], r"mitral valve",
     "Valva entre o átrio e o ventrículo esquerdos: abre para o sangue oxigenado descer e fecha para ele não voltar."),
    ("valva-tricuspide", "Valva tricúspide", "tricuspid valve", "cardiovascular", "orgaos", ["torax"], r"tricuspid valve",
     "Valva entre o átrio e o ventrículo direitos: impede que o sangue volte ao átrio quando o ventrículo se contrai."),
    ("valva-aortica", "Valva aórtica", "aortic valve", "cardiovascular", "orgaos", ["torax"], r"cusp of aortic valve",
     "Valva na saída do ventrículo esquerdo para a aorta: abre a cada batimento e fecha para o sangue não retornar."),
    ("valva-pulmonar", "Valva pulmonar", "pulmonary valve", "cardiovascular", "orgaos", ["torax"], r"cusp of pulmonary valve",
     "Valva na saída do ventrículo direito para a artéria pulmonar, rumo aos pulmões."),
    ("atrio-direito", "Átrio direito", "right atrium", "cardiovascular", "orgaos", ["torax"], r"of right atrium",
     "Câmara que recebe o sangue pobre em oxigênio que volta do corpo pelas veias cavas."),
    ("atrio-esquerdo", "Átrio esquerdo", "left atrium", "cardiovascular", "orgaos", ["torax"], r"of left atrium",
     "Câmara que recebe o sangue oxigenado que volta dos pulmões."),
    ("ventriculo-direito", "Ventrículo direito", "right ventricle", "cardiovascular", "orgaos", ["torax"], r"cavity of right ventricle",
     "Câmara que bombeia o sangue para os pulmões, onde ele recebe oxigênio."),
    ("ventriculo-esquerdo", "Ventrículo esquerdo", "left ventricle", "cardiovascular", "orgaos", ["torax"], r"cavity of left ventricle",
     "Câmara de parede mais grossa: bombeia o sangue oxigenado para o corpo inteiro pela aorta."),
    ("arco-da-aorta", "Arco da aorta", "arch of aorta", "cardiovascular", "arterias", ["torax", "pescoco"], r"^(arch of aorta|ascending aorta)$",
     "Curva da aorta no alto do tórax, de onde saem as artérias que levam sangue à cabeça e aos braços."),
    ("aorta-abdominal", "Aorta abdominal", "abdominal aorta", "cardiovascular", "arterias", ["epigastrio", "periumbilical"], r"^abdominal aorta$",
     "Trecho da aorta dentro do abdome: dá ramos para o sistema digestório e para os rins e continua até as pernas."),
    ("veia-cava-superior", "Veia cava superior", "superior vena cava", "cardiovascular", "veias", ["torax"], r"^superior vena cava$",
     "Traz o sangue da cabeça, do pescoço e dos braços para o átrio direito."),
    ("veia-cava-inferior", "Veia cava inferior", "inferior vena cava", "cardiovascular", "veias", ["torax", "lombar"], r"^inferior vena cava$",
     "Traz o sangue da metade inferior do corpo para o átrio direito."),
    # ── encéfalo ───────────────────────────────────────────────────────────────────────────
    ("cerebelo", "Cerebelo", "cerebellum", "nervoso", "nervos", ["cabeca"], r"^cerebellum$",
     "Fica atrás e embaixo do cérebro: coordena o movimento, o equilíbrio e a postura."),
    ("tronco-encefalico", "Tronco encefálico", "brainstem", "nervoso", "nervos", ["cabeca", "pescoco"], r"^(pons|medulla oblongata|midbrain)$",
     "Liga o cérebro à medula espinhal: controla respiração e batimentos e por ele passam quase todas as vias nervosas."),
    ("talamo", "Tálamo", "thalamus", "nervoso", "nervos", ["cabeca"], r"^(left|right) thalamus$",
     "Estação de retransmissão: leva ao córtex as informações dos sentidos."),
    ("hipocampo", "Hipocampo", "hippocampus", "nervoso", "nervos", ["cabeca"], r"hippocampus$",
     "Região ligada à formação de novas memórias e à orientação no espaço."),
    ("amigdala", "Amígdala cerebral", "amygdala", "nervoso", "nervos", ["cabeca"], r"amygdala$",
     "Núcleo ligado às emoções, em especial ao medo e à resposta de alerta."),
    ("corpo-caloso", "Corpo caloso", "corpus callosum", "nervoso", "nervos", ["cabeca"], r"^corpus callosum$",
     "Faixa de fibras que conecta os dois hemisférios do cérebro."),
    ("nucleos-da-base", "Núcleos da base", "basal ganglia", "nervoso", "nervos", ["cabeca"], r"caudate nucleus|putamen|globus pallidus",
     "Grupo de núcleos profundos que ajuda a iniciar e a regular os movimentos."),
    ("hipotalamo", "Hipotálamo", "hypothalamus", "nervoso", "nervos", ["cabeca"], r"^hypothalamus$",
     "Pequena região que regula temperatura, fome, sede e sono e comanda a hipófise."),
    ("via-optica", "Via óptica", "optic pathway", "nervoso", "nervos", ["cabeca"], r"optic (nerve|chiasm|tract)",
     "Nervo óptico, quiasma e tratos: levam a imagem do olho até o cérebro."),
    ("giro-pre-central", "Giro pré-central (córtex motor)", "precentral gyrus", "nervoso", "nervos", ["cabeca"], r"precentral gyrus",
     "Faixa do córtex que comanda os movimentos voluntários do lado oposto do corpo."),
    ("giro-pos-central", "Giro pós-central (córtex sensitivo)", "postcentral gyrus", "nervoso", "nervos", ["cabeca"], r"postcentral gyrus",
     "Recebe o tato, a dor e a posição do corpo do lado oposto."),
    ("lobo-occipital", "Lobo occipital", "occipital lobe", "nervoso", "nervos", ["cabeca"], r"occipital lobe",
     "Parte de trás do cérebro, responsável principalmente pela visão."),
    ("hipofise", "Hipófise", "pituitary gland", "endocrino", "orgaos", ["cabeca"], r"^pituitary gland$",
     "Glândula do tamanho de uma ervilha, na base do cérebro: comanda outras glândulas hormonais."),
    ("glandula-pineal", "Glândula pineal", "pineal body", "endocrino", "orgaos", ["cabeca"], r"^pineal body$",
     "Pequena glândula que participa do ritmo de sono e vigília por meio da melatonina."),
    ("ventriculos-laterais", "Ventrículos laterais", "lateral ventricle", "nervoso", "orgaos", ["cabeca"], r"lateral ventricle$",
     "Cavidades dentro do cérebro onde o líquido cefalorraquidiano é produzido e circula."),
    # ── olho ───────────────────────────────────────────────────────────────────────────────
    ("cristalino", "Cristalino", "lens", "sensorial", "orgaos", ["cabeca"], r"^(left|right) lens$",
     "Lente transparente atrás da íris: muda de curvatura para focar de perto e de longe."),
    ("cornea", "Córnea", "cornea", "sensorial", "orgaos", ["cabeca"], r"cornea$",
     "Janela transparente na frente do olho, responsável pela maior parte do poder de foco."),
    ("iris", "Íris", "iris", "sensorial", "orgaos", ["cabeca"], r"iris$",
     "Parte colorida do olho: abre e fecha a pupila para regular a entrada de luz."),
    ("retina", "Retina", "retina", "sensorial", "orgaos", ["cabeca"], r"retina$",
     "Camada no fundo do olho que transforma a luz em sinais nervosos."),
    ("esclera", "Esclera", "sclera", "sensorial", "orgaos", ["cabeca"], r"sclera$",
     "O \"branco do olho\": camada firme que dá forma e protege o globo ocular."),
    ("corpo-vitreo", "Corpo vítreo", "vitreous body", "sensorial", "orgaos", ["cabeca"], r"vitreous body$",
     "Gel transparente que preenche o interior do olho."),
    # ── boca, pescoço e digestório ─────────────────────────────────────────────────────────
    ("lingua", "Língua", "tongue", "digestorio", "orgaos", ["cabeca"], r"^tongue$",
     "Músculo coberto de papilas: participa da mastigação, da fala e do paladar."),
    ("glandulas-salivares", "Glândulas salivares", "salivary glands", "digestorio", "orgaos", ["cabeca", "pescoco"], r"submandibular gland|sublingual gland",
     "Produzem a saliva, que umedece o alimento e começa a digestão."),
    ("epiglote", "Epiglote", "epiglottis", "respiratorio", "orgaos", ["pescoco"], r"^epiglottis$",
     "Tampa de cartilagem que fecha a laringe ao engolir, protegendo as vias aéreas."),
    ("cartilagem-tireoide", "Cartilagem tireóidea", "thyroid cartilage", "respiratorio", "ossos", ["pescoco"], r"^thyroid cartilage$",
     "A maior cartilagem da laringe: forma o \"pomo de Adão\"."),
    ("vias-biliares", "Vias biliares", "biliary tract", "digestorio", "orgaos", ["hipocondrio-direito", "epigastrio"], r"hepatic biliary tree|hepatic duct|cystic duct|duct of caudate lobe",
     "Canais que levam a bile do fígado até a vesícula biliar e o duodeno."),
    ("ducto-pancreatico", "Ducto pancreático", "pancreatic duct", "digestorio", "orgaos", ["epigastrio"], r"^pancreatic duct( tree)?$",
     "Canal que leva o suco digestivo do pâncreas até o duodeno."),
    ("jejuno", "Jejuno", "jejunum", "digestorio", "orgaos", ["periumbilical", "hipocondrio-esquerdo"], r"jejunum$",
     "Trecho do intestino delgado depois do duodeno, onde ocorre grande parte da absorção de nutrientes."),
    ("ileo", "Íleo", "ileum", "digestorio", "orgaos", ["periumbilical", "fossa-iliaca-direita"], r"ileum$|^ileocecal junction$",
     "Último trecho do intestino delgado: absorve vitamina B12 e sais biliares e desemboca no ceco."),
    ("mesenterio", "Mesentério", "mesentery", "digestorio", "orgaos", ["periumbilical"], r"^mesentery of small intestine$",
     "Membrana que prende o intestino delgado à parede do abdome e leva seus vasos e nervos."),
    ("suprarrenais", "Glândulas suprarrenais", "adrenal glands", "endocrino", "orgaos", ["lombar", "hipocondrio-direito", "hipocondrio-esquerdo"], r"adrenal gland$",
     "Ficam sobre os rins: produzem cortisol, adrenalina e outros hormônios."),
    ("timo", "Timo", "thymus", "linfatico", "orgaos", ["torax"], r"lobe of thymus$",
     "Órgão atrás do esterno que \"treina\" os linfócitos T; é maior na infância."),
    ("arvore-bronquica", "Árvore brônquica segmentar", "segmental bronchi", "respiratorio", "orgaos", ["torax"], r"bronchial tree$",
     "Ramificações dos brônquios que levam o ar a cada segmento do pulmão."),
    # ── coluna ─────────────────────────────────────────────────────────────────────────────
    ("vertebras-cervicais", "Vértebras cervicais (C1–C7)", "cervical vertebrae", "esqueletico", "ossos", ["pescoco"],
     r"^(atlas|axis|(third|fourth|fifth|sixth|seventh) cervical vertebra)$",
     "As sete vértebras do pescoço: sustentam a cabeça e protegem a medula."),
    ("discos-cervicais", "Discos intervertebrais cervicais", "cervical intervertebral discs", "articular", "ossos", ["pescoco"],
     r"^intervertebral disk of \w+ cervical vertebra$", "Almofadas entre as vértebras do pescoço: amortecem e dão mobilidade."),
    ("vertebras-toracicas", "Vértebras torácicas (T1–T12)", "thoracic vertebrae", "esqueletico", "ossos", ["torax"],
     r"^\w+ thoracic vertebra$", "As doze vértebras do meio das costas, onde as costelas se articulam."),
    ("discos-toracicos", "Discos intervertebrais torácicos", "thoracic intervertebral discs", "articular", "ossos", ["torax"],
     r"^intervertebral disk of \w+ thoracic vertebra$", "Almofadas entre as vértebras torácicas."),
    ("vertebras-lombares", "Vértebras lombares (L1–L5)", "lumbar vertebrae", "esqueletico", "ossos", ["lombar"],
     r"^(first|second|third|fourth|fifth) lumbar vertebra$",
     "As cinco vértebras grandes da parte baixa das costas: sustentam o peso do tronco."),
    ("vertebra-l4", "Quarta vértebra lombar (L4)", "fourth lumbar vertebra", "esqueletico", "ossos", ["lombar"],
     r"^fourth lumbar vertebra$", "Vértebra lombar que, junto com L5, concentra grande parte da carga e do movimento da região."),
    ("vertebra-l5", "Quinta vértebra lombar (L5)", "fifth lumbar vertebra", "esqueletico", "ossos", ["lombar"],
     r"^fifth lumbar vertebra$", "Última vértebra lombar: apoia-se no sacro e transmite o peso do tronco à pelve."),
    ("discos-lombares", "Discos intervertebrais lombares", "lumbar intervertebral discs", "articular", "ossos", ["lombar"],
     r"^intervertebral disk of \w+ lumbar vertebra$",
     "Almofadas de cartilagem entre as vértebras lombares: amortecem o impacto e permitem o movimento."),
    ("ligamento-plantar-longo", "Ligamento plantar longo", "long plantar ligament", "articular", "ossos", ["perna-pe"],
     r"long plantar ligament$", "Ligamento na planta do pé que ajuda a sustentar o arco."),
]


def ler_glb(caminho):
    """-> (json, bin) de um GLB."""
    b = caminho.read_bytes()
    n, _ = struct.unpack_from("<II", b, 12)
    g = json.loads(b[20:20 + n])
    m = 20 + n
    tam, _ = struct.unpack_from("<II", b, m)
    return g, memoryview(b)[m + 8:m + 8 + tam]


def geometria(g, bin_, no):
    prim = g["meshes"][no["mesh"]]["primitives"][0]

    def acc(i, dt, k):
        a = g["accessors"][i]
        v = g["bufferViews"][a["bufferView"]]
        return np.frombuffer(bin_, dt, a["count"] * k, v["byteOffset"] + a.get("byteOffset", 0))
    pos = acc(prim["attributes"]["POSITION"], np.float32, 3).reshape(-1, 3)
    nor = acc(prim["attributes"]["NORMAL"], np.float32, 3).reshape(-1, 3)
    return pos, nor, acc(prim["indices"], np.uint32, 1)


def main(so_listar=False):
    cat, _ = anatomia.carregar()
    cores = {k: c["cor"] for k, c in cat["camadas"].items()}
    ordem = list(cores)

    def material(camada):
        h = cores[camada].lstrip("#")
        rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        return {"name": camada, "pbrMetallicRoughness": {"baseColorFactor": rgb + [1.0], "metallicFactor": 0.0, "roughnessFactor": 0.65}}
    materiais = [material(c) for c in ordem]

    por_camada = {}
    for e in N:
        por_camada.setdefault(e[4], []).append(e)

    estruturas, malhas, vazias = {}, {}, []
    for camada, lista in por_camada.items():
        g, bin_ = ler_glb(CAMADAS / f"{camada}.glb")
        nos = [(nd, nd.get("extras", {}).get("nome", "")) for nd in g["nodes"]]
        for slug, nome, nome_en, sistema, cam, regioes, regra, desc in lista:
            rx = re.compile(regra, re.I)
            achados = [(nd, n) for nd, n in nos if rx.search(n)]
            print(f"{slug:24} {len(achados):3} malhas")
            if not achados:
                vazias.append(slug)
                continue
            if so_listar:
                continue
            P, Nn, I, base = [], [], [], 0
            lo, hi, lados = np.full(3, 1e9), np.full(3, -1e9), {"direito": [], "esquerdo": []}
            for nd, n in achados:
                p, nr, ix = geometria(g, bin_, nd)
                P.append(p); Nn.append(nr); I.append(ix + base); base += len(p)
                lo, hi = np.minimum(lo, p.min(0)), np.maximum(hi, p.max(0))
                lado = re.search(r"\b(right|left)\b", n.lower())
                if lado:
                    lados["direito" if lado.group(1) == "right" else "esquerdo"].append((p.min(0), p.max(0)))
            extras = {"nome": nome, "camada": cam, "fma": ""}
            tam = anatomia._glb([(slug, extras, ordem.index(cam), np.concatenate(P), np.concatenate(Nn),
                                  np.concatenate(I).astype(np.uint32))], materiais, SAIDA / f"{slug}.glb")
            centro, raio = ((lo + hi) / 2).round(4).tolist(), round(float(np.linalg.norm(hi - lo) / 2), 4)
            lado_c = {k: (((np.min([a for a, _ in v], 0) + np.max([b for _, b in v], 0)) / 2).round(4).tolist())
                      for k, v in lados.items() if v}
            estruturas[slug] = dict(nome=nome, nome_en=nome_en, sistema=sistema, camada=cam, regioes=regioes, descricao=desc)
            malhas[slug] = dict(fma="", nome=nome_en, camada=cam, arquivos=[f"estruturas/{slug}.glb"], centro=centro,
                                raio=raio, lados=lado_c, malhas=len(achados), kb=round(tam / 1024))
        del g, bin_
    if so_listar:
        return
    AMPLIACAO.write_text(json.dumps(dict(
        versao=datetime.date.today().isoformat(),
        sobre="Gerado por tools/ampliar_biblioteca.py a partir dos GLBs de camada (BodyParts3D 4.0 via Human Atlas, CC BY 4.0). "
              "anatomia.carregar() junta estas estruturas ao catálogo. Não edite: ajuste as regras do script.",
        estruturas=estruturas, malhas=malhas, sem_malha=vazias), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(estruturas)} estruturas gravadas em {AMPLIACAO}; sem malha: {vazias}")


if __name__ == "__main__":
    main(so_listar=len(sys.argv) > 1 and sys.argv[1] == "listar")
