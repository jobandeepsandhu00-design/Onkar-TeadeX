// Compare strict diagnostics with the committed App.tsx without modifying the checkout.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve('artifacts/trading-os');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const appPath = path.join(root, 'src/App.tsx').replaceAll('\\', '/').toLowerCase();
const baseline = execFileSync('git', ['show', 'HEAD:artifacts/trading-os/src/App.tsx'], {encoding:'utf8', maxBuffer:10e6});
function diagnostics(useBaseline) {
  const host = ts.createCompilerHost(parsed.options);
  const read = host.readFile;
  host.readFile = filename => useBaseline && filename.replaceAll('\\', '/').toLowerCase() === appPath ? baseline : read(filename);
  const program = ts.createProgram(parsed.fileNames, {...parsed.options, noEmit:true}, host);
  return ts.getPreEmitDiagnostics(program).map(d => ({file:d.file ? path.relative(root,d.file.fileName) : '', code:d.code, message:ts.flattenDiagnosticMessageText(d.messageText,' ')}));
}
const before = diagnostics(true), after = diagnostics(false);
const counts = new Map();
for (const d of before) {const key=JSON.stringify(d); counts.set(key,(counts.get(key)||0)+1);}
const introduced = after.filter(d => {const key=JSON.stringify(d), n=counts.get(key)||0; if(n){counts.set(key,n-1);return false;}return true;});
console.log(JSON.stringify({baselineErrors:before.length,currentErrors:after.length,introducedErrors:introduced},null,2));
process.exitCode = introduced.length ? 1 : 0;
