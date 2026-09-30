import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { patchVoskBundle, patchVoskWorkerSource } from './voskCspPatch.mjs';

const require = createRequire(import.meta.url);
const bundlePath = require.resolve('vosk-browser/dist/vosk.js');

function workerOf(code) {
  const base64 = /createBase64WorkerFactory\('([A-Za-z0-9+/=]+)'/.exec(code)[1];
  return Buffer.from(base64, 'base64').toString('utf8');
}

describe('vosk-browser sans évaluation de code (CSP sans unsafe-eval)', () => {
  const original = readFileSync(bundlePath, 'utf8');

  it('le worker d’origine utilise new Function (refusé par la CSP)', () => {
    expect(workerOf(original)).toMatch(/new Function\("body"/);
    expect(workerOf(original)).toMatch(/new_\(Function,args1\)/);
  });

  it('le worker corrigé n’en contient plus, le reste du module est intact', () => {
    const patched = patchVoskBundle(original);
    const worker = workerOf(patched);
    expect(worker).not.toMatch(/new Function|new_\(Function/);
    expect(worker).toContain('function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount');
    expect(patched.replace(/createBase64WorkerFactory\('[^']+'/, '')).toBe(
      original.replace(/createBase64WorkerFactory\('[^']+'/, ''),
    );
  });

  it('les fonctions de remplacement se comportent comme les originales', () => {
    const source = patchVoskWorkerSource(workerOf(original));
    const named = /function createNamedFunction\(name,body\)\{[^]*?return named\}/.exec(source)[0];
    const invoker = /function craftInvokerFunction\([^]*?if\(returns\)\{return argTypes\[0\]\.fromWireType\(rv\)\}\}\}/.exec(source)[0];
    const sandbox = {};
    vm.runInNewContext(
      `function makeLegalFunctionName(n){return n}
       function throwBindingError(m){throw new Error(m)}
       function runDestructors(d){while(d.length){var p=d.pop();var f=d.pop();f(p)}}
       ${named}
       ${invoker}
       this.createNamedFunction=createNamedFunction;this.craftInvokerFunction=craftInvokerFunction;`,
      sandbox,
    );
    const hello = sandbox.createNamedFunction('bonjour', function (x) {
      return `${this.prefix}${x}`;
    });
    expect(hello.name).toBe('bonjour');
    expect(hello.call({ prefix: '>' }, 'a')).toBe('>a');

    const int = { name: 'int', toWireType: (_d, v) => v * 2, fromWireType: (v) => v + 1, destructorFunction: null };
    const voidType = { name: 'void' };
    const calls = [];
    const add = sandbox.craftInvokerFunction('add', [int, null, int, int], null, (fn, a, b) => {
      calls.push(fn);
      return a + b;
    }, 'cible');
    expect(add(1, 2)).toBe(7);
    expect(calls).toEqual(['cible']);
    expect(() => add(1)).toThrow(/called with 1 arguments, expected 2/);

    const self = { name: 'Recognizer*', toWireType: (_d, v) => v.ptr, destructorFunction: null };
    const method = sandbox.craftInvokerFunction('Recognizer.SetWords', [voidType, self, int], {}, (fn, thisPtr, words) => {
      calls.push([fn, thisPtr, words]);
    }, 'SetWords');
    expect(method.call({ ptr: 42 }, 1)).toBeUndefined();
    expect(calls.at(-1)).toEqual(['SetWords', 42, 2]);
  });

  it('l’appel de méthode emval garde le this et lit les arguments à la suite', () => {
    const source = patchVoskWorkerSource(workerOf(original));
    const caller = /function __emval_get_method_caller\(argCount,argTypes\)\{[^]*?return __emval_addMethodCaller\(invokerFunction\)\}/.exec(source)[0];
    const memory = [10, 20];
    const types = [
      { name: 'int', isVoid: false, toWireType: (_d, v) => `wire:${v}` },
      { name: 'a', argPackAdvance: 1, readValueFromPointer: (ptr) => memory[ptr] },
      { name: 'b', argPackAdvance: 1, readValueFromPointer: (ptr) => memory[ptr], deleteObject: () => calls.push('supprimé') },
    ];
    const calls = [];
    const sandbox = { types };
    vm.runInNewContext(
      `function heap32VectorToArray(){return types}
       function __emval_lookupTypes(){return types}
       function makeLegalFunctionName(n){return n}
       function __emval_addMethodCaller(f){return f}
       ${caller}
       this.getCaller=__emval_get_method_caller;`,
      sandbox,
    );
    const invoke = sandbox.getCaller(3, 0);
    const target = { base: 1, sum(a, b) { return this.base + a + b; } };
    expect(invoke(target, 'sum', null, 0)).toBe('wire:31');
    expect(calls).toEqual(['supprimé']);
  });
});
