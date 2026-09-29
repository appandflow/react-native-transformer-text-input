import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkRelease } from './check-release.mjs';

const tarball = process.argv[2];
if (!tarball || process.argv.length !== 3) {
  throw new Error('Provide exactly one package tarball.');
}

const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .trim()
  .split('\n');
const manifest = JSON.parse(
  execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
    encoding: 'utf8',
  }),
);
const source = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

if (manifest.name !== source.name || manifest.version !== source.version) {
  throw new Error('Packed manifest name or version differs from the source.');
}

checkRelease(manifest);

for (const required of [
  'README.md',
  'LICENSE',
  'RNTransformerTextInput.podspec',
  'react-native.config.js',
  'src/NativeTransformerTextInputModule.ts',
  'src/TransformerTextInputDecoratorViewNativeComponent.ts',
  'src/TransformerTextInput.web.tsx',
  'lib/module/TransformerTextInput.web.js',
  'ios/TransformerTextInputModule.mm',
  'ios/TransformerTextInputDecoratorView.mm',
  'android/build.gradle',
  'android/src/main/jni/CMakeLists.txt',
  'android/src/main/jni/TransformerTextInputJni.cpp',
  'android/src/main/java/com/appandflow/transformertextinput/TransformerTextInputPackage.kt',
  'cpp/TransformerTextInputRuntime.cpp',
  'cpp/TransformerTextInputRuntime.h',
]) {
  if (!entries.includes(`package/${required}`)) {
    throw new Error(`Missing package file: ${required}`);
  }
}

function checkTarget(target) {
  if (typeof target === 'string') {
    if (!entries.includes(`package/${target.replace(/^\.\//, '')}`)) {
      throw new Error(`Missing exported file: ${target}`);
    }
  } else if (target && typeof target === 'object') {
    Object.values(target).forEach(checkTarget);
  }
}
checkTarget(manifest.exports);
for (const field of ['main', 'types']) {
  if (!manifest[field]) throw new Error(`Missing entrypoint: ${field}`);
  checkTarget(manifest[field]);
}

for (const entry of entries) {
  if (/^package\/(?:android|ios)\/(?:.*\/)?build\//.test(entry)) {
    throw new Error(`Unexpected native build output: ${entry}`);
  }
  if (
    /^package\/(?:example|docs|node_modules|scripts|artifacts|\.github)(?:\/|$)/.test(
      entry,
    ) ||
    /(?:^|\/)(?:__tests__|__mocks__|__fixtures__)(?:\/|$)/.test(entry)
  ) {
    throw new Error(`Unexpected repository-only file: ${entry}`);
  }
}

for (const group of [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]) {
  for (const range of Object.values(manifest[group] ?? {})) {
    if (typeof range === 'string' && range.startsWith('workspace:')) {
      throw new Error('Unresolved workspace range in tarball.');
    }
  }
}

console.log(
  `${manifest.name}@${manifest.version}: ${entries.length} package files verified`,
);
