# Guía de Despliegue en Hostinger (hPanel)

Esta guía detalla los pasos para desplegar la aplicación web de **Pixis Informática** en el servicio de Node.js de Hostinger.

---

## 1. Variables de Entorno a Configurar en hPanel

En la sección de configuración de tu aplicación Node.js en Hostinger (hPanel), debés establecer las siguientes variables de entorno:

| Variable | Valor / Descripción |
| :--- | :--- |
| `DATABASE_URL` | `"file:./dev.db"` (Ruta a la base de datos SQLite administrada por Prisma). |
| `JWT_SECRET` | Un string largo y seguro generado al azar para firmar los tokens JWT en producción. |
| `GMAIL_USER` | Tu dirección de correo de soporte de Gmail para notificaciones (ej: `contacto@pixistech.com`). |
| `GMAIL_APP_PASSWORD` | Contraseña de aplicación de 16 caracteres generada desde Google Accounts (2FA activa obligatoria). |
| `NODE_ENV` | `production` |
| `COOKIE_DOMAIN` | El dominio raíz de la web sin subdominio ni www (ejemplo: `pixistech.com`), para permitir que las cookies JWT sean válidas en subdominios (como `panel.pixistech.com`). |
| `PORT` | `8080` |

---

## 2. Activación de Node.js Web App en hPanel

1. Subí los archivos del proyecto a Hostinger mediante Git o el Administrador de Archivos de hPanel (excepto la carpeta `node_modules`).
2. Dirigite a **Sitios Web > Aplicación Node.js** en hPanel.
3. Creá una nueva aplicación especificando:
   * **Nombre:** Pixis Web App
   * **Versión de Node:** Recomendo versión 18 o superior.
   * **Directorio de la app:** El directorio raíz donde subiste los archivos.
   * **Archivo de inicio:** `server.js`
   * **Puerto:** `8080` (Hostinger creará un proxy reverso transparente de Nginx a este puerto).
4. Guardá la configuración e iniciá la aplicación. Las dependencias se instalarán de forma automática. Si no es así, podés ejecutar `npm install` desde la consola de Hostinger.
5. Recordá aplicar las migraciones de Prisma de ser necesario ejecutando:
   ```bash
   npx prisma migrate deploy
   ```

---

## 3. Permisos de Escritura vía SSH

Para garantizar que el servidor Node.js pueda guardar backups, archivos subidos (comprobantes de pago) y actualizar datos de configuración local, debés ingresar por SSH y validar o corregir los permisos de escritura.

* **Comando para verificar permisos:**
  ```bash
  ls -la data/ uploads/ prisma/ backups/
  ```
* **Comando para corregir permisos (otorgar lectura/escritura al grupo correspondiente):**
  ```bash
  chmod -R 755 data/ uploads/ prisma/ backups/
  ```

---

## 4. Configuración del Subdominio `panel.pixistech.com`

Para que el panel de administración de ventas sea accesible desde `panel.pixistech.com`:
1. En hPanel, dirigite a **Sitios Web > Subdominios** y creá el subdominio `panel`.
2. En la zona DNS de tu dominio `pixistech.com`, asegurate de que exista un registro **CNAME** o tipo **A** para `panel` apuntando a la dirección IP de tu servidor VPS / Hosting donde corre la aplicación de Node.js.
3. El proxy reverso en el servidor rutea las peticiones dirigidas a dicho subdominio de forma automática a través del puerto `8080` gracias al middleware de enrutamiento implementado en la aplicación.

---

## 5. Advertencias de Seguridad Importantes

> [!WARNING]
> El secreto TOTP original (`PIXIS777SAFECODE`) quedó expuesto en el historial de confirmaciones de Git y debe considerarse **comprometido**. 
> Sin embargo, no afecta en absoluto a la seguridad actual: el nuevo sistema utiliza semillas TOTP dinámicas e individuales generadas de forma automática en la tabla `empleados_ventas` de SQLite.

> [!IMPORTANT]
> **Cambio de Contraseña Obligatorio:** En el primer acceso a la plataforma con el usuario semilla (`vendedor@pixis.com`), debés ingresar al panel de administración y **cambiar la contraseña por defecto** (`Pixis123!`) por una clave robusta y única.
