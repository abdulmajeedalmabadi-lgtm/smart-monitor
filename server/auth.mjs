import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function equalSecret(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}
export function createAuth(config) {
  const tag = createHash('sha256').update(config.password).digest('hex').slice(0,16);
  const sign = body => createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  function issue() { const body = `${Date.now()+7*86400000}.${tag}`; return `${body}.${sign(body)}`; }
  function authenticated(req) {
    if (!config.password) return true;
    const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('sm_session='))?.slice(11);
    if (!cookie) return false;
    const [expires, passwordTag, signature, extra] = cookie.split('.');
    return !extra && Number(expires)>Date.now() && passwordTag===tag && Boolean(signature) && equalSecret(signature,sign(`${expires}.${passwordTag}`));
  }
  function cookie(value, maxAge = 604800) { return `sm_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.production?'; Secure':''}`; }
  return { authenticated, loginCookie: () => cookie(issue()), logoutCookie: () => cookie('',0) };
}
