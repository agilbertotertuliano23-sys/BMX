---
type: esquema
updated: 2026-10-21
---

# Esquema — Estrutura anatômica

A fonte de verdade é `40-Conhecimento/Anatomia/catalogo-anatomico.json`. As notas de Regiões, Sistemas, Bibliotecas e o Mapa sintoma → região são **geradas** dele (`python anatomia.py notas`).

```json
"estruturas": {
  "menisco-medial": {
    "nome": "Menisco medial",
    "nome_en": "medial meniscus",
    "sistema": "articular",
    "camada": "ossos",
    "regioes": ["coxa-joelho"]
  }
},
"sintomas": [
  {"id": "joelho", "termos": ["dor no joelho", "joelho"],
   "regioes": ["coxa-joelho"], "estruturas": ["menisco-medial"],
   "nota": "anatomia em uma frase", "atencao": "sinal que muda o nível de atendimento"}
]
```
- `nome_en` é o nome do FMA / BodyParts3D, usado para achar a malha no import.
- `sistema`, `camada` e `regioes` são chaves das listas do próprio catálogo (`python anatomia.py validar` confere).
- `termos` são procurados no relato sem acento.

O **FMA ID** e os arquivos de malha ficam em `malhas.json`, gravado pelo import
(`python anatomia.py indexar <pasta> --biblioteca bodyparts3d`). Assim a mesma estrutura pode ter malha em várias bibliotecas.
Ver [[Pipeline 3D]].
