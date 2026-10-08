const { registerRunner, hasRunner, listRunners, createRunner, disposeRunners } = require('./factory.cjs');
const docker = require('./dockerRunner.cjs');
const daytona = require('./daytonaRunner.cjs');

const DEFAULT_RUNNER_ID = 'docker';

/** Code execution disabled: quizzes fall back to unverified code questions. */
registerRunner('off', {
  label: 'Off',
  create: () => ({
    id: 'off',
    label: 'Off',
    async status() {
      return { available: false, detail: 'Code execution is turned off.', languages: [] };
    },
    async run() {
      return {
        ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, durationMs: 0,
        error: 'Code execution is turned off.',
      };
    },
  }),
});

registerRunner('docker', { label: 'Docker (local)', create: docker.create });
registerRunner('daytona', { label: 'Daytona (cloud)', create: daytona.create });

// Future backends plug in here, e.g.:
// registerRunner('e2b', { label: 'E2B', create: (config) => require('./e2bRunner.cjs').create(config) });

module.exports = {
  DEFAULT_RUNNER_ID,
  listRunners,
  hasRunner,
  /** `config` reaches a runner's create() the first time it is used (e.g. key resolvers). */
  getRunner: (id, config) => createRunner(id || DEFAULT_RUNNER_ID, 'off', config),
  /** Release remote resources (e.g. the warm Daytona sandbox) on quit. */
  disposeAll: disposeRunners,
};
