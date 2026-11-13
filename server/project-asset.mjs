import path from 'node:path';
import { open, realpath } from 'node:fs/promises';

const MIME = new Map(Object.entries({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon',
}));
function fail(status, message) {
  throw Object.assign(new Error(message), { status, code: 'ASSET_UNAVAILABLE' });
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export async function readProjectAsset(projectRoot, contentRoots = ['.'], assetPath, { head = false } = {}) {
  // The query parser decodes once. Never decode again or normalize away traversal.
  if (typeof assetPath !== 'string' || !assetPath || /[\\:\x00-\x1f]/.test(assetPath)
    || assetPath.startsWith('/') || assetPath.split('/').includes('..')) {
    fail(400, 'Asset path must be a project-relative path without parent traversal.');
  }
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, assetPath);
  const allowed = contentRoots.map(value => path.resolve(root, value))
    .filter(value => within(root, value) && within(value, target));
  if (!within(root, target) || !allowed.length) fail(403, 'Asset is outside allowed content roots.');
  const contentType = MIME.get(path.extname(target).toLowerCase());
  if (!contentType) fail(415, 'Unsupported image type.');
  try {
    const [realRoot, realTarget, realAllowed] = await Promise.all([
      realpath(root), realpath(target), Promise.all(allowed.map(value => realpath(value))),
    ]);
    // A symlink/junction must not escape either the project or its allowed roots.
    if (!within(realRoot, realTarget) || !realAllowed.some(value => within(realRoot, value) && within(value, realTarget))) {
      fail(403, 'Asset resolves outside allowed content roots.');
    }
    const handle = await open(realTarget, 'r');
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) fail(404, 'Asset is not a file.');
      return {
        body: head ? null : await handle.readFile(),
        headers: {
          'content-type': contentType,
          'content-length': metadata.size,
          'cache-control': 'private, max-age=300',
          'last-modified': metadata.mtime.toUTCString(),
          'x-content-type-options': 'nosniff',
          // SVG remains an image, including when opened directly in a tab.
          'content-security-policy': "default-src 'none'; sandbox",
        },
      };
    } finally { await handle.close(); }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') fail(404, 'Asset not found.');
    if (error.code === 'EACCES' || error.code === 'EPERM') fail(403, 'Asset is not readable.');
    throw error;
  }
}
