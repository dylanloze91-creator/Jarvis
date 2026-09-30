/**
 * vosk-browser 0.0.8 embarque son Web Worker en base64 ; la colle Embind
 * de ce worker fabrique des fonctions avec `new Function`, ce que la CSP de
 * Jarvis refuse (pas d'`unsafe-eval`, héritée par un worker `blob:`). On
 * remplace ces deux fonctions par leurs équivalents sans évaluation — ceux
 * d'Emscripten compilé avec `DYNAMIC_EXECUTION=0` — au moment du build.
 */

const NAMED_FUNCTION =
  /function createNamedFunction\(name,body\)\{name=makeLegalFunctionName\(name\);return new Function\("body","return function "\+name\+"\(\) \{\\n"\+' {4}"use strict";'\+" {4}return body\.apply\(this, arguments\);\\n"\+"\};\\n"\)\(body\)\}/;

const NAMED_FUNCTION_SAFE =
  'function createNamedFunction(name,body){name=makeLegalFunctionName(name);var named=function(){"use strict";return body.apply(this,arguments)};try{Object.defineProperty(named,"name",{value:name})}catch(e){}return named}';

const INVOKER_START = 'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){';
const INVOKER_END = 'var invokerFunction=new_(Function,args1).apply(null,args2);return invokerFunction}';

const INVOKER_SAFE =
  'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){' +
  'var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and \'this\' types!")}' +
  'var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;' +
  'for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}' +
  'var returns=argTypes[0].name!=="void";var expected=argCount-2;' +
  'return function(){if(arguments.length!==expected){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expected+" args!")}' +
  'var destructors=needsDestructorStack?[]:null;var thisWired;var invokerArgs=[cppTargetFunc];' +
  'if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this);invokerArgs.push(thisWired)}' +
  'var argsWired=[];for(var i=0;i<expected;++i){argsWired.push(argTypes[i+2].toWireType(destructors,arguments[i]));invokerArgs.push(argsWired[i])}' +
  'var rv=cppInvokerFunc.apply(null,invokerArgs);' +
  'if(needsDestructorStack){runDestructors(destructors)}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){var param=i===1?thisWired:argsWired[i-2];if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(param)}}}' +
  'if(returns){return argTypes[0].fromWireType(rv)}}}';

const METHOD_CALLER_START = 'var functionName=makeLegalFunctionName("methodCaller_"+signatureName);';
const METHOD_CALLER_END = 'var invokerFunction=new_(Function,params).apply(null,args);';
const METHOD_CALLER_SAFE =
  'var invokerFunction=function(handle,name,destructors,argsPtr){var offset=0;var values=[];' +
  'for(var i=0;i<argCount-1;++i){values.push(types[1+i].readValueFromPointer(argsPtr+offset));offset+=types[i+1]["argPackAdvance"]}' +
  'var rv=handle[name].apply(handle,values);' +
  'for(var i=0;i<argCount-1;++i){if(types[i+1]["deleteObject"]){types[i+1].deleteObject(values[i])}}' +
  'if(!retType.isVoid){return retType.toWireType(destructors,rv)}};';

function replaceSpan(source, startMarker, endMarker, replacement, what) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`vosk-browser : ${what} introuvable (version inattendue).`);
  return source.slice(0, start) + replacement + source.slice(end + endMarker.length);
}

/** Source du worker (texte) → même source, sans `new Function`. */
export function patchVoskWorkerSource(source) {
  if (!NAMED_FUNCTION.test(source)) throw new Error('vosk-browser : createNamedFunction introuvable (version inattendue).');
  let patched = source.replace(NAMED_FUNCTION, NAMED_FUNCTION_SAFE);
  patched = replaceSpan(patched, INVOKER_START, INVOKER_END, INVOKER_SAFE, 'craftInvokerFunction');
  patched = replaceSpan(patched, METHOD_CALLER_START, METHOD_CALLER_END, METHOD_CALLER_SAFE, '__emval_get_method_caller');
  if (/new Function|new_\(Function/.test(patched)) throw new Error('vosk-browser : il reste une évaluation de code dans le worker.');
  return patched;
}

const WORKER_FACTORY = /createBase64WorkerFactory\('([A-Za-z0-9+/=]+)'/;

/** `vosk-browser/dist/vosk.js` → même module, worker base64 corrigé. */
export function patchVoskBundle(code) {
  const match = WORKER_FACTORY.exec(code);
  if (!match) throw new Error('vosk-browser : worker base64 introuvable (version inattendue).');
  const worker = Buffer.from(match[1], 'base64').toString('utf8');
  const encoded = Buffer.from(patchVoskWorkerSource(worker), 'utf8').toString('base64');
  return code.slice(0, match.index) + `createBase64WorkerFactory('${encoded}'` + code.slice(match.index + match[0].length);
}

/** Plugin Vite (renderer) : applique le correctif au module vosk-browser. */
export function voskCspPlugin() {
  return {
    name: 'jarvis-vosk-csp',
    enforce: 'pre',
    transform(code, id) {
      // Seul le fichier lui-même : pas les modules virtuels `?commonjs-…` qui l'enveloppent.
      if (!/vosk-browser[\\/]dist[\\/]vosk\.js$/.test(id)) return null;
      return { code: patchVoskBundle(code), map: null };
    },
  };
}
