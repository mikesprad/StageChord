// Fails if app code uses JavaScript that old Safari (iOS 12 / Safari 12) can't run.
// The app has no build step, so this is the only thing standing between a modern
// shortcut and a broken app on an old iPad. Run: npm run check:old-browsers
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const fs = require('fs');
const path = require('path');

// Our own code only. vexflow.bundle.js is third-party and loaded on demand, with
// a fallback in stave.js when it can't load.
const FILES = ['app.js', 'db.js', 'parser.js', 'stave.js', 'service-worker.js', 'index.html', 'help.html'];

// Browser APIs newer than Safari 12 (add to this list as you find more).
const NEW_APIS = new Set(['fromEntries', 'replaceAll', 'matchAll', 'allSettled', 'structuredClone',
    'globalThis', 'hasOwn', 'findLast', 'findLastIndex', 'toSorted', 'toReversed', 'replaceChildren',
    'requestIdleCallback', 'queueMicrotask']);

const problems = [];

function check(file, code, lineOffset) {
    const report = (node, what) => problems.push(`${file}:${node.loc.start.line + lineOffset}  ${what}`);
    let ast;
    try {
        ast = parse(code, { sourceType: file.endsWith('.html') ? 'script' : 'module' });
    } catch (e) {
        problems.push(`${file}  could not parse: ${e.message}`);
        return;
    }
    traverse(ast, {
        OptionalMemberExpression(p) { report(p.node, 'optional chaining ?.'); },
        OptionalCallExpression(p) { report(p.node, 'optional call ?.()'); },
        LogicalExpression(p) { if (p.node.operator === '??') report(p.node, 'nullish coalescing ??'); },
        AssignmentExpression(p) {
            if (['||=', '&&=', '??='].includes(p.node.operator)) report(p.node, `logical assignment ${p.node.operator}`);
        },
        ClassProperty(p) { report(p.node, 'class field'); },
        ClassPrivateProperty(p) { report(p.node, 'private class field'); },
        ClassPrivateMethod(p) { report(p.node, 'private class method'); },
        StaticBlock(p) { report(p.node, 'class static block'); },
        BigIntLiteral(p) { report(p.node, 'BigInt'); },
        NumericLiteral(p) { if (p.node.extra && /_/.test(p.node.extra.raw)) report(p.node, 'numeric separator'); },
        RegExpLiteral(p) {
            if (/\(\?<[=!]/.test(p.node.pattern)) report(p.node, 'regex lookbehind');
            if (/[dv]/.test(p.node.flags)) report(p.node, `regex flag ${p.node.flags}`);
        },
        AwaitExpression(p) { if (!p.getFunctionParent()) report(p.node, 'top-level await'); },
        MemberExpression(p) {
            const prop = p.node.property;
            const name = prop && (prop.name || prop.value);
            if (NEW_APIS.has(name)) report(p.node, `API .${name}`);
            if (name === 'at' && p.parent.type === 'CallExpression' && p.parent.callee === p.node) report(p.node, 'API .at()');
        },
        Identifier(p) {
            if (NEW_APIS.has(p.node.name) && !p.parentPath.isMemberExpression({ property: p.node })) report(p.node, `API ${p.node.name}`);
        }
    });
}

const root = path.join(__dirname, '..');
for (const file of FILES) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    if (file.endsWith('.html')) {
        const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
        let m;
        while ((m = re.exec(code))) check(file, m[1], code.slice(0, m.index).split('\n').length - 1);
    } else {
        check(file, code, 0);
    }
}

if (problems.length) {
    console.error('Code old Safari (iOS 12) cannot run — see "Guiding principle" in README.md:\n');
    problems.forEach((p) => console.error('  ' + p));
    process.exit(1);
}
console.log(`Old-browser check passed (${FILES.length} files).`);
