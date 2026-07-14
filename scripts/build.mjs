import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(root, 'dist');
const packageRoot = path.join(distRoot, 'meridian');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const zipPath = path.join(distRoot, `meridian-${manifest.version}.zip`);
const fixedTimestamp = new Date('2000-01-01T00:00:00.000Z');

const runtimePaths = [
  'LICENSE',
  'core.js',
  'manifest.json',
  'newtab.css',
  'newtab.html',
  'newtab.js',
  '_locales',
  'data',
  'fonts/inter-300.ttf',
  'fonts/inter-400.ttf',
  'fonts/inter-500.ttf',
  'fonts/inter-600.ttf',
  'fonts/jbm-200.ttf',
  'fonts/jbm-300.ttf',
  'fonts/jbm-400.ttf',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

await mkdir(distRoot, { recursive: true });
await rm(packageRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

for (const relativePath of runtimePaths) {
  const source = path.join(root, relativePath);
  const destination = path.join(packageRoot, relativePath);
  const sourceStat = await stat(source);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: sourceStat.isDirectory() });
}

const packageFiles = await listFiles(packageRoot);
for (const relativePath of packageFiles) {
  await utimes(path.join(packageRoot, relativePath), fixedTimestamp, fixedTimestamp);
}

await rm(zipPath, { force: true });
execFileSync('zip', ['-X', '-q', zipPath, ...packageFiles], {
  cwd: packageRoot,
  stdio: 'inherit',
});

const zipEntries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
if (!zipEntries.includes('manifest.json') || zipEntries.some(entry => entry.startsWith('meridian/'))) {
  throw new Error('Release ZIP must contain manifest.json and all assets at its root.');
}

console.log(`Built ${path.relative(root, packageRoot)} and ${path.relative(root, zipPath)} (${packageFiles.length} files).`);
