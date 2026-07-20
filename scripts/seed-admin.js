const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Sembrando base de datos con empleado de ventas inicial...');

  const email = 'vendedor@pixis.com';
  const password = 'Pixis123!';
  
  // Hashear contraseña con bcrypt
  const passwordHash = await bcrypt.hash(password, 10);

  // Generar un secreto TOTP nuevo y dinámico
  const secret = speakeasy.generateSecret({
    name: `Pixis Informatica (${email})`,
    issuer: 'Pixis Informatica'
  });

  console.log(`🔑 Secreto TOTP generado: ${secret.base32}`);

  // Insertar o actualizar el empleado en la base de datos
  const empleado = await prisma.empleadoVentas.upsert({
    where: { email },
    update: {
      nombre: 'Vendedor Principal',
      password_hash: passwordHash,
      totp_secret: secret.base32,
      totp_activado: false, // Empieza en falso para requerir escaneo inicial
      activo: true
    },
    create: {
      nombre: 'Vendedor Principal',
      email,
      password_hash: passwordHash,
      totp_secret: secret.base32,
      totp_activado: false,
      activo: true
    }
  });

  console.log('✅ Empleado creado / actualizado con éxito:');
  console.log(`   - ID: ${empleado.id}`);
  console.log(`   - Nombre: ${empleado.nombre}`);
  console.log(`   - Email: ${empleado.email}`);
  console.log(`   - Contraseña Temporal: ${password}`);
  console.log(`   - Secreto TOTP (Base32): ${secret.base32}`);
  console.log(`   - OTPAuth URL: ${secret.otpauth_url}`);
  console.log('\n⚠️ NOTA: Guarda el secreto TOTP para configurarlo en tu app de autenticación (Google Authenticator, etc.).');
}

main()
  .catch((e) => {
    console.error('❌ Error al sembrar base de datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
