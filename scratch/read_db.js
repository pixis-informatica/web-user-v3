const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.empleadoVentas.findMany();
  console.log('--- Empleados en DB ---');
  for (const u of users) {
    console.log(`ID: ${u.id} | Email: ${u.email} | Activo: ${u.activo} | 2FA Activado: ${u.totp_activado}`);
  }
}

main().catch(err => console.error(err)).finally(() => prisma.$disconnect());
