const http = require('http');

async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (options.body) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runAudit() {
  console.log('🤖 INICIANDO AUDITORÍA FUNCIONAL DEL BACKEND (CON PRODUCTO REAL)...');
  const testEmail = `audit_${Date.now()}@pixis-audit.com`;
  let cookie = '';
  let createdOrderId = null;

  try {
    // ----------------------------------------------------
    // 1. REGISTRO & LOGIN
    // ----------------------------------------------------
    console.log('\n--- 1. ESCENARIO 1: Registro de cliente nuevo ---');
    const regPayload = JSON.stringify({
      nombre: 'Cliente Auditor',
      email: testEmail,
      telefono: '3819999999',
      password: 'Password999!',
      direccion: 'Calle Falsa 123',
      provincia: 'Tucumán',
      localidad: 'Capital',
      codigo_postal: '4000',
      acepta_marketing: true
    });

    const regRes = await request('http://localhost:8080/api/shop/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: regPayload
    });

    console.log(`Status de Registro: ${regRes.status}`);
    console.log(`Respuesta Registro: ${regRes.body}`);

    const loginPayload = JSON.stringify({
      email: testEmail,
      password: 'Password999!'
    });
    
    const loginRes = await request('http://localhost:8080/api/shop/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: loginPayload
    });

    console.log(`Status de Login: ${loginRes.status}`);
    const setCookie = loginRes.headers['set-cookie'];
    if (setCookie && setCookie.length > 0) {
      cookie = setCookie[0].split(';')[0];
      console.log('✅ Cookie customer_token extraída exitosamente.');
    }

    if (regRes.status === 201 && loginRes.status === 200 && cookie) {
      console.log('✅ ESCENARIO 1: CORRECTO');
    } else {
      console.log('❌ ESCENARIO 1: ERROR');
    }

    // ----------------------------------------------------
    // 2. SESIÓN ACTIVA (GET /api/shop/me)
    // ----------------------------------------------------
    console.log('\n--- 2. ESCENARIO 2: Sesión Activa ---');
    const meRes = await request('http://localhost:8080/api/shop/me', {
      headers: { 'Cookie': cookie }
    });
    console.log(`Status /me: ${meRes.status}`);
    console.log(`Respuesta /me: ${meRes.body}`);

    const meData = JSON.parse(meRes.body);
    if (
      meData.loggedIn &&
      meData.user.direccion === 'Calle Falsa 123' &&
      meData.user.provincia === 'Tucumán' &&
      meData.user.localidad === 'Capital' &&
      meData.user.codigo_postal === '4000'
    ) {
      console.log('✅ ESCENARIO 2: CORRECTO');
    } else {
      console.log('❌ ESCENARIO 2: ERROR');
    }

    // ----------------------------------------------------
    // 3. CREACIÓN DE PEDIDO (CON PRODUCTO REAL)
    // ----------------------------------------------------
    console.log('\n--- 3. ESCENARIO 3: Creación de Pedido ---');
    const orderPayload = JSON.stringify({
      entrega: 'envio',
      direccion: 'Calle Falsa 123',
      forma_pago: 'transferencia',
      items: [{ name: 'Adaptador Bluetooth 5.3 USB Nano MA530 Mercusys', qty: 1 }]
    });

    const orderRes = await request('http://localhost:8080/api/shop/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: orderPayload
    });

    console.log(`Status de Orden: ${orderRes.status}`);
    console.log(`Respuesta Orden: ${orderRes.body}`);

    const orderData = JSON.parse(orderRes.body);
    if (orderRes.status === 201 || orderRes.status === 200) {
      createdOrderId = orderData.orderId;
      console.log('✅ ESCENARIO 3: CORRECTO');
    } else {
      console.log('❌ ESCENARIO 3: ERROR');
    }

    // ----------------------------------------------------
    // 4. ACTUALIZACIÓN DE PERFIL (PUT /api/shop/me)
    // ----------------------------------------------------
    console.log('\n--- 4. ESCENARIO 4: Actualización de Perfil ---');
    const updatePayload = JSON.stringify({
      direccion: 'Av. Alem 987',
      provincia: 'Tucumán',
      localidad: 'Yerba Buena',
      codigo_postal: '4107'
    });

    const updateRes = await request('http://localhost:8080/api/shop/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: updatePayload
    });

    console.log(`Status de Modificación: ${updateRes.status}`);
    console.log(`Respuesta Modificación: ${updateRes.body}`);

    const updateData = JSON.parse(updateRes.body);
    if (updateRes.status === 200 && updateData.user.direccion === 'Av. Alem 987') {
      console.log('✅ ESCENARIO 4: CORRECTO');
    } else {
      console.log('❌ ESCENARIO 4: ERROR');
    }

    // ----------------------------------------------------
    // 5. PERSISTENCIA
    // ----------------------------------------------------
    console.log('\n--- 5. ESCENARIO 5: Persistencia de datos ---');
    const meAgainRes = await request('http://localhost:8080/api/shop/me', {
      headers: { 'Cookie': cookie }
    });
    console.log(`Status /me de nuevo: ${meAgainRes.status}`);
    console.log(`Respuesta /me de nuevo: ${meAgainRes.body}`);

    const meAgainData = JSON.parse(meAgainRes.body);
    if (meAgainData.user.direccion === 'Av. Alem 987') {
      console.log('✅ ESCENARIO 5: CORRECTO');
    } else {
      console.log('❌ ESCENARIO 5: ERROR');
    }

    // ----------------------------------------------------
    // 6. MIS PEDIDOS (GET /api/shop/orders)
    // ----------------------------------------------------
    console.log('\n--- 6. ESCENARIO 6: Mis Pedidos ---');
    const ordersRes = await request('http://localhost:8080/api/shop/orders', {
      headers: { 'Cookie': cookie }
    });
    console.log(`Status /orders: ${ordersRes.status}`);
    console.log(`Respuesta /orders: ${ordersRes.body}`);

    const ordersData = JSON.parse(ordersRes.body);
    const myOrder = (ordersData.orders || []).find(o => o.id === createdOrderId);
    if (myOrder && myOrder.estado === 'pendiente_revision') {
      console.log('✅ ESCENARIO 6: CORRECTO');
    } else {
      console.log('❌ ESCENARIO 6: ERROR');
    }

  } catch (e) {
    console.error('❌ Error fatal en Auditoría:', e);
  }
}

runAudit();
