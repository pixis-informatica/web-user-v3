const { PrismaClient } = require('@prisma/client');
const { spawn } = require('child_process');
const path = require('path');
const prisma = new PrismaClient();

const PORT = '8082';
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('🧪 Iniciando pruebas de integración del Bloque 6 en puerto alternativo 8082...');

  // 1. Limpiar datos viejos
  const testEmail = 'cliente-b6@test.com';
  const otherEmail = 'cliente-b6-ajeno@test.com';
  
  const users = await prisma.usuario.findMany({
    where: { email: { in: [testEmail, otherEmail] } },
    select: { id: true }
  });
  const userIds = users.map(u => u.id);
  
  if (userIds.length > 0) {
    const orders = await prisma.pedido.findMany({
      where: { usuario_id: { in: userIds } },
      select: { id: true }
    });
    const orderIds = orders.map(o => o.id);
    
    if (orderIds.length > 0) {
      await prisma.comprobante.deleteMany({ where: { pedido_id: { in: orderIds } } });
      await prisma.itemPedido.deleteMany({ where: { pedido_id: { in: orderIds } } });
      await prisma.pedido.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
  }

  // 2. Levantar el servidor en puerto 8082
  console.log('🚀 Iniciando instancia temporal del servidor...');
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: PORT }
  });

  // Esperar a que el servidor esté listo
  await new Promise((resolve) => {
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Servidor en:')) {
        resolve();
      }
    });
  });

  try {
    // 3. Registrar usuario de prueba
    console.log('\n👤 1. Registrando cliente de prueba...');
    const regRes = await fetch(`${BASE_URL}/api/shop/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Cliente B6 Test',
        email: testEmail,
        telefono: '1122334455',
        password: 'Password123!',
        acepta_marketing: true
      })
    });
    
    const regData = await regRes.json();
    if (!regRes.ok) throw new Error(`Registro fallido: ${JSON.stringify(regData)}`);
    console.log('✅ Cliente registrado con éxito.');

    // Registrar cliente ajeno
    await fetch(`${BASE_URL}/api/shop/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Cliente Ajeno',
        email: otherEmail,
        telefono: '9988776655',
        password: 'Password123!',
        acepta_marketing: false
      })
    });
    
    // 4. Login de usuario de prueba para obtener cookie
    console.log('\n🔑 2. Iniciando sesión...');
    const loginRes = await fetch(`${BASE_URL}/api/shop/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password123!'
      })
    });
    
    if (!loginRes.ok) throw new Error('Login fallido');
    const cookieHeader = loginRes.headers.get('set-cookie');
    console.log('✅ Login exitoso. Cookie recibida:', cookieHeader ? 'SÍ' : 'NO');

    // Login cliente ajeno
    const loginOtherRes = await fetch(`${BASE_URL}/api/shop/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: otherEmail,
        password: 'Password123!'
      })
    });
    const otherCookieHeader = loginOtherRes.headers.get('set-cookie');

    // 5. Crear un pedido de prueba
    console.log('\n🛒 3. Creando pedido de prueba (Checkout)...');
    const orderRes = await fetch(`${BASE_URL}/api/shop/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader
      },
      body: JSON.stringify({
        entrega: 'retiro',
        forma_pago: 'efectivo',
        items: [
          {
            name: 'Adaptador Bluetooth 5.3 USB Nano MA530 Mercusys',
            qty: 1
          }
        ]
      })
    });
    
    const orderData = await orderRes.json();
    if (!orderRes.ok) throw new Error(`Error al crear pedido: ${JSON.stringify(orderData)}`);
    const orderId = orderData.orderId;
    console.log(`✅ Pedido #${orderId} creado con éxito.`);

    // 6. Subir comprobante mediante FormData
    console.log('\n📎 4. Subiendo comprobante ficticio...');
    const formData = new FormData();
    const fakeFile = new Blob(['Simulacion de archivo comprobante de pago PDF'], { type: 'application/pdf' });
    formData.append('comprobante', fakeFile, 'comprobante_pago.pdf');

    const uploadRes = await fetch(`${BASE_URL}/api/shop/orders/${orderId}/comprobante`, {
      method: 'POST',
      headers: {
        'Cookie': cookieHeader
      },
      body: formData
    });

    const uploadRawText = await uploadRes.text();
    const uploadData = JSON.parse(uploadRawText);
    if (!uploadRes.ok) throw new Error(`Subida de comprobante fallida: ${JSON.stringify(uploadData)}`);
    console.log('✅ Comprobante subido. Respuesta:', JSON.stringify(uploadData));
    const archivoUrl = uploadData.comprobante.archivo_url;

    // 7. Verificar el acceso seguro al archivo comprobante
    console.log('\n🔒 5. Verificando políticas de acceso al comprobante...');
    
    // Caso A: El cliente dueño accede
    console.log('  - Intentando acceder como CLIENTE DUEÑO...');
    const accessOwnerRes = await fetch(`${BASE_URL}${archivoUrl}`, {
      headers: { 'Cookie': cookieHeader }
    });
    console.log(`    Status: ${accessOwnerRes.status} (Esperado: 200)`);
    if (accessOwnerRes.status !== 200) throw new Error('Cliente dueño bloqueado incorrectamente.');

    // Caso B: Acceder sin sesión
    console.log('  - Intentando acceder SIN SESIÓN...');
    const accessNoSessionRes = await fetch(`${BASE_URL}${archivoUrl}`);
    console.log(`    Status: ${accessNoSessionRes.status} (Esperado: 403)`);
    if (accessNoSessionRes.status !== 403) throw new Error('Se permitió el acceso sin sesión.');

    // Caso C: Cliente ajeno accede
    console.log('  - Intentando acceder como CLIENTE AJENO...');
    const accessOtherRes = await fetch(`${BASE_URL}${archivoUrl}`, {
      headers: { 'Cookie': otherCookieHeader }
    });
    console.log(`    Status: ${accessOtherRes.status} (Esperado: 403)`);
    if (accessOtherRes.status !== 403) throw new Error('Se permitió el acceso a un cliente no dueño del pedido.');

    console.log('\n✨ Todas las pruebas del Bloque 6 finalizaron exitosamente.');
  } finally {
    console.log('\n🛑 Deteniendo instancia temporal del servidor...');
    serverProcess.kill();
  }
}

runTests().catch(err => {
  console.error('\n❌ Prueba fallida:', err);
  process.exit(1);
});
