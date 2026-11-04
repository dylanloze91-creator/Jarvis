const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} piperRoot
 * @param {readonly { relativePath: string; minBytes: number }[]} checks
 * @returns {string[]}
 */
function verifyPiperWindowsBundle(piperRoot, checks) {
  const problems = [];
  for (const check of checks) {
    const file = path.join(piperRoot, ...check.relativePath.split('/'));
    if (!fs.existsSync(file)) {
      problems.push(`manquant : ${check.relativePath}`);
      continue;
    }
    const size = fs.statSync(file).size;
    if (size < check.minBytes) {
      problems.push(`trop petit (${size} octets) : ${check.relativePath}`);
    }
  }
  return problems;
}

module.exports = { verifyPiperWindowsBundle };
