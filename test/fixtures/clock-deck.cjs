// Deterministic cards for the round-clock integration test only.
const logic = require('../../game-logic');
logic.createSailingEventDeck = () => ({
  drawPile: [
    { id:'clock-storm', name:'Шторм у Атлантии', type:'storm', islandId:'atlantia' },
    { id:'clock-hunger', name:'Голод', type:'next-turn', effect:'noIncome', value:true },
    ...Array.from({length:4}, (_, index) => ({
      id:`clock-wind-${index}`, name:'Попутный ветер', type:'next-turn', effect:'moveBonus', value:2,
    })),
  ],
  discard: [],
});
