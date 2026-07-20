const fs = require('fs');
const path = require('path');

async function testHeaderButton() {
  console.log('🧪 Iniciando prueba del botón de acceso del cliente...');

  // 1. Verificar HTML de index.html
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  if (!html.includes('id="btn-client-login"')) {
    throw new Error('El botón #btn-client-login no está en index.html.');
  }
  console.log('✅ Botón de login encontrado en el HTML de la barra superior.');

  // 2. Realizar petición de sesión al servidor
  console.log('📡 Consultando /api/shop/me de forma anónima...');
  const meResAnon = await fetch('http://localhost:8080/api/shop/me');
  const meDataAnon = await meResAnon.json();
  if (meDataAnon.loggedIn !== false) {
    throw new Error('Se esperaba loggedIn: false para un usuario anónimo.');
  }
  console.log('✅ Estado anónimo verificado correctamente.');

  // 3. Crear usuario temporal y simular inicio de sesión de cliente
  const email = `cliente-test-${Date.now()}@test.com`;
  console.log(`👤 Creando usuario cliente de prueba: ${email}`);
  
  const regRes = await fetch('http://localhost:8080/api/shop/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Pedro Test',
      email,
      telefono: '3855555555',
      password: 'clientepassword',
      acepta_marketing: true
    })
  });
  
  if (!regRes.ok) {
    throw new Error(`Fallo en registro: ${regRes.status} ${await regRes.text()}`);
  }

  // Login
  const loginRes = await fetch('http://localhost:8080/api/shop/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'clientepassword' })
  });

  const cookieHeader = loginRes.headers.get('set-cookie');
  if (!cookieHeader) {
    throw new Error('No se recibió la cookie customer_token tras el login.');
  }
  const customerTokenCookie = cookieHeader.split(';')[0];
  console.log('✅ Cliente autenticado con éxito.');

  // Consultar sesión activa
  const meResActive = await fetch('http://localhost:8080/api/shop/me', {
    headers: { 'Cookie': customerTokenCookie }
  });
  const meDataActive = await meResActive.json();
  
  if (!meDataActive.loggedIn || meDataActive.user.nombre !== 'Pedro Test') {
    throw new Error('No se obtuvo la sesión activa esperada.');
  }
  console.log(`🎉 Sesión activa validada para: ${meDataActive.user.nombre}.`);
  console.log('🏆 LA PRUEBA FINALIZÓ EXITOSAMENTE.');
}

testHeaderButton().catch(err => {
  console.error('❌ Error en el test:', err);
  process.exit(1);
});
