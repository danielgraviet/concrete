const { registerRunner, hasRunner, listRunners, createRunner } = require('./factory.cjs');
const docker = require('./dockerRunner.cjs');

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

// Future backends plug in here, e.g.:
// registerRunner('e2b', { label: 'E2B', create: (config) => require('./e2bRunner.cjs').create(config) });
// registerRunner('daytona', { label: 'Daytona', create: (config) => require('./daytonaRunner.cjs').create(config) });

module.exports = {
  DEFAULT_RUNNER_ID,
  listRunners,
  hasRunner,
  getRunner: (id) => createRunner(id || DEFAULT_RUNNER_ID, 'off'),
};
