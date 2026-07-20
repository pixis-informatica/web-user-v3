-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_pedidos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuario_id" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente_revision',
    "motivo_rechazo" TEXT,
    "stock_descontado" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_pedidos" ("actualizado_en", "creado_en", "cuotas", "direccion", "entrega", "estado", "forma_pago", "id", "reservado_hasta", "total", "usuario_id") SELECT "actualizado_en", "creado_en", "cuotas", "direccion", "entrega", "estado", "forma_pago", "id", "reservado_hasta", "total", "usuario_id" FROM "pedidos";
DROP TABLE "pedidos";
ALTER TABLE "new_pedidos" RENAME TO "pedidos";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
