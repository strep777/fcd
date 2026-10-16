import {describe, expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {hideChildProcessWindows} from './desktop-child-process.mjs';

const methods = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'] as const;
type Method = typeof methods[number];
function recorder() {
  const calls: {name: Method; args: unknown[]; receiver: unknown}[] = [];
  const result = {};
  const target = Object.fromEntries(methods.map(name => [name, function (this: unknown, ...args: unknown[]) {
    calls.push({name, args, receiver: this});
    return result;
  }])) as Record<Method, (...args: unknown[]) => unknown>;
  return {target, calls, result};
}

describe('hidden desktop child process launcher', () => {
  it.each(methods)('%s preserves options, arguments, receiver and result without mutating caller options', name => {
    const {target, calls, result} = recorder();
    const env = {FPCAD_TEST_SENTINEL: 'retained'};
    const options = Object.freeze({windowsHide: false, env, shell: true, timeout: 15731, stdio: 'pipe'});
    const argv = Object.freeze(['路径 with spaces', '--fpcad-background-test']);
    const args = name === 'exec' || name === 'execSync' ? ['command', options] : ['command', argv, options];
    hideChildProcessWindows(target, 'win32');
    expect(target[name](...args)).toBe(result);
    expect(calls[0].receiver).toBe(target);
    expect(calls[0].args.slice(0, -1)).toEqual(args.slice(0, -1));
    expect(calls[0].args.at(-1)).toEqual({...options, windowsHide: true});
    expect((calls[0].args.at(-1) as typeof options).env).toBe(env);
    expect(options.windowsHide).toBe(false);
  });

  it('retains optional argument and callback overloads, including explicit null/undefined', () => {
    const {target, calls} = recorder();
    hideChildProcessWindows(target, 'win32');
    const callback = () => undefined;
    const cases: {name: Method; args: unknown[]; expected: unknown[]}[] = [
      {name: 'spawn', args: ['p'], expected: ['p', undefined, {windowsHide: true}]},
      {name: 'spawnSync', args: ['p', {cwd: 'x'}], expected: ['p', {cwd: 'x', windowsHide: true}]},
      {name: 'execFile', args: ['p', callback], expected: ['p', {windowsHide: true}, callback]},
      {name: 'execFile', args: ['p', ['a'], callback], expected: ['p', ['a'], {windowsHide: true}, callback]},
      {name: 'execFile', args: ['p', {encoding: 'buffer'}, callback], expected: ['p', {encoding: 'buffer', windowsHide: true}, callback]},
      {name: 'execFile', args: ['p', null, null, callback], expected: ['p', null, {windowsHide: true}, callback]},
      {name: 'execFile', args: ['p', undefined, {timeout: 123}, callback], expected: ['p', undefined, {timeout: 123, windowsHide: true}, callback]},
      {name: 'execFileSync', args: ['p'], expected: ['p', undefined, {windowsHide: true}]},
      {name: 'exec', args: ['p', callback], expected: ['p', {windowsHide: true}, callback]},
      {name: 'execSync', args: ['p', null], expected: ['p', {windowsHide: true}]},
    ];
    for (const {name, args, expected} of cases) {
      target[name](...args);
      expect(calls.at(-1)?.args).toEqual(expected);
      if (args.at(-1) === callback) expect(calls.at(-1)?.args.at(-1)).toBe(callback);
    }
  });

  it('passes callback errors and thrown errors through unchanged, including invalid arguments', () => {
    const {target} = recorder();
    const failure = new Error('original launch error');
    target.execFile = (...args) => { (args.at(-1) as (error: Error) => void)(failure); return failure; };
    target.spawn = (...args) => { expect(args).toEqual(['p', 42]); throw failure; };
    target.execSync = (...args) => { expect(args).toEqual(['p', 'invalid options']); throw failure; };
    hideChildProcessWindows(target, 'win32');
    let received: unknown;
    expect(target.execFile('p', (error: unknown) => { received = error; })).toBe(failure);
    expect(received).toBe(failure);
    expect(() => target.spawn('p', 42)).toThrow(failure);
    expect(() => target.execSync('p', 'invalid options')).toThrow(failure);
  });

  it('does not replace child process methods on other platforms', () => {
    const {target} = recorder();
    const original = {...target};
    hideChildProcessWindows(target, 'linux');
    for (const name of methods) expect(target[name]).toBe(original[name]);
  });

  it('keeps invalid options arrays and callbacks on synchronous/spawn APIs invalid', () => {
    const {target, calls} = recorder();
    hideChildProcessWindows(target, 'win32');
    const callback = () => undefined;
    for (const name of methods) {
      const args = name === 'exec' || name === 'execSync' ? ['p', []] : ['p', ['a'], []];
      target[name](...args);
      expect(calls.at(-1)?.args).toEqual(args);
    }
    for (const name of ['spawn', 'spawnSync', 'execFileSync'] as const) {
      for (const args of [['p', callback], ['p', ['a'], callback]]) {
        target[name](...args);
        expect(calls.at(-1)?.args).toEqual(args);
      }
    }
  });

  it.skipIf(process.platform !== 'win32')('updates preexisting ESM named bindings without losing real Node errors', () => {
    const url = pathToFileURL(resolve('tests/desktop-child-process.mjs')).href;
    const program = `
      import assert from 'node:assert/strict';
      import cp, {spawn, execFile, execFileSync} from 'node:child_process';
      import {promisify} from 'node:util';
      const originalSpawn = cp.spawn;
      let recorded;
      const marker = {};
      cp.spawn = (...args) => { recorded = args; return marker; };
      await import(${JSON.stringify(url)});
      assert.equal(spawn, cp.spawn);
      assert.equal(spawn('sentinel', ['a'], {shell:true, windowsHide:false}), marker);
      assert.deepEqual(recorded, ['sentinel', ['a'], {shell:true, windowsHide:true}]);
      cp.spawn = originalSpawn;
      let syncError;
      try { execFileSync(process.execPath, ['-e', 'process.exit(23)'], {stdio:'pipe'}); }
      catch (error) { syncError = error; }
      assert.equal(syncError.status, 23);
      await new Promise((resolve, reject) => execFile(process.execPath, ['-e', 'process.stdout.write("ok")'], {encoding:'utf8'}, (error, stdout) => {
        if (error) return reject(error);
        assert.equal(stdout, 'ok'); resolve();
      }));
      const promised = promisify(execFile)(process.execPath, ['-e', 'process.stdout.write("out");process.stderr.write("err")'], {encoding:'utf8'});
      assert.equal(typeof promised.child.pid, 'number');
      assert.deepEqual(await promised, {stdout:'out', stderr:'err'});
      await assert.rejects(promisify(execFile)(process.execPath, ['-e', 'process.stdout.write("kept");process.exit(17)']), error => error.code === 17 && error.stdout === 'kept');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {windowsHide: true, encoding: 'utf8', timeout: 10000});
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
