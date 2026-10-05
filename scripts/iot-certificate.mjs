import { connect } from 'node:tls';
import { writeFileSync } from 'node:fs';
const url=new URL(process.argv[2]||process.env.PUBLIC_ORIGIN||'https://PUBLIC-DOMAIN');
if(url.protocol!=='https:'||url.username||url.password||url.hostname==='public-domain')throw new Error('Usage: npm run iot:certificate -- https://YOUR-SERVICE.onrender.com');
const pem=await new Promise((resolve,reject)=>{
  const socket=connect({host:url.hostname,port:Number(url.port)||443,servername:url.hostname,rejectUnauthorized:true},()=>{
    try{
      if(!socket.authorized)throw new Error('HTTPS certificate is not trusted');
      let cert=socket.getPeerCertificate(true);const seen=new Set();
      while(cert.issuerCertificate&&cert.issuerCertificate.fingerprint256!==cert.fingerprint256){
        if(seen.has(cert.fingerprint256))throw new Error('Invalid certificate chain');
        seen.add(cert.fingerprint256);cert=cert.issuerCertificate;
      }
      if(!cert.raw||cert.subject.CN!==cert.issuer.CN)throw new Error('Trusted root unavailable in chain; obtain the current issuer root certificate from its official CA.');
      const base64=cert.raw.toString('base64').match(/.{1,64}/g).join('\n');
      resolve(`-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`);
    }catch(error){reject(error);}finally{socket.end();}
  });
  socket.setTimeout(20000,()=>socket.destroy(new Error('TLS connection timed out')));
  socket.on('error',reject);
});
writeFileSync('wokwi/root_ca.h',`#pragma once\n// Public CA certificate, extracted from a verified TLS connection to ${url.hostname}.\nstatic const char ROOT_CA[] PROGMEM = R"CERT(${pem})CERT";\n`);
console.log(`Saved verified public CA to wokwi/root_ca.h for ${url.hostname}. Copy this file into Wokwi. Re-run after a hosting CA change.`);
