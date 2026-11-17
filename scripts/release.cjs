// Ship a release:  npm run release -- 1.2
// Checks main is clean, pushed and green in CI, then creates the GitHub release
// (notes generated from merged PRs). That triggers the Deploy workflow, which
// this script then watches until the new version is live.
// Needs the GitHub CLI (`gh`), logged in.
const { execFileSync } = require('child_process');

function run(cmd, args, opts) {
    return execFileSync(cmd, args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts)).trim();
}
function fail(message) {
    console.error('\n✗ ' + message);
    process.exit(1);
}
function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const version = String(process.argv[2] || '').trim();
if (!/^\d+(\.\d+){1,2}$/.test(version)) {
    const tags = run('git', ['tag', '--sort=-v:refname']).split('\n').filter(Boolean);
    fail(`Usage: npm run release -- <version>   e.g. 1.2   (latest tag: ${tags[0] || 'none'})`);
}

console.log(`Releasing ${version}…`);
run('git', ['fetch', '--tags', 'origin']);

if (run('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('Switch to main first (git checkout main).');
if (run('git', ['status', '--porcelain'])) fail('Working tree has uncommitted changes.');
const head = run('git', ['rev-parse', 'HEAD']);
if (head !== run('git', ['rev-parse', 'origin/main'])) fail('Local main differs from origin/main — pull or push first.');
if (run('git', ['tag', '--list', version])) fail(`Tag ${version} already exists. Pick a new version.`);

const runs = JSON.parse(run('gh', ['run', 'list', '--workflow', 'tests.yml', '--branch', 'main', '--event', 'push',
    '--limit', '5', '--json', 'headSha,status,conclusion,url']));
const ci = runs.find((r) => r.headSha === head);
if (!ci) fail('No CI run found for the latest main commit yet. Wait for it, then retry.');
if (ci.status !== 'completed') fail(`CI for main is still running: ${ci.url}`);
if (ci.conclusion !== 'success') fail(`CI for main did not pass (${ci.conclusion}): ${ci.url}`);
console.log('✓ main is clean, pushed and green in CI');

const before = new Date().toISOString();
const url = run('gh', ['release', 'create', version, '--target', 'main', '--title', version, '--generate-notes']);
console.log(`✓ Release created: ${url}`);

// Find the Deploy run the release triggered, then follow it.
let deploy = null;
for (let i = 0; i < 30 && !deploy; i++) {
    sleep(4000);
    const found = JSON.parse(run('gh', ['run', 'list', '--workflow', 'deploy.yml', '--limit', '5',
        '--json', 'databaseId,headBranch,createdAt,url']));
    deploy = found.find((r) => r.headBranch === version && r.createdAt >= before) || null;
}
if (!deploy) fail('Release created, but the Deploy run did not start. Check the Actions tab.');
console.log(`… Deploying: ${deploy.url}`);
try {
    execFileSync('gh', ['run', 'watch', String(deploy.databaseId), '--exit-status', '--interval', '10'], { stdio: 'inherit' });
} catch (_) {
    fail(`Deploy failed: ${deploy.url}\nNothing is half-applied on devices: they only update once the new service-worker.js (uploaded last) is live.`);
}
console.log(`\n✓ ${version} is live. Devices will show "Update Available" next time they open the app.`);
