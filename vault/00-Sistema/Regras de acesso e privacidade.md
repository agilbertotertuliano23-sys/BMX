---
type: sistema
updated: 2026-10-21
---

# Regras de acesso e privacidade

Ver [[Mapa do cofre]].

1. **Um paciente por vez.** O grafo, a ficha fixa, a meta, a escala de dor e a busca só enxergam o paciente ativo. `/paciente <ID>` troca, e a conversa recomeça do zero (sessão e atendimento novos), para nada do anterior vazar.
2. **O modelo não escreve.** Ferramentas: WebSearch, WebFetch, Read, Glob, Grep. Escrita no cofre só pelos comandos (`commands.py`) e pelo servidor (`registro.py`).
3. **O modelo pensa em `40-Conhecimento`.** É a pasta de trabalho dele: lê catálogo e guias. O que sabe do paciente chega montado pelo servidor. Isso limita o que ele abre por conta própria, mas não é barreira criptográfica: quem tem a pasta do cofre tem tudo.
4. **Acessos sem conteúdo.** `30-Acessos` guarda evento, hora, paciente, comando, nível de alerta e contagens. Nunca o texto do relato nem a resposta.
5. **Análise não é diagnóstico.** Tudo com `origem: bmx` é hipótese. Para virar fato, alguém registra em `Registros/` com `origem: profissional`.
6. **Apagar é manual.** O BMX nunca apaga nota. Para remover um paciente, apague a pasta dele em `10-Pacientes` e os atendimentos `… — <ID>.md`; as linhas de acesso ficam como registro de que houve atividade.
7. **Backup e nuvem.** O cofre é texto puro. Se for sincronizar, lembre que são dados de saúde (dado pessoal sensível na LGPD).
