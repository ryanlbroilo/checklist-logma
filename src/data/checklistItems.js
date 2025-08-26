
const checklistItems = {
  veiculo: [
    "Retrovisores", "Parabrisa", "Certificado cronotacógrafo", "Veículo está abastecido",
    "Extintor", "Alavanca bascular cabine", "Macaco hidráulico", "Sistema elétrico",
    "Lanterna traseira direita", "Lanterna traseira esquerda", "Limpeza interna cabine",
    "Sistema de som/radio", "Funcionamento do farol (alta/baixa)", "Funcionamento do pisca alerta",
    "Estado dos bancos (estofamento)", "Nível de óleo do motor", "Nível de água do radiador",
    "Placa do veículo legível", "Sirene de marcha ré", "Luz de placa", "Estado geral do bau",
    "Luz interna do bau", "Carrinho de descarga", "Ar condicionado", "Buzina", "Tampa de Combustível",
    "Estado dos Pneus", "Outros"
  ],

  // Empilhadeira genérica (caso não venha "gas" ou "eletrica")
  empilhadeiraPadrao: [
    "Faróis Dianteiros", "Stop De Freio", "Sinal Sonoro (Buzina)",
    "Ré Sonoro", "Pneus estão em boas condições", "O SISTEMA DE ALIMENTAÇÃO (MANGUEIRAS E BOTIJÃO) APRESENTAM ALGUM ASPECTO OU ODOR QUE INDIQUE VAZAMENTO DE GÁS?",
    "O SISTEMA HIDRÁULICO (MANGUEIRAS E BOMBAS) APRESENTAM ALGUM ASPECTO QUE INDIQUE VAZAMENTO DE ÓLEO?", "Sistema de Frenagem", "Sistema de refrigeração do motor (radiador)",
    "Operador utilizando EPIS", "Extintor com carga plena e no prazo de validade", "Cinto de segurança em boas condições?", "A torre, corrente e garfos estão em boas condições de uso?",
    "Diante de todos os pontos observados, a empilhadeira está em condições de operar normalmente?", "Outros"
  ],

  empilhadeiraGas: [
    "Faróis Dianteiros", "Stop De Freio", "Sinal Sonoro (Buzina)",
    "Ré Sonoro", "Pneus estão em boas condições", "O sistema de alimentação de gás está ok?",
    "O SISTEMA HIDRÁULICO (MANGUEIRAS E BOMBAS) APRESENTAM ALGUM ASPECTO QUE INDIQUE VAZAMENTO DE ÓLEO?", "Sistema de Frenagem", "Sistema de refrigeração do motor (radiador)",
    "Operador utilizando EPIS", "Extintor com carga plena e no prazo de validade", "Cinto de segurança em boas condições?", "A torre, corrente e garfos estão em boas condições de uso?",
    "Diante de todos os pontos observados, a empilhadeira está em condições de operar normalmente?", "Outros"
  ],

  empilhadeiraEletrica: [
    "Faróis Dianteiros", "Sinal Sonoro (Buzina)",
    "Ré Sonoro", "Pneus estão em boas condições",
    "Carga da bateria suficiente para operação?", "Cabos, conexões e plugs em bom estado?",
    "Sistema de Frenagem", "Sistema de refrigeração do motor (Ventoinha)",
    "Operador utilizando EPIS", "Extintor com carga plena e no prazo de validade", "Cinto de segurança em boas condições?", "A torre, corrente e garfos estão em boas condições de uso?",
    "Diante de todos os pontos observados, a empilhadeira está em condições de operar normalmente?", "Outros"
  ],

  paleteiraNormal: [
    "Condição das rodinhas",
    "Alavanca de elevação funcionando",
    "Estrutura sem trincos/soltas",
    "Sem vazamentos de óleo ou graxa",
    "Diante de todos os pontos, a paleteira está em condições de operar?", "Outros"
  ],

  paleteiraGalvanizada: [
    "Condição das rodinhas",
    "Alavanca galvanizada funcionando",
    "Estrutura galvanizada sem danos",
    "Sem sinais de ferrugem",
    "Diante de todos os pontos, a paleteira galvanizada está em condições de operar?", "Outros"
  ],

  gerador: [
    "Nível de óleo do motor", "Nível de água do radiador", "Nível de combustível",
    "Bateria carregada", "Painel de controle funcional", "Sistema de exaustão",
    "Cabos e conexões", "Sistema de partida", "Proteções (fusíveis/disjuntores)",
    "Vazamentos visíveis", "Outros"
  ],
};

export default checklistItems;
