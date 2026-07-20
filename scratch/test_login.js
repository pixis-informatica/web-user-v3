const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

async function test() {
  const user = 'vendedor@pixis.com';
  const pass = 'Pixis123!';

  console.log('1. Buscando empleado...');
  const empleado = await prisma.empleadoVentas.findUnique({
    where: { email: user }
  });

  if (!empleado) {
    console.log('❌ Empleado no encontrado');
    return;
  }
  console.log('✅ Empleado encontrado:', empleado.email);

  console.log('2. Verificando contraseña...');
  const valid = await bcrypt.compare(pass, empleado.password_hash);
  console.log('Password valid:', valid);

  console.log('3. Creando token temporal 2FA...');
  const expiraEn = new Date(Date.now() + 5 * 60 * 1000);
  const tempToken = await prisma.tempTokens2FA.create({
    data: {
      empleado_id: empleado.id,
      expira_en: expiraEn
    }
  });
  console.log('✅ Temp token creado:', tempToken.id);

  console.log('4. Generando QR...');
  if (!empleado.totp_activado) {
    const label = `PixisEditor:${empleado.email}`;
    const otpauthUrl = speakeasy.otpauthURL({
      secret: empleado.totp_secret || 'PIXIS777SAFECODE',
      label: label,
      issuer: 'Pixis Informatica'
    });
    const qrCodeUrl = await qrcode.toDataURL(otpauthUrl);
    console.log('✅ QR Code URL generado exitosamente');
  } else {
    console.log('✅ 2FA ya estaba activo, no requiere QR');
  }
}

test().catch(err => {
  console.error('❌ ERROR EN EL TEST:', err);
}).finally(() => prisma.$disconnect());
