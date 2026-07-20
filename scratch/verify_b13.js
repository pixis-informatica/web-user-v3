const fs = require('fs');
const path = require('path');

async function verifyBlock13() {
  console.log('🧪 Iniciando verificación del Bloque 13...');

  // 1. GET /?edit=true sin cookie
  console.log('🔍 Probando GET /?edit=true sin cookies...');
  const resGet = await fetch('http://localhost:8080/?edit=true');
  console.log(`📡 Código de respuesta: ${resGet.status}`);
  if (resGet.status !== 404) {
    throw new Error(`Se esperaba status 404, pero se obtuvo ${resGet.status}`);
  }
  console.log('✅ El interceptor retornó 404 correctamente para solicitudes sin credenciales.');

  // 2. POST /editor-acceso
  console.log('🔍 Probando POST /editor-acceso con credenciales válidas...');
  const resPost = await fetch('http://localhost:8080/editor-acceso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'vendedor@pixis.com', pass: 'Pixis123!' })
  });

  const postStatus = resPost.status;
  console.log(`📡 Código de respuesta POST: ${postStatus}`);
  if (postStatus !== 200) {
    throw new Error(`Se esperaba status 200, pero se obtuvo ${postStatus}`);
  }

  const postData = await resPost.json();
  if (!postData.tempToken) {
    throw new Error('No se recibió el tempToken en la respuesta.');
  }
  console.log(`✅ POST exitoso. tempToken recibido: ${postData.tempToken}`);

  // 3. Confirmar existencia y formato de DEPLOY.md
  console.log('🔍 Verificando archivo DEPLOY.md...');
  const deployPath = path.join(__dirname, '..', 'DEPLOY.md');
  if (!fs.existsSync(deployPath)) {
    throw new Error('No se encontró el archivo DEPLOY.md en la raíz del proyecto.');
  }

  const content = fs.readFileSync(deployPath, 'utf-8');
  const sections = [
    'Variables de Entorno',
    'Activación de Node.js',
    'Permisos de Escritura',
    'panel.pixistech.com',
    'Advertencias de Seguridad'
  ];

  for (const section of sections) {
    if (!content.includes(section)) {
      throw new Error(`Falta la sección "${section}" en DEPLOY.md.`);
    }
  }
  console.log('✅ DEPLOY.md verificado exitosamente y contiene todas las secciones obligatorias.');
  console.log('🏆 TODOS LOS PUNTOS DEL BLOQUE 13 VERIFICADOS CORRECTAMENTE.');
}

verifyBlock13().catch(err => {
  console.error('❌ Error en verificación:', err);
  process.exit(1);
});
