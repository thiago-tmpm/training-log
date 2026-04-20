'use strict';

// ── EXERCISE DATA ──
// Single source of truth for all workout structure.
// IDs are stable — changing exercise names will not break historical data.

const EXERCISES = {
  lower_1: [
    { id: 'l1_1', name: 'Adutor',                                          sets: 3, repRange: '8-12'      },
    { id: 'l1_2', name: 'Agachamento Guiado - Hack',                       sets: 3, repRange: '5-8'       },
    { id: 'l1_3', name: 'Cadeira Flexora - Máquina Articulada',            sets: 2, repRange: '6-10'      },
    { id: 'l1_4', name: 'Extensora - Cadeira Articulada - Unilateral',     sets: 2, repRange: '8-12'      },
    { id: 'l1_5', name: 'Flexora em Pé - Máquina Articulada - Unilateral', sets: 2, repRange: '8-12'      },
    { id: 'l1_6', name: 'Panturrilha',                                     sets: 4, repRange: '12/10/8/6' }
  ],
  push: [
    { id: 'pu_1', name: 'Supino Reto Smith',                                sets: 2, repRange: '6-10'  },
    { id: 'pu_2', name: 'Crucifixo - Crossover - Polia Alta',              sets: 2, repRange: '10-15' },
    { id: 'pu_3', name: 'Desenvolvimento Máquina Articulada Pegada Neutra', sets: 3, repRange: '6-10'  },
    { id: 'pu_4', name: 'Elevação Frontal Corda - Polia Baixa',            sets: 3, repRange: '8-12'  },
    { id: 'pu_5', name: 'Elevação Lateral - Halter',                       sets: 3, repRange: '8-12'  },
    { id: 'pu_6', name: 'Tríceps Testa',                                   sets: 3, repRange: '6-10'  },
    { id: 'pu_7', name: 'Tríceps Pulley',                                  sets: 2, repRange: '8-12'  }
  ],
  pull: [
    { id: 'pl_1', name: 'Remada Curvada com Barra',                sets: 3, repRange: '6-10'  },
    { id: 'pl_2', name: 'Puxada Alta Unilateral',                  sets: 3, repRange: '8-12'  },
    { id: 'pl_3', name: 'Remada Articulada Unilateral - Neutra',   sets: 2, repRange: '6-10'  },
    { id: 'pl_4', name: 'Pulldown Corda - Polia Alta',             sets: 2, repRange: '10-15' },
    { id: 'pl_5', name: 'Crucifixo Inverso Articulado',            sets: 3, repRange: '8-12'  },
    { id: 'pl_6', name: 'Rosca Direta com Barra',                  sets: 3, repRange: '6-10'  },
    { id: 'pl_7', name: 'Rosca Direta Halter Banco Inclinado',     sets: 2, repRange: '8-12'  }
  ],
  lower_2: [
    { id: 'l2_1', name: 'Stiff',                        sets: 2, repRange: '6-10'      },
    { id: 'l2_2', name: 'Leg Press 45',                 sets: 3, repRange: '5-8'       },
    { id: 'l2_3', name: 'Abdutor Cadeira Articulada',   sets: 2, repRange: '8-12'      },
    { id: 'l2_4', name: 'Mesa Flexora',                 sets: 2, repRange: '8-12'      },
    { id: 'l2_5', name: 'Cadeira Extensora Unilateral', sets: 2, repRange: '6-10'      },
    { id: 'l2_6', name: 'Panturrilha',                  sets: 4, repRange: '12/10/8/6' }
  ],
  upper_body: [
    { id: 'ub_1', name: 'Abdominal Supra',                             sets: 3, repRange: '6-12'  },
    { id: 'ub_2', name: 'Supino Inclinado Articulado Máquina',        sets: 2, repRange: '6-10'  },
    { id: 'ub_3', name: 'Remada Máquina Articulada - Pronada Aberta', sets: 2, repRange: '6-10'  },
    { id: 'ub_4', name: 'Crucifixo Peck Deck',                        sets: 2, repRange: '6-10'  },
    { id: 'ub_5', name: 'Puxada Aberta Pronada',                      sets: 2, repRange: '8-12'  },
    { id: 'ub_6', name: 'Elevação Lateral Polia Unilateral',          sets: 3, repRange: '8-12'  },
    { id: 'ub_7', name: 'Tríceps Francês Sentado Polia',              sets: 2, repRange: '8-12'  }
  ]
};

const WORKOUT_DAY_LABELS = {
  lower_1:    'Lower 1',
  push:       'Push',
  pull:       'Pull',
  lower_2:    'Lower 2',
  upper_body: 'Upper Body'
};

// Maps JS Date.getDay() (0 = Sun ... 6 = Sat) to workout day key
const SCHEDULE_BY_DAY = {
  0: null,           // Sunday    → Rest
  1: 'lower_1',     // Monday
  2: 'push',        // Tuesday
  3: 'pull',        // Wednesday
  4: null,           // Thursday  → Rest
  5: 'lower_2',     // Friday
  6: 'upper_body'   // Saturday
};
