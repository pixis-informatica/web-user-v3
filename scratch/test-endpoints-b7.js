const { PrismaClient } = require('@prisma/client');
const { spawn } = require('child_process');
const path = require('path');
const speakeasy = require('speakeasy');
const fs = require('fs');

const prisma = new PrismaClient();
const PORT = '8082';
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('🧪 Iniciando pruebas de integración del Bloque 7 (Panel de Ventas)...');

  // 1. Limpiar e inicializar usuario y pedido
  const testEmail = 'cliente-b7@test.com';
  
  const users = await prisma.usuario.findMany({
    where: { email: testEmail },
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

  // Leer stock inicial del producto de prueba
  const productsPath = path.join(__dirname, '..', 'data', 'products.json');
  const productsInit = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  const targetProductTitle = 'Adaptador Bluetooth 5.3 USB Nano MA530 Mercusys';
  const productInitData = productsInit.find(p => p.title === targetProductTitle);
  const stockInicial = productInitData ? productInitData.stock : 0;
  console.log(`📊 Stock inicial del producto en catálogo: ${stockInicial}`);

  // 2. Levantar el servidor Express en puerto 8082
  console.log('🚀 Iniciando instancia temporal del servidor...');
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: PORT }
  });

  await new Promise((resolve) => {
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Servidor en:')) {
        resolve();
      }
    });
  });

  try {
    // 3. Registrar cliente, hacer login y crear pedido
    console.log('\n👤 Registrando cliente...');
    await fetch(`${BASE_URL}/api/shop/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Cliente B7 Test',
        email: testEmail,
        telefono: '1122334455',
        password: 'Password123!'
      })
    });

    const loginClientRes = await fetch(`${BASE_URL}/api/shop/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'Password123!' })
    });
    const clientCookie = loginClientRes.headers.get('set-cookie');

    const orderRes = await fetch(`${BASE_URL}/api/shop/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({
        entrega: 'retiro',
        forma_pago: 'efectivo',
        items: [{ name: targetProductTitle, qty: 2 }]
      })
    });
    const orderData = await orderRes.json();
    const orderId = orderData.orderId;
    console.log(`✅ Pedido #${orderId} creado.`);

    // 4. Subir comprobante
    const formData = new FormData();
    formData.append('comprobante', new Blob(['fake_comprobante']), 'comprobante.jpg');
    await fetch(`${BASE_URL}/api/shop/orders/${orderId}/comprobante`, {
      method: 'POST',
      headers: { 'Cookie': clientCookie },
      body: formData
    });
    console.log('✅ Comprobante subido.');

    // 5. Iniciar sesión de Administrador (Vendedor) - Paso 1
    console.log('\n🔑 Iniciando sesión de Vendedor (Paso 1)...');
    const adminLoginRes = await fetch(`${BASE_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'vendedor@pixis.com',
        password: 'Pixis123!'
      })
    });
    const adminLoginData = await adminLoginRes.json();
    if (!adminLoginRes.ok) throw new Error(`Login admin fallido: ${JSON.stringify(adminLoginData)}`);
    const tempToken = adminLoginData.tempToken;
    console.log('✅ Paso 1 completado. Token temporal obtenido.');

    // Obtener el secreto TOTP de la base de datos para generar el código dinámico
    const empleado = await prisma.empleadoVentas.findUnique({
      where: { email: 'vendedor@pixis.com' }
    });
    const totpCode = speakeasy.totp({
      secret: empleado.totp_secret,
      encoding: 'base32'
    });
    console.log(`🔑 Código TOTP generado dinámicamente: ${totpCode}`);

    // Iniciar sesión de Administrador - Paso 2
    console.log('🔑 Validando OTP de Vendedor (Paso 2)...');
    const admin2faRes = await fetch(`${BASE_URL}/admin/login/2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: tempToken,
        codigo: totpCode
      })
    });
    const adminCookie = admin2faRes.headers.get('set-cookie');
    if (!admin2faRes.ok) throw new Error('Validación 2FA de admin falló');
    console.log('✅ Autenticación exitosa. Cookie de administración obtenida.');

    // 6. Obtener pedidos como administrador
    console.log('\n📥 Listando pedidos como administrador...');
    const listRes = await fetch(`${BASE_URL}/api/admin/orders`, {
      headers: { 'Cookie': adminCookie }
    });
    const listData = await listRes.json();
    console.log(`✅ Pedidos listados: ${listData.orders.length}`);

    // 7. Confirmar Pedido (Reservar stock)
    console.log(`\n⚙️ Confirmando pedido #${orderId}...`);
    const confirmRes = await fetch(`${BASE_URL}/api/admin/orders/${orderId}/confirm`, {
      method: 'POST',
      headers: { 'Cookie': adminCookie }
    });
    const confirmData = await confirmRes.json();
    if (!confirmRes.ok) throw new Error(`Error al confirmar pedido: ${JSON.stringify(confirmData)}`);
    console.log('✅ Pedido confirmado.');

    // 8. Verificar que el stock se haya decrementado en products.json
    const productsPost = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
    const productPostData = productsPost.find(p => p.title === targetProductTitle);
    const stockFinal = productPostData ? productPostData.stock : 0;
    console.log(`📊 Stock final del producto en catálogo: ${stockFinal}`);
    if (stockFinal !== stockInicial - 2) {
      throw new Error(`Error en reserva de stock. Esperado: ${stockInicial - 2}, Real: ${stockFinal}`);
    }
    console.log('✅ Descuento de stock en products.json validado de forma exitosa.');

    // 9. Completar Pedido
    console.log(`\n⚙️ Completando pedido #${orderId}...`);
    const completeRes = await fetch(`${BASE_URL}/api/admin/orders/${orderId}/complete`, {
      method: 'POST',
      headers: { 'Cookie': adminCookie }
    });
    if (!completeRes.ok) throw new Error('Error al completar el pedido');
    console.log('✅ Pedido completado.');

    console.log('\n✨ Todas las pruebas del Bloque 7 finalizaron exitosamente.');
  } finally {
    console.log('\n🛑 Deteniendo instancia temporal del servidor...');
    serverProcess.kill();
  }
}

runTests().catch(err => {
  console.error('\n❌ Prueba fallida:', err);
  process.exit(1);
});
