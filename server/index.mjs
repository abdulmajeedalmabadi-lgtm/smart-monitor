import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError, openStore } from './store.mjs';
import { readConfig } from './config.mjs';
import { createAuth, equalSecret } from './auth.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const headers = {
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
function json(res,status,body,extra={}) { res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(body)); }
async function readBody(req,limit=512*1024) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw new AppError(415,'استخدم بيانات JSON');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AppError(413,'حجم الطلب أكبر من المسموح');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(400,'بيانات JSON غير صحيحة');}
}
export async function createApp(options={}) {
  const config = options.config || readConfig({});
  const store = options.store || await openStore(options.databasePath || config.databasePath, {url:config.databaseUrl,authToken:config.databaseToken});
  const auth = createAuth(config);
  let loginAttempts=0,loginWindow=Date.now(),iotCount=0,iotWindow=Date.now();
  const server = createServer(async(req,res)=>{
    try{
      if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
      const port=server.address().port;
      const publicHost=config.publicOrigin?new URL(config.publicOrigin).host:null;
      const allowedHosts=publicHost?[publicHost]:[`127.0.0.1:${port}`,`localhost:${port}`];
      const path=new URL(req.url,'http://request.invalid').pathname;
      // Hosting health probes may use an internal Host. They expose no user data.
      if(path==='/api/health'&&req.method==='GET'){
        try{await store.health();return json(res,200,{status:'ok',storage:store.kind,mode:config.production?'production':'development'});}
        catch{return json(res,503,{status:'unavailable',storage:store.kind});}
      }
      if(!allowedHosts.includes(req.headers.host))throw new AppError(403,'عنوان الخادم غير مسموح');
      const origin=config.publicOrigin||`http://${req.headers.host}`;
      if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==origin))throw new AppError(403,'الطلب من موقع آخر غير مسموح');
      if(path==='/api/iot/telemetry'){
        if(req.method!=='POST')throw new AppError(405,'استخدم POST');
        if(!config.iotKey)throw new AppError(503,'IoT API is not configured');
        if(!equalSecret(req.headers.authorization||'',`Bearer ${config.iotKey}`))throw new AppError(401,'Invalid device key');
        if(Date.now()-iotWindow>60000){iotWindow=Date.now();iotCount=0;}
        if(++iotCount>120)throw new AppError(429,'Telemetry rate exceeded; retry later');
        const body=await readBody(req,8192);
        if(body?.deviceId!==config.deviceId)throw new AppError(403,'Device key does not authorize this device');
        const result=await store.ingestTelemetry(body);
        return json(res,result.duplicate?200:201,result);
      }
      if(path==='/api/login'&&req.method==='POST'){
        if(req.headers['x-smart-monitor']!=='1')throw new AppError(403,'الطلب غير مسموح');
        if(Date.now()-loginWindow>60000){loginWindow=Date.now();loginAttempts=0;}
        if(++loginAttempts>10)throw new AppError(429,'محاولات كثيرة؛ انتظر دقيقة');
        const body=await readBody(req,2048);
        if(config.password&&!equalSecret(body?.password||'',config.password))throw new AppError(401,'كلمة المرور غير صحيحة');
        return json(res,200,{ok:true},{'Set-Cookie':auth.loginCookie()});
      }
      if(path.startsWith('/api/')){
        if(!auth.authenticated(req))throw new AppError(401,'سجّل الدخول لفتح لوحة المراقبة');
        if(path==='/api/state'&&req.method==='GET')return json(res,200,{...await store.getState(),authRequired:Boolean(config.password)});
        if(!['POST','PATCH','DELETE'].includes(req.method))throw new AppError(405,'طريقة الطلب غير مدعومة');
        if(req.headers['x-smart-monitor']!=='1')throw new AppError(403,'الطلب غير مسموح');
        if(path==='/api/logout'&&req.method==='POST')return json(res,200,{ok:true},{'Set-Cookie':auth.logoutCookie()});
        const revisionHeader=req.headers['if-match'];
        const revision=typeof revisionHeader==='string'&&/^\d+$/.test(revisionHeader)?Number(revisionHeader):NaN;
        const body=await readBody(req);
        return json(res,200,{...await store.mutate(req.method,path,body,revision),authRequired:Boolean(config.password)});
      }
      if(!['GET','HEAD'].includes(req.method))throw new AppError(405,'طريقة الطلب غير مدعومة');
      if(path==='/favicon.ico'){res.writeHead(204,headers);return res.end();}
      const asset=assets.get(path);
      if(!asset)throw new AppError(404,'الصفحة غير موجودة');
      const bytes=readFileSync(resolve(root,'dist',asset[0]));
      res.writeHead(200,{...headers,'Content-Type':asset[1]});res.end(req.method==='HEAD'?undefined:bytes);
    }catch(error){
      if(!(error instanceof AppError))console.error('Request failed:',error.code||error.name);
      if(!res.headersSent)json(res,error.status||503,{error:error instanceof AppError?error.message:'تعذر الاتصال بقاعدة البيانات؛ أعد المحاولة'});
      else res.end();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,store,config,
    listen:(port=config.port)=>new Promise((resolvePromise,reject)=>{
      server.once('error',reject);server.listen(port,config.host,()=>{server.off('error',reject);resolvePromise(config.publicOrigin||`http://localhost:${server.address().port}`);});
    }),
    close:()=>new Promise((resolvePromise,reject)=>{
      server.close(error=>{store.close();error?reject(error):resolvePromise();});server.closeAllConnections();
    }),
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const config=readConfig();
  const app=await createApp({config});
  const url=await app.listen();
  console.log(`Smart Monitor: ${url}\nDatabase: ${app.store.kind}; mode: ${config.production?'production':'development'}`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
