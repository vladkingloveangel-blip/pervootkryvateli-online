// Deterministic cards for the round-clock integration test only.
const source = require('../../sailing-event-source');
source.createSailingEventSourceState = () => ({
  available: [
    { id:'clock-storm', name:'Шторм у Атлантии', type:'storm', islandId:'atlantia' },
    { id:'clock-hunger', name:'Голод', type:'turn-effect', effect:'noIncome', value:true, timing:'current-personal-turn' },
    ...Array.from({length:4}, (_, index) => ({
      id:`clock-wind-${index}`, name:'Попутный ветер', type:'turn-effect', effect:'moveBonus', value:2, timing:'current-personal-turn',
    })),
  ],
  recyclable: [],
  reserved: [],
});
