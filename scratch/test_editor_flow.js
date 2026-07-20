const speakeasy = require('speakeasy');

async function testEditorFlow() {
  const email = 'vendedor@pixis.com';
  const pass = 'Pixis123!';
  const totpSecret = 'OQYFINRZHE7CQQLDJZWVGOJ4FA7EQYKDNM4GKSTOMEXTIWZROMTA';
  
  console.log('🧪 Iniciando prueba programática de autenticación y guardado del Editor...');

  // Paso 1: Login
  const loginRes = await fetch('http://localhost:8080/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: email, pass })
  });
  
  if (!loginRes.ok) {
    throw new Error(`Error en Paso 1: ${loginRes.status} ${await loginRes.text()}`);
  }
  
  const loginData = await loginRes.json();
  console.log('✅ Paso 1 Exitoso. tempToken recibido:', loginData.tempToken);
  
  // Generar código 2FA actual
  const code = speakeasy.totp({
    secret: totpSecret,
    encoding: 'base32'
  });
  console.log(`🔑 Código 2FA generado para el test: ${code}`);

  // Paso 2: Verificar 2FA
  const verifyRes = await fetch('http://localhost:8080/api/verify-2fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: code, tempToken: loginData.tempToken })
  });

  if (!verifyRes.ok) {
    throw new Error(`Error en Paso 2: ${verifyRes.status} ${await verifyRes.text()}`);
  }

  // Extraer cookie admin_token de los headers
  const cookieHeader = verifyRes.headers.get('set-cookie');
  if (!cookieHeader) {
    throw new Error('No se recibió la cookie admin_token en la respuesta.');
  }
  const adminTokenCookie = cookieHeader.split(';')[0];
  console.log('✅ Paso 2 Exitoso. Cookie admin_token recibida.');

  // Obtener estado actual de site.json
  const siteFilePath = require('path').join(__dirname, '..', 'data', 'site.json');
  const fs = require('fs');
  const siteData = JSON.parse(fs.readFileSync(siteFilePath, 'utf-8'));
  const originalBanner = siteData.topBannerText || '';
  console.log(`📝 Banner original: "${originalBanner}"`);

  // Modificar banner
  const newBanner = `¡Edición Exitosa Bloque 12! - ${new Date().toLocaleTimeString()}`;
  siteData.topBannerText = newBanner;

  // Intentar guardar cambio vía /api/save-all con la cookie obtenida
  console.log('💾 Enviando actualización a /api/save-all...');
  const saveRes = await fetch('http://localhost:8080/api/save-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminTokenCookie
    },
    body: JSON.stringify({ site: siteData })
  });

  if (!saveRes.ok) {
    throw new Error(`Error al guardar: ${saveRes.status} ${await saveRes.text()}`);
  }

  const saveData = await saveRes.json();
  console.log('✅ Actualización exitosa en API:', JSON.stringify(saveData));

  // Verificar en disco
  const updatedSiteData = JSON.parse(fs.readFileSync(siteFilePath, 'utf-8'));
  console.log(`🎉 Banner en disco después de guardar: "${updatedSiteData.topBannerText}"`);
  
  if (updatedSiteData.topBannerText === newBanner) {
    console.log('🏆 PRUEBA COMPLETADA EXITOSAMENTE. Todo funciona perfecto.');
  } else {
    throw new Error('El banner en disco no coincide con el enviado.');
  }
}

testEditorFlow().catch(err => {
  console.error('❌ Error en el test:', err);
  process.exit(1);
});
