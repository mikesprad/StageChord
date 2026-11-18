// Builds dist/ — exactly the files to upload — stamped with a release version.
//   node scripts/build-deploy.cjs 1.2
// The repo keeps its dev version stamps; only dist/ is stamped, so releases
// never need a "bump version" commit (and two people can't conflict on one).
// The deploy workflow runs this on each GitHub release. For an emergency manual
// upload, run it locally and upload dist/ with service-worker.js LAST.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// Everything the live app needs. songlibs/ isn't in the offline cache, but
// help.html fetches bundles from it.
const DEPLOY = [
    'index.html', 'help.html', 'app.js', 'db.js', 'parser.js', 'stave.js', 'styles.css',
    'manifest.json', 'service-worker.js', 'vexflow.bundle.js', 'icons', 'songlibs'
];
// Files that carry version stamps.
const STAMPED = ['index.html', 'app.js', 'service-worker.js'];

const raw = String(process.argv[2] || '').trim();
if (!/^v?\d+(\.\d+){1,2}$/.test(raw)) {
    console.error('Usage: node scripts/build-deploy.cjs <version>   e.g. 1.2 or v1.2.0');
    process.exit(1);
}
const version = raw.replace(/^v/, '');

// The dev build ID currently in the repo, e.g. '20261016T2'.
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const idMatch = indexHtml.match(/__STAGECHORD_BUILD_ID__\s*=\s*'([^']+)'/);
if (!idMatch) throw new Error('Could not find __STAGECHORD_BUILD_ID__ in index.html');
const devBuildId = idMatch[1];

fs.rmSync(dist, { recursive: true, force: true });
for (const item of DEPLOY) {
    fs.cpSync(path.join(root, item), path.join(dist, item), { recursive: true });
}
// Server cache rules (see deploy/htaccess).
fs.copyFileSync(path.join(root, 'deploy', 'htaccess'), path.join(dist, '.htaccess'));

for (const file of STAMPED) {
    const p = path.join(dist, file);
    let text = fs.readFileSync(p, 'utf8');
    text = text.split(devBuildId).join(version);
    if (file === 'service-worker.js') {
        const before = text;
        // A new CACHE_VERSION is what makes installed apps offer "Update Available".
        text = text.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = 'sv-${version}';`);
        if (text === before) throw new Error('Could not find CACHE_VERSION in service-worker.js');
    }
    fs.writeFileSync(p, text);
}

for (const file of STAMPED) {
    if (fs.readFileSync(path.join(dist, file), 'utf8').includes(devBuildId)) {
        throw new Error(`${file} still contains the dev build ID`);
    }
}
console.log(`Built dist/ for version ${version} (cache sv-${version}).`);
