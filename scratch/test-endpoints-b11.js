const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = '8082';
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
  console.log('🧪 Iniciando pruebas de integración del Bloque 11 (Backups)...');

  // Limpiar carpeta de backups previa si existe
  const backupDir = path.join(__dirname, '..', 'backups');
  if (fs.existsSync(backupDir)) {
    const archivos = fs.readdirSync(backupDir);
    for (const archivo of archivos) {
      fs.unlinkSync(path.join(backupDir, archivo));
    }
  }

  // Levantar el servidor Express en puerto 8082
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
    // Gatillar backup manual vía HTTP POST (llamada local permitida)
    console.log('📦 Gatillando backup manual vía endpoint...');
    const res = await fetch(`${BASE_URL}/api/admin/backup/run-manually`, {
      method: 'POST'
    });
    const data = await res.json();
    console.log(`✅ Respuesta del servidor: ${JSON.stringify(data)}`);

    if (!res.ok) throw new Error('El endpoint de backup respondió con error.');

    // Verificar que el archivo de backup se haya creado en la carpeta backups
    if (!fs.existsSync(backupDir)) {
      throw new Error('La carpeta /backups/ no fue creada.');
    }

    const archivos = fs.readdirSync(backupDir);
    console.log(`📊 Archivos encontrados en /backups/: ${archivos.join(', ')}`);

    if (archivos.length === 0) {
      throw new Error('No se generó ningún archivo de backup.');
    }

    const backupArchivo = archivos[0];
    if (!backupArchivo.startsWith('backup-') || !backupArchivo.endsWith('.db')) {
      throw new Error(`El nombre de archivo no cumple el patrón requerido: ${backupArchivo}`);
    }

    console.log('✨ Pruebas del Bloque 11 finalizadas con éxito.');
  } finally {
    console.log('🛑 Deteniendo instancia temporal del servidor...');
    serverProcess.kill();
  }
}

runTests().catch(err => {
  console.error('\n❌ Prueba fallida:', err);
  process.exit(1);
});
