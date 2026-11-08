// SPDX-License-Identifier: Apache-2.0
// Runs in CI after webpack. This never reads or modifies upstream bundles.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'skyline_console/static');
const assets = path.join(root, 'SuperProtocol/assets');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (file) => {
  if (!fs.lstatSync(file).isFile()) throw new Error('Regular build input required');
  return fs.readFileSync(file);
};
const commit = process.env.SOURCE_COMMIT;
if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('Exact SOURCE_COMMIT required');
const names = fs.readdirSync(assets).sort();
const hashes = Object.fromEntries(names.map((name) => [name, sha(read(path.join(assets, name)))]));
names.forEach((name) => {
  let bytes = read(path.join(assets, name));
  if (name.endsWith('.html')) {
    // Keep public URLs, but cache-bust every local asset from this same build.
    bytes = Buffer.from(bytes.toString().replace(/((?:src|href)="\/)([^"?]+)(?:\?[^" ]*)?(")/g,
      (match, prefix, asset, quote) => hashes[asset]
        ? `${prefix}${asset}?v=${hashes[asset].slice(0, 20)}${quote}` : match));
  }
  fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
});
const files = {};
function visit(directory) {
  fs.readdirSync(directory).sort().forEach((name) => {
    const file = path.join(directory, name);
    const info = fs.lstatSync(file);
    if (info.isDirectory()) return visit(file);
    const bytes = read(file);
    const relative = path.relative(output, file).split(path.sep).join('/');
    // Webpack gzip is replaced with a deterministic sibling for every text asset.
    if (name.endsWith('.gz')) return;
    files[relative] = sha(bytes);
    if (/\.(?:html|js|css|json|svg)$/.test(name)) {
      const compressed = zlib.gzipSync(bytes, { level: 9 });
      fs.writeFileSync(`${file}.gz`, compressed);
      files[`${relative}.gz`] = sha(compressed);
    }
  });
}
visit(output);
const lock = JSON.parse(read(path.join(__dirname, 'component-lock.json')));
const manifest = {
  schema_version: 1,
  capability: 'prebuilt-openstack-images-v1',
  component: 'skyline-console',
  version: lock.component_version,
  source_commit: commit,
  upstream_source: lock.upstream_source,
  kolla_revision: lock.kolla_revision,
  node_version: process.versions.node,
  yarn_version: lock.yarn_version,
  asset_sha256: files,
  nginx_sha256: sha(read(path.join(__dirname, 'nginx.conf.j2'))),
  nginx_source_sha256: lock.nginx_source_sha256,
};
fs.mkdirSync(path.join(root, 'SuperProtocol/output'), { recursive: true });
fs.writeFileSync(path.join(root, 'SuperProtocol/output/console-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
