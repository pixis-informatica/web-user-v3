const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const emailTest = `buyer-${Date.now()}@pixis.com`;
const passwordTest = 'BuyerPassword123!';
const BASE_URL = 'http://localhost:8080';

async function runTests() {
  console.log('🧪 Iniciando pruebas de endpoints del Bloque 5 (Pedidos/Checkout)...');

  // 1. Registrar Cliente
  console.log('\n--- 1. Registrar cliente comprador ---');
  const regRes = await fetch(`${BASE_URL}/api/shop/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Juan Comprador',
      email: emailTest,
      telefono: '3816112233',
      password: passwordTest,
      acepta_marketing: true
    })
  });
  const regData = await regRes.json();
  console.log('Registro status:', regRes.status, regData);
  if (regRes.status !== 201) throw new Error('Error al registrar cliente');

  // 2. Iniciar sesión para obtener cookie de sesión
  console.log('\n--- 2. Iniciar sesión cliente ---');
  const loginRes = await fetch(`${BASE_URL}/api/shop/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: emailTest,
      password: passwordTest
    })
  });
  const loginData = await loginRes.json();
  const cookies = loginRes.headers.get('set-cookie');
  console.log('Login status:', loginRes.status, loginData);
  console.log('Cookies recibidas:', cookies);
  if (loginRes.status !== 200) throw new Error('Error al iniciar sesión');

  // Extraer token de cookie para peticiones subsiguientes
  const customerTokenCookie = cookies.split(';')[0];

  // 3. Consultar /api/shop/me
  console.log('\n--- 3. Consultar /api/shop/me ---');
  const meRes = await fetch(`${BASE_URL}/api/shop/me`, {
    headers: { 'Cookie': customerTokenCookie }
  });
  const meData = await meRes.json();
  console.log('/api/shop/me response:', meData);
  if (!meData.loggedIn || meData.user.email !== emailTest) {
    throw new Error('La sesión no se validó correctamente en /api/shop/me');
  }

  // 4. Crear un pedido con un producto válido del catálogo (ej. Adaptador Bluetooth 5.3 USB Nano MA530 Mercusys)
  console.log('\n--- 4. Crear pedido (tarjeta con 3 cuotas) ---');
  const orderRes = await fetch(`${BASE_URL}/api/shop/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': customerTokenCookie
    },
    body: JSON.stringify({
      entrega: 'retiro',
      forma_pago: 'tarjeta',
      cuotas: 3,
      items: [
        {
          name: 'Adaptador Bluetooth 5.3 USB Nano MA530 Mercusys',
          qty: 2
        }
      ]
    })
  });
  const orderData = await orderRes.json();
  console.log('Order status:', orderRes.status, orderData);
  if (orderRes.status !== 201) throw new Error('Error al crear el pedido');

  // Verificar el total calculado por el backend.
  // Precio de lista para Adaptador Bluetooth 5.3 USB Nano MA530 Mercusys = 9000
  // Recargo de 3 cuotas: index 1 en tasasCuotas = 1.31
  // Total base = 9000 * 2 = 18000
  // Total con interés = 18000 * 1.31 = 23580
  const expectedTotal = Math.round(9000 * 2 * 1.31);
  console.log(`Total esperado: ${expectedTotal}, Total recibido: ${orderData.total}`);
  if (orderData.total !== expectedTotal) {
    throw new Error(`Cálculo de total incorrecto. Esperado: ${expectedTotal}, Recibido: ${orderData.total}`);
  }
  console.log('✅ El cálculo de precios con interés del catálogo coincide perfectamente.');

  // 5. Consultar pedidos del cliente
  console.log('\n--- 5. Consultar pedidos del cliente ---');
  const getOrdersRes = await fetch(`${BASE_URL}/api/shop/orders`, {
    headers: { 'Cookie': customerTokenCookie }
  });
  const getOrdersData = await getOrdersRes.json();
  console.log('Pedidos de cliente:', JSON.stringify(getOrdersData, null, 2));
  if (getOrdersData.orders.length !== 1 || getOrdersData.orders[0].id !== orderData.orderId) {
    throw new Error('El pedido creado no figura en la lista de pedidos del cliente');
  }

  // 6. Consultar detalle de un pedido específico por ID
  console.log('\n--- 6. Consultar detalle de pedido específico ---');
  const orderDetailRes = await fetch(`${BASE_URL}/api/shop/orders/${orderData.orderId}`, {
    headers: { 'Cookie': customerTokenCookie }
  });
  const orderDetailData = await orderDetailRes.json();
  console.log('Detalle de pedido:', orderDetailData);
  if (!orderDetailData.ok || orderDetailData.order.total !== expectedTotal) {
    throw new Error('El detalle del pedido no coincide');
  }

  // 7. Intentar consultar pedido de otro cliente (debe fallar/dar 404)
  console.log('\n--- 7. Intentar consultar pedido sin autenticación de propietario ---');
  const hackerRes = await fetch(`${BASE_URL}/api/shop/orders/${orderData.orderId}`);
  console.log('Intento hacker status:', hackerRes.status);
  if (hackerRes.status === 200) {
    throw new Error('Error: Un usuario no autenticado pudo ver el pedido.');
  }
  console.log('✅ Acceso no autorizado denegado con éxito.');

  console.log('\n🎉 TODAS LAS PRUEBAS DEL BLOQUE 5 COMPLETADAS CON ÉXITO.');
}

runTests()
  .catch(err => {
    console.error('\n❌ ERROR EN PRUEBAS:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
