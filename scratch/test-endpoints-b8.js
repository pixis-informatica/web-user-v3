const { PrismaClient } = require('@prisma/client');
const { spawn } = require('child_process');
const path = require('path');
const speakeasy = require('speakeasy');
const fs = require('fs');

const prisma = new PrismaClient();
const PORT = '8082';
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('🧪 Iniciando pruebas de integración del Bloque 8 (Cron de Reservas Vencidas)...');

  // 1. Limpiar datos de pruebas anteriores
  const testEmail = 'cliente-b8@test.com';
  
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

  // Leer stock inicial del producto
  const productsPath = path.join(__dirname, '..', 'data', 'products.json');
  const productsInit = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  const targetProductTitle = 'Adaptador Bluetooth 5.3 USB Nano MA530 Mercusys';
  const productInitData = productsInit.find(p => p.title === targetProductTitle);
  const stockInicial = productInitData ? productInitData.stock : 0;
  console.log(`📊 Stock inicial en catálogo: ${stockInicial}`);

  // 2. Levantar el servidor en puerto 8082
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
    // 3. Crear pedido del cliente
    console.log('\n👤 Creando cliente y pedido...');
    await fetch(`${BASE_URL}/api/shop/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Cliente B8 Test',
        email: testEmail,
        telefono: '1122334455',
        password: 'Password123!'
      })
    });

    const loginRes = await fetch(`${BASE_URL}/api/shop/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'Password123!' })
    });
    const clientCookie = loginRes.headers.get('set-cookie');

    const orderRes = await fetch(`${BASE_URL}/api/shop/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': clientCookie },
      body: JSON.stringify({
        entrega: 'retiro',
        forma_pago: 'efectivo',
        items: [{ name: targetProductTitle, qty: 3 }]
      })
    });
    const orderData = await orderRes.json();
    const orderId = orderData.orderId;
    console.log(`✅ Pedido #${orderId} creado.`);

    // 4. Iniciar sesión de admin
    console.log('\n🔑 Autenticando Administrador...');
    const adminLoginRes = await fetch(`${BASE_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'vendedor@pixis.com', password: 'Pixis123!' })
    });
    const adminLoginData = await adminLoginRes.json();
    const tempToken = adminLoginData.tempToken;

    const empleado = await prisma.empleadoVentas.findUnique({
      where: { email: 'vendedor@pixis.com' }
    });
    const totpCode = speakeasy.totp({
      secret: empleado.totp_secret,
      encoding: 'base32'
    });

    const admin2faRes = await fetch(`${BASE_URL}/admin/login/2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tempToken, codigo: totpCode })
    });
    const adminCookie = admin2faRes.headers.get('set-cookie');
    console.log('✅ Admin autenticado.');

    // 5. Confirmar pedido (reserva stock y resta 3 unidades)
    console.log('\n⚙️ Confirmando pedido...');
    await fetch(`${BASE_URL}/api/admin/orders/${orderId}/confirm`, {
      method: 'POST',
      headers: { 'Cookie': adminCookie }
    });
    
    // Verificar stock disminuido
    let productsMid = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
    let stockMid = productsMid.find(p => p.title === targetProductTitle).stock;
    console.log(`📊 Stock reservado intermedio: ${stockMid} (Debe ser ${stockInicial - 3})`);
    if (stockMid !== stockInicial - 3) throw new Error('El stock intermedio no coincide.');

    // 6. Manipular la base de datos para vencer la reserva artificialmente
    console.log('\n🕒 Manipulando reservado_hasta para situarlo en el pasado...');
    await prisma.pedido.update({
      where: { id: orderId },
      data: {
        reservado_hasta: new Date(Date.now() - 1000 * 60) // Vencido hace 1 minuto
      }
    });

    // 7. Insertar un token 2FA obsoleto/usado para verificar que la limpieza del cron funciona
    console.log('🧹 Creando token 2FA obsoleto para comprobar su eliminación...');
    await prisma.tempTokens2FA.create({
      data: {
        empleado_id: empleado.id,
        usado: true,
        expira_en: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    // 8. Gatillar cron manualmente
    console.log('\n⏰ Gatillando cron de forma manual...');
    const cronRes = await fetch(`${BASE_URL}/api/admin/cron/run-manually`, {
      method: 'POST',
      headers: { 'Cookie': adminCookie }
    });
    const cronData = await cronRes.json();
    console.log(`✅ Cron ejecutado. Respuesta: ${JSON.stringify(cronData)}`);

    // 9. Verificar restauración de stock
    const productsEnd = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
    const stockFinal = productsEnd.find(p => p.title === targetProductTitle).stock;
    console.log(`📊 Stock final en catálogo: ${stockFinal} (Debe retornar a ${stockInicial})`);
    if (stockFinal !== stockInicial) {
      throw new Error(`El stock no fue restaurado correctamente. Final: ${stockFinal}, Esperado: ${stockInicial}`);
    }
    console.log('✅ Restauración de stock verificada de forma exitosa.');

    // 10. Verificar estado del pedido en la base de datos
    const dbOrder = await prisma.pedido.findUnique({ where: { id: orderId } });
    console.log(`📦 Estado final del pedido en DB: ${dbOrder.estado} (Esperado: vencido)`);
    if (dbOrder.estado !== 'vencido') throw new Error('El estado del pedido no se marcó como vencido.');

    // 11. Verificar que el token 2FA usado fue borrado
    const tokensCount = await prisma.tempTokens2FA.count({ where: { usado: true } });
    console.log(`🧹 Cantidad de tokens usados en DB: ${tokensCount} (Esperado: 0)`);
    if (tokensCount !== 0) throw new Error('La limpieza de tokens 2FA falló.');

    console.log('\n✨ Todas las pruebas del Bloque 8 finalizaron exitosamente.');
  } finally {
    console.log('\n🛑 Deteniendo instancia temporal del servidor...');
    serverProcess.kill();
  }
}

runTests().catch(err => {
  console.error('\n❌ Prueba fallida:', err);
  process.exit(1);
});
