const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('public/styles.css', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');

test('UI-40 uses one canonical normalization block', () => {
  assert.equal((css.match(/UI-40 — staging visual normalization/g) || []).length, 1);
  assert.equal((css.match(/UI-40 staging (?:micro-)?patch/g) || []).length, 0);
  assert.equal((css.match(/UI-40 quick access (?:correction|refinement|final composition)/g) || []).length, 0);
});

test('map player marker is centered on the authoritative cell center', () => {
  assert.match(app, /t\.style\.left = `calc\(\(\$\{p\.col\} \+ \.5\) \* 100% \/ \$\{cols\}/);
  assert.match(app, /t\.style\.top = `calc\(\(\$\{p\.row\} \+ \.5\) \* 100% \/ \$\{rows\}/);

  const tokenBlock = css.match(/body\.game-active \.token \{([\s\S]*?)\n\}/g)?.at(-1) || '';
  assert.match(tokenBlock, /width:\s*calc\(100% \/ var\(--map-cols, 28\) \* \.4608\)/);
  assert.match(tokenBlock, /height:\s*auto/);
  assert.match(tokenBlock, /aspect-ratio:\s*1 \/ 1/);
  assert.match(tokenBlock, /transform:\s*translate\(-50%, -50%\)/);
  assert.match(tokenBlock, /min-height:\s*0/);
  assert.match(css, /body\.game-active button:not\(\.map-object-hit\):not\(\.navigation-hit\):not\(\.targeting-hit\):not\(\.targeting-marker\):not\(\.cell-hit\):not\(\.token\) \{[\s\S]*?min-height:\s*44px/);
});

test('compact map tools have explicit square geometry', () => {
  const block = css.match(/body\.game-active \.map-toolbar \.map-tool-icon \{([\s\S]*?)\n  \}/)?.[0] || '';
  assert.match(block, /width:\s*30px/);
  assert.match(block, /height:\s*30px/);
  assert.match(block, /min-width:\s*30px/);
  assert.match(block, /min-height:\s*30px/);
  assert.match(block, /aspect-ratio:\s*1 \/ 1/);
});
