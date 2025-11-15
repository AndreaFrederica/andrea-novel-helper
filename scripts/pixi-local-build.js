/* eslint-disable @typescript-eslint/no-var-requires */
const fs=require('fs');
const cp=require('child_process');
function run(cmd,args,env){const r=cp.spawnSync(cmd,args,{stdio:'inherit',env:{...process.env,...(env||{})}});if(r.status!==0)process.exit(r.status);} 
const pkgPath='package.json';
const original=fs.readFileSync(pkgPath,'utf8');
function modify(variant){const pkg=JSON.parse(original);const ev=new Set(pkg.activationEvents||[]);if(variant==='std'){ev.delete('onStartupFinished');}else{ev.add('onStartupFinished');const p=pkg.version.split('.').map(Number);p[2]+=1;pkg.version=p.join('.');}pkg.activationEvents=[...ev];if(pkg.scripts&&pkg.scripts['vscode:prepublish'])pkg.scripts['vscode:prepublish']='npm run compile';fs.writeFileSync(pkgPath,JSON.stringify(pkg,null,2));}
function restore(){fs.writeFileSync(pkgPath,original);} 
const variant=process.argv[2]||'std';
const ev=process.env.ELECTRON_VERSION||'30.0.9';
function mapTarget(){const p=process.platform;const a=process.arch;const platform=p==='win32'?'win32':p==='darwin'?'darwin':'linux';let arch='x64';if(a==='ia32')arch='ia32';else if(a==='arm64')arch='arm64';else if(a==='arm')arch='armhf';return `${platform}-${arch}`;}
const targetArg=process.argv[3]||mapTarget();
const [platform,arch]=targetArg.split('-');
if(process.env.SKIP_WEBVIEW!=='1'){run('npm',['--workspace=packages/webview','run','build']);}
run('npm',['run','compile']);
run('npm',['rebuild','@vscode/sqlite3','--runtime=electron',`--target=${ev}`,'--dist-url=https://electronjs.org/headers',`--platform=${platform}`,`--arch=${arch}`]);
modify(variant);
fs.mkdirSync('dist',{recursive:true});
if(variant==='std'){const out=`dist/anh-std-${targetArg}.vsix`;run('npx',['vsce','package','--target',targetArg,'--out',out]);restore();}
else{const out=`dist/anh-exp-${targetArg}.vsix`;run('npx',['vsce','package','--target',targetArg,'--pre-release','--out',out]);restore();}