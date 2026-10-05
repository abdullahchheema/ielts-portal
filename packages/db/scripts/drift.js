// Read-only drift check: prints the SQL that would make the live database match schema.prisma.
// Writes nothing. Works the same in PowerShell, Command Prompt and Git Bash.
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const url = process.env.DIRECT_URL;
if (!url) {
  console.error('DIRECT_URL is not set in the root .env file.');
  process.exit(1);
}

const prismaCli = require.resolve('prisma/build/index.js', { paths: [path.resolve(__dirname, '..')] });
const result = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
  { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' },
);
process.exit(result.status ?? 1);
