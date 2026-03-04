#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(distDir)) {
  console.error('dist directory does not exist, nothing to do');
  process.exit(0);
}

const files = fs.readdirSync(distDir);
for (const f of files) {
  if (f.endsWith('.cjs')) {
    const base = f.slice(0, -4);
    const src = path.join(distDir, f);
    const dest = path.join(distDir, `${base}.js`);
    try {
      fs.copyFileSync(src, dest);
      console.log(`Copied ${f} -> ${base}.js`);
    } catch (err) {
      console.warn(`Failed to copy ${f} -> ${base}.js:`, err && err.message ? err.message : err);
    }
  }
}

// Also ensure the expected extension entrypoint exists: dist/extension.js
const extCjs = path.join(distDir, 'extension.cjs');
const extJs = path.join(distDir, 'extension.js');
if (fs.existsSync(extCjs) && !fs.existsSync(extJs)) {
  try {
    fs.copyFileSync(extCjs, extJs);
    console.log('Ensured extension.js exists');
  } catch (err) {
    console.warn('Failed to ensure extension.js:', err && err.message ? err.message : err);
  }
}

process.exit(0);
