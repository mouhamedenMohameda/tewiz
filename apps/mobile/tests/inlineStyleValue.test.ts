/**
 * Guard against a trap that neither `tsc` nor any other test in this suite can
 * see, and that only ever shows up on a device.
 *
 * `react-native-worklets/plugin` (Reanimated 4's babel plugin, applied to every
 * file) walks JSX `style` objects and rewrites ANY `<expr>.value` it finds into:
 *
 *   (() => {
 *     console.warn(require('react-native-reanimated').getUseOfValueInStyleWarning());
 *     return <expr>.value;
 *   })()
 *
 * It assumes `.value` means a Reanimated shared value. Nothing in this app
 * imports Reanimated, so that require lands `undefined` and the component dies
 * with "Cannot read property 'getUseOfValueInStyleWarning' of undefined" —
 * pointing at whichever innocent file happened to use the name.
 *
 * Type checking cannot catch it (the types are perfectly valid) and the node
 * tests cannot either (they never run babel). So it gets caught here: `.value`
 * is a reserved property name for anything a style object can reach.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['app', 'components', 'theme', 'lib'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Find `.value` reads inside a `style` object. Deliberately simple and a little
 * over-eager: it scans the text of every `style={{ … }}` / `style: { … }` block
 * rather than parsing, because a false positive here costs a rename and a false
 * negative costs a crash on a user's phone.
 */
function offendingStyleValues(source: string): string[] {
  const hits: string[] = [];
  const styleStart = /style\s*(?:=\{\{|:\s*\{)/g;

  let match: RegExpExecArray | null;
  while ((match = styleStart.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const from = i;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const block = source.slice(from, i);
    for (const m of block.matchAll(/([A-Za-z_$][\w$]*)\.value\b/g)) {
      hits.push(m[0]);
    }
  }
  return hits;
}

describe('no `.value` inside style objects', () => {
  const files = ROOTS.flatMap((r) => sourceFiles(r));

  it('scans a plausible number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s', (file) => {
    const hits = offendingStyleValues(readFileSync(file, 'utf8'));
    expect(
      hits,
      `${file} reads ${hits.join(', ')} inside a style object. The worklets `
        + 'babel plugin will rewrite that into a Reanimated warning and crash at '
        + 'render. Rename the property (e.g. `.color`, `.fg`).',
    ).toEqual([]);
  });
});

describe('the detector itself', () => {
  it('catches the exact shape that broke the app', () => {
    expect(offendingStyleValues(
      'const a = <View style={{ backgroundColor: scrim.value, opacity: fade }} />;',
    )).toEqual(['scrim.value']);
  });

  it('catches it in a StyleSheet-style object property too', () => {
    expect(offendingStyleValues('const s = { style: { shadowColor: tint.value } };'))
      .toEqual(['tint.value']);
  });

  it('leaves `.value` alone outside styles', () => {
    // A `color=` prop, a keyExtractor, a settled promise — all fine.
    expect(offendingStyleValues('<Text color={palette.value}>{o.value}</Text>')).toEqual([]);
    expect(offendingStyleValues('if (r.status === "fulfilled") use(r.value.data);')).toEqual([]);
  });
});
