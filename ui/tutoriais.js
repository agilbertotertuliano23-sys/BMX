/* BMX · textos dos tutoriais de cada tela (quem os mostra é fase.js).
   Passo: { titulo, texto, alvo? }. `alvo` é um seletor CSS do elemento a destacar; se ele não existir ou estiver
   escondido, o cartão aparece no centro da tela. */
window.BMX_TUTORIAIS = {
  entrada: [
    { titulo: 'Bem-vindo ao BMX', texto: 'Eu sou o BMX, um agente pessoal de saúde. Primeiro preciso saber quem é você, para abrir a sua ficha.' },
    { titulo: 'Digite o seu nome', texto: 'Escreva o nome completo. Se você já tem ficha, ela abre; se não, criamos uma nova em cerca de um minuto.', alvo: '#nome' },
    { titulo: 'Ficha e PIN', texto: 'No cadastro você conta alergias, remédios em uso e condições de saúde. Isso ajuda o BMX a orientar com segurança. O PIN de 4 a 6 números protege a sua ficha quando você entra de outro aparelho.' },
    { titulo: 'Combinado', texto: 'O BMX dá informação e orientação, mas não substitui um médico. Em emergência, ligue 192.' }
  ],

  atendimento: [
    { titulo: 'Conte o que você está sentindo', texto: 'Escreva aqui ou use o botão Falar. Conte uma coisa de cada vez, por exemplo: dor de cabeça desde ontem.', alvo: '#pergunta' },
    { titulo: 'Ações rápidas', texto: 'Aqui ficam a triagem guiada, a escala de dor e os atalhos para anotar alergia, remédio, condição de saúde e consulta na sua ficha.', alvo: '#matriz' },
    { titulo: 'A conversa', texto: 'O BMX faz uma pergunta por vez e abre um caso com o que você conta. Quando entender o suficiente, ele diz o nível de atendimento: emergência, urgente, consulta ou autocuidado.', alvo: '#conversa' },
    { titulo: 'Do chat ao atlas 3D', texto: 'Quando o BMX achar que já dá para mostrar, ele apresenta no corpo 3D o que você contou e depois abre o painel do caso. Você pode desligar isso nesta caixa.', alvo: '#chkSeguir' },
    { titulo: 'Prontuário', texto: 'Estas são as notas do seu prontuário que o BMX usa. Toque em uma para ler. Quando ele usa uma nota para responder, ela acende sozinha.', alvo: '.grafo-painel' },
    { titulo: 'Explorar sintomas', texto: 'Este botão abre o painel do caso quando você quiser: dor, sinais de alerta, remédios e demonstrações.', alvo: '#btnCaso' },
    { titulo: 'Sugestões e erros', texto: 'Viu algo confuso, errado ou que poderia melhorar? Conte pelo botão Sugestão. E o ? abre este guia de novo.', alvo: '.bf-botoes' }
  ],

  atlas: [
    { titulo: 'O atlas mostra o seu relato no corpo', texto: 'É uma aula curta e guiada: primeiro o que você contou, depois onde isso fica no corpo, como as partes se encaixam e onde um problema pode impactar. É um atlas de referência, não o seu exame.' },
    { titulo: 'Gire e aproxime', texto: 'Arraste o modelo para girar. Use a roda do mouse, ou dois dedos no celular, para aproximar e afastar.', alvo: '#atlPalco canvas' },
    { titulo: 'Os passos da aula', texto: 'Cada traço é um passo. Toque em um para ir direto a ele. O traço brilhante é o passo de agora.', alvo: '#atlTrilha' },
    { titulo: 'Pausar, voltar e avançar', texto: 'Use estes botões, ou as setas e a barra de espaço do teclado. A aula também pausa sozinha quando você abre o chat.', alvo: '.atl-ctrl' },
    { titulo: 'Voz', texto: 'O BMX narra cada passo. Este botão liga e desliga a voz; a legenda continua na tela.', alvo: '#atlVoz' },
    { titulo: 'Pergunte durante a aula', texto: 'Ficou com dúvida em algum ponto? Toque em Perguntar. O BMX responde sobre o que está na tela, sem mexer no seu caso.', alvo: '#atlPerguntar' },
    { titulo: 'Depois da aula', texto: 'Ao final se abre o painel do caso, com os remédios e o que observar. Você pode ir direto com Ver painel.', alvo: '#atlPular' }
  ],

  painel: [
    { titulo: 'O seu caso em um painel', texto: 'Aqui fica tudo o que o BMX organizou a partir da conversa: dor, nível de atendimento, sinais de alerta, corpo 3D, remédios e linha do tempo.' },
    { titulo: 'Dor e nível de atendimento', texto: 'A dor vem da escala que você marcou. O nível (emergência, urgente, consulta ou autocuidado) é o que o BMX classificou na conversa.', alvo: '.esq .medida' },
    { titulo: 'Sinais de alerta', texto: 'Cada sinal pode estar confirmado (!), descartado (✓) ou ainda não perguntado (?). Se algum estiver confirmado, procure atendimento.', alvo: '#sinais' },
    { titulo: 'O corpo 3D', texto: 'As estruturas do seu caso ficam destacadas. Toque em uma estrutura da lista, troque as camadas e use Frente, Costas e Região para mudar a vista.', alvo: '#palco' },
    { titulo: 'Alívio e remédios', texto: 'Aqui aparecem as opções comuns para o seu tipo de queixa, com foto, cuidados e o aviso se a sua ficha tiver alergia. É informação geral, sem dose e sem prescrição: confirme com um farmacêutico ou médico.', alvo: '#paraCaso .pc-remedios' },
    { titulo: 'Atlas e demonstrações', texto: 'Veja o atlas 3D do seu caso de novo, ou toque em uma demonstração guiada para ver, com voz, onde fica a região e o que observar.', alvo: '#paraCasoAcoes' },
    { titulo: 'Perguntar e sugerir', texto: 'Dúvida sobre o que está nesta tela? Toque em Perguntar. Para contar algo novo sobre o que você sente, use a conversa do Atendimento. Tem uma sugestão ou viu algo errado? Use Sugestão.', alvo: '.bf-botoes' }
  ],

  demo: [
    { titulo: 'Demonstração guiada', texto: 'O BMX explica com voz, move a câmera no corpo 3D e mostra cartões com o que importa em cada passo.' },
    { titulo: 'Escolha a profundidade', texto: 'Simples traz só o resumo; Intermediário acrescenta a explicação e o glossário; Aprofundado vai mais fundo.', alvo: '#demoNiveis' },
    { titulo: 'Controle o ritmo', texto: 'Pause, volte ou avance, ou toque em um traço para ir a um passo. Abrir o chat também pausa a demonstração.', alvo: '.demo-controle' },
    { titulo: 'Tire dúvidas', texto: 'Ficou com alguma dúvida? Use Perguntar no topo do painel para conversar sobre este passo.' }
  ]
};
