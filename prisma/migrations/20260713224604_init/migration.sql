-- CreateTable
CREATE TABLE "usuarios" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "acepta_marketing" BOOLEAN NOT NULL DEFAULT false,
    "codigo_recuperacion" TEXT,
    "codigo_recuperacion_expira" DATETIME,
    "creado_en" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "empleados_ventas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret" TEXT,
    "totp_activado" BOOLEAN NOT NULL DEFAULT false,
    "codigo_recuperacion" TEXT,
    "codigo_recuperacion_expira" DATETIME,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuario_id" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente_revision',
    "entrega" TEXT NOT NULL,
    "direccion" TEXT,
    "forma_pago" TEXT NOT NULL,
    "cuotas" INTEGER,
    "total" REAL NOT NULL,
    "reservado_hasta" DATETIME,
    "creado_en" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" DATETIME NOT NULL,
    CONSTRAINT "pedidos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "items_pedido" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pedido_id" INTEGER NOT NULL,
    "producto_id" TEXT NOT NULL,
    "nombre_snapshot" TEXT NOT NULL,
    "precio_unitario_snapshot" REAL NOT NULL,
    "cantidad" INTEGER NOT NULL,
    CONSTRAINT "items_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pedido_id" INTEGER NOT NULL,
    "archivo_url" TEXT NOT NULL,
    "subido_en" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisado_por" INTEGER,
    "revisado_en" DATETIME,
    CONSTRAINT "comprobantes_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "comprobantes_revisado_por_fkey" FOREIGN KEY ("revisado_por") REFERENCES "empleados_ventas" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "intentos_login" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "ultimo_intento" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bloqueado_hasta" DATETIME
);

-- CreateTable
CREATE TABLE "temp_tokens_2fa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empleado_id" INTEGER NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "expira_en" DATETIME NOT NULL,
    "creado_en" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "temp_tokens_2fa_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "empleados_ventas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "empleados_ventas_email_key" ON "empleados_ventas"("email");

-- CreateIndex
CREATE UNIQUE INDEX "intentos_login_email_tipo_key" ON "intentos_login"("email", "tipo");
