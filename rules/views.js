const islands = require('./islands.json');
const { resources } = require('./economy.json');
const { factions } = require('./politics.json');
// Pure join: board geometry and economic definitions remain independently editable.
function islandViews(geometry) {
  return geometry.map(({ id, cells }) => {
    const rule = islands.find(island => island.id === id);
    if (!rule) throw new Error(`Missing island rules: ${id}`);
    return { ...rule, cells, resources: rule.resourceIds.map(key => resources[key].name),
      faction: rule.factionId ? factions[rule.factionId].name : undefined,
      reward: rule.rewardText, specialMark: ['atlantia', 'adia', 'skull'].includes(id) };
  });
}
module.exports = { islandViews };
