-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_usuarios" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "acepta_marketing" BOOLEAN NOT NULL DEFAULT false,
    "direccion" TEXT,
    "provincia" TEXT,
    "localidad" TEXT,
    "codigo_postal" TEXT,
    "codigo_recuperacion" TEXT,
    "codigo_recuperacion_expira" DATETIME,
    "verificado" BOOLEAN NOT NULL DEFAULT false,
    "codigo_verificacion" TEXT,
    "codigo_verificacion_expira" DATETIME,
    "creado_en" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_usuarios" ("acepta_marketing", "codigo_postal", "codigo_recuperacion", "codigo_recuperacion_expira", "creado_en", "direccion", "email", "id", "localidad", "nombre", "password_hash", "provincia", "telefono") SELECT "acepta_marketing", "codigo_postal", "codigo_recuperacion", "codigo_recuperacion_expira", "creado_en", "direccion", "email", "id", "localidad", "nombre", "password_hash", "provincia", "telefono" FROM "usuarios";
DROP TABLE "usuarios";
ALTER TABLE "new_usuarios" RENAME TO "usuarios";
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
