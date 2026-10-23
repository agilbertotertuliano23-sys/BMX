---
type: anatomia
updated: 2026-10-21
---

# Anatomia — Índice

O motor de investigação anatômica visual do BMX: o usuário descreve o problema, o BMX liga o relato a **regiões** e **estruturas**, a interface destaca essas estruturas no corpo 3D, e o modelo explica onde fica cada coisa e o que ajudaria a diferenciar. É explicação, não diagnóstico.

## Peças
- `catalogo-anatomico.json` — fonte de verdade: camadas, sistemas, regiões, estruturas, sintomas, bibliotecas. Ver [[Esquema — Estrutura anatômica]].
- `malhas.json` — gerado pelo import: estrutura → FMA ID → arquivos de malha por biblioteca.
- [[Mapa sintoma → região]] — como o relato vira regiões.
- [[Pipeline 3D]] — do arquivo da biblioteca ao destaque na tela.
- `Regiões/`, `Sistemas/`, `Bibliotecas/` — notas geradas do catálogo.

## Bibliotecas, por prioridade
1. [[BodyParts3D]] — malhas individuais por FMA ID. Fonte primária.
2. [[Human Atlas]] — **extraída e exportada** em GLBs por camada e região (ver [[Pipeline 3D]]); referência de interface.
3. [[HuBMAP 3D Reference Organ Set — Female]] — referência feminina para a pelve (a baixar).
4. [[Z-Anatomy]] — riqueza anatômica e definições (CC BY-SA: cuidado com derivados).
5. [[3D Anatomy Atlas]] — GLB fatiado por região.
6. [[Somakine]] — leve, só musculoesquelético.
7. [[Human Anatomy 3D]] e 8. [[Écorché]] — citados na pesquisa, repositórios ainda não localizados.

## Camadas (ordem de dentro para fora)
Ossos e articulações → nervos → veias → artérias → órgãos → músculos → pele. Cada estrutura do catálogo pertence a uma camada; a interface liga e desliga camadas e pinta a estrutura destacada com a cor da camada.
