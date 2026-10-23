---
type: fonte
updated: 2026-10-22
---

# Fontes — Como adicionar

Entrada dos livros e materiais de saúde que vão alimentar o BMX. Fica separada do resto: nada aqui entra no contexto do modelo até ser **aprovado** (RN-06 do [[PRD — Organização de caso]]).

## Fluxo
1. Criar a ficha da fonte (`Fonte — <título>.md`) com o frontmatter abaixo, `status: proposta`.
2. Conferir licença e confiabilidade (diretriz oficial > livro-texto > manual > material de divulgação).
3. Extrair o conteúdo útil em notas curtas por tema (`Fonte — <título> — <capítulo>.md`), cada uma citando página/seção.
4. Mudar para `status: aprovada`. Só então o servidor passa a buscar nela.

```yaml
type: fonte
titulo: Semiologia Médica
autor: …
edicao: …
ano: …
tipo: livro            # livro | diretriz | manual | artigo | curso
licenca: uso pessoal   # uso pessoal | CC BY | domínio público | …
confiabilidade: alta   # alta | media | baixa
temas: [semiologia, urgência]
status: proposta       # proposta | aprovada | arquivada
updated: AAAA-MM-DD
```
