/**
 * Network images go through expo-image.  ⚠️ FRAGILE BY DESIGN — reads source.
 *
 * React Native's own <Image> caches remote images in memory only. On this
 * market that is the expensive default: a rider scrolling the car-rental list,
 * backing out and scrolling again re-downloads every photo over a metered,
 * often 2G/3G connection — and pays for it twice.
 *
 * `expo-image` was already a dependency when this test was written, and was
 * used on exactly ONE screen out of the eleven that render images. Its disk
 * cache is the default, so the entire benefit is unlocked by which module the
 * component is imported from — which is precisely the kind of detail that
 * regresses silently, since both components render identically in a simulator
 * on wifi.
 *
 * The rule pinned here:
 *
 *   - A screen rendering a NETWORK image (`source={{ uri }}`) must import Image
 *     from 'expo-image'.
 *   - A screen rendering only BUNDLED assets (`source={require(...)}`) may keep
 *     react-native's Image. Those ship inside the binary, so there is nothing to
 *     cache and nothing to gain — SplashScreen in particular is left alone on
 *     purpose.
 *
 * expo-image renames one prop: `resizeMode` becomes `contentFit`. Leaving a
 * stray `resizeMode` on an expo-image is silently ignored rather than an error,
 * which is why it is checked here too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/** Every .tsx under app/ and components/, as ROOT-relative paths. */
function screenFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(ROOT, dir))) {
      if (entry === 'node_modules') continue;
      const rel = `${dir}/${entry}`;
      if (statSync(resolve(ROOT, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith('.tsx')) out.push(rel);
    }
  };
  walk('app');
  walk('components');
  return out;
}

/** Files that render an <Image> whose source is a runtime URI, not a require(). */
function filesWithNetworkImages(): string[] {
  return screenFiles().filter((f) => {
    const src = read(f);
    if (!/<Image\b/.test(src)) return false;
    return /source=\{\{\s*uri:/.test(src);
  });
}

const RN_IMAGE_IMPORT = /import\s*\{[^}]*\bImage\b[^}]*\}\s*from\s*'react-native'/;
const EXPO_IMAGE_IMPORT = /import\s*\{[^}]*\bImage\b[^}]*\}\s*from\s*'expo-image'/;

describe('network images use expo-image', () => {
  it('finds the screens this rule is about', () => {
    // A guard on the guard: if a refactor moved these screens, the assertions
    // below would silently pass over an empty list and protect nothing.
    const files = filesWithNetworkImages();
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toEqual(
      expect.arrayContaining([
        'app/(app)/car-rental/index.tsx',
        'app/(app)/car-rental/[id].tsx',
        'app/(app)/car-rental/my-cars.tsx',
        'app/(app)/rider/restaurant/[id].tsx',
      ]),
    );
  });

  it.each(filesWithNetworkImages())('%s imports Image from expo-image', (file) => {
    expect(read(file)).toMatch(EXPO_IMAGE_IMPORT);
  });

  it.each(filesWithNetworkImages())('%s does not also import react-native Image', (file) => {
    // Two components named Image in one module is a shadowing bug waiting to
    // happen, and TypeScript would only catch it for the props that differ.
    expect(read(file)).not.toMatch(RN_IMAGE_IMPORT);
  });

  it.each(filesWithNetworkImages())('%s uses contentFit, not the ignored resizeMode', (file) => {
    expect(read(file)).not.toMatch(/resizeMode=/);
  });
});

describe('bundled assets are deliberately left on react-native Image', () => {
  it('keeps the splash screen off expo-image', () => {
    // The splash is the first frame of a cold start, rendered before anything
    // else is ready. It draws bundled assets only, so expo-image would add a
    // module to that path and buy nothing.
    const src = read('components/SplashScreen.tsx');
    expect(src).toMatch(RN_IMAGE_IMPORT);
    expect(src).not.toMatch(EXPO_IMAGE_IMPORT);
  });

  it('does not sneak a network image into a bundled-asset screen', () => {
    // If one of these ever starts rendering a remote URI, it belongs in the
    // list above and the rule should start applying to it.
    for (const f of ['components/SplashScreen.tsx', 'app/(auth)/index.tsx']) {
      expect(read(f), f).not.toMatch(/source=\{\{\s*uri:/);
    }
  });
});

describe('expo-image is a real dependency', () => {
  it('is declared in package.json', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['expo-image']).toBeTruthy();
  });
});

// Keep the helper referenced so an accidental unused-import cleanup cannot
// quietly narrow what this file walks.
describe('the walker sees the whole app', () => {
  it('covers both app/ and components/', () => {
    const files = screenFiles().map((f) => relative('.', f));
    expect(files.some((f) => f.startsWith('app/'))).toBe(true);
    expect(files.some((f) => f.startsWith('components/'))).toBe(true);
  });
});
