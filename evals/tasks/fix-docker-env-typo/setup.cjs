/**
 * Seeds logs/docker/build.log for the fix-docker eval, mimicking the capture the
 * Docker: Stack Status / Start: Full Stack tasks write. It is a config issue (not a
 * daemon-unreachable infra error, which would make the skill stop), and it names
 * the committed fixture explicitly so the agent edits it rather than the real
 * docker-compose.yml. /fix-docker should correct the env key typo.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `[config] Validating compose configuration
ERROR: app container failed to start - required environment variable DATABASE_URL is missing.
The compose file evals/fixtures/fix-docker/service.fixture.yml sets \`DATABSE_URL\` (typo) instead of \`DATABASE_URL\`.
Fix the key name in evals/fixtures/fix-docker/service.fixture.yml, then re-run Docker: Stack Status.
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/docker/build.log', LOG);
};
