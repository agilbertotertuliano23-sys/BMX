---
type: esquema
updated: 2026-10-21
---

# Esquema — Paciente

Pasta `10-Pacientes/<ID>/` (ID simples, como `P0001`). Criada por `/paciente <ID> [nome]`.

```
10-Pacientes/P0001/
  Perfil de saúde.md      ← nó central do grafo do paciente
  Registros/              ← recebido (origem: paciente | profissional | documento)
  Analises/               ← analisado (origem: bmx)
```

```yaml
type: perfil
paciente: P0001
nome: Nome ou apelido
origem: paciente
updated: AAAA-MM-DD
```
Corpo livre: idade, peso, altura, tipo sanguíneo, contatos. Tudo aqui entra na ficha fixa de toda pergunta.
Ver [[Esquema — Registro]] e [[Esquema — Análise]].
