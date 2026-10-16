import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';

// Imported by the desktop test runner before Playwright. In particular, its
// Windows Electron launcher uses a shell child whose console must stay hidden.
// Keep Electron arguments, environment, sandbox and original test budgets intact.
export function hideChildProcessWindows(target, platform = process.platform) {
  if (platform !== 'win32') return;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
    const original = target[name];
    const wrap = originalCall => function (...args) {
      let index = 1;
      if (!name.startsWith('exec') || name.startsWith('execFile')) {
        const second = args[1];
        if (Array.isArray(second) || second == null) index = 2;
        else if (typeof second !== 'object' && typeof second !== 'function') {
          return Reflect.apply(originalCall, this, args);
        }
      }
      const options = args[index];
      // Leave malformed options to Node's own validation rather than concealing
      // an error by converting them into an otherwise valid options object.
      const callbackAllowed = name === 'exec' || name === 'execFile';
      if (Array.isArray(options) || (typeof options === 'function' && !callbackAllowed)
        || (options != null && typeof options !== 'object' && typeof options !== 'function')) {
        return Reflect.apply(originalCall, this, args);
      }
      const hidden = {...(typeof options === 'object' ? options : {}), windowsHide: true};
      if (typeof options === 'function') args.splice(index, 0, hidden);
      else args[index] = hidden;
      return Reflect.apply(originalCall, this, args);
    };
    target[name] = wrap(original);
    // Node gives exec/execFile a custom promisifier (stdout + stderr and child).
    // Retain it and apply the same options policy to that launch route too.
    if (typeof original[promisify.custom] === 'function') {
      Object.defineProperty(target[name], promisify.custom, {value: wrap(original[promisify.custom])});
    }
  }
}

if (process.platform === 'win32') {
  hideChildProcessWindows(childProcess);
  // Update existing ESM named bindings as well as CommonJS/default imports.
  syncBuiltinESMExports();
}
