const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');

async function main() {
  const hash = await bcrypt.hash('Pixis123!', 10);
  const updated = await prisma.empleadoVentas.update({
    where: { email: 'vendedor@pixis.com' },
    data: {
      password_hash: hash,
      totp_activado: false // Desactivamos el 2FA para que pida configurarlo con QR de nuevo
    }
  });
  console.log(`✅ Administrador resetado con éxito:`);
  console.log(`📧 Email: ${updated.email}`);
  console.log(`🔑 Clave seteada a: Pixis123!`);
  console.log(`🔐 2FA: Reseteado (te pedirá escanear el QR al ingresar)`);
}

main().catch(err => console.error(err)).finally(() => prisma.$disconnect());
