const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'hello from workspace hook at ';
const MAX_AGE_MS = 5 * 60 * 1000;

module.exports = function verify(worktree) {
  const marker = path.join(worktree, '.claude/skills/test-skill/.active');
  if (fs.existsSync(marker)) return false;

  let content;
  try {
    content = fs.readFileSync(
      path.join(worktree, 'logs/agent/test-skill-hook.txt'),
      'utf8',
    ).trim();
  } catch {
    return false;
  }

  if (!content.startsWith(PREFIX)) return false;
  const timestamp = content.slice(PREFIX.length);
  if (!timestamp.endsWith('Z')) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  const age = Date.now() - parsed;
  return age >= 0 && age <= MAX_AGE_MS;
};
