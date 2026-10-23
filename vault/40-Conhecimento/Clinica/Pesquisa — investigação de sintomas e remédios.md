---
type: pesquisa
updated: 2026-10-23
status: revisão clínica formal pendente
---

# Investigação de sintomas e remédios

## Objetivo e método

Em 23/10/2026, os roteiros de investigação das 18 queixas existentes foram ampliados e quatro entradas foram acrescentadas: palpitações, perna inchada, dor pélvica e possível reação a medicamento. As 22 entradas agora têm um guia com duas perguntas que discriminam padrões, uma explicação de por que perguntar, sinais para procurar atendimento e links diretos para fontes institucionais. Os textos e URLs usados pela interface estão em `investigacao.json`; a identificação das queixas e as possibilidades estão em `queixas-de-entrada.json`. As listas antigas de condições possíveis ainda precisam de revisão diagnóstica formal.

A pesquisa priorizou Ministério da Saúde, NICE, NHS e MedlinePlus. A seleção privilegia sintomas, critérios de procura por atendimento e segurança de medicamentos. Ela **não** atribui probabilidade individual, não confirma diagnósticos e não substitui avaliação clínica. Os rótulos “também pode ser” e “não deixar passar” indicam temas de conversa, sem ordenar por chance. Esta é revisão de conteúdo educativo para adultos; revisão clínica formal e conferência dos códigos CIAP-2/CID-10 ainda são necessárias antes de uso assistencial ou distribuição.

## Decisões apoiadas nas fontes

| Assunto | Decisão no BMX | Base |
|---|---|---|
| Dor torácica e sinais neurológicos | Manter faixa de emergência antes do modelo; orientar SAMU 192 | [SAMU 192](https://www.gov.br/saude/pt-br/composicao/saes/samu-192), [Infarto](https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/i/infarto), [AVC](https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/a/avc/avc/) |
| Dor lombar com perda nova de função urinária/intestino ou dormência íntima | Priorizar avaliação imediata | [NICE NG127](https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults-aged-over-16) |
| Dor pélvica, atraso menstrual e sangramento | Perguntar sobre possibilidade de gravidez e sinais de urgência | [NHS — dor na gravidez](https://www.nhs.uk/pregnancy/common-symptoms/stomach-pain/), [gravidez ectópica](https://www.nhs.uk/conditions/ectopic-pregnancy/symptoms/) |
| Perna inchada de um lado, especialmente com falta de ar | Investigar trombose e embolia; alerta quando há sinal respiratório | [NHS — trombose venosa](https://www.nhs.uk/conditions/deep-vein-thrombosis-dvt/), [falta de ar](https://www.nhs.uk/symptoms/shortness-of-breath/) |
| Palpitações com dor torácica, falta de ar ou desmaio | Emergência; sem esses sinais, perguntar duração, ritmo e gatilhos | [NHS — palpitações](https://www.nhs.uk/symptoms/heart-palpitations/) |
| Diarreia e vômitos | Perguntar se mantém líquidos e se urina; mostrar reposição oral como assunto de cuidado | [MedlinePlus — diarreia](https://medlineplus.gov/diarrhea.html) |
| Febre ou suspeita de dengue | Mostrar precaução contra anti-inflamatórios e salicilatos; observar piora após queda da febre | [Ministério da Saúde — dengue](https://sisaps.saude.gov.br/sistemas/esusaps/docs/manual/PEC/PEC_16_suporte_decisaoclinica_dengue/), [guia e-SUS APS](https://bvsms.saude.gov.br/bvs/publicacoes/guia_prontuario_eletronico_esus.pdf) |
| Analgésicos e anti-inflamatórios | Exibir opções como assunto para confirmar, sem dose ou prescrição; checar alergias, remédios em uso, gravidez, doença hepática/renal e sangramento | [NHS — paracetamol](https://www.nhs.uk/medicines/paracetamol-for-adults/), [NHS — ibuprofeno](https://www.nhs.uk/medicines/ibuprofen-for-adults/) |
| Urticária limitada à pele | Mostrar anti-histamínico como assunto para o farmacêutico; sintomas respiratórios acionam atendimento | [NHS — urticária](https://www.nhs.uk/conditions/hives/), [NHS — loratadina](https://www.nhs.uk/medicines/loratadine/who-can-and-cannot-take-loratadine/) |
| Tosse | Mostrar alívio sintomático como tema, sem sugerir antibiótico ou codeína como solução | [NHS — tosse](https://www.nhs.uk/symptoms/cough/) |
| Possível reação a medicamento | Primeiro perguntar tempo de início, produto e sinais respiratórios; anafilaxia vai ao 192 | [NHS — anafilaxia](https://www.nhs.uk/conditions/anaphylaxis/) |
| Sofrimento mental | Perguntar segurança atual; CVV 188 e atendimento de emergência quando há risco imediato | [Ministério da Saúde — prevenção do suicídio](https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/s/suicidio-prevencao) |

As demais queixas têm fontes específicas no mapa `fontes` de `investigacao.json` e os links aparecem junto ao guia na interface. Os sinais de alerta são conservadores; a ausência de um sinal marcado não descarta doença.

## Fluxo para a pessoa

1. Buscar pelo sintoma, uma possibilidade ou pelo nome de um remédio em linguagem comum, com acentos opcionais.
2. Ler duas perguntas e por que elas ajudam; anotar o que percebeu. A pessoa pode levar cada resposta ou o resumo à conversa como **rascunho**, que ela revisa antes de enviar. As anotações ficam só na memória da tela e são limpas ao trocar de paciente.
3. Ver “Quando procurar ajuda” antes de abrir a lista de possibilidades.
4. Abrir as possibilidades e, quando pertinente, os cuidados com remédios. Se o caso contém emergência ou sinal de alerta positivo, o painel substitui o conteúdo de medicamentos por orientação de procurar atendimento. Exemplos que constem como alergia na Ficha fixa são retirados das opções exibidas e acompanhados de alerta explícito.
5. Abrir a fonte primária para verificar a explicação.

O catálogo é estático e não envia a busca de sintomas a terceiros. O cofre externo do usuário continua com seus próprios registros; o conteúdo educativo embarcado é mesclado às queixas locais por ID, preservando as edições locais.
