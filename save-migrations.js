const DIGITAL_MODEL_SCHEMA_VERSION_FIELD = 'digitalModelSchemaVersion';
const INITIAL_DIGITAL_MODEL_SCHEMA_VERSION = 1;
const CURRENT_DIGITAL_MODEL_SCHEMA_VERSION = INITIAL_DIGITAL_MODEL_SCHEMA_VERSION;

function cloneState(value) {
  return structuredClone(value);
}

function migrateVersion0To1(state) {
  return {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: INITIAL_DIGITAL_MODEL_SCHEMA_VERSION,
  };
}

const MIGRATIONS = new Map([
  [0, { toVersion: INITIAL_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion0To1 }],
]);

function readDigitalModelSchemaVersion(rawRoom) {
  const hasVersion = rawRoom !== null
    && typeof rawRoom === 'object'
    && !Array.isArray(rawRoom)
    && Object.hasOwn(rawRoom, DIGITAL_MODEL_SCHEMA_VERSION_FIELD);
  const version = hasVersion ? rawRoom[DIGITAL_MODEL_SCHEMA_VERSION_FIELD] : 0;

  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid digital model schema version: ${String(version)}`);
  }
  if (version > CURRENT_DIGITAL_MODEL_SCHEMA_VERSION) {
    throw new Error(`Unsupported future digital model schema version: ${version}`);
  }
  return version;
}

function migrateRoomState(rawRoom) {
  const fromVersion = readDigitalModelSchemaVersion(rawRoom);
  let state = cloneState(rawRoom);
  let version = fromVersion;

  while (version < CURRENT_DIGITAL_MODEL_SCHEMA_VERSION) {
    const step = MIGRATIONS.get(version);
    if (!step || step.toVersion !== version + 1) {
      throw new Error(`Missing digital model schema migration from version ${version}`);
    }
    state = step.migrate(state);
    version = step.toVersion;
  }

  return {
    state,
    migrated: fromVersion !== version,
    fromVersion,
    toVersion: version,
  };
}

module.exports = {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  migrateRoomState,
};
