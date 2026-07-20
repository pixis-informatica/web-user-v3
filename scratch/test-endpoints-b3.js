const { PrismaClient } = require('@prisma/client');
const speakeasy = require('speakeasy');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:8080';

async function runTests() {
  console.log('🧪 Iniciando pruebas de endpoints del Bloque 3 (Empleados 2FA)...\n');

  // ── 1. Login Empleado (Paso 1: Credenciales) ──
  console.log('--- 1. Login Empleado (Paso 1) ---');
  const loginRes = await fetch(`${BASE_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'vendedor@pixis.com', password: 'Pixis123!' })
  });
  const loginData = await loginRes.json();
  console.log(`Status: ${loginRes.status}`);
  console.log('Response:', JSON.stringify(loginData, null, 2).substring(0, 300));

  if (loginRes.status !== 200 || !loginData.ok || loginData.step !== '2fa') {
    throw new Error('Login paso 1 falló');
  }
  if (!loginData.tempToken) {
    throw new Error('No se recibió tempToken UUID');
  }
  console.log(`✅ tempToken UUID recibido: ${loginData.tempToken}`);
  console.log(`✅ totp_activado: ${loginData.totp_activado}`);
  if (!loginData.totp_activado && loginData.qr) {
    console.log('✅ QR code data URL recibido (primera activación)');
  }

  // ── 2. Verificar que el tempToken está en la DB ──
  console.log('\n--- 2. Verificar tempToken en DB ---');
  const dbToken = await prisma.tempTokens2FA.findUnique({ where: { id: loginData.tempToken } });
  console.log('DB Token:', dbToken);
  if (!dbToken || dbToken.usado) {
    throw new Error('Token temporal no encontrado o ya usado en DB');
  }
  console.log('✅ Token existe en DB, no usado, expira:', dbToken.expira_en);

  // ── 3. Generar OTP válido y verificar paso 2 ──
  console.log('\n--- 3. Login Empleado (Paso 2: 2FA OTP) ---');
  const empleado = await prisma.empleadoVentas.findUnique({ where: { email: 'vendedor@pixis.com' } });
  const validOtp = speakeasy.totp({
    secret: empleado.totp_secret,
    encoding: 'base32'
  });
  console.log(`OTP generado para test: ${validOtp}`);

  const verify2faRes = await fetch(`${BASE_URL}/admin/login/2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken: loginData.tempToken, codigo: validOtp })
  });
  const verify2faData = await verify2faRes.json();
  console.log(`Status: ${verify2faRes.status}`);
  console.log('Response:', verify2faData);

  if (verify2faRes.status !== 200 || !verify2faData.ok) {
    throw new Error('2FA verificación falló');
  }

  const setCookie = verify2faRes.headers.get('set-cookie');
  console.log('Cookie:', setCookie);
  if (!setCookie || !setCookie.includes('admin_token')) {
    throw new Error('No se recibió cookie admin_token');
  }
  if (!setCookie.includes('Max-Age=28800')) {
    throw new Error('admin_token no tiene Max-Age de 8 horas (28800s)');
  }
  console.log('✅ Cookie admin_token con Max-Age=28800 (8h) recibida');

  // ── 4. Verificar que el token ya está marcado como usado en DB ──
  console.log('\n--- 4. Verificar token marcado como usado ---');
  const usedToken = await prisma.tempTokens2FA.findUnique({ where: { id: loginData.tempToken } });
  if (!usedToken.usado) {
    throw new Error('Token no fue marcado como usado en DB');
  }
  console.log('✅ Token marcado como usado en DB');

  // ── 5. Verificar que totp_activado se puso en true ──
  const empleadoActualizado = await prisma.empleadoVentas.findUnique({ where: { email: 'vendedor@pixis.com' } });
  if (!empleadoActualizado.totp_activado) {
    throw new Error('totp_activado no se activó');
  }
  console.log('✅ totp_activado = true en DB');

  // ── 6. Intentar reusar el token temporal (debe fallar) ──
  console.log('\n--- 5. Reutilizar token usado (debe fallar) ---');
  const reuseRes = await fetch(`${BASE_URL}/admin/login/2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken: loginData.tempToken, codigo: validOtp })
  });
  console.log(`Status: ${reuseRes.status} (debe ser 401)`);
  if (reuseRes.status !== 401) {
    throw new Error('Reutilización de token no fue bloqueada');
  }
  console.log('✅ Token usado rechazado correctamente');

  // ── 7. Rate Limiting para empleados ──
  console.log('\n--- 6. Rate Limiting (tipo=empleado) ---');
  const fakeEmail = 'hacker@test.com';
  for (let i = 1; i <= 6; i++) {
    const rlRes = await fetch(`${BASE_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fakeEmail, password: 'wrong' })
    });
    const rlData = await rlRes.json();
    console.log(`Intento ${i}: status=${rlRes.status}`);
    if (i <= 5 && rlRes.status !== 401) {
      throw new Error(`Intento ${i} debía ser 401`);
    }
    if (i === 6 && rlRes.status !== 429) {
      throw new Error(`Intento ${i} debía ser 429 (bloqueado)`);
    }
  }
  console.log('✅ Rate limiting funciona con tipo=empleado');

  // Verificar que el rate limit de empleado no afecta al de cliente
  console.log('\n--- 7. Aislamiento rate limit empleado/cliente ---');
  const clientLoginRes = await fetch(`${BASE_URL}/api/shop/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fakeEmail, password: 'wrong' })
  });
  console.log(`Login cliente con mismo email: status=${clientLoginRes.status} (debe ser 401, no 429)`);
  if (clientLoginRes.status === 429) {
    throw new Error('Rate limit de empleado contaminó el de cliente');
  }
  console.log('✅ Aislamiento tipo empleado/cliente correcto');

  // ── 8. Recuperación de contraseña de empleados ──
  console.log('\n--- 8. Recuperación de contraseña de empleados ---');
  const recRes = await fetch(`${BASE_URL}/admin/password/solicitar-codigo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'vendedor@pixis.com' })
  });
  const recData = await recRes.json();
  console.log(`Status: ${recRes.status}`, recData);
  if (recRes.status !== 200 || !recData.ok) {
    throw new Error('Solicitud de código de recuperación falló');
  }

  // Leer código del log del servidor
  await new Promise(r => setTimeout(r, 500));
  const logPath = 'C:\\Users\\PIXIS\\.gemini\\antigravity\\brain\\bb594bf5-d600-429b-8bcf-04a77219b938\\.system_generated\\tasks\\task-211.log';
  const logs = fs.readFileSync(logPath, 'utf-8');
  const matches = logs.match(/RECOVERY CODE EMPLEADO\] Código para \S+: (\d+)/g);
  let code = null;
  if (matches) {
    code = matches[matches.length - 1].match(/(\d+)$/)[1];
  }
  console.log(`Código encontrado: ${code}`);
  if (!code) throw new Error('No se pudo extraer código de los logs');

  const newPass = 'NuevaClave2FA!';
  const confirmRes = await fetch(`${BASE_URL}/admin/password/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'vendedor@pixis.com', codigo: code, password: newPass })
  });
  const confirmData = await confirmRes.json();
  console.log(`Confirmar: status=${confirmRes.status}`, confirmData);
  if (confirmRes.status !== 200 || !confirmData.ok) {
    throw new Error('Confirmación de código falló');
  }
  console.log('✅ Contraseña de empleado cambiada');

  // Verificar login con nueva contraseña
  const newLoginRes = await fetch(`${BASE_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'vendedor@pixis.com', password: newPass })
  });
  console.log(`Login con nueva clave: status=${newLoginRes.status} (debe ser 200)`);
  if (newLoginRes.status !== 200) {
    throw new Error('Login con nueva contraseña falló');
  }
  console.log('✅ Login con nueva contraseña OK');

  // Restaurar contraseña original para futuros tests
  const restoreHash = require('bcryptjs').hashSync('Pixis123!', 10);
  await prisma.empleadoVentas.update({
    where: { email: 'vendedor@pixis.com' },
    data: { password_hash: restoreHash }
  });
  console.log('✅ Contraseña restaurada a Pixis123! para futuros tests');

  console.log('\n✅ TODAS LAS PRUEBAS DEL BLOQUE 3 COMPLETADAS CON ÉXITO.');
}

runTests()
  .catch(err => {
    console.error('\n❌ ERROR:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
