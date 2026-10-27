# Anatomia 3D

BodyParts3D 4.0, © The Database Center for Life Science, CC BY 4.0 (https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html), simplificado pelo Human Atlas (https://github.com/ashemag/human-atlas, código MIT) e reagrupado em camadas e regiões pelo BMX (`python anatomia.py exportar`, 2026-10-22). Referência anatômica adulta masculina; uso educativo, não clínico.

As malhas de `estruturas/` (valvas e câmaras do coração, tronco encefálico e demais partes do encéfalo, partes do olho, vias biliares, vértebras e discos por segmento etc.) são as mesmas malhas do BodyParts3D 4.0 (CC BY 4.0, via Human Atlas) reagrupadas a partir dos GLBs de `camadas/` por `python tools/ampliar_biblioteca.py`, sem baixar nada novo. Nada do Z-Anatomy (CC BY-SA 4.0) foi importado: ele serviu só de referência de interface.

Útero, ovários, cólon sigmoide e ligamento cruzado anterior vêm do conjunto feminino do Human Reference Atlas / HuBMAP (3d-vh-f-united.glb v1.5), CC BY 4.0, Browne e Schlehlein, 2023 (https://lod.humanatlas.io/ref-organ/united-female/v1.5), movidos para o corpo masculino por escala e âncora (`python tools/anexar_hubmap.py`). Posição aproximada; uso educativo, não clínico.
