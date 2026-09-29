function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
// Master data, including fields with explicitly pending consumers.
module.exports = deepFreeze({
  metadata: require('./metadata.json'), fleet: require('./fleet.json'),
  economy: require('./economy.json'), islands: require('./islands.json'),
  politics: require('./politics.json'), sea: require('./sea.json'),
  events: require('./events.json'), legends: require('./legends.json'),
  characters: require('./characters.json'), session: require('./session.json'),
  scoring: require('./scoring.json'),
  implementation: require('./implementation.json'),
});
