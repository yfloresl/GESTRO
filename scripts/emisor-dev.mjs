// Emisor de Kyros ID SIMULADO, solo para desarrollo local (nunca se despliega). Imita lo mínimo de
// Keycloak: auth, registrations, token (con PKCE S256), certs (JWKS) y logout, con claves efímeras.
//   node scripts/emisor-dev.mjs            -> http://localhost:4100/realms/kyros
// Identidad de prueba: ?sub=<id> en la URL de ingreso no existe; se usa la cookie/consulta `sub`
// del formulario simple que muestra /auth ("Entrar como…").
import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const PUERTO = 4100;
const EMISOR = `http://localhost:${PUERTO}/realms/kyros`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'dev-1';
const codigos = new Map(); // code -> { challenge, client, sub, authTime }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function firmar(claims) {
  const h = b64({ alg: 'RS256', typ: 'JWT', kid: KID });
  const p = b64(claims);
  return `${h}.${p}.${createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url')}`;
}
const cors = (res) => { res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', 'content-type'); };

createServer(async (req, res) => {
  const url = new URL(req.url, EMISOR);
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const ruta = url.pathname.replace('/realms/kyros/protocol/openid-connect', '');

  if (ruta === '/certs') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] }));
  }
  if (ruta === '/auth' || ruta === '/registrations') {
    const q = url.searchParams;
    const sub = q.get('sub') ?? 'dev-' + (ruta === '/registrations' ? randomUUID() : 'usuario-1');
    // Simula una sesión ya iniciada (sin pedir contraseña) o una cuenta recién creada.
    const code = randomUUID();
    codigos.set(code, { challenge: q.get('code_challenge'), client: q.get('client_id'), sub, authTime: Math.floor(Date.now() / 1000) });
    const volver = new URL(q.get('redirect_uri'));
    volver.searchParams.set('code', code); volver.searchParams.set('state', q.get('state'));
    res.statusCode = 302; res.setHeader('location', volver.toString());
    return res.end();
  }
  if (ruta === '/token' && req.method === 'POST') {
    let cuerpo = ''; for await (const c of req) cuerpo += c;
    const f = new URLSearchParams(cuerpo);
    const dato = codigos.get(f.get('code'));
    codigos.delete(f.get('code'));
    const ok = dato && dato.client === f.get('client_id')
      && createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') === dato.challenge;
    res.setHeader('content-type', 'application/json');
    if (!ok) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid_grant' })); }
    const ahora = Math.floor(Date.now() / 1000);
    return res.end(JSON.stringify({
      token_type: 'Bearer', expires_in: 600,
      access_token: firmar({ iss: EMISOR, typ: 'Bearer', azp: dato.client, aud: [dato.client], sub: dato.sub, jti: randomUUID(), iat: ahora, exp: ahora + 600, auth_time: dato.authTime, preferred_username: dato.sub }),
    }));
  }
  if (ruta === '/logout') {
    const volver = url.searchParams.get('post_logout_redirect_uri');
    res.statusCode = 302; res.setHeader('location', volver ?? '/'); return res.end();
  }
  res.statusCode = 404; res.end();
}).listen(PUERTO, '127.0.0.1', () => console.log(`Emisor de desarrollo en ${EMISOR} (sub fijo: dev-usuario-1; «Crear mi cuenta» genera uno nuevo)`));
