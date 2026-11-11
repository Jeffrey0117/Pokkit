'use strict';

const path = require('node:path');

/**
 * Turning an uploaded file name into one the disk will accept.
 *
 * The name people see lives in the database untouched. This is only for the
 * name written to disk — the server runs on Windows, where < > : " | ? * and
 * control characters are refused, trailing dots/spaces are silently dropped,
 * and a few device names (CON, NUL, COM1…) never reach the filesystem at all.
 * All of those are ordinary file names on a phone or a Mac.
 */

// NTFS allows 255; leave room for the `.tmp-xxxxxxxx` suffix of atomic writes.
const MAX_DISK_NAME = 200;
const MAX_EXT = 20;
const FORBIDDEN = /[<>:"|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function lastSegment(name) {
  // Split on both separators: path.basename only knows the host platform's.
  return String(name ?? '').split(/[\\/]/).pop();
}

function clampLength(name) {
  if (name.length <= MAX_DISK_NAME) return name;
  const ext = path.extname(name);
  const keptExt = ext.length <= MAX_EXT ? ext : '';
  // A cut can land between the two halves of an emoji; drop the orphaned half.
  const stem = name.slice(0, MAX_DISK_NAME - keptExt.length).replace(/[\uD800-\uDBFF]$/, '');
  return stem + keptExt;
}

function diskSafeName(filename) {
  const cleaned = lastSegment(filename)
    .replace(/^\.+/, '')
    .replace(FORBIDDEN, '_')
    .replace(/[. ]+$/, '');
  if (!cleaned) return 'file';
  const clamped = clampLength(cleaned).replace(/[. ]+$/, '');
  return RESERVED.test(clamped) ? `_${clamped}` : clamped;
}

/** Extension (with the dot) for a `_raw.<ext>` file, or `fallback` when unusable. */
function diskSafeExt(filename, fallback) {
  const ext = path.extname(lastSegment(filename)).replace(FORBIDDEN, '_').replace(/[. ]+$/, '');
  if (ext.length < 2 || ext.length > MAX_EXT) return fallback;
  return ext;
}

module.exports = { diskSafeName, diskSafeExt, MAX_DISK_NAME };
