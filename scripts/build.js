const esbuild = require('esbuild');
const fs      = require('fs');
const path    = require('path');

const isDev   = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');

function copy(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
    }
}

function copyStaticAssets() {
    // Root assets
    for (const f of ['manifest.json', 'favicon.png', 'airports.json', 'THIRD_PARTY_NOTICES.md']) {
        copy(f, `dist/${f}`);
    }
    // Extension icons
    copyDir('icons', 'dist/icons');
    // HTML + CSS files
    copy('src/offline/offline.html', 'dist/offline/offline.html');
    copy('src/offline/offline.css',  'dist/offline/offline.css');
    copy('src/options/jp.html',         'dist/options/jp.html');
    copy('src/options/jp.css',          'dist/options/jp.css');
    copy('src/options/jp-content.css',  'dist/options/jp-content.css');
    copy('src/options/about.html',      'dist/options/about.html');
    copy('src/options/about.css',       'dist/options/about.css');
    // Plain JS / other assets
    copy('src/page-hook.js', 'dist/page-hook.js');
    // Locale files
    copyDir('_locales', 'dist/_locales');
}

const config = {
    entryPoints: [
        { in: 'src/offline/offline.ts', out: 'offline/offline' },
        { in: 'src/options/jp.ts',      out: 'options/jp'      },
        { in: 'src/options/config.ts',  out: 'options/config'  },
        { in: 'src/options/about.ts',   out: 'options/about'   },
        { in: 'src/content.ts',         out: 'content'         },
    ],
    bundle:    true,
    minify:    !isDev,
    sourcemap: isDev ? 'inline' : false,
    outdir:    'dist',
    target:    ['chrome109', 'firefox109'],
    format:    'iife',
    platform:  'browser',
};

if (isWatch) {
    copyStaticAssets();
    esbuild.context(config).then(ctx => {
        ctx.watch();
        console.log('Watching for changes…');
    });
} else {
    copyStaticAssets();
    esbuild.build(config).catch(() => process.exit(1));
}
