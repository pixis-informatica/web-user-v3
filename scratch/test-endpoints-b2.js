const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const emailTest = `test-${Date.now()}@pixis.com`;
const passwordTest = 'SuperSecure123!';

async function runTests() {
  console.log('🧪 Iniciando pruebas de endpoints del Bloque 2...');

  // 1. Registro de Cliente
  console.log('\n--- 1. Pruebas de Registro ---');
  const registerRes = await fetch('http://localhost:8080/api/shop/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Cliente de Prueba',
      email: emailTest,
      telefono: '123456789',
      password: passwordTest,
      acepta_marketing: true
    })
  });
  const registerData = await registerRes.json();
  console.log(`Registro Status: ${registerRes.status}`);
  console.log('Registro Response:', registerData);
  if (registerRes.status !== 201 || !registerData.ok) {
    throw new Error('Falló el registro');
  }

  // 2. Registro Duplicado
  const registerDupRes = await fetch('http://localhost:8080/api/shop/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Cliente Duplicado',
      email: emailTest,
      telefono: '987654321',
      password: 'differentPassword',
      acepta_marketing: false
    })
  });
  const registerDupData = await registerDupRes.json();
  console.log(`Registro Duplicado Status: ${registerDupRes.status}`);
  console.log('Registro Duplicado Response:', registerDupData);
  if (registerDupRes.status !== 400 || registerDupData.error !== 'El correo electrónico ya está registrado.') {
    throw new Error('No se bloqueó el registro duplicado correctamente');
  }

  // 3. Login Fallidos y Rate Limiting
  console.log('\n--- 2. Pruebas de Login y Rate Limiting (Base de Datos) ---');
  for (let i = 1; i <= 6; i++) {
    const loginFailRes = await fetch('http://localhost:8080/api/shop/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailTest,
        password: 'WrongPassword'
      })
    });
    const loginFailData = await loginFailRes.json();
    console.log(`Intento ${i} Status: ${loginFailRes.status}`);
    console.log(`Intento ${i} Response:`, loginFailData);

    if (i <= 5) {
      if (loginFailRes.status !== 401 || loginFailData.error !== 'Credenciales inválidas') {
        throw new Error(`Intento fallido ${i} no devolvió credenciales inválidas (status: ${loginFailRes.status})`);
      }
    } else {
      // Intento 6 debe dar 429 por bloqueo
      if (loginFailRes.status !== 429 || !loginFailData.error.includes('Demasiados intentos fallidos')) {
        throw new Error(`Intento fallido ${i} no fue bloqueado por rate limit (status: ${loginFailRes.status})`);
      }
    }
  }

  // Verificar en Base de Datos que está bloqueado
  const dbRecord = await prisma.intentosLogin.findUnique({
    where: { email_tipo: { email: emailTest, tipo: 'cliente' } }
  });
  console.log('Registro de Intentos en DB:', dbRecord);
  if (dbRecord.cantidad !== 5 || !dbRecord.bloqueado_hasta) {
    throw new Error('La base de datos no persistió el bloqueo correctamente');
  }

  // Desbloquear manualmente en base de datos para probar login exitoso
  console.log('Desbloqueando cuenta en DB para probar login exitoso...');
  await prisma.intentosLogin.delete({
    where: { email_tipo: { email: emailTest, tipo: 'cliente' } }
  });

  // 4. Login Exitoso y Cookie Check
  const loginSuccessRes = await fetch('http://localhost:8080/api/shop/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: emailTest,
      password: passwordTest
    })
  });
  const loginSuccessData = await loginSuccessRes.json();
  console.log(`Login Exitoso Status: ${loginSuccessRes.status}`);
  console.log('Login Exitoso Response:', loginSuccessData);
  const cookieHeader = loginSuccessRes.headers.get('set-cookie');
  console.log('Cookie Recibida:', cookieHeader);

  if (loginSuccessRes.status !== 200 || !loginSuccessData.ok || !cookieHeader.includes('customer_token')) {
    throw new Error('Login exitoso falló o no retornó la cookie correcta');
  }

  // 5. Solicitar Código de Recuperación
  console.log('\n--- 3. Pruebas de Recuperación de Contraseña ---');
  const recoveryReqRes = await fetch('http://localhost:8080/api/shop/password/solicitar-codigo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailTest })
  });
  const recoveryReqData = await recoveryReqRes.json();
  console.log(`Solicitud de Código Status: ${recoveryReqRes.status}`);
  console.log('Solicitud de Código Response:', recoveryReqData);

  // Leer código de los logs del servidor para usarlo en la prueba
  console.log('Buscando código generado en los logs del servidor...');
  // Esperar un instante para asegurar que se escribió en logs
  await new Promise(r => setTimeout(r, 1000));
  
  // Buscar el log del servidor
  const logPath = path.join('C:\\Users\\PIXIS\\.gemini\\antigravity\\brain\\bb594bf5-d600-429b-8bcf-04a77219b938\\.system_generated\\tasks\\task-160.log');
  const logs = fs.readFileSync(logPath, 'utf-8');
  const matches = logs.match(/📧 \[RECOVERY CODE CLIENTE\] Código para (\S+): (\d+)/g);
  let recoveryCode = null;
  if (matches) {
    // Tomar el último código
    const lastMatch = matches[matches.length - 1];
    recoveryCode = lastMatch.split(': ')[1];
  }
  
  console.log(`Código encontrado en logs: ${recoveryCode}`);
  if (!recoveryCode) {
    throw new Error('No se pudo extraer el código de recuperación de los logs del servidor.');
  }

  // 6. Confirmar Código y cambiar contraseña
  const newPassword = 'NewSuperSecure456!';
  const recoveryConfirmRes = await fetch('http://localhost:8080/api/shop/password/confirmar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: emailTest,
      codigo: recoveryCode,
      password: newPassword
    })
  });
  const recoveryConfirmData = await recoveryConfirmRes.json();
  console.log(`Confirmación de Código Status: ${recoveryConfirmRes.status}`);
  console.log('Confirmación de Código Response:', recoveryConfirmData);
  if (recoveryConfirmRes.status !== 200 || !recoveryConfirmData.ok) {
    throw new Error('Falló la confirmación del código de recuperación');
  }

  // 7. Intentar Login con la vieja contraseña (debe fallar)
  const oldLoginRes = await fetch('http://localhost:8080/api/shop/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: emailTest,
      password: passwordTest
    })
  });
  console.log(`Login con contraseña vieja Status: ${oldLoginRes.status} (debe ser 401)`);
  if (oldLoginRes.status !== 401) {
    throw new Error('El login con la contraseña anterior no falló');
  }

  // 8. Intentar Login con la nueva contraseña (debe tener éxito)
  const newLoginRes = await fetch('http://localhost:8080/api/shop/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: emailTest,
      password: newPassword
    })
  });
  console.log(`Login con contraseña nueva Status: ${newLoginRes.status} (debe ser 200)`);
  if (newLoginRes.status !== 200) {
    throw new Error('El login con la nueva contraseña falló');
  }

  console.log('\n✅ TODAS LAS PRUEBAS COMPLETADAS CON ÉXITO PARA EL BLOQUE 2.');
}

runTests()
  .catch(err => {
    console.error('\n❌ ERROR EN LAS PRUEBAS:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
