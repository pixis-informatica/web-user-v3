// ── AUTO-CONFIGURACIÓN: Garantizar DATABASE_URL ──────────────────
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./dev.db';
}

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   PIXIS LIVE EDITOR — Servidor local Express.js              ║
 * ║   Uso: node server.js                                        ║
 * ║   Luego abrir: http://localhost:8080/index.html?edit=true    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Mutex } = require('async-mutex');
const nodemailer = require('nodemailer');
const mail = require('./server/mail');
const { execSync } = require('child_process');
const speakeasy = require('speakeasy');

// ── CARGADOR NATIVO DE VARIABLES DE ENTORNO (.env) ──
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let val = (match[2] || '').trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const PORT = process.env.PORT || 8080;
const BASE = __dirname;
const JWT_SECRET = process.env.JWT_SECRET || 'PIXIS_SECURE_DYNAMIC_SECRET_KEY';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const activeClients = new Map();
function registerActiveClient(userId) {
  if (userId) activeClients.set(userId, Date.now());
}

// CONFIGURACIÓN DE SEGURIDAD (Cargada aisladamente desde entorno o DB)
const ADMIN_CONFIG = {
  recoveryEmail: process.env.SMTP_USER || 'pixisinformatica.contacto@gmail.com',
  smtp: {
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER || 'pixisinformatica.contacto@gmail.com',
      pass: process.env.SMTP_PASS || ''
    }
  }
};

const isAuthorized = (req) => {
  if (!req) return false;
  const token = req.cookies.admin_token;
  if (!token) return false;
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch (e) {
    return false;
  }
};

// Map of Mutexes for file operations
const fileMutexes = new Map();
function getMutex(filename) {
  const normalized = path.normalize(filename).replace(/\\/g, '/');
  if (!fileMutexes.has(normalized)) {
    fileMutexes.set(normalized, new Mutex());
  }
  return fileMutexes.get(normalized);
}

// Mutex JSON helpers
async function readJsonMutex(filePath) {
  const mutex = getMutex(filePath);
  const release = await mutex.acquire();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    return null;
  } finally {
    release();
  }
}

async function writeJsonMutex(filePath, data) {
  const mutex = getMutex(filePath);
  const release = await mutex.acquire();
  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak');
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } finally {
    release();
  }
}

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cookieParser());

// CORS custom middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Cache Busting: Actualización automática de versionado
const bumpVersionalizador = () => {
  try {
    const indexPath = path.join(BASE, 'index.html');
    if (!fs.existsSync(indexPath)) return;
    const html = fs.readFileSync(indexPath, 'utf-8');
    
    let nextVersion = "";
    const jsMatch = html.match(/js\/versionalizador\.js\?v=([^"'\s>]+)/i);
    
    if (jsMatch) {
      const versionStr = jsMatch[1];
      let parts = versionStr.split('.');
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        let major = parseInt(parts[0], 10);
        let minor = parseInt(parts[1], 10) + 1;
        nextVersion = `${major}.${minor}`;
      } else {
        let current = parseFloat(versionStr) || 1.0;
        nextVersion = (current + 0.1).toFixed(1);
      }
    } else {
      nextVersion = "1.1"; 
    }

    let newHtml = html.replace(
      /js\/versionalizador\.js\?v=[^"'\s>]+/gi,
      `js/versionalizador.js?v=${nextVersion}`
    );
    newHtml = newHtml.replace(
      /css\/style\.css\?v=[^"'\s>]+/gi,
      `css/style.css?v=${nextVersion}`
    );
    newHtml = newHtml.replace(
      /css\/lightmode\.css\?v=[^"'\s>]+/gi,
      `css/lightmode.css?v=${nextVersion}`
    );

    if (html !== newHtml) {
      fs.writeFileSync(indexPath, newHtml, 'utf-8');
      const now = new Date().toLocaleTimeString('es-AR');
      console.log(`  \x1b[36m🔄 [${now}] Cache Busting: v${nextVersion} aplicado a JS y CSS\x1b[0m`);
    }
  } catch (e) {
    console.error('  \x1b[31m❌ Error en bumpVersionalizador:\x1b[0m', e.message);
  }
};

/**
 * Ejecuta un callback con acceso exclusivo a products.json.
 * El mutex se mantiene durante todo el ciclo read-modify-write.
 */
async function withProductsMutex(callback) {
  const productsPath = path.join(BASE, 'data', 'products.json');
  const mutex = getMutex(productsPath);
  const release = await mutex.acquire();
  try {
    let products = [];
    if (fs.existsSync(productsPath)) {
      products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
    }
    const result = await callback(products, productsPath);
    if (fs.existsSync(productsPath)) {
      fs.copyFileSync(productsPath, productsPath + '.bak');
    }
    fs.mkdirSync(path.dirname(productsPath), { recursive: true });
    fs.writeFileSync(productsPath, JSON.stringify(products, null, 2), 'utf-8');
    bumpVersionalizador();
    return result;
  } finally {
    release();
  }
}

/**
 * Valida y descuenta stock para los items de un pedido.
 */
function validarYDescontarStock(products, items) {
  for (const item of items) {
    const product = products.find(p => p.title === item.nombre_snapshot);
    if (product && product.stock !== undefined && product.stock < item.cantidad) {
      return { ok: false, error: `Stock insuficiente para el producto "${item.nombre_snapshot}". Disponible: ${product.stock}, Solicitado: ${item.cantidad}` };
    }
  }
  for (const item of items) {
    const product = products.find(p => p.title === item.nombre_snapshot);
    if (product && product.stock !== undefined) {
      product.stock = Math.max(0, product.stock - item.cantidad);
      if (product.stock === 0) {
        product.inStock = false;
      }
    }
  }
  return { ok: true };
}

/**
 * Restaura el stock de los items en products.json.
 */
function restaurarStock(products, items) {
  for (const item of items) {
    const product = products.find(p => p.title === item.nombre_snapshot);
    if (product) {
      if (product.stock !== undefined) {
        product.stock += item.cantidad;
        if (product.stock > 0) {
          product.inStock = true;
        }
      }
    }
  }
}

// ── SEGURIDAD DE ACCESO AL EDITOR (BLOQUE 13 - Interceptar ?edit=true) ──
app.use((req, res, next) => {
  // Si contiene el parámetro edit y es la página principal
  if (req.query.edit === 'true' && (req.path === '/' || req.path === '/index.html')) {
    if (isAuthorized(req)) {
      return next();
    }
    const token = req.cookies.admin_token;
    if (!token) {
      return res.status(404).send('Not Found');
    }
    try {
      jwt.verify(token, JWT_SECRET);
      // Token válido, continuar sirviendo el editor
    } catch (e) {
      return res.status(404).send('Not Found');
    }
  }
  next();
});

// Bloquear acceso directo a comprobantes subidos
app.use('/uploads/comprobantes', (req, res) => {
  res.status(403).send('Forbidden');
});

const isAllowedEmailDomain = (email) => {
  if (!email || !email.includes('@')) return false;
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return false;
  // Permitir gmail, hotmail, outlook, live con extensiones regionales como .com.ar, .es, .cl, etc.
  const regex = /^(gmail|hotmail|outlook|live)\.[a-z]{2,3}(\.[a-z]{2})?$/i;
  return regex.test(domain);
};

// ── HELPERS DE RATE LIMITING EN BASE DE DATOS ────────────────
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MS = 1 * 60 * 1000; // 60 segundos (1 minuto)

async function checkLoginRateLimit(email, tipo) {
  const record = await prisma.intentosLogin.findUnique({
    where: { email_tipo: { email, tipo } }
  });
  
  if (record && record.bloqueado_hasta) {
    const now = new Date();
    if (record.bloqueado_hasta > now) {
      const remainingTime = Math.ceil((record.bloqueado_hasta - now) / 1000);
      return { blocked: true, remainingTime };
    } else {
      // Expiró el bloqueo, resetear
      await prisma.intentosLogin.update({
        where: { email_tipo: { email, tipo } },
        data: { cantidad: 0, bloqueado_hasta: null }
      });
    }
  }
  return { blocked: false };
}

async function recordFailedLoginAttempt(email, tipo) {
  const now = new Date();
  const record = await prisma.intentosLogin.findUnique({
    where: { email_tipo: { email, tipo } }
  });
  
  if (!record) {
    await prisma.intentosLogin.create({
      data: { email, tipo, cantidad: 1, ultimo_intento: now }
    });
  } else {
    const newCount = record.cantidad + 1;
    let bloqueadoHasta = null;
    if (newCount >= MAX_FAILED_ATTEMPTS) {
      bloqueadoHasta = new Date(now.getTime() + LOCK_TIME_MS);
    }
    await prisma.intentosLogin.update({
      where: { email_tipo: { email, tipo } },
      data: {
        cantidad: newCount,
        ultimo_intento: now,
        bloqueado_hasta: bloqueadoHasta
      }
    });
  }
}

async function clearLoginAttempts(email, tipo) {
  try {
    await prisma.intentosLogin.delete({
      where: { email_tipo: { email, tipo } }
    });
  } catch (e) {
    // Si no existía, ignorar
  }
}

// ── ENDPOINTS DE AUTENTICACIÓN DE CLIENTES (BLOQUE 2) ────────────────

// POST /api/shop/register
app.post('/api/shop/register', async (req, res) => {
  try {
    const { nombre, email, telefono, password, acepta_marketing, direccion, numero, barrio, provincia, localidad, codigo_postal } = req.body;
    if (!nombre || !email || !telefono || !password) {
      return res.status(400).json({ error: 'Nombre, email, teléfono y contraseña son obligatorios.' });
    }

    if (!isAllowedEmailDomain(email)) {
      return res.status(400).json({ error: 'Solo se permiten correos de Gmail, Outlook y Hotmail.' });
    }
    
    const existing = await prisma.usuario.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
    
    await prisma.usuario.create({
      data: {
        nombre,
        email,
        telefono,
        password_hash: passwordHash,
        acepta_marketing: !!acepta_marketing,
        direccion: direccion || null,
        numero: numero || null,
        barrio: barrio || null,
        provincia: provincia || null,
        localidad: localidad || null,
        codigo_postal: codigo_postal || null,
        verificado: false, // Requiere verificación obligatoria
        codigo_verificacion: code,
        codigo_verificacion_expira: expira
      }
    });

    console.log(`📧 [ACTIVACIÓN CLIENTE] Código para ${email}: ${code}`);
    mail.enviarCodigoVerificacion(email, code).catch(console.error);
    
    res.status(201).json({
      ok: true,
      requiereVerificacion: true,
      email,
      message: 'Usuario registrado. Se ha enviado un código de verificación.'
    });
  } catch (e) {
    console.error('Error en register:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.post('/api/shop/verify-email', async (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!email || !codigo) {
      return res.status(400).json({ error: 'Email y código son obligatorios.' });
    }

    const user = await prisma.usuario.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.verificado) return res.status(400).json({ error: 'Esta cuenta ya está verificada.' });

    if (user.codigo_verificacion !== codigo.trim()) {
      return res.status(400).json({ error: 'Código de verificación incorrecto.' });
    }

    const now = new Date();
    if (user.codigo_verificacion_expira && user.codigo_verificacion_expira < now) {
      return res.status(400).json({ error: 'El código ha expirado. Solicitá uno nuevo.' });
    }

    await prisma.usuario.update({
      where: { id: user.id },
      data: { verificado: true, codigo_verificacion: null, codigo_verificacion_expira: null }
    });

    const token = jwt.sign({ id: user.id, email: user.email, role: 'customer' }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('customer_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email, telefono: user.telefono } });
  } catch (e) {
    console.error('Error en verify-email:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.post('/api/shop/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email es obligatorio.' });

    const user = await prisma.usuario.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.verificado) return res.status(400).json({ error: 'Esta cuenta ya está verificada.' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    await prisma.usuario.update({
      where: { id: user.id },
      data: { codigo_verificacion: code, codigo_verificacion_expira: expira }
    });

    console.log(`📧 [REENVÍO ACTIVACIÓN CLIENTE] Código para ${email}: ${code}`);
    mail.enviarCodigoVerificacion(email, code).catch(console.error);

    res.json({ ok: true, message: 'Se ha enviado un nuevo código a tu correo.' });
  } catch (e) {
    console.error('Error al reenviar código:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/shop/login
app.post('/api/shop/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
    }
    
    // Verificar Rate Limit
    const rateCheck = await checkLoginRateLimit(email, 'cliente');
    if (rateCheck.blocked) {
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Inténtalo de nuevo en ${rateCheck.remainingTime} segundos.`
      });
    }
    
    const user = await prisma.usuario.findUnique({ where: { email } });
    if (!user) {
      await recordFailedLoginAttempt(email, 'cliente');
      return res.status(401).json({ error: 'Credenciales inválidas' }); // Mensaje genérico
    }
    
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await recordFailedLoginAttempt(email, 'cliente');
      return res.status(401).json({ error: 'Credenciales inválidas' }); // Mensaje genérico
    }

    // Verificar si la cuenta está activa/verificada (Bloque 2)
    if (!user.verificado) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expira = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
      
      await prisma.usuario.update({
        where: { id: user.id },
        data: {
          codigo_verificacion: code,
          codigo_verificacion_expira: expira
        }
      });
      
      console.log(`📧 [ACTIVACIÓN CLIENTE] Código para ${email}: ${code}`);
      mail.enviarCodigoVerificacion(email, code).catch(console.error);

      return res.status(403).json({
        error: 'Tu cuenta no está verificada. Se ha enviado un nuevo código de activación a tu correo.',
        requiereVerificacion: true,
        email: user.email,
        nombre: user.nombre
      });
    }
    
    // Éxito
    await clearLoginAttempts(email, 'cliente');
    
    const token = jwt.sign(
      { id: user.id, email: user.email, role: 'customer' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.cookie('customer_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
      path: '/'
    });
    
    registerActiveClient(user.id);
    
    res.json({
      ok: true,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        telefono: user.telefono
      }
    });
  } catch (e) {
    console.error('Error en login:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});


// POST /api/shop/password/solicitar-codigo
app.post('/api/shop/password/solicitar-codigo', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email es obligatorio.' });
    }
    
    const user = await prisma.usuario.findUnique({ where: { email } });
    const genericMsg = 'Si el correo está registrado, recibirás un código de recuperación.';
    
    if (user) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expira = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 horas (evita vencimiento al chatear)
      
      await prisma.usuario.update({
        where: { id: user.id },
        data: {
          codigo_recuperacion: code,
          codigo_recuperacion_expira: expira
        }
      });
      
      console.log(`📧 [RECOVERY CODE CLIENTE] Código para ${email}: ${code}`);
      
      // Enviar mail con el código (no bloquea el response)
      mail.enviarCodigoRecuperacion(email, code).catch(console.error);
    }
    
    res.json({ ok: true, message: genericMsg });
  } catch (e) {
    console.error('Error en solicitar-codigo:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/shop/password/confirmar
app.post('/api/shop/password/confirmar', async (req, res) => {
  try {
    const { email, codigo, password } = req.body;
    if (!email || !codigo || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }
    
    const user = await prisma.usuario.findUnique({ where: { email } });
    if (!user || !user.codigo_recuperacion || !user.codigo_recuperacion_expira) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }
    
    const now = new Date();
    if (user.codigo_recuperacion_expira < now) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }
    
    if (user.codigo_recuperacion !== codigo.trim()) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    await prisma.usuario.update({
      where: { id: user.id },
      data: {
        password_hash: passwordHash,
        codigo_recuperacion: null,
        codigo_recuperacion_expira: null
      }
    });
    
    res.json({ ok: true, message: 'Contraseña restablecida con éxito.' });
  } catch (e) {
    console.error('Error en confirmar-codigo:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Middleware de verificación del token del cliente (customer_token)
const verifyCustomerToken = async (req, res, next) => {
  const token = req.cookies.customer_token;
  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Debes iniciar sesión.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'customer') {
      return res.status(403).json({ error: 'Acceso denegado. Rol inválido.' });
    }
    const user = await prisma.usuario.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }
    req.user = user;
    registerActiveClient(user.id);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada. Por favor iniciá sesión nuevamente.' });
  }
};

// GET /api/shop/me (verificar estado de sesión)
app.get('/api/shop/me', async (req, res) => {
  const token = req.cookies.customer_token;
  if (!token) {
    return res.json({ loggedIn: false });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.usuario.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.json({ loggedIn: false });
    }
    registerActiveClient(user.id);
    return res.json({
      loggedIn: true,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        telefono: user.telefono,
        direccion: user.direccion || '',
        numero: user.numero || '',
        barrio: user.barrio || '',
        provincia: user.provincia || '',
        localidad: user.localidad || '',
        codigo_postal: user.codigo_postal || ''
      }
    });
  } catch (e) {
    return res.json({ loggedIn: false });
  }
});

// PUT /api/shop/me (actualizar perfil del cliente)
app.put('/api/shop/me', async (req, res) => {
  const token = req.cookies.customer_token;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { nombre, telefono, password, direccion, numero, barrio, provincia, localidad, codigo_postal } = req.body;
    
    const updateData = {
      ...(nombre && { nombre }),
      ...(telefono && { telefono }),
      direccion: direccion !== undefined ? (direccion || null) : undefined,
      numero: numero !== undefined ? (numero || null) : undefined,
      barrio: barrio !== undefined ? (barrio || null) : undefined,
      provincia: provincia !== undefined ? (provincia || null) : undefined,
      localidad: localidad !== undefined ? (localidad || null) : undefined,
      codigo_postal: codigo_postal !== undefined ? (codigo_postal || null) : undefined
    };

    if (password && password.trim().length >= 6) {
      updateData.password_hash = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.usuario.update({
      where: { id: decoded.id },
      data: updateData
    });
    return res.json({
      ok: true,
      user: {
        id: updated.id,
        nombre: updated.nombre,
        email: updated.email,
        telefono: updated.telefono,
        direccion: updated.direccion || '',
        numero: updated.numero || '',
        barrio: updated.barrio || '',
        provincia: updated.provincia || '',
        localidad: updated.localidad || '',
        codigo_postal: updated.codigo_postal || ''
      }
    });
  } catch (e) {
    console.error('Error en PUT /api/shop/me:', e);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Helper para calcular precio real y total validando catálogo
async function getRealProductDetailsAndTotal(items, formaPago, cuotas) {
  const products = await readJsonMutex(path.join(BASE, 'data', 'products.json')) || [];
  const site = await readJsonMutex(path.join(BASE, 'data', 'site.json')) || {};
  
  let rawTasas = site.tasasCuotas || [1.13, 1.31, 1.31, 1.60, 1.60];
  let tasasCuotas = { 1: 1.13, 3: 1.31, 6: 1.31, 9: 1.60, 12: 1.60 };
  if (Array.isArray(rawTasas) && rawTasas.length === 5) {
    tasasCuotas = {
      1: rawTasas[0],
      3: rawTasas[1],
      6: rawTasas[2],
      9: rawTasas[3],
      12: rawTasas[4]
    };
  } else if (rawTasas && typeof rawTasas === 'object') {
    tasasCuotas = rawTasas;
  }

  let totalBase = 0;
  let verifiedItems = [];

  for (const item of items) {
    const product = products.find(p => p.title === item.name);
    if (!product) {
      throw new Error(`Producto no encontrado en el catálogo: ${item.name}`);
    }

    // Stock se valida manualmente por el empleado, no se rechaza automáticamente

    let precioUnitario = 0;
    if (formaPago === 'efectivo') {
      precioUnitario = parseFloat(product.priceLocal) || parseFloat(product.price) || 0;
    } else {
      precioUnitario = parseFloat(product.price) || 0;
    }

    let subtotal = precioUnitario * item.qty;
    totalBase += subtotal;

    verifiedItems.push({
      producto_id: product.id || `custom-${Date.now()}`,
      nombre_snapshot: product.title,
      precio_unitario_snapshot: precioUnitario,
      cantidad: item.qty
    });
  }

  let finalTotal = totalBase;
  if (formaPago === 'tarjeta' && cuotas && cuotas > 0) {
    const tasa = tasasCuotas[cuotas];
    if (tasa) {
      finalTotal = totalBase * tasa;
    }
  }

  return {
    items: verifiedItems,
    total: Math.round(finalTotal)
  };
}

// POST /api/shop/orders (Checkout/Reservas)
app.post('/api/shop/orders', verifyCustomerToken, async (req, res) => {
  try {
    const { entrega, direccion, forma_pago, cuotas, items, cupon_codigo } = req.body;
    if (!entrega || !forma_pago || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Faltan campos obligatorios o formato de items inválido.' });
    }

    if (!['retiro', 'envio'].includes(entrega)) {
      return res.status(400).json({ error: 'Modo de entrega inválido.' });
    }

    if (!['efectivo', 'transferencia', 'tarjeta'].includes(forma_pago)) {
      return res.status(400).json({ error: 'Forma de pago inválida.' });
    }

    if (entrega === 'envio' && (!direccion || direccion.trim() === '')) {
      return res.status(400).json({ error: 'La dirección es obligatoria para envíos a domicilio.' });
    }

    if (forma_pago === 'tarjeta' && (!cuotas || cuotas === 0)) {
      return res.status(400).json({ error: 'Debes seleccionar cuotas para pagar con tarjeta.' });
    }

    let validated;
    try {
      validated = await getRealProductDetailsAndTotal(items, forma_pago, cuotas);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // ── VALIDACIÓN Y APLICACIÓN DE CUPÓN SERVER-SIDE (Anti-Manipulación) ──
    let subtotal_sin_descuento = validated.total;
    let monto_descuento = 0;
    let cupon_tipo = null;
    let descuento_porcentaje = null;
    let cuponCodigoFinal = null;

    if (cupon_codigo && typeof cupon_codigo === 'string' && cupon_codigo.trim().length > 0) {
      const code = cupon_codigo.trim().toUpperCase();
      const cupon = await prisma.cupon.findUnique({ where: { codigo: code } });

      if (cupon && cupon.activo) {
        // Verificar expiración al milisegundo
        const ahora = new Date();
        if (cupon.expira_en && new Date(cupon.expira_en) < ahora) {
          return res.status(400).json({ error: 'El cupón ha expirado.' });
        }
        // Verificar compra mínima
        if (cupon.monto_minimo > 0 && subtotal_sin_descuento < cupon.monto_minimo) {
          return res.status(400).json({
            error: `Este cupón requiere una compra mínima de $${cupon.monto_minimo.toLocaleString('es-AR')}.`
          });
        }
        // Calcular descuento según tipo (PERCENTAGE o FIXED)
        if (cupon.tipo === 'PERCENTAGE') {
          monto_descuento = Math.round((subtotal_sin_descuento * cupon.descuento_porcentaje) / 100);
          descuento_porcentaje = cupon.descuento_porcentaje;
        } else {
          monto_descuento = cupon.descuento_monto;
        }
        // Bloqueo de seguridad: el descuento no puede superar el subtotal
        if (monto_descuento > subtotal_sin_descuento) monto_descuento = subtotal_sin_descuento;
        cupon_tipo = cupon.tipo;
        cuponCodigoFinal = code;
      } else if (cupon && !cupon.activo) {
        return res.status(400).json({ error: 'El cupón no está activo.' });
      } else {
        return res.status(400).json({ error: 'Código de cupón no válido.' });
      }
    }

    const totalFinal = subtotal_sin_descuento - monto_descuento;

    // Crear el pedido en estado 'pendiente_revision'
    const order = await prisma.pedido.create({
      data: {
        usuario_id: req.user.id,
        estado: 'pendiente_revision',
        entrega,
        direccion: entrega === 'envio' ? direccion : null,
        forma_pago,
        cuotas: forma_pago === 'tarjeta' ? parseInt(cuotas, 10) : null,
        total: totalFinal,
        subtotal_sin_descuento: cuponCodigoFinal ? subtotal_sin_descuento : null,
        cupon_codigo: cuponCodigoFinal,
        cupon_tipo,
        descuento_porcentaje,
        monto_descuento: monto_descuento > 0 ? monto_descuento : null,
        items: {
          create: validated.items.map(item => ({
            producto_id: item.producto_id,
            nombre_snapshot: item.nombre_snapshot,
            precio_unitario_snapshot: item.precio_unitario_snapshot,
            cantidad: item.cantidad
          }))
        }
      },
      include: { items: true }
    });

    // Incrementar uso del cupón (si se aplicó uno)
    if (cuponCodigoFinal) {
      await prisma.cupon.updateMany({
        where: { codigo: cuponCodigoFinal },
        data: { usos_count: { increment: 1 } }
      });
    }

    // Incrementar contador histórico de forma atómica (sin race condition)
    await prisma.$executeRaw`
      INSERT INTO config_global (clave, valor) VALUES ('total_pedidos_historico', '1')
      ON CONFLICT(clave) DO UPDATE SET valor = CAST(valor AS INTEGER) + 1
    `;

    // Disparar correo de recepción/reserva del pedido al cliente en segundo plano
    if (req.user && req.user.email) {
      mail.enviarPedidoRegistrado(req.user.email, order).catch(console.error);
    }

    res.status(201).json({
      ok: true,
      message: 'Reserva registrada con éxito, pendiente de comprobante.',
      orderId: order.id,
      total: order.total,
      subtotal_sin_descuento: order.subtotal_sin_descuento,
      monto_descuento: order.monto_descuento,
      cupon_codigo: order.cupon_codigo
    });
  } catch (e) {
    console.error('Error al registrar pedido:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 🎟️  SISTEMA DE CUPONES DE DESCUENTO — Rutas API
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/shop/coupons/validate — Validación pública asincrónica para checkout
app.post('/api/shop/coupons/validate', async (req, res) => {
  try {
    const rawCode = req.body.code || req.body.codigo;
    if (!rawCode || typeof rawCode !== 'string' || rawCode.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Código de cupón requerido.' });
    }
    const code = rawCode.trim().toUpperCase();
    const cupon = await prisma.cupon.findUnique({ where: { codigo: code } });

    if (!cupon) {
      return res.json({ ok: false, error: '⚠️ Código de cupón no válido o expirado.' });
    }
    if (!cupon.activo) {
      return res.json({ ok: false, error: '⚠️ Este cupón ya no está activo.' });
    }
    if (cupon.expira_en && new Date(cupon.expira_en) < new Date()) {
      return res.json({ ok: false, error: '⚠️ Este cupón ha expirado.' });
    }

    // Respuesta exitosa — NO devuelve el monto calculado (lo calcula el backend al crear el pedido)
    return res.json({
      ok: true,
      codigo: cupon.codigo,
      tipo: cupon.tipo,
      porcentaje: cupon.tipo === 'PERCENTAGE' ? cupon.descuento_porcentaje : null,
      monto_fijo: cupon.tipo === 'FIXED' ? cupon.descuento_monto : null,
      monto_minimo: cupon.monto_minimo || 0,
      mensaje: cupon.tipo === 'PERCENTAGE'
        ? `🎉 ¡Felicitaciones! Cupón de ${cupon.descuento_porcentaje}% de descuento aplicado.`
        : `🎉 ¡Felicitaciones! Cupón de descuento de $${cupon.descuento_monto.toLocaleString('es-AR')} aplicado.`
    });
  } catch (e) {
    console.error('Error al validar cupón:', e);
    res.status(500).json({ ok: false, error: 'Error interno al validar el cupón.' });
  }
});

// GET /api/admin/coupons — Listar todos los cupones (admin)
app.get('/api/admin/coupons', async (req, res) => {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'No autenticado.' });
    jwt.verify(token, JWT_SECRET);

    const cupones = await prisma.cupon.findMany({
      orderBy: { creado_en: 'desc' }
    });
    const ahora = new Date();
    const cuponesConEstado = cupones.map(c => ({
      ...c,
      expirado: c.expira_en ? new Date(c.expira_en) < ahora : false,
      tiempo_restante_ms: c.expira_en ? Math.max(0, new Date(c.expira_en).getTime() - ahora.getTime()) : null
    }));
    res.json({ ok: true, cupones: cuponesConEstado });
  } catch (e) {
    console.error('Error al listar cupones:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/coupons — Crear nuevo cupón (admin)
app.post('/api/admin/coupons', async (req, res) => {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'No autenticado.' });
    jwt.verify(token, JWT_SECRET);

    const { codigo, tipo, descuento_porcentaje, descuento_monto, monto_minimo, unidad_expiracion, valor_expiracion, fecha_exacta } = req.body;

    if (!codigo || typeof codigo !== 'string' || codigo.trim().length === 0) {
      return res.status(400).json({ error: 'El código del cupón es requerido.' });
    }
    const codigoNormalizado = codigo.trim().toUpperCase();
    if (!/^[A-Z0-9_\-]{3,30}$/.test(codigoNormalizado)) {
      return res.status(400).json({ error: 'El código solo puede contener letras, números, guiones y guiones bajos (3-30 caracteres).' });
    }
    if (!['PERCENTAGE', 'FIXED'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de cupón inválido.' });
    }
    if (tipo === 'PERCENTAGE' && (descuento_porcentaje === undefined || descuento_porcentaje <= 0 || descuento_porcentaje > 100)) {
      return res.status(400).json({ error: 'El porcentaje de descuento debe estar entre 1 y 100.' });
    }
    if (tipo === 'FIXED' && (descuento_monto === undefined || descuento_monto <= 0)) {
      return res.status(400).json({ error: 'El monto de descuento fijo debe ser mayor a 0.' });
    }

    // Calcular fecha de expiración según unidad
    let expira_en = null;
    const ahora = new Date();
    if (unidad_expiracion === 'EXACTO' && fecha_exacta) {
      expira_en = new Date(fecha_exacta);
      if (isNaN(expira_en.getTime()) || expira_en <= ahora) {
        return res.status(400).json({ error: 'La fecha exacta debe ser futura.' });
      }
    } else if (unidad_expiracion && valor_expiracion && parseInt(valor_expiracion, 10) > 0) {
      const val = parseInt(valor_expiracion, 10);
      const ms = { HORAS: 3600000, DIAS: 86400000, SEMANAS: 604800000 }[unidad_expiracion];
      if (ms) {
        expira_en = new Date(ahora.getTime() + val * ms);
      } else if (unidad_expiracion === 'MESES') {
        expira_en = new Date(ahora);
        expira_en.setMonth(expira_en.getMonth() + val);
      }
    }

    const nuevoCupon = await prisma.cupon.create({
      data: {
        codigo: codigoNormalizado,
        tipo,
        descuento_porcentaje: tipo === 'PERCENTAGE' ? parseFloat(descuento_porcentaje) : 0,
        descuento_monto: tipo === 'FIXED' ? parseFloat(descuento_monto) : 0,
        monto_minimo: parseFloat(monto_minimo) || 0,
        activo: true,
        expira_en
      }
    });
    res.status(201).json({ ok: true, cupon: nuevoCupon });
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un cupón con ese código.' });
    }
    console.error('Error al crear cupón:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// DELETE /api/admin/coupons/:id — Desactivar/Eliminar cupón (admin)
app.delete('/api/admin/coupons/:id', async (req, res) => {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'No autenticado.' });
    jwt.verify(token, JWT_SECRET);

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    await prisma.cupon.update({ where: { id }, data: { activo: false } });
    res.json({ ok: true, message: 'Cupón desactivado correctamente.' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Cupón no encontrado.' });
    console.error('Error al desactivar cupón:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// DELETE /api/admin/coupons/:id/destroy — Eliminar FÍSICAMENTE el cupón (admin)
app.delete('/api/admin/coupons/:id/destroy', async (req, res) => {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'No autenticado.' });
    try { jwt.verify(token, JWT_SECRET); }
    catch { return res.status(401).json({ error: 'Sesión inválida.' }); }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    await prisma.cupon.delete({ where: { id } });
    res.json({ ok: true, message: 'Cupón eliminado definitivamente.' });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Cupón no encontrado.' });
    console.error('Error al eliminar cupón:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ── SINCRONIZACIÓN BIDIRECCIONAL DE CUPONES (.pxgcupon) CON MAESTRO POS ──

// POST /api/admin/coupons/import-pxgcupon — Importar paquete de cupones desde Maestro POS (UPSERT)
app.post('/api/admin/coupons/import-pxgcupon', async (req, res) => {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'No autenticado.' });
    jwt.verify(token, JWT_SECRET);

    const payload = req.body;
    if (!payload || payload.tipo !== 'COUPONS_SYNC_PACKAGE' || !Array.isArray(payload.cupones)) {
      return res.status(400).json({ error: 'Formato de paquete .pxgcupon inválido.' });
    }

    let procesados = 0;
    for (const c of payload.cupones) {
      if (!c.codigo || typeof c.codigo !== 'string' || c.codigo.trim().length === 0) continue;
      const code = c.codigo.trim().toUpperCase();

      const expiraEnDate = c.expira_en ? new Date(c.expira_en) : null;

      await prisma.cupon.upsert({
        where: { codigo: code },
        update: {
          tipo: c.tipo === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED',
          descuento_porcentaje: parseFloat(c.descuento_porcentaje) || 0,
          descuento_monto: parseFloat(c.descuento_monto) || 0,
          monto_minimo: parseFloat(c.monto_minimo) || 0,
          activo: c.activo !== undefined ? Boolean(c.activo) : true,
          expira_en: expiraEnDate && !isNaN(expiraEnDate.getTime()) ? expiraEnDate : null
        },
        create: {
          codigo: code,
          tipo: c.tipo === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED',
          descuento_porcentaje: parseFloat(c.descuento_porcentaje) || 0,
          descuento_monto: parseFloat(c.descuento_monto) || 0,
          monto_minimo: parseFloat(c.monto_minimo) || 0,
          activo: c.activo !== undefined ? Boolean(c.activo) : true,
          expira_en: expiraEnDate && !isNaN(expiraEnDate.getTime()) ? expiraEnDate : null
        }
      });
      procesados++;
    }

    res.json({
      ok: true,
      message: `Sincronización exitosa: ${procesados} cupón(es) importado(s)/actualizado(s).`,
      procesados
    });
  } catch (e) {
    console.error('Error al importar paquete .pxgcupon:', e);
    res.status(500).json({ error: 'Error interno del servidor al sincronizar cupones.' });
  }
});

// GET /api/admin/coupons/export-pxgcupon — Exportar paquete de cupones para Maestro POS
app.get('/api/admin/coupons/export-pxgcupon', async (req, res) => {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'No autenticado.' });
    jwt.verify(token, JWT_SECRET);

    const cupones = await prisma.cupon.findMany({
      where: { activo: true },
      orderBy: { creado_en: 'desc' }
    });

    const exportPayload = {
      tipo: 'COUPONS_SYNC_PACKAGE',
      version: '1.0',
      origen: 'Pixis Live Web',
      fecha_exportacion: new Date().toISOString(),
      total_cupones: cupones.length,
      cupones: cupones.map(c => ({
        codigo: c.codigo,
        tipo: c.tipo,
        descuento_porcentaje: c.descuento_porcentaje || 0,
        descuento_monto: c.descuento_monto || 0,
        monto_minimo: c.monto_minimo || 0,
        activo: c.activo,
        expira_en: c.expira_en ? c.expira_en.toISOString() : null
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="cupones_pixis.pxgcupon"');
    return res.send(JSON.stringify(exportPayload, null, 2));
  } catch (e) {
    console.error('Error al exportar paquete .pxgcupon:', e);
    res.status(500).json({ error: 'Error interno del servidor al exportar cupones.' });
  }
});

// POST /api/shop/logout (Cerrar sesión del cliente)
app.post('/api/shop/logout', (req, res) => {
  res.clearCookie('customer_token', { path: '/' });
  res.json({ ok: true, message: 'Sesión cerrada correctamente.' });
});

// GET /api/shop/orders (Listar pedidos del cliente)
app.get('/api/shop/orders', verifyCustomerToken, async (req, res) => {

  try {
    const orders = await prisma.pedido.findMany({
      where: { usuario_id: req.user.id },
      orderBy: { creado_en: 'desc' },
      include: {
        items: true,
        comprobantes: true
      }
    });
    res.json({ ok: true, orders });
  } catch (e) {
    console.error('Error al listar pedidos:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/shop/orders/:id (Detalle de pedido del cliente)
app.get('/api/shop/orders/:id', verifyCustomerToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'ID de pedido inválido.' });
    }

    const order = await prisma.pedido.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        comprobantes: true
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    if (order.usuario_id !== req.user.id) {
      return res.status(403).json({ error: 'No tenés permiso para ver este pedido.' });
    }

    res.json({ ok: true, order });
  } catch (e) {
    console.error('Error al obtener detalle del pedido:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// DELETE /api/shop/orders (Eliminar pedidos del historial del cliente)
app.delete('/api/shop/orders', verifyCustomerToken, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debes enviar al menos un ID de pedido.' });
    }

    const orderIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    if (orderIds.length === 0) {
      return res.status(400).json({ error: 'IDs de pedido inválidos.' });
    }

    // Verificar propiedad y estado
    const orders = await prisma.pedido.findMany({
      where: { id: { in: orderIds }, usuario_id: req.user.id },
      select: { id: true, estado: true }
    });

    // Solo se pueden eliminar pedidos en estado final
    const ESTADOS_ELIMINABLES = ['completado', 'rechazado', 'vencido'];
    const noEliminables = orders.filter(o => !ESTADOS_ELIMINABLES.includes(o.estado));
    if (noEliminables.length > 0) {
      return res.status(400).json({
        error: 'Solo se pueden eliminar pedidos finalizados (completado, rechazado o vencido). Los pedidos activos no pueden eliminarse.'
      });
    }

    const idsVerificados = orders.map(o => o.id);
    if (idsVerificados.length === 0) {
      return res.status(404).json({ error: 'No se encontraron pedidos válidos para eliminar.' });
    }

    // Obtener los archivos de comprobantes ANTES de borrar los registros
    const comprobantesABorrar = await prisma.comprobante.findMany({
      where: { pedido_id: { in: idsVerificados } },
      select: { archivo_url: true }
    });

    // Eliminar en cascada manual: comprobantes → items → pedido
    await prisma.$transaction([
      prisma.comprobante.deleteMany({ where: { pedido_id: { in: idsVerificados } } }),
      prisma.itemPedido.deleteMany({ where: { pedido_id: { in: idsVerificados } } }),
      prisma.pedido.deleteMany({ where: { id: { in: idsVerificados } } })
    ]);

    // Eliminar archivos físicos del disco
    const archivosEliminados = eliminarArchivosComprobantes(comprobantesABorrar);
    if (archivosEliminados > 0) {
      console.log(`  🗑️ [LIMPIEZA] ${archivosEliminados} archivo(s) de comprobantes eliminados del disco.`);
    }

    res.json({ ok: true, eliminados: idsVerificados.length });
  } catch (e) {
    console.error('Error al eliminar pedidos del historial:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/admin/orders/:id/export-pxgres — Exportar Reserva Web (.pxgres) para Maestro POS
app.get('/api/admin/orders/:id/export-pxgres', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'No autorizado.' });
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID de pedido inválido.' });

    const order = await prisma.pedido.findUnique({
      where: { id },
      include: {
        usuario: true,
        items: true
      }
    });

    if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });

    const fechaObj = new Date(order.creado_en);
    const dateFormatted = fechaObj.toLocaleString('es-AR', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const isEfectivo = (order.forma_pago || '').toLowerCase() === 'efectivo';
    const montoEfectivo = isEfectivo ? order.total : 0;
    const montoTransfTarjeta = !isEfectivo ? order.total : 0;
    const rawPhone = order.usuario?.telefono || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');

    const subtotalBruto = order.subtotal_sin_descuento || (order.total + (order.monto_descuento || 0));
    const montoDescuento = order.monto_descuento || 0;

    const pxgresPayload = {
      tipo: 'RESERVA_WEB',
      version: '1.0',
      origen: 'Pixis Live Web',
      folio: `#${order.id}`,
      pedido_id: order.id,
      fecha: order.creado_en,
      fecha_formateada: dateFormatted,
      vendedor: 'Web / Admin',
      cliente: {
        id_cliente_web: order.usuario_id,
        usuario_id: order.usuario_id,
        nombre: order.usuario?.nombre || 'Consumidor Final',
        email: order.usuario?.email || '',
        telefono: rawPhone,
        whatsapp: rawPhone,
        tel: rawPhone,
        telefono_limpio: cleanPhone,
        telefono_normalizado: cleanPhone,
        direccion: order.usuario?.direccion || order.direccion || '',
        barrio: order.usuario?.barrio || '',
        localidad: order.usuario?.localidad || '',
        provincia: order.usuario?.provincia || '',
        codigo_postal: order.usuario?.codigo_postal || ''
      },
      descuento_aplicado: {
        codigo: order.cupon_codigo || '',
        tipo: order.cupon_tipo || (order.descuento_porcentaje ? 'PORCENTAJE' : 'FIXED'),
        porcentaje: order.descuento_porcentaje || 0,
        monto_descuento: montoDescuento,
        subtotal_sin_descuento: subtotalBruto
      },
      pago_detallado: {
        monto_subtotal: subtotalBruto,
        monto_descuento: montoDescuento,
        total_final: order.total,
        moneda: 'ARS',
        efectivo: montoEfectivo,
        transferencia_tarjeta: montoTransfTarjeta,
        monto_efectivo: montoEfectivo,
        monto_transferencia: montoTransfTarjeta,
        cuotas: order.cuotas || 1,
        medio_pago: (order.forma_pago || 'efectivo').toUpperCase()
      },
      subtotal: subtotalBruto,
      monto_descuento: montoDescuento,
      monto_efectivo: montoEfectivo,
      monto_transferencia: montoTransfTarjeta,
      entrega: order.entrega === 'envio' ? 'Envío a domicilio' : 'Retiro por sucursal',
      forma_pago: (order.forma_pago || 'efectivo').toUpperCase(),
      cuotas: order.cuotas || 1,
      total: order.total,
      items: (order.items || []).map(item => ({
        product_id: item.producto_id,
        codigo: item.producto_id,
        sku: item.producto_id,
        producto: item.nombre_snapshot,
        nombre: item.nombre_snapshot,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario_snapshot,
        precio: item.precio_unitario_snapshot,
        subtotal: item.precio_unitario_snapshot * item.cantidad,
        total: item.precio_unitario_snapshot * item.cantidad,
        currency: 'ARS',
        iva: 21.0
      }))
    };

    const fileName = `reserva_${order.id}.pxgres`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(JSON.stringify(pxgresPayload, null, 2));
  } catch (err) {
    console.error('Error al exportar reserva .pxgres:', err);
    res.status(500).json({ error: 'Error interno al exportar reserva.' });
  }
});

// ── SUBIDA DE COMPROBANTES (BLOQUE 6) ─────────────────────────────────────────


const multer = require('multer');
const crypto = require('crypto');

// Configuración de almacenamiento de Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads', 'comprobantes');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const randomName = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomName}${ext}`);
  }
});

// Filtro para aceptar solo imágenes y PDF
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
  
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de archivo no permitido. Solo se aceptan imágenes (JPG, PNG, WEBP) o documentos PDF.'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB (se comprime después de subir)
  }
});

// ── COMPRESIÓN AUTOMÁTICA DE IMÁGENES DE COMPROBANTES ──
// Reduce fotos pesadas de celulares (~4-10MB) a ~150-200KB sin perder nitidez del ticket bancario
async function comprimirImagenComprobante(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    // Solo comprimir imágenes, no PDFs
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return filePath;

    const sharp = require('sharp');
    const tempPath = filePath + '.tmp';

    await sharp(filePath)
      .resize({ width: 1200, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(tempPath);

    // Reemplazar el archivo original con el comprimido
    fs.unlinkSync(filePath);
    const newPath = filePath.replace(ext, '.jpg');
    fs.renameSync(tempPath, newPath);

    const sizeKB = Math.round(fs.statSync(newPath).size / 1024);
    console.log(`  📦 [COMPRESIÓN] Comprobante comprimido a ${sizeKB}KB: ${path.basename(newPath)}`);
    return newPath;
  } catch (e) {
    console.error('  ⚠️ [COMPRESIÓN] No se pudo comprimir la imagen, se conserva el original:', e.message);
    return filePath;
  }
}

// Función utilitaria: Eliminar archivos físicos de comprobantes del disco
function eliminarArchivosComprobantes(comprobantes) {
  const uploadDir = path.join(__dirname, 'uploads', 'comprobantes');
  let eliminados = 0;
  for (const comp of comprobantes) {
    try {
      if (comp.archivo_url) {
        const filename = path.basename(comp.archivo_url);
        const filePath = path.join(uploadDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          eliminados++;
        }
      }
    } catch (err) {
      console.error(`  ⚠️ Error al eliminar archivo físico: ${comp.archivo_url}`, err.message);
    }
  }
  return eliminados;
}

// POST /api/shop/orders/:id/comprobante (Subir comprobante de pago)
app.post('/api/shop/orders/:id/comprobante', verifyCustomerToken, (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  if (isNaN(orderId)) {
    return res.status(400).json({ error: 'ID de pedido inválido.' });
  }

  // Ejecutamos multer upload
  const uploadSingle = upload.single('comprobante');
  uploadSingle(req, res, async (err) => {
    if (err) {
      let errMsg = err.message;
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          errMsg = 'El archivo es demasiado grande (máximo 5MB).';
        }
      }
      return res.status(400).json({ error: errMsg });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No se ha subido ningún archivo.' });
      }

      // Validar que el pedido exista y pertenezca al usuario
      const order = await prisma.pedido.findUnique({
        where: { id: orderId },
        include: { items: true }
      });

      if (!order) {
        if (req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ error: 'Pedido no encontrado.' });
      }

      if (order.usuario_id !== req.user.id) {
        if (req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({ error: 'No tenés permiso para subir comprobantes en este pedido.' });
      }

      // Validar estado del pedido
      if (order.estado !== 'pendiente_revision') {
        if (req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: 'No se puede subir comprobante para un pedido en este estado.' });
      }

      // Validar forma de pago: solo transferencias requieren comprobante
      if (order.forma_pago !== 'transferencia') {
        if (req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: 'Solo los pedidos con transferencia bancaria requieren comprobante de pago.' });
      }

      // Si es transferencia y no se descontó el stock, validar y descontarlo bajo mutex
      let stockDescontadoCorrectamente = false;
      let limiteReserva = null;

      if (order.forma_pago === 'transferencia' && !order.stock_descontado) {
        const stockResult = await withProductsMutex(async (products) => {
          return validarYDescontarStock(products, order.items);
        });

        if (!stockResult.ok) {
          if (req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ error: stockResult.error });
        }
        stockDescontadoCorrectamente = true;
        limiteReserva = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }

      // Comprimir imagen si es posible (reduce ~8MB a ~180KB)
      const compressedPath = await comprimirImagenComprobante(req.file.path);
      const compressedFilename = path.basename(compressedPath);
      const archivoUrl = `/api/comprobantes/${compressedFilename}`;

      // Crear el registro de comprobante en la base de datos
      const comprobante = await prisma.comprobante.create({
        data: {
          pedido_id: orderId,
          archivo_url: archivoUrl
        }
      });

      // Si descontamos el stock, actualizar el estado del pedido a reservado y marcar stock_descontado
      if (stockDescontadoCorrectamente) {
        await prisma.pedido.update({
          where: { id: orderId },
          data: {
            estado: 'reservado',
            stock_descontado: true,
            reservado_hasta: limiteReserva
          }
        });
      }

      // Enviar correos en segundo plano
      const usuario = await prisma.usuario.findUnique({ where: { id: req.user.id } });
      if (usuario) {
        mail.enviarComprobanteRecibido(usuario.email, order).catch(console.error);
        
        if (stockDescontadoCorrectamente && limiteReserva) {
          order.reservado_hasta = limiteReserva;
          mail.enviarPedidoReservado(usuario.email, order, limiteReserva).catch(console.error);
        }
      }
      mail.notificarAdminComprobanteNuevo(orderId).catch(console.error);

      res.json({
        ok: true,
        message: 'Comprobante subido con éxito.',
        comprobante
      });
    } catch (e) {
      console.error('Error al registrar comprobante:', e);
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  });
});

// GET /api/comprobantes/:filename (Acceso seguro a comprobantes)
app.get('/api/comprobantes/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const safeFilename = path.basename(filename);
    const filePath = path.join(__dirname, 'uploads', 'comprobantes', safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Comprobante no encontrado.');
    }

    let isAuthorized = false;

    // Caso 1: ¿Es Empleado/Admin?
    const adminToken = req.cookies.admin_token;
    if (adminToken) {
      try {
        jwt.verify(adminToken, JWT_SECRET);
        isAuthorized = true;
      } catch (e) {}
    }

    // Caso 2: ¿Es Cliente?
    if (!isAuthorized) {
      const customerToken = req.cookies.customer_token;
      if (customerToken) {
        try {
          const decoded = jwt.verify(customerToken, JWT_SECRET);
          const comprobante = await prisma.comprobante.findFirst({
            where: {
              archivo_url: `/api/comprobantes/${safeFilename}`
            },
            include: {
              pedido: true
            }
          });
          if (comprobante && comprobante.pedido.usuario_id === decoded.id) {
            isAuthorized = true;
          }
        } catch (e) {}
      }
    }

    if (!isAuthorized) {
      return res.status(403).send('No tenés permiso para ver este comprobante.');
    }

    res.sendFile(filePath);
  } catch (e) {
    console.error('Error al servir comprobante:', e);
    res.status(500).send('Error interno del servidor.');
  }
});

// ── ENDPOINTS DE GESTIÓN DE PEDIDOS PARA ADMINISTRADORES (BLOQUE 7) ───────────

// Middleware para verificar admin_token y estado activo
const verifyAdminToken = async (req, res, next) => {
  const token = req.cookies.admin_token;
  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Debes iniciar sesión como administrador.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'No tenés permisos de administrador.' });
    }

    // Validar en base de datos que el empleado exista y esté activo (Bloque 11)
    const empleado = await prisma.empleadoVentas.findUnique({
      where: { id: decoded.id }
    });
    if (!empleado || !empleado.activo) {
      return res.status(403).json({ error: 'Tu cuenta de empleado ha sido desactivada o no existe.' });
    }

    req.adminUser = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada. Por favor inicia sesión nuevamente.' });
  }
};

// GET /api/admin/stats — Obtener estadísticas globales para el dashboard
app.get('/api/admin/stats', verifyAdminToken, async (req, res) => {
  try {
    const cfg = await prisma.configGlobal.findUnique({
      where: { clave: 'total_pedidos_historico' }
    });

    // Limpiar clientes inactivos de más de 60 segundos
    const now = Date.now();
    for (const [userId, lastActive] of activeClients.entries()) {
      if (now - lastActive > 60000) {
        activeClients.delete(userId);
      }
    }

    const totalClientes = await prisma.usuario.count();
    const totalOnline = activeClients.size;

    res.json({
      ok: true,
      total_pedidos_historico: parseInt(cfg?.valor || '0', 10),
      total_clientes: totalClientes,
      total_online: totalOnline
    });
  } catch (e) {
    console.error('Error al obtener estadísticas:', e);
    res.status(500).json({ error: 'Error al obtener estadísticas.' });
  }
});

// GET /api/admin/orders (Ver todos los pedidos con filtros opcionales)
app.get('/api/admin/orders', verifyAdminToken, async (req, res) => {
  try {
    const { estado } = req.query;
    const where = {};
    if (estado) {
      where.estado = estado;
    }

    const orders = await prisma.pedido.findMany({
      where,
      include: {
        items: true,
        comprobantes: true,
        usuario: {
          select: {
            nombre: true,
            email: true,
            telefono: true,
            direccion: true,
            provincia: true,
            localidad: true,
            codigo_postal: true
          }
        }
      },
      orderBy: {
        creado_en: 'desc'
      }
    });

    res.json({ ok: true, orders });
  } catch (e) {
    console.error('Error al listar pedidos (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/admin/orders/:id (Detalle de un pedido en particular)
app.get('/api/admin/orders/:id', verifyAdminToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'ID de pedido inválido.' });
    }

    const order = await prisma.pedido.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        comprobantes: true,
        usuario: {
          select: {
            nombre: true,
            email: true,
            telefono: true,
            direccion: true,
            provincia: true,
            localidad: true,
            codigo_postal: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    res.json({ ok: true, order });
  } catch (e) {
    console.error('Error al obtener pedido (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/orders/:id/confirm (Confirmar y reservar stock)
app.post('/api/admin/orders/:id/confirm', verifyAdminToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'ID de pedido inválido.' });
    }

    // 1. Obtener pedido
    const order = await prisma.pedido.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        usuario: true
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    // Guarda de estado ampliada: aceptar pendiente_revision, y reservado solo para transferencia
    const estadosPermitidos = ['pendiente_revision'];
    if (order.forma_pago === 'transferencia') {
      estadosPermitidos.push('reservado');
    }
    if (!estadosPermitidos.includes(order.estado)) {
      return res.status(400).json({ error: `No se puede confirmar un pedido en estado: ${order.estado}` });
    }

    // Lógica de stock condicional:
    // Solo se descuenta stock si es transferencia y aún no fue descontado.
    // Para efectivo/tarjeta, no se descuenta stock en la reserva.
    let stockDescontadoCorrectamente = order.stock_descontado;

    if (order.forma_pago === 'transferencia' && !order.stock_descontado) {
      const stockResult = await withProductsMutex(async (products) => {
        return validarYDescontarStock(products, order.items);
      });

      if (!stockResult.ok) {
        return res.status(400).json({ error: stockResult.error });
      }
      stockDescontadoCorrectamente = true;
    }

    // 3. Actualizar estado de pedido y comprobantes
    const limiteReserva = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await prisma.$transaction([
      prisma.pedido.update({
        where: { id: orderId },
        data: {
          estado: 'reservado',
          stock_descontado: stockDescontadoCorrectamente,
          reservado_hasta: limiteReserva
        }
      }),
      prisma.comprobante.updateMany({
        where: { pedido_id: orderId },
        data: {
          revisado_por: req.adminUser.id,
          revisado_en: new Date()
        }
      })
    ]);

    // 4. Enviar mail en segundo plano
    order.reservado_hasta = limiteReserva;
    mail.enviarPedidoReservado(order.usuario.email, order, limiteReserva).catch(console.error);

    res.json({ ok: true, message: 'Pedido confirmado y stock reservado con éxito.' });
  } catch (e) {
    console.error('Error al confirmar pedido (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/orders/:id/reject (Rechazar pedido)
app.post('/api/admin/orders/:id/reject', verifyAdminToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { motivo } = req.body;
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'ID de pedido inválido.' });
    }
    if (!motivo || motivo.trim() === '') {
      return res.status(400).json({ error: 'Debes proporcionar un motivo de rechazo.' });
    }

    const order = await prisma.pedido.findUnique({
      where: { id: orderId },
      include: { usuario: true, items: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    if (order.estado !== 'pendiente_revision' && order.estado !== 'reservado') {
      return res.status(400).json({ error: `No se puede rechazar un pedido en estado: ${order.estado}` });
    }

    // Si ya se había descontado el stock de este pedido, lo restauramos en products.json
    if (order.stock_descontado) {
      await withProductsMutex(async (products) => {
        restaurarStock(products, order.items);
      });
    }

    // Actualizar estado del pedido, motivo de rechazo y auditoría de comprobantes
    await prisma.$transaction([
      prisma.pedido.update({
        where: { id: orderId },
        data: {
          estado: 'rechazado',
          motivo_rechazo: motivo,
          stock_descontado: false,
          reservado_hasta: null
        }
      }),
      prisma.comprobante.updateMany({
        where: { pedido_id: orderId },
        data: {
          revisado_por: req.adminUser.id,
          revisado_en: new Date()
        }
      })
    ]);

    // Enviar mail
    mail.enviarPedidoRechazado(order.usuario.email, order, motivo).catch(console.error);

    res.json({ ok: true, message: 'Pedido rechazado con éxito.' });
  } catch (e) {
    console.error('Error al rechazar pedido (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/orders/:id/complete (Completar/Entregar pedido)
app.post('/api/admin/orders/:id/complete', verifyAdminToken, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'ID de pedido inválido.' });
    }

    const order = await prisma.pedido.findUnique({
      where: { id: orderId },
      include: { usuario: true, items: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    if (order.estado !== 'reservado' && order.estado !== 'pendiente_revision') {
      return res.status(400).json({ error: `No se puede completar un pedido en estado: ${order.estado}` });
    }

    // Lógica de stock condicional:
    // Si aún no se descontó el stock (ej: efectivo, tarjeta, o transferencia sin comprobante previo), descontarlo ahora.
    let stockDescontadoCorrectamente = order.stock_descontado;

    if (!order.stock_descontado) {
      const stockResult = await withProductsMutex(async (products) => {
        return validarYDescontarStock(products, order.items);
      });

      if (!stockResult.ok) {
        return res.status(400).json({ error: stockResult.error });
      }
      stockDescontadoCorrectamente = true;
    }

    // Actualizar estado y comprobantes
    await prisma.$transaction([
      prisma.pedido.update({
        where: { id: orderId },
        data: {
          estado: 'completado',
          stock_descontado: stockDescontadoCorrectamente,
          reservado_hasta: null
        }
      }),
      prisma.comprobante.updateMany({
        where: { pedido_id: orderId },
        data: {
          revisado_por: req.adminUser.id,
          revisado_en: new Date()
        }
      })
    ]);

    // Enviar mail
    mail.enviarPedidoEntregado(order.usuario.email, order).catch(console.error);

    res.json({ ok: true, message: 'Pedido marcado como completado/entregado con éxito.' });
  } catch (e) {
    console.error('Error al completar pedido (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ── ENDPOINTS DE PANEL DE CLIENTES (BLOQUE 10) ──────────────────────────────

// GET /admin/customers — Listar clientes con búsqueda y paginación opcional
app.get('/admin/customers', verifyAdminToken, async (req, res) => {
  try {
    const { q, acepta_marketing } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const where = {};
    if (q && q.trim() !== '') {
      const term = q.trim();
      where.OR = [
        { nombre:   { contains: term } },
        { email:    { contains: term } },
        { telefono: { contains: term } }
      ];
    }
    if (acepta_marketing === 'true')  where.acepta_marketing = true;
    if (acepta_marketing === 'false') where.acepta_marketing = false;

    const hace30dias = new Date();
    hace30dias.setDate(hace30dias.getDate() - 30);

    const [total, clientes] = await Promise.all([
      prisma.usuario.count({ where }),
      prisma.usuario.findMany({
        where,
        orderBy: { creado_en: 'desc' },
        skip,
        take: limit,
        select: {
          id:               true,
          nombre:           true,
          email:            true,
          telefono:         true,
          direccion:        true,
          numero:           true,
          barrio:           true,
          provincia:        true,
          localidad:        true,
          codigo_postal:    true,
          acepta_marketing: true,
          verificado:       true,
          codigo_verificacion: true,
          codigo_recuperacion: true,
          creado_en:        true,
          _count:           { select: { pedidos: true } },
          pedidos: {
            where: { creado_en: { gte: hace30dias } },
            select: { id: true }
          }
        }
      })
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    const clientesMapeados = clientes.map(c => ({
      id: c.id,
      nombre: c.nombre,
      email: c.email,
      telefono: c.telefono,
      direccion: c.direccion,
      numero: c.numero,
      barrio: c.barrio,
      provincia: c.provincia,
      localidad: c.localidad,
      codigo_postal: c.codigo_postal,
      acepta_marketing: c.acepta_marketing,
      verificado: c.verificado,
      codigo_verificacion: c.codigo_verificacion,
      codigo_recuperacion: c.codigo_recuperacion,
      creado_en: c.creado_en,
      _count: c._count,
      pedidos_mes: c.pedidos.length
    }));

    res.json({ ok: true, total, page, limit, totalPages, clientes: clientesMapeados });
  } catch (e) {
    console.error('Error al listar clientes (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.post('/api/admin/customers/remove', verifyAdminToken, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Lista de IDs inválida.' });
    }

    const userIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));

    // Obtener comprobantes ANTES de la transacción para borrar archivos físicos después
    const pedidosPrevio = await prisma.pedido.findMany({
      where: { usuario_id: { in: userIds } },
      select: { id: true }
    });
    const pedidoIdsPrevio = pedidosPrevio.map(p => p.id);
    const comprobantesABorrar = await prisma.comprobante.findMany({
      where: { pedido_id: { in: pedidoIdsPrevio } },
      select: { archivo_url: true }
    });

    await prisma.$transaction(async (tx) => {
      // 1. Buscar los pedidos de estos usuarios
      const pedidos = await tx.pedido.findMany({
        where: { usuario_id: { in: userIds } },
        select: { id: true }
      });
      const pedidoIds = pedidos.map(p => p.id);

      // 2. Eliminar comprobantes
      await tx.comprobante.deleteMany({
        where: { pedido_id: { in: pedidoIds } }
      });

      // 3. Eliminar items de pedidos
      await tx.itemPedido.deleteMany({
        where: { pedido_id: { in: pedidoIds } }
      });

      // 4. Eliminar los pedidos
      await tx.pedido.deleteMany({
        where: { usuario_id: { in: userIds } }
      });

      // 5. Eliminar los usuarios
      await tx.usuario.deleteMany({
        where: { id: { in: userIds } }
      });
    });

    // Eliminar archivos físicos del disco después de la transacción exitosa
    const archivosEliminados = eliminarArchivosComprobantes(comprobantesABorrar);
    if (archivosEliminados > 0) {
      console.log(`  🗑️ [LIMPIEZA] ${archivosEliminados} archivo(s) de comprobantes eliminados del disco (clientes).`);
    }

    res.json({ ok: true, message: 'Clientes y sus pedidos asociados eliminados con éxito.' });
  } catch (e) {
    console.error('Error al eliminar clientes (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.post('/api/admin/customers/:id/verify', verifyAdminToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    await prisma.usuario.update({
      where: { id },
      data: { verificado: true, codigo_verificacion: null, codigo_verificacion_expira: null }
    });

    res.json({ ok: true, message: 'Cliente activado con éxito.' });
  } catch (e) {
    console.error('Error al activar cliente (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.post('/api/admin/customers/:id/reset-password', verifyAdminToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    const tempPassword = `Pixis-${pin}`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await prisma.usuario.update({
      where: { id },
      data: {
        password_hash: passwordHash,
        codigo_recuperacion: null,
        codigo_recuperacion_expira: null
      }
    });

    res.json({ ok: true, tempPassword, message: 'Nueva contraseña generada con éxito.' });
  } catch (e) {
    console.error('Error al restablecer contraseña (admin):', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /admin/customers/export — Exportar CSV respetando Ley 25.326
app.get('/admin/customers/export', verifyAdminToken, async (req, res) => {
  try {
    const { acepta_marketing } = req.query;
    const filtrarSoloMarketing = acepta_marketing === 'true';

    const where = filtrarSoloMarketing ? { acepta_marketing: true } : {};

    const clientes = await prisma.usuario.findMany({
      where,
      orderBy: { creado_en: 'desc' },
      select: {
        id:               true,
        nombre:           true,
        email:            true,
        telefono:         true,
        direccion:        true,
        numero:           true,
        barrio:           true,
        provincia:        true,
        localidad:        true,
        codigo_postal:    true,
        acepta_marketing: true,
        creado_en:        true,
        _count:           { select: { pedidos: true } }
      }
    });

    // CSV builder sin dependencias externas (optimizado para Excel en español con ;)
    const encodeCSVField = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(';') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const headers = ['ID', 'Nombre', 'Email', 'Telefono', 'Direccion', 'Numero', 'Barrio', 'Provincia', 'Localidad', 'Codigo Postal', 'Acepta Marketing', 'Total Pedidos', 'Registrado'];

    const rows = clientes.map(c => [
      c.id,
      c.nombre,
      c.email,
      c.telefono || '',
      c.direccion || '',
      c.numero || '',
      c.barrio || '',
      c.provincia || '',
      c.localidad || '',
      c.codigo_postal || '',
      c.acepta_marketing ? 'Si' : 'No',
      c._count.pedidos,
      new Date(c.creado_en).toLocaleDateString('es-AR')
    ].map(encodeCSVField).join(';'));

    const csvContent = [headers.join(';'), ...rows].join('\r\n');
    const fechaHoy = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
    const sufijo = filtrarSoloMarketing ? 'solo-marketing' : 'todos';
    const filename = `clientes-${sufijo}-${fechaHoy}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csvContent); // BOM para Excel Windows

    console.log(`  \x1b[32m📊 [ADMIN] CSV (${sufijo}) exportado con delimitador ';' para Excel: ${clientes.length} clientes.\x1b[0m`);
  } catch (e) {
    console.error('Error al exportar CSV:', e);
    res.status(500).json({ error: 'Error al generar el archivo CSV.' });
  }
});

// ── ENDPOINTS DE AUTENTICACIÓN DE EMPLEADOS CON 2FA (BLOQUE 3) ────────────────


// speakeasy: importado globalmente al inicio del archivo
const qrcode = require('qrcode');

// POST /admin/login (Paso 1: Credenciales)
app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
    }

    // Rate Limiting con tipo = 'empleado'
    const rateCheck = await checkLoginRateLimit(email, 'empleado');
    if (rateCheck.blocked) {
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Inténtalo de nuevo en ${rateCheck.remainingTime} segundos.`
      });
    }

    const empleado = await prisma.empleadoVentas.findUnique({ where: { email } });
    if (!empleado || !empleado.activo) {
      await recordFailedLoginAttempt(email, 'empleado');
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const match = await bcrypt.compare(password, empleado.password_hash);
    if (!match) {
      await recordFailedLoginAttempt(email, 'empleado');
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Credenciales válidas — limpiar intentos
    await clearLoginAttempts(email, 'empleado');

    // Crear token temporal UUID en la base de datos
    const tempToken = await prisma.tempTokens2FA.create({
      data: {
        empleado_id: empleado.id,
        expira_en: new Date(Date.now() + 5 * 60 * 1000) // 5 minutos
      }
    });

    // Si TOTP no está activado, generar secreto y QR
    if (!empleado.totp_activado) {
      // El secreto ya fue generado por el seed; solo devolvemos el QR
      const otpauthUrl = speakeasy.otpauthURL({
        secret: empleado.totp_secret,
        label: `Pixis Informatica (${empleado.email})`,
        issuer: 'Pixis Informatica',
        encoding: 'base32'
      });

      const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

      return res.json({
        ok: true,
        step: '2fa',
        tempToken: tempToken.id,
        totp_activado: false,
        qr: qrDataUrl,
        message: 'Escanea el código QR con tu app de autenticación y luego ingresa el código.'
      });
    }

    // TOTP ya activado, solo pedir el código
    res.json({
      ok: true,
      step: '2fa',
      tempToken: tempToken.id,
      totp_activado: true,
      message: 'Ingresa el código de tu app de autenticación.'
    });
  } catch (e) {
    console.error('Error en /admin/login:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /admin/login/2fa (Paso 2: Verificar OTP)
app.post('/admin/login/2fa', async (req, res) => {
  try {
    const tempTokenVal = req.body.tempToken || req.body.token;
    const { codigo } = req.body;
    if (!tempTokenVal || !codigo) {
      return res.status(400).json({ error: 'Token temporal y código OTP son obligatorios.' });
    }

    // Buscar el token temporal en la base de datos
    const token2fa = await prisma.tempTokens2FA.findUnique({
      where: { id: tempTokenVal },
      include: { empleado: true }
    });

    if (!token2fa) {
      return res.status(401).json({ error: 'Token temporal inválido.' });
    }

    if (token2fa.usado) {
      return res.status(401).json({ error: 'Token temporal ya fue utilizado.' });
    }

    const now = new Date();
    if (token2fa.expira_en < now) {
      return res.status(401).json({ error: 'Token temporal expirado. Volvé a iniciar sesión.' });
    }

    const empleado = token2fa.empleado;
    if (!empleado.totp_secret) {
      return res.status(500).json({ error: 'No se encontró el secreto TOTP del empleado.' });
    }

    // Verificar OTP usando speakeasy
    const isValid = speakeasy.totp.verify({
      secret: empleado.totp_secret,
      encoding: 'base32',
      token: codigo.replace(/\s/g, ''),
      window: 1 // Acepta ±1 step (30 segundos de tolerancia)
    });

    if (!isValid) {
      return res.status(401).json({ error: 'Código OTP inválido.' });
    }

    // Marcar token como usado
    await prisma.tempTokens2FA.update({
      where: { id: tempTokenVal },
      data: { usado: true }
    });

    // Activar TOTP si era la primera vez
    if (!empleado.totp_activado) {
      await prisma.empleadoVentas.update({
        where: { id: empleado.id },
        data: { totp_activado: true }
      });
    }

    // Generar JWT admin_token con 8 horas de vida
    const adminJwt = jwt.sign(
      { id: empleado.id, email: empleado.email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/'
    };
    const host = req.headers.host || '';
    if (process.env.COOKIE_DOMAIN && host.endsWith(process.env.COOKIE_DOMAIN)) {
      cookieOpts.domain = process.env.COOKIE_DOMAIN;
    }
    res.cookie('admin_token', adminJwt, cookieOpts);

    // También activar la sesión legacy del editor para compatibilidad
    ADMIN_CONFIG.sessionActive = true;

    const logTime = new Date().toLocaleTimeString('es-AR');
    console.log(`  \x1b[32m🔐 [${logTime}] Empleado ${empleado.email} autenticado con 2FA exitosamente.\x1b[0m`);

    // Obtener el email de recuperación (el email seguro del dueño)
    const cfgRecovery = await prisma.configGlobal.findUnique({ where: { clave: 'recovery_email' } });
    const alertEmail = cfgRecovery?.valor || empleado.email;

    // Alerta de inicio de sesión al email seguro (async, no bloquea response)
    mail.enviarAlertaLogin(alertEmail, {
      fecha: new Date().toLocaleString('es-AR'),
      ip: req.ip || req.headers['x-forwarded-for'] || 'Desconocido',
      userAgent: req.headers['user-agent'] || 'Desconocido'
    }).catch(err => console.error('[LoginAlert] Error:', err));

    res.json({
      ok: true,
      message: 'Autenticación con 2FA exitosa.',
      user: {
        id: empleado.id,
        nombre: empleado.nombre,
        email: empleado.email
      }
    });
  } catch (e) {
    console.error('Error en /admin/login/2fa:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /admin/logout
app.post('/admin/logout', (req, res) => {
  ADMIN_CONFIG.sessionActive = false;
  res.clearCookie('admin_token');
  res.json({ ok: true, message: 'Sesión de administración cerrada.' });
});

// POST /admin/password/solicitar-codigo
app.post('/admin/password/solicitar-codigo', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email es obligatorio.' });
    }

    const empleado = await prisma.empleadoVentas.findUnique({ where: { email } });
    const genericMsg = 'Si el correo está registrado, recibirás un código de recuperación.';

    if (empleado && empleado.activo) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await bcrypt.hash(code, 10);
      const expira = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      await prisma.empleadoVentas.update({
        where: { id: empleado.id },
        data: {
          codigo_recuperacion: codeHash,
          codigo_recuperacion_expira: expira
        }
      });

      console.log(`📧 [RECOVERY CODE EMPLEADO] Código para ${email}: ${code}`);
      
      // Enviar mail con el código (no bloquea el response)
      mail.enviarCodigoRecuperacion(email, code);
    }

    res.json({ ok: true, message: genericMsg });
  } catch (e) {
    console.error('Error en admin solicitar-codigo:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /admin/password/confirmar
app.post('/admin/password/confirmar', async (req, res) => {
  try {
    const { email, codigo, password } = req.body;
    if (!email || !codigo || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }

    const empleado = await prisma.empleadoVentas.findUnique({ where: { email } });
    if (!empleado || !empleado.codigo_recuperacion || !empleado.codigo_recuperacion_expira) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    const now = new Date();
    if (empleado.codigo_recuperacion_expira < now) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    const match = await bcrypt.compare(codigo, empleado.codigo_recuperacion);
    if (!match) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.empleadoVentas.update({
      where: { id: empleado.id },
      data: {
        password_hash: passwordHash,
        codigo_recuperacion: null,
        codigo_recuperacion_expira: null
      }
    });

    res.json({ ok: true, message: 'Contraseña restablecida con éxito.' });
  } catch (e) {
    console.error('Error en admin confirmar-codigo:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ── ENDPOINTS DE SEGURIDAD Y CONFIGURACIÓN DEL ADMINISTRADOR ──

// POST /api/admin/profile/edit — Cambiar nombre
app.post('/api/admin/profile/edit', verifyAdminToken, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre || nombre.trim().length < 2 || nombre.trim().length > 50) {
      return res.status(400).json({ error: 'El nombre debe tener entre 2 y 50 caracteres.' });
    }

    await prisma.empleadoVentas.update({
      where: { id: req.adminUser.id },
      data: { nombre: nombre.trim() }
    });

    res.json({ ok: true, message: 'Nombre actualizado con éxito.' });
  } catch (e) {
    console.error('Error al actualizar nombre admin:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/profile/credentials — Cambiar email y/o contraseña (requiere OTP)
app.post('/api/admin/profile/credentials', verifyAdminToken, async (req, res) => {
  try {
    const { email, password, otp_code } = req.body;
    if (!otp_code) {
      return res.status(400).json({ error: 'El código OTP es obligatorio.' });
    }

    const empleado = await prisma.empleadoVentas.findUnique({
      where: { id: req.adminUser.id }
    });

    if (!empleado) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }

    if (empleado.totp_activado && empleado.totp_secret) {
      const isValid = speakeasy.totp.verify({
        secret: empleado.totp_secret,
        encoding: 'base32',
        token: otp_code.trim()
      });
      if (!isValid) {
        return res.status(400).json({ error: 'Código 2FA incorrecto.' });
      }
    } else {
      return res.status(400).json({ error: 'El administrador debe tener 2FA activado.' });
    }

    const updateData = {};

    if (email && email.trim() !== empleado.email) {
      const targetEmail = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return res.status(400).json({ error: 'Formato de correo electrónico inválido.' });
      }
      const existing = await prisma.empleadoVentas.findUnique({
        where: { email: targetEmail }
      });
      if (existing) {
        return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
      }
      updateData.email = targetEmail;
    }

    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
      }
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No se enviaron datos para actualizar.' });
    }

    await prisma.empleadoVentas.update({
      where: { id: empleado.id },
      data: updateData
    });

    res.clearCookie('admin_token', { path: '/' });
    res.json({ ok: true, message: 'Credenciales actualizadas. Por favor iniciá sesión nuevamente.' });
  } catch (e) {
    console.error('Error al actualizar credenciales admin:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Helper flexible para encontrar al empleado administrador (soporta email de login o recovery_email)
async function findAdminEmpleadoFlexible(inputEmail) {
  if (!inputEmail) return null;
  const targetEmail = inputEmail.trim().toLowerCase();

  const allActive = await prisma.empleadoVentas.findMany({ where: { activo: true } });
  if (!allActive || allActive.length === 0) return null;

  // 1. Coincidencia por email de login (case-insensitive en JS)
  let empleado = allActive.find(e => e.email && e.email.trim().toLowerCase() === targetEmail);

  // 2. Coincidencia por correo seguro de recuperación guardado en configGlobal
  if (!empleado) {
    const cfgRecovery = await prisma.configGlobal.findUnique({ where: { clave: 'recovery_email' } });
    if (cfgRecovery && cfgRecovery.valor && cfgRecovery.valor.trim().toLowerCase() === targetEmail) {
      empleado = allActive[0];
    }
  }

  // 3. Fallback: Si hay un único administrador en la tienda, asignarlo automáticamente
  if (!empleado && allActive.length === 1) {
    empleado = allActive[0];
  }

  return empleado;
}

// POST /api/admin/recovery/request-reset-2fa — Solicitar reset de 2FA o código de recuperación
app.post('/api/admin/recovery/request-reset-2fa', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'El correo electrónico es obligatorio.' });
    }

    const targetEmail = email.trim();
    const rateCheck = await checkLoginRateLimit(targetEmail, 'recovery_2fa');
    if (rateCheck.blocked) {
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Inténtalo de nuevo en ${rateCheck.remainingTime} segundos.`
      });
    }

    const empleado = await findAdminEmpleadoFlexible(targetEmail);
    const genericMsg = 'Si el correo está registrado, se enviará un código de seguridad al email de recuperación.';

    if (empleado && empleado.activo) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeHash = await bcrypt.hash(code, 10);
      const expira = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      await prisma.empleadoVentas.update({
        where: { id: empleado.id },
        data: {
          codigo_recuperacion: codeHash,
          codigo_recuperacion_expira: expira
        }
      });

      const cfgRecovery = await prisma.configGlobal.findUnique({
        where: { clave: 'recovery_email' }
      });
      const recoveryEmail = cfgRecovery?.valor || 'pixisinformatica.contacto@gmail.com';

      console.log(`📧 [RESET CODE EMPLEADO] Código de recuperación enviado a ${recoveryEmail}: ${code}`);
      mail.enviarCodigoReset2FA(recoveryEmail, code).catch(console.error);
    } else {
      await recordFailedLoginAttempt(targetEmail, 'recovery_2fa');
    }

    res.json({ ok: true, message: genericMsg });
  } catch (e) {
    console.error('Error en solicitar reset 2fa:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/recovery/confirm-reset-2fa — Confirmar reset de 2FA
app.post('/api/admin/recovery/confirm-reset-2fa', async (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!email || !codigo) {
      return res.status(400).json({ error: 'El email y el código son obligatorios.' });
    }

    const targetEmail = email.trim();
    const empleado = await findAdminEmpleadoFlexible(targetEmail);

    if (!empleado || !empleado.codigo_recuperacion || !empleado.codigo_recuperacion_expira) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    const now = new Date();
    if (empleado.codigo_recuperacion_expira < now) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    const match = await bcrypt.compare(codigo.trim(), empleado.codigo_recuperacion);
    if (!match) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    // Generar un nuevo secreto 2FA en estado no-activado para obligar a escanear de nuevo
    const tempSecret = speakeasy.generateSecret({ length: 20 });

    await prisma.empleadoVentas.update({
      where: { id: empleado.id },
      data: {
        totp_secret: tempSecret.base32,
        totp_activado: false,
        codigo_recuperacion: null,
        codigo_recuperacion_expira: null
      }
    });

    await clearLoginAttempts(targetEmail, 'recovery_2fa');
    res.json({ ok: true, message: 'La verificación en dos pasos (2FA) ha sido restablecida. Podrás volver a configurarla en el próximo inicio de sesión.' });
  } catch (e) {
    console.error('Error al confirmar reset 2fa:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/recovery/reset-password-with-code — Restablecer contraseña usando código de recuperación de email
app.post('/api/admin/recovery/reset-password-with-code', async (req, res) => {
  try {
    const { email, codigo, new_password } = req.body;
    if (!email || !codigo || !new_password) {
      return res.status(400).json({ error: 'Email, código y nueva contraseña son obligatorios.' });
    }

    if (new_password.trim().length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    }

    const targetEmail = email.trim();
    const empleado = await findAdminEmpleadoFlexible(targetEmail);

    if (!empleado || !empleado.codigo_recuperacion || !empleado.codigo_recuperacion_expira) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    const now = new Date();
    if (empleado.codigo_recuperacion_expira < now) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    const match = await bcrypt.compare(codigo.trim(), empleado.codigo_recuperacion);
    if (!match) {
      return res.status(400).json({ error: 'Código de recuperación inválido o vencido.' });
    }

    const newHash = await bcrypt.hash(new_password.trim(), 10);

    await prisma.empleadoVentas.update({
      where: { id: empleado.id },
      data: {
        password_hash: newHash,
        codigo_recuperacion: null,
        codigo_recuperacion_expira: null
      }
    });

    await clearLoginAttempts(targetEmail, 'recovery_2fa');
    await clearLoginAttempts(targetEmail, 'empleado');

    res.json({ ok: true, message: '¡Contraseña restablecida con éxito! Ya podés iniciar sesión con tu nueva clave.' });
  } catch (e) {
    console.error('Error al restablecer clave con código:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/settings/panel-path — Cambiar URL de acceso del Panel de Ventas
app.post('/api/admin/settings/panel-path', verifyAdminToken, async (req, res) => {
  try {
    const { new_path, otp_code } = req.body;
    if (!new_path || !otp_code) {
      return res.status(400).json({ error: 'El nuevo path y el código OTP son obligatorios.' });
    }

    const targetPath = new_path.trim().toLowerCase();

    // Validar regex alfanumérico con guiones simples
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(targetPath)) {
      return res.status(400).json({ error: 'El nombre de la ruta solo debe contener letras, números y guiones.' });
    }

    if (targetPath.length < 3 || targetPath.length > 40) {
      return res.status(400).json({ error: 'El nombre de la ruta debe tener entre 3 y 40 caracteres.' });
    }

    // Lista negra de palabras reservadas
    const blacklist = ['api', 'admin', 'uploads', 'css', 'js', 'img', 'editor', 'data', 'node_modules', 'prisma', 'scripts', 'server', 'backups'];
    if (blacklist.includes(targetPath)) {
      return res.status(400).json({ error: 'Ese nombre de ruta está reservado por el sistema.' });
    }

    const empleado = await prisma.empleadoVentas.findUnique({
      where: { id: req.adminUser.id }
    });

    if (!empleado || !empleado.totp_activado || !empleado.totp_secret) {
      return res.status(400).json({ error: 'El administrador debe tener 2FA activado.' });
    }

    const isValid = speakeasy.totp.verify({
      secret: empleado.totp_secret,
      encoding: 'base32',
      token: otp_code.trim()
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Código 2FA incorrecto.' });
    }

    await prisma.configGlobal.upsert({
      where: { clave: 'admin_path' },
      update: { valor: targetPath },
      create: { clave: 'admin_path', valor: targetPath }
    });

    currentAdminPath = targetPath; // Actualizar variable en memoria
    console.log(`🔒 [ADMIN] URL de administración reconfigurada a: /${targetPath}`);

    res.json({ ok: true, message: `URL del panel de ventas reconfigurada con éxito. La nueva ruta es /${targetPath}` });
  } catch (e) {
    console.error('Error al cambiar path del panel:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.get('/api/admin/settings/smtp', verifyAdminToken, async (req, res) => {
  try {
    const host = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_host' } });
    const port = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_port' } });
    const user = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_user' } });
    res.json({
      ok: true,
      host: host ? host.valor : '',
      port: port ? port.valor : '',
      user: user ? user.valor : ''
    });
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.post('/api/admin/settings/smtp', verifyAdminToken, async (req, res) => {
  try {
    const { host, port, user, pass } = req.body;
    if (!host || !port || !user || !pass) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }

    await prisma.configGlobal.upsert({
      where: { clave: 'smtp_host' },
      update: { valor: host.trim() },
      create: { clave: 'smtp_host', valor: host.trim() }
    });
    await prisma.configGlobal.upsert({
      where: { clave: 'smtp_port' },
      update: { valor: port.toString().trim() },
      create: { clave: 'smtp_port', valor: port.toString().trim() }
    });
    await prisma.configGlobal.upsert({
      where: { clave: 'smtp_user' },
      update: { valor: user.trim() },
      create: { clave: 'smtp_user', valor: user.trim() }
    });
    await prisma.configGlobal.upsert({
      where: { clave: 'smtp_pass' },
      update: { valor: pass.trim() },
      create: { clave: 'smtp_pass', valor: pass.trim() }
    });

    await loadSmtpConfig(); // Recarga dinámica inmediata en caliente

    res.json({ ok: true, message: 'Configuración de servidor SMTP guardada con éxito.' });
  } catch (e) {
    console.error('Error al guardar config SMTP:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/settings/recovery-email — Cambiar correo de recuperación (email seguro)
app.post('/api/admin/settings/recovery-email', verifyAdminToken, async (req, res) => {
  try {
    const { recovery_email, otp_code } = req.body;
    if (!recovery_email || !otp_code) {
      return res.status(400).json({ error: 'El correo electrónico y el código OTP son obligatorios.' });
    }

    const targetEmail = recovery_email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      return res.status(400).json({ error: 'Formato de correo electrónico inválido.' });
    }

    const empleado = await prisma.empleadoVentas.findUnique({
      where: { id: req.adminUser.id }
    });

    if (!empleado || !empleado.totp_activado || !empleado.totp_secret) {
      return res.status(400).json({ error: 'El administrador debe tener 2FA activado.' });
    }

    const isValid = speakeasy.totp.verify({
      secret: empleado.totp_secret,
      encoding: 'base32',
      token: otp_code.trim()
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Código 2FA incorrecto.' });
    }

    await prisma.configGlobal.upsert({
      where: { clave: 'recovery_email' },
      update: { valor: targetEmail },
      create: { clave: 'recovery_email', valor: targetEmail }
    });

    res.json({ ok: true, message: 'Correo de recuperación actualizado con éxito.' });
  } catch (e) {
    console.error('Error al cambiar email de recuperación:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/admin/settings/garantia-email — Obtener el texto actual de garantía para mails
app.get('/api/admin/settings/garantia-email', verifyAdminToken, async (req, res) => {
  try {
    const cfg = await prisma.configGlobal.findUnique({ where: { clave: 'garantia_email_texto' } });
    res.json({
      ok: true,
      texto: cfg ? cfg.valor : mail.getTextoGarantia()
    });
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/settings/garantia-email — Guardar el nuevo texto de garantía para mails
app.post('/api/admin/settings/garantia-email', verifyAdminToken, async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto || typeof texto !== 'string' || texto.trim() === '') {
      return res.status(400).json({ error: 'El texto de garantía no puede estar vacío.' });
    }

    const nuevoTexto = texto.trim();
    await prisma.configGlobal.upsert({
      where: { clave: 'garantia_email_texto' },
      update: { valor: nuevoTexto },
      create: { clave: 'garantia_email_texto', valor: nuevoTexto }
    });

    mail.setTextoGarantia(nuevoTexto);

    res.json({ ok: true, message: 'Texto de garantía y políticas en correos actualizado con éxito.' });
  } catch (e) {
    console.error('Error al guardar texto de garantía:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/admin/settings/seo — Obtener metadatos SEO actuales
app.get('/api/admin/settings/seo', verifyAdminToken, async (req, res) => {
  try {
    const title = await prisma.configGlobal.findUnique({ where: { clave: 'seo_title' } });
    const desc = await prisma.configGlobal.findUnique({ where: { clave: 'seo_description' } });
    const keywords = await prisma.configGlobal.findUnique({ where: { clave: 'seo_keywords' } });
    res.json({
      ok: true,
      seo_title: title ? title.valor : 'Pixis Informática | Especialistas N°1 en Santiago del Estero en Reparaciones y Computadoras Gamer y Oficina',
      seo_description: desc ? desc.valor : 'Especialistas N°1 en Santiago del Estero en reparaciones y servicio técnico de computadoras y laptops de oficina y gamer. Venta de insumos informáticos, accesorios y hardware de alto rendimiento.',
      seo_keywords: keywords ? keywords.valor : 'reparacion de computadoras santiago del estero, servicio tecnico laptops santiago del estero, arreglar pc gamer, insumos informaticos, pixis informatica, componentes de pc santiago del estero'
    });
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/settings/seo — Guardar los nuevos metadatos SEO
app.post('/api/admin/settings/seo', verifyAdminToken, async (req, res) => {
  try {
    const { seo_title, seo_description, seo_keywords } = req.body;
    if (!seo_title || !seo_description) {
      return res.status(400).json({ error: 'El título y la descripción SEO son obligatorios.' });
    }

    await prisma.configGlobal.upsert({
      where: { clave: 'seo_title' },
      update: { valor: seo_title.trim() },
      create: { clave: 'seo_title', valor: seo_title.trim() }
    });
    await prisma.configGlobal.upsert({
      where: { clave: 'seo_description' },
      update: { valor: seo_description.trim() },
      create: { clave: 'seo_description', valor: seo_description.trim() }
    });
    if (seo_keywords !== undefined) {
      await prisma.configGlobal.upsert({
        where: { clave: 'seo_keywords' },
        update: { valor: seo_keywords.trim() },
        create: { clave: 'seo_keywords', valor: seo_keywords.trim() }
      });
    }

    res.json({ ok: true, message: 'Configuración de SEO Global y Posicionamiento Google guardada con éxito.' });
  } catch (e) {
    console.error('Error al guardar configuración SEO:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/admin/settings/storage-stats — Diagnóstico de espacio en disco de comprobantes
app.get('/api/admin/settings/storage-stats', verifyAdminToken, async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, 'uploads', 'comprobantes');
    let totalBytes = 0;
    let totalArchivos = 0;

    if (fs.existsSync(uploadDir)) {
      const archivos = fs.readdirSync(uploadDir);
      for (const archivo of archivos) {
        try {
          const stats = fs.statSync(path.join(uploadDir, archivo));
          if (stats.isFile()) {
            totalBytes += stats.size;
            totalArchivos++;
          }
        } catch (e) { /* ignorar archivos inaccesibles */ }
      }
    }

    // Contar comprobantes purgables (pedidos finalizados >60 días)
    const fechaLimite = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const purgables = await prisma.comprobante.count({
      where: {
        pedido: {
          estado: { in: ['completado', 'rechazado', 'vencido'] },
          creado_en: { lt: fechaLimite }
        }
      }
    });

    res.json({
      ok: true,
      total_archivos: totalArchivos,
      total_mb: parseFloat((totalBytes / (1024 * 1024)).toFixed(2)),
      purgables_60_dias: purgables
    });
  } catch (e) {
    console.error('Error al obtener estadísticas de almacenamiento:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/settings/purge-storage — Purga manual de comprobantes antiguos (>60 días)
app.post('/api/admin/settings/purge-storage', verifyAdminToken, async (req, res) => {
  try {
    const fechaLimite = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const comprobantesViejos = await prisma.comprobante.findMany({
      where: {
        pedido: {
          estado: { in: ['completado', 'rechazado', 'vencido'] },
          creado_en: { lt: fechaLimite }
        }
      },
      select: { id: true, archivo_url: true }
    });

    if (comprobantesViejos.length === 0) {
      return res.json({ ok: true, eliminados: 0, mb_liberados: 0, message: 'No hay comprobantes antiguos para purgar.' });
    }

    // Calcular tamaño de archivos a eliminar
    const uploadDir = path.join(__dirname, 'uploads', 'comprobantes');
    let bytesLiberados = 0;
    for (const comp of comprobantesViejos) {
      try {
        if (comp.archivo_url) {
          const filePath = path.join(uploadDir, path.basename(comp.archivo_url));
          if (fs.existsSync(filePath)) {
            bytesLiberados += fs.statSync(filePath).size;
          }
        }
      } catch (e) { /* ignorar */ }
    }

    // Eliminar archivos físicos
    const archivosEliminados = eliminarArchivosComprobantes(comprobantesViejos);

    // Eliminar registros de la DB
    const idsABorrar = comprobantesViejos.map(c => c.id);
    await prisma.comprobante.deleteMany({ where: { id: { in: idsABorrar } } });

    const mbLiberados = parseFloat((bytesLiberados / (1024 * 1024)).toFixed(2));
    console.log(`🧹 [PURGA MANUAL] ${archivosEliminados} archivos eliminados, ${mbLiberados}MB liberados.`);

    res.json({
      ok: true,
      eliminados: comprobantesViejos.length,
      archivos_borrados: archivosEliminados,
      mb_liberados: mbLiberados,
      message: `Se purgaron ${comprobantesViejos.length} comprobantes antiguos. Se liberaron ${mbLiberados}MB de espacio en disco.`
    });
  } catch (e) {
    console.error('Error durante la purga manual de almacenamiento:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/admin/settings/all — Cargar todos los datos actuales configurados
app.get('/api/admin/settings/all', verifyAdminToken, async (req, res) => {
  try {
    const host = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_host' } });
    const port = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_port' } });
    const user = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_user' } });
    const pass = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_pass' } });
    const recEmail = await prisma.configGlobal.findUnique({ where: { clave: 'recovery_email' } });
    const panelPath = await prisma.configGlobal.findUnique({ where: { clave: 'admin_panel_path' } });
    const garantiaEmail = await prisma.configGlobal.findUnique({ where: { clave: 'garantia_email_texto' } });
    const seoTitle = await prisma.configGlobal.findUnique({ where: { clave: 'seo_title' } });
    const seoDesc = await prisma.configGlobal.findUnique({ where: { clave: 'seo_description' } });
    const seoKw = await prisma.configGlobal.findUnique({ where: { clave: 'seo_keywords' } });
    
    const empleado = await prisma.empleadoVentas.findUnique({ where: { id: req.adminUser.id } });

    res.json({
      ok: true,
      smtp_host: host ? host.valor : '',
      smtp_port: port ? port.valor : '',
      smtp_user: user ? user.valor : '',
      smtp_configured: !!(pass && pass.valor),
      nombre_comercial: empleado ? empleado.nombre : 'Vendedor Pixis',
      recovery_email: recEmail ? recEmail.valor : process.env.ADMIN_RECOVERY_EMAIL || 'vendedorpixis@gmail.com',
      admin_email: empleado ? empleado.email : req.adminUser.email,
      totp_activado: empleado ? empleado.totp_activado : false,
      panel_path: panelPath ? panelPath.valor : 'admin-panel',
      garantia_email_texto: garantiaEmail ? garantiaEmail.valor : mail.getTextoGarantia(),
      seo_title: seoTitle ? seoTitle.valor : 'Pixis Informática | Especialistas N°1 en Santiago del Estero en Reparaciones y Computadoras Gamer y Oficina',
      seo_description: seoDesc ? seoDesc.valor : 'Especialistas N°1 en Santiago del Estero en reparaciones y servicio técnico de computadoras y laptops de oficina y gamer. Venta de insumos informáticos, accesorios y hardware de alto rendimiento.',
      seo_keywords: seoKw ? seoKw.valor : 'reparacion de computadoras santiago del estero, servicio tecnico laptops santiago del estero, arreglar pc gamer, insumos informaticos, pixis informatica, componentes de pc santiago del estero'
    });
  } catch (e) {
    console.error('Error en GET /api/admin/settings/all:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/recovery/request-gate-pin — Enviar PIN de emergencia al recovery_email para desbloquear Ajustes
app.post('/api/admin/recovery/request-gate-pin', verifyAdminToken, async (req, res) => {
  try {
    const empleado = await prisma.empleadoVentas.findUnique({ where: { id: req.adminUser.id } });
    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });

    // Generar PIN de 6 dígitos
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const pinHash = await bcrypt.hash(pin, 10);
    const expira = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    await prisma.empleadoVentas.update({
      where: { id: empleado.id },
      data: {
        codigo_recuperacion: pinHash,
        codigo_recuperacion_expira: expira
      }
    });

    // Obtener recovery_email
    const cfgRecovery = await prisma.configGlobal.findUnique({ where: { clave: 'recovery_email' } });
    const recoveryEmail = cfgRecovery?.valor || 'pixisinformatica.contacto@gmail.com';

    console.log(`📧 [GATE PIN] Código de emergencia para Ajustes enviado a ${recoveryEmail}: ${pin}`);
    mail.enviarCodigoReset2FA(recoveryEmail, pin).catch(console.error);

    // Respuesta genérica por seguridad
    const emailMask = recoveryEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    res.json({ ok: true, message: `Código de emergencia enviado a ${emailMask}. Válido por 10 minutos.` });
  } catch (e) {
    console.error('Error en request-gate-pin:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/2fa/verify-gate — Verificar código 2FA para desbloquear acceso a Ajustes
// Acepta: OTP de Authenticator O PIN de emergencia enviado por email
app.post('/api/admin/2fa/verify-gate', verifyAdminToken, async (req, res) => {
  try {
    const empleado = await prisma.empleadoVentas.findUnique({ where: { id: req.adminUser.id } });
    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });

    // Si TOTP no está activado, permitir acceso notificando
    if (!empleado.totp_activado || !empleado.totp_secret) {
      return res.json({ ok: true, totp_activado: false, message: '2FA no activado en la cuenta.' });
    }

    const { otp_code } = req.body;
    if (!otp_code) {
      return res.status(400).json({ error: 'Ingresá el código de 6 dígitos.' });
    }

    const code = otp_code.trim();

    // Intento 1: Verificar como OTP de Authenticator
    const isValidOTP = speakeasy.totp.verify({
      secret: empleado.totp_secret,
      encoding: 'base32',
      token: code
    });

    if (isValidOTP) {
      return res.json({ ok: true, totp_activado: true, message: 'Acceso a ajustes desbloqueado con éxito.' });
    }

    // Intento 2: Verificar como PIN de emergencia enviado por email
    if (empleado.codigo_recuperacion && empleado.codigo_recuperacion_expira) {
      const now = new Date();
      if (empleado.codigo_recuperacion_expira > now) {
        const pinMatch = await bcrypt.compare(code, empleado.codigo_recuperacion);
        if (pinMatch) {
          // PIN válido: limpiar el código usado
          await prisma.empleadoVentas.update({
            where: { id: empleado.id },
            data: { codigo_recuperacion: null, codigo_recuperacion_expira: null }
          });
          return res.json({ ok: true, totp_activado: true, message: 'Acceso desbloqueado con código de emergencia.' });
        }
      }
    }

    // Ambos fallaron
    return res.status(400).json({ error: 'Código incorrecto. Verificá tu app Authenticator o usá un código de emergencia válido.' });
  } catch (e) {
    console.error('Error al verificar gatekeeper 2FA:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/2fa/disable — Desactivar 2FA verificando el OTP actual
app.post('/api/admin/2fa/disable', verifyAdminToken, async (req, res) => {
  try {
    const { otp_code } = req.body;
    if (!otp_code) {
      return res.status(400).json({ error: 'El código OTP es obligatorio para desactivar el 2FA.' });
    }

    const empleado = await prisma.empleadoVentas.findUnique({ where: { id: req.adminUser.id } });
    if (!empleado || !empleado.totp_secret || !empleado.totp_activado) {
      return res.status(400).json({ error: 'El 2FA ya está desactivado.' });
    }

    const isValid = speakeasy.totp.verify({
      secret: empleado.totp_secret,
      encoding: 'base32',
      token: otp_code.trim()
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Código 2FA incorrecto.' });
    }

    await prisma.empleadoVentas.update({
      where: { id: empleado.id },
      data: { totp_activado: false, totp_secret: null }
    });

    res.json({ ok: true, message: '2FA desactivado correctamente.' });
  } catch (e) {
    console.error('Error al desactivar 2FA:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/admin/2fa/setup-new — Generar nuevo QR y secreto 2FA para vincular
app.post('/api/admin/2fa/setup-new', verifyAdminToken, async (req, res) => {
  try {
    const empleado = await prisma.empleadoVentas.findUnique({ where: { id: req.adminUser.id } });
    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado.' });

    const newSecret = speakeasy.generateSecret({
      length: 20,
      name: `Pixis Informatica (${empleado.email})`,
      issuer: 'Pixis Informatica'
    });

    // Guardar secreto temporalmente en la BD sin activar totp_activado hasta confirmar
    await prisma.empleadoVentas.update({
      where: { id: empleado.id },
      data: { totp_secret: newSecret.base32, totp_activado: false }
    });

    const qrDataUrl = await qrcode.toDataURL(newSecret.otpauth_url);

    res.json({
      ok: true,
      qr: qrDataUrl,
      secret: newSecret.base32,
      message: 'Escaneá el código QR con tu aplicación de autenticación y confirmá con el código de 6 dígitos.'
    });
  } catch (e) {
    console.error('Error al generar nuevo 2FA:', e);
    res.status(500).json({ error: 'Error al generar código QR.' });
  }
});

// POST /api/admin/2fa/confirm-new — Confirmar y activar la nueva vinculación 2FA
app.post('/api/admin/2fa/confirm-new', verifyAdminToken, async (req, res) => {
  try {
    const { otp_code } = req.body;
    if (!otp_code) {
      return res.status(400).json({ error: 'El código de 6 dígitos es obligatorio.' });
    }

    const empleado = await prisma.empleadoVentas.findUnique({ where: { id: req.adminUser.id } });
    if (!empleado || !empleado.totp_secret) {
      return res.status(400).json({ error: 'No hay ninguna configuración de 2FA pendiente.' });
    }

    const isValid = speakeasy.totp.verify({
      secret: empleado.totp_secret,
      encoding: 'base32',
      token: otp_code.trim()
    });

    if (!isValid) {
      return res.status(400).json({ error: 'Código 2FA incorrecto. Verificá tu aplicación de autenticación.' });
    }

    await prisma.empleadoVentas.update({
      where: { id: empleado.id },
      data: { totp_activado: true }
    });

    res.json({ ok: true, message: '¡2FA vinculado y activado con éxito!' });
  } catch (e) {
    console.error('Error al confirmar 2FA:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// DELETE /api/admin/orders/purge-test — Limpiar todos los pedidos de prueba
app.delete('/api/admin/orders/purge-test', verifyAdminToken, async (req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({ select: { id: true } });
    const ids = pedidos.map(p => p.id);

    if (ids.length === 0) {
      return res.json({ ok: true, count: 0, message: 'No hay pedidos en la base de datos para limpiar.' });
    }

    // Obtener archivos de comprobantes antes de borrar
    const comprobantesABorrar = await prisma.comprobante.findMany({
      where: { pedido_id: { in: ids } },
      select: { archivo_url: true }
    });

    await prisma.itemPedido.deleteMany({ where: { pedido_id: { in: ids } } });
    await prisma.comprobante.deleteMany({ where: { pedido_id: { in: ids } } });
    const deleted = await prisma.pedido.deleteMany({ where: { id: { in: ids } } });

    // Eliminar archivos físicos del disco
    const archivosEliminados = eliminarArchivosComprobantes(comprobantesABorrar);

    console.log(`🧹 [ADMIN] Purga ejecutada: ${deleted.count} pedidos eliminados, ${archivosEliminados} archivos de comprobantes borrados del disco.`);
    res.json({ ok: true, count: deleted.count, message: `Se eliminaron ${deleted.count} pedidos con éxito.` });
  } catch (e) {
    console.error('Error al purgar pedidos:', e);
    res.status(500).json({ error: 'Error al purgar pedidos de la base de datos.' });
  }
});


// Middleware: Renovación automática de admin_token por actividad
app.use('/admin', (req, res, next) => {
  const token = req.cookies.admin_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.adminUser = decoded;
      // Solo renovar cuando quedan menos de 2 horas de vida
      const nowSeconds = Math.floor(Date.now() / 1000);
      const remainingSeconds = decoded.exp - nowSeconds;
      if (remainingSeconds < 2 * 60 * 60) {
        const refreshedJwt = jwt.sign(
          { id: decoded.id, email: decoded.email, role: 'admin' },
          JWT_SECRET,
          { expiresIn: '8h' }
        );
        res.cookie('admin_token', refreshedJwt, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 8 * 60 * 60 * 1000,
          path: '/'
        });
      }
    } catch (e) {
      // Token inválido/expirado, no renovar
    }
  }
  next();
});

// ── ENDPOINTS DEL EDITOR ORIGINAL (Mantenidos hasta el Bloque 12) ────────────────

// GET /editor-acceso — Responder 404 intencionalmente (ofuscación)
app.get('/editor-acceso', (req, res) => {
  res.status(404).send('Not Found');
});

// POST /editor-acceso (Bloque 13) — Alias de login de empleados_ventas para el Editor
app.post('/editor-acceso', async (req, res) => {
  try {
    const { user, pass } = req.body;
    if (!user || !pass) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
    }

    const empleado = await prisma.empleadoVentas.findUnique({
      where: { email: user }
    });

    if (!empleado || !empleado.activo) {
      return res.status(401).json({ error: 'Credenciales inválidas o cuenta inactiva.' });
    }

    const valid = await bcrypt.compare(pass, empleado.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const expiraEn = new Date(Date.now() + 5 * 60 * 1000);
    const tempToken = await prisma.tempTokens2FA.create({
      data: {
        empleado_id: empleado.id,
        expira_en: expiraEn
      }
    });

    if (!empleado.totp_activado) {
      const label = `PixisEditor:${empleado.email}`;
      const otpauthUrl = speakeasy.otpauthURL({
        secret: empleado.totp_secret,
        label: label,
        issuer: 'Pixis Informatica'
      });

      const qrCodeUrl = await qrcode.toDataURL(otpauthUrl);
      return res.json({
        ok: true,
        message: 'Credenciales válidas. Configuración 2FA requerida.',
        tempToken: tempToken.id,
        qrCodeUrl
      });
    }

    res.json({
      ok: true,
      message: 'Credenciales válidas. Esperando código 2FA.',
      tempToken: tempToken.id
    });
  } catch (e) {
    console.error('Error en login editor (acceso):', e);
    res.status(500).json({ error: 'Error interno en el servidor.' });
  }
});

// POST /api/login (Paso 1 del Editor - Redirigido a empleados_ventas en el Bloque 12)
app.post('/api/login', async (req, res) => {
  try {
    const { user, pass } = req.body;
    if (!user || !pass) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
    }

    // Buscar el empleado por email
    const empleado = await prisma.empleadoVentas.findUnique({
      where: { email: user }
    });

    if (!empleado || !empleado.activo) {
      return res.status(401).json({ error: 'Credenciales inválidas o cuenta inactiva.' });
    }

    // Verificar password
    const valid = await bcrypt.compare(pass, empleado.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    // Generar UUID temporal para el paso 2
    const expiraEn = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos de vida
    const tempToken = await prisma.tempTokens2FA.create({
      data: {
        empleado_id: empleado.id,
        expira_en: expiraEn
      }
    });

    // Si es su primera vez (no tiene el TOTP activado), generar y enviarle el QR
    if (!empleado.totp_activado) {
      const label = `PixisEditor:${empleado.email}`;
      const otpauthUrl = speakeasy.otpauthURL({
        secret: empleado.totp_secret,
        label: label,
        issuer: 'Pixis Informatica'
      });

      const qrCodeUrl = await qrcode.toDataURL(otpauthUrl);
      return res.json({
        ok: true,
        message: 'Credenciales válidas. Configuración 2FA requerida.',
        tempToken: tempToken.id,
        qrCodeUrl
      });
    }

    res.json({
      ok: true,
      message: 'Credenciales válidas. Esperando código 2FA.',
      tempToken: tempToken.id
    });
  } catch (e) {
    console.error('Error en login editor:', e);
    res.status(500).json({ error: 'Error interno en el servidor.' });
  }
});

// POST /api/verify-2fa (Paso 2 del Editor - Redirigido a empleados_ventas en el Bloque 12)
app.post('/api/verify-2fa', async (req, res) => {
  try {
    const { token, tempToken } = req.body;
    if (!token || !tempToken) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos.' });
    }

    // Buscar token temporal en DB
    const dbTempToken = await prisma.tempTokens2FA.findUnique({
      where: { id: tempToken },
      include: { empleado: true }
    });

    if (!dbTempToken || dbTempToken.usado || dbTempToken.expira_en < new Date()) {
      return res.status(401).json({ error: 'Sesión temporal expirada o inválida. Inicie sesión nuevamente.' });
    }

    const empleado = dbTempToken.empleado;
    if (!empleado || !empleado.activo) {
      return res.status(401).json({ error: 'Empleado inactivo o no encontrado.' });
    }

    // Verificar código TOTP
    const verificado = speakeasy.totp.verify({
      secret: empleado.totp_secret,
      encoding: 'base32',
      token: token.replace(/\s/g, '') // Quitar espacios
    });

    if (!verificado) {
      return res.status(401).json({ error: 'Código 2FA incorrecto.' });
    }

    // Marcar token como usado
    await prisma.tempTokens2FA.update({
      where: { id: tempToken },
      data: { usado: true }
    });

    // Activar TOTP si es la primera vez
    if (!empleado.totp_activado) {
      await prisma.empleadoVentas.update({
        where: { id: empleado.id },
        data: { totp_activado: true }
      });
    }

    // Generar JWT admin_token con 8 horas
    const adminJwt = jwt.sign(
      { id: empleado.id, email: empleado.email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Opciones de cookie: soporte de domain para subdominios si es configurado en env
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/'
    };
    const host = req.headers.host || '';
    if (process.env.COOKIE_DOMAIN && host.endsWith(process.env.COOKIE_DOMAIN)) {
      cookieOptions.domain = process.env.COOKIE_DOMAIN;
    }

    res.cookie('admin_token', adminJwt, cookieOptions);

    res.json({ ok: true, session: 'active' });
  } catch (e) {
    console.error('Error en verify-2fa editor:', e);
    res.status(500).json({ error: 'Error interno en el servidor.' });
  }
});

// POST /api/config-admin
app.post('/api/config-admin', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }
  try {
    const { user, pass, recoveryEmail } = req.body;
    const token = req.cookies.admin_token;
    const decoded = jwt.verify(token, JWT_SECRET);

    const updateData = {};
    if (user) updateData.email = user;
    if (pass) {
      updateData.password_hash = await bcrypt.hash(pass, 10);
    }

    await prisma.empleadoVentas.update({
      where: { id: decoded.id },
      data: updateData
    });

    if (recoveryEmail) ADMIN_CONFIG.recoveryEmail = recoveryEmail;

    console.log(`  \x1b[33m🔐 [ADMIN] Credenciales de Empleado #${decoded.id} y Email actualizados\x1b[0m`);
    res.json({ ok: true });
  } catch (e) {
    console.error('Error al actualizar admin:', e);
    res.status(500).json({ error: 'Error al actualizar credenciales.' });
  }
});

// POST /api/request-recovery
app.post('/api/request-recovery', (req, res) => {
  const recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
  ADMIN_CONFIG.recoveryCode = recoveryCode;
  
  const now = new Date().toLocaleTimeString('es-AR');
  console.log(`\n\x1b[41m\x1b[37m 📧 [RECUPERACIÓN] [${now}] \x1b[0m`);
  console.log(`\x1b[33m CÓDIGO GENERADO: ${recoveryCode}\x1b[0m`);

  if (ADMIN_CONFIG.smtp.auth.pass !== 'TU_PASSWORD_DE_APP_AQUI') {
    const transporter = nodemailer.createTransport(ADMIN_CONFIG.smtp);
    const mailOptions = {
      from: `"Seguridad Pixis" <${ADMIN_CONFIG.smtp.auth.user}>`,
      to: ADMIN_CONFIG.recoveryEmail,
      subject: `⚠️ Código de Recuperación de Acceso - Pixis`,
      text: `Hola, tu código de acceso de emergencia es: ${recoveryCode}. Este código es de un solo uso.`,
      html: `
        <div style="font-family: sans-serif; background: #0a0a0f; color: #fff; padding: 40px; border-radius: 20px; text-align: center;">
          <h2 style="color: #f5c518;">⚠️ Acceso de Emergencia</h2>
          <p>Se ha solicitado un código para entrar al editor de Pixis.</p>
          <div style="font-size: 32px; font-weight: bold; background: #222; padding: 20px; border-radius: 10px; color: #ffd700; margin: 20px 0; letter-spacing: 5px;">
            ${recoveryCode}
          </div>
          <p style="color: #888; font-size: 12px;">Si no fuiste tú, cambia tu contraseña de inmediato.</p>
        </div>`
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`\x1b[31m ❌ Error al enviar mail: ${error.message}\x1b[0m`);
      } else {
        console.log(`\x1b[32m ✅ Mail enviado a: ${ADMIN_CONFIG.recoveryEmail}\x1b[0m\n`);
      }
    });
  } else {
    console.log(`\x1b[31m ⚠️ Mail NO enviado: Falta configurar la "Contraseña de Aplicación".\x1b[0m\n`);
  }

  res.json({ ok: true, message: 'Código generado' });
});

// POST /api/sync-all
app.post('/api/sync-all', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(403).json({ error: 'Acceso denegado. Debes iniciar sesión con 2FA.' });
  }
  try {
    const payload = req.body;
    const allowed = ['site', 'products', 'categories', 'ui'];
    const saved = [];
    const newVersion = Date.now();

    if (payload.site) {
      payload.site.cacheVersion = newVersion;
    } else {
      try {
        const siteFilePath = path.join(BASE, 'data', 'site.json');
        const siteData = await readJsonMutex(siteFilePath);
        if (siteData) {
          siteData.cacheVersion = newVersion;
          await writeJsonMutex(siteFilePath, siteData);
          saved.push('data/site.json (version bump)');
        }
      } catch (e) { /* ignore */ }
    }

    for (const key of allowed) {
      if (payload[key] === undefined) continue;
      const filePath = path.join(BASE, 'data', `${key}.json`);
      await writeJsonMutex(filePath, payload[key]);
      saved.push(`data/${key}.json`);
    }

    const now = new Date().toLocaleTimeString('es-AR');
    console.log(`  \x1b[32m✅ [${now}] /api/sync-all → ${saved.join(', ')} [v${newVersion}]\x1b[0m`);

    bumpVersionalizador();

    res.json({ ok: true, saved, cacheVersion: newVersion, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error(`  \x1b[31m❌ Error en /api/sync-all: ${e.message}\x1b[0m`);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/sync
app.post('/api/sync', async (req, res) => {
  // 🔍 Diagnóstico de autorización (remover después de verificar)
  const hasCookie = !!req.cookies.admin_token;
  const isAuth = isAuthorized(req);
  console.log(`[SAVE-JSON] Cookie presente: ${hasCookie} | Autorizado: ${isAuth} | Protocolo: ${req.protocol} | Secure: ${req.secure} | Host: ${req.headers.host}`);
  if (!isAuth) {
    console.log(`[SAVE-JSON] ❌ RECHAZADO — Cookies recibidas: ${Object.keys(req.cookies || {}).join(', ') || '(ninguna)'}`);
    // Retornar 200 con ok: false para evitar que el proxy reverso intercepte el error 403 y devuelva HTML
    return res.json({ ok: false, error: 'Acceso denegado. Debes iniciar sesión con 2FA.' });
  }
  const fileParam = (req.query.file || '').replace(/\\/g, '/');

  if (!fileParam.startsWith('data/') || fileParam.includes('..')) {
    return res.json({ ok: false, error: 'Ruta no permitida' });
  }

  try {
    let data = req.body;
    
    // Si viene empaquetado en base64 para evitar bloqueos del WAF/ModSecurity de Hostinger
    if (data && data.payload) {
      try {
        const decoded = Buffer.from(data.payload, 'base64').toString('utf-8');
        data = JSON.parse(decoded);
      } catch (e) {
        console.error('❌ [SAVE-JSON] Error al decodificar payload Base64:', e.message);
        return res.json({ ok: false, error: 'Error decodificando payload de seguridad WAF: ' + e.message });
      }
    }

    const targetPath = path.join(BASE, ...fileParam.split('/'));
    const newVersion = Date.now();

    if (fileParam === 'data/site.json') {
      data.cacheVersion = newVersion;
    } else {
      try {
        const siteFilePath = path.join(BASE, 'data', 'site.json');
        const siteData = await readJsonMutex(siteFilePath);
        if (siteData) {
          siteData.cacheVersion = newVersion;
          await writeJsonMutex(siteFilePath, siteData);
        }
      } catch (e) { /* ignore */ }
    }

    await writeJsonMutex(targetPath, data);
    const size = fs.statSync(targetPath).size;

    const now = new Date().toLocaleTimeString('es-AR');
    console.log(`  \x1b[32m✅ [${now}] Guardado: ${fileParam} (${size} bytes) [v${newVersion}]\x1b[0m`);

    bumpVersionalizador();

    res.json({ ok: true, file: fileParam, size, cacheVersion: newVersion, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error(`  \x1b[31m❌ Error al guardar: ${e.message}\x1b[0m`);
    res.json({ ok: false, error: e.message });
  }
});

// POST /api/upload-image
app.post('/api/upload-image', (req, res) => {
  const filename = (req.query.filename || `upload-${Date.now()}.jpg`).replace(/\\/g, '/');
  const folder   = (req.query.folder || 'img/uploads').replace(/\\/g, '/');

  if (!folder.startsWith('img') || folder.includes('..')) {
    return res.status(403).json({ error: 'Carpeta no permitida' });
  }

  let chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    try {
      const buffer = Buffer.concat(chunks);
      const targetPath = path.join(BASE, ...folder.split('/'), filename);

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, buffer);
      
      const relativePath = `${folder}/${filename}`;
      const now = new Date().toLocaleTimeString('es-AR');
      console.log(`  \x1b[35m📸 [${now}] Imagen subida: ${relativePath}\x1b[0m`);

      res.json({ ok: true, url: relativePath });
    } catch (e) {
      console.error(`  \x1b[31m❌ Error en upload: ${e.message}\x1b[0m`);
      res.status(500).json({ error: e.message });
    }
  });
});

// POST /api/remove-image
app.post('/api/remove-image', (req, res) => {
  if (!isAuthorized(req)) {
    return res.sendStatus(403);
  }
  
  try {
    const { url: relativePath } = req.body;
    if (!relativePath || !relativePath.startsWith('img/') || relativePath.includes('..')) {
      return res.status(400).json({ error: 'Ruta inválida' });
    }

    const fullPath = path.join(BASE, ...relativePath.split('/'));
    
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      const now = new Date().toLocaleTimeString('es-AR');
      console.log(`  \x1b[31m🗑️ [${now}] Imagen eliminada: ${relativePath}\x1b[0m`);
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'Archivo no encontrado' });
    }
  } catch (e) {
    console.error(`  \x1b[31m❌ Error en delete: ${e.message}\x1b[0m`);
    res.status(500).json({ error: e.message });
  }
});

// ── TAREA PROGRAMADA: LIBERACIÓN DE RESERVAS VENCIDAS Y LIMPIEZA (BLOQUE 8) ──

const cron = require('node-cron');

// Función que ejecuta el proceso de liberación
async function liberarReservasVencidas() {
  const logTime = new Date().toLocaleTimeString('es-AR');
  console.log(`  \x1b[36m⏰ [${logTime}] [CRON] Iniciando proceso de liberación de reservas vencidas...\x1b[0m`);

  try {
    const ahora = new Date();
    
    // 1. Obtener pedidos vencidos en estado 'reservado'
    const pedidosVencidos = await prisma.pedido.findMany({
      where: {
        estado: 'reservado',
        reservado_hasta: {
          lt: ahora
        }
      },
      include: {
        items: true,
        usuario: true
      }
    });

    if (pedidosVencidos.length === 0) {
      console.log(`  \x1b[30m⏰ [${logTime}] [CRON] No se encontraron reservas vencidas.\x1b[0m`);
    } else {
      console.log(`  \x1b[33m⏰ [${logTime}] [CRON] Se encontraron ${pedidosVencidos.length} reservas vencidas. Procesando liberación...\x1b[0m`);
      
      // Adquirimos el mutex de products.json para evitar colisiones y realizamos el ciclo de forma segura
      await withProductsMutex(async (products) => {
        for (const order of pedidosVencidos) {
          try {
            // Devolver el stock a products.json solo si fue descontado previamente
            if (order.stock_descontado) {
              restaurarStock(products, order.items);
            }

            // Marcar el pedido como vencido en la base de datos
            await prisma.pedido.update({
              where: { id: order.id },
              data: {
                estado: 'vencido',
                stock_descontado: false,
                reservado_hasta: null
              }
            });

            // Enviar mail de notificación de vencimiento al cliente
            mail.enviarPedidoRechazado(
              order.usuario.email,
              order,
              'El tiempo de reserva de 24 horas ha expirado sin que se complete el retiro o entrega de los productos.'
            ).catch(console.error);

            console.log(`  \x1b[32m⏰ [${logTime}] [CRON] Pedido #${order.id} liberado con éxito.\x1b[0m`);
          } catch (err) {
            console.error(`  \x1b[31m❌ [CRON] Error al liberar Pedido #${order.id}:\x1b[0m`, err);
          }
        }
      });
      console.log(`  \x1b[36m⏰ [${logTime}] [CRON] Archivo products.json actualizado y versionado.\x1b[0m`);
    }

    // 2. Limpieza de tokens temporales de 2FA vencidos o usados
    console.log(`  \x1b[36m⏰ [${logTime}] [CRON] Limpiando tokens 2FA huérfanos o vencidos...\x1b[0m`);
    const cleanResult = await prisma.tempTokens2FA.deleteMany({
      where: {
        OR: [
          { expira_en: { lt: ahora } },
          { usado: true }
        ]
      }
    });
    if (cleanResult.count > 0) {
      console.log(`  \x1b[32m⏰ [${logTime}] [CRON] Se eliminaron ${cleanResult.count} tokens 2FA obsoletos de la base de datos.\x1b[0m`);
    }

  } catch (e) {
    console.error(`  \x1b[31m❌ [CRON] Error crítico durante la tarea programada:\x1b[0m`, e);
  }
}

// Programar cron para correr cada 1 hora: 0 * * * *
cron.schedule('0 * * * *', liberarReservasVencidas);

// ── TAREA PROGRAMADA: PURGA DE COMPROBANTES ANTIGUOS (>60 DÍAS) ──
async function purgarComprobantesAntiguos() {
  const logTime = new Date().toLocaleTimeString('es-AR');
  console.log(`  \x1b[36m🧹 [${logTime}] [CRON-PURGA] Iniciando purga de comprobantes antiguos (>60 días)...\x1b[0m`);

  try {
    const fechaLimite = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 días atrás

    // Buscar comprobantes de pedidos finalizados con más de 60 días
    const comprobantesViejos = await prisma.comprobante.findMany({
      where: {
        pedido: {
          estado: { in: ['completado', 'rechazado', 'vencido'] },
          creado_en: { lt: fechaLimite }
        }
      },
      select: { id: true, archivo_url: true }
    });

    if (comprobantesViejos.length === 0) {
      console.log(`  \x1b[30m🧹 [${logTime}] [CRON-PURGA] No hay comprobantes antiguos para purgar.\x1b[0m`);
      return;
    }

    // 1. Eliminar archivos físicos del disco
    const archivosEliminados = eliminarArchivosComprobantes(comprobantesViejos);

    // 2. Eliminar registros de la base de datos
    const idsABorrar = comprobantesViejos.map(c => c.id);
    await prisma.comprobante.deleteMany({ where: { id: { in: idsABorrar } } });

    console.log(`  \x1b[32m🧹 [${logTime}] [CRON-PURGA] Purgados ${comprobantesViejos.length} comprobantes antiguos (${archivosEliminados} archivos eliminados del disco).\x1b[0m`);
  } catch (e) {
    console.error(`  \x1b[31m❌ [CRON-PURGA] Error durante la purga de comprobantes:\x1b[0m`, e);
  }
}

// Programar purga diaria a las 3:00 AM
cron.schedule('0 3 * * *', purgarComprobantesAntiguos);

// Función para realizar backup diario
async function realizarBackup() {
  const logTime = new Date().toLocaleTimeString('es-AR');
  console.log(`  \x1b[36m⏰ [${logTime}] [BACKUP] Iniciando copia de seguridad diaria...\x1b[0m`);

  try {
    const backupDir = path.join(BASE, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const dbPath = path.join(BASE, 'prisma', 'dev.db');
    if (!fs.existsSync(dbPath)) {
      console.error(`  \x1b[31m❌ [BACKUP] No se encontró la DB en ${dbPath}\x1b[0m`);
      return;
    }

    const ahora = new Date();
    const yyyy = ahora.getFullYear();
    const mm = String(ahora.getMonth() + 1).padStart(2, '0');
    const dd = String(ahora.getDate()).padStart(2, '0');
    const backupFilename = `backup-${yyyy}-${mm}-${dd}.db`;
    const backupDest = path.join(backupDir, backupFilename);

    fs.copyFileSync(dbPath, backupDest);
    console.log(`  \x1b[32m⏰ [${logTime}] [BACKUP] Copia realizada: ${backupFilename}\x1b[0m`);

    // Limpieza de más de 30 días
    const archivos = fs.readdirSync(backupDir);
    let eliminados = 0;
    const limiteMs = 30 * 24 * 60 * 60 * 1000;

    for (const archivo of archivos) {
      const archivoPath = path.join(backupDir, archivo);
      const stat = fs.statSync(archivoPath);
      const antiguedadMs = ahora.getTime() - stat.mtime.getTime();

      if (antiguedadMs > limiteMs) {
        fs.unlinkSync(archivoPath);
        eliminados++;
      }
    }

    console.log(`  \x1b[35m⏰ [${logTime}] [BACKUP] Corrida finalizada: 1 backup realizado, ${eliminados} antiguos eliminados.\x1b[0m`);
  } catch (err) {
    console.error(`  \x1b[31m❌ [BACKUP] Error al realizar copia:\x1b[0m`, err);
  }
}

// Programar backups automáticos a las 3:00 AM (0 3 * * *)
cron.schedule('0 3 * * *', realizarBackup);

// ── CRON: Inactivar cupones expirados cada 15 minutos ─────────────────────────
cron.schedule('*/15 * * * *', async () => {
  try {
    const resultado = await prisma.cupon.updateMany({
      where: {
        activo: true,
        expira_en: { lt: new Date() }
      },
      data: { activo: false }
    });
    if (resultado.count > 0) {
      console.log(`  \x1b[33m🎟️ [CRON-CUPONES] ${resultado.count} cupón(es) expirado(s) desactivado(s).\x1b[0m`);
    }
  } catch (e) {
    console.error('  \x1b[31m❌ [CRON-CUPONES] Error al desactivar cupones expirados:\x1b[0m', e);
  }
});

// Endpoint manual de backup
app.post('/api/admin/backup/run-manually', async (req, res) => {
  const token = req.cookies.admin_token;
  let isLocalOrAdmin = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
  
  if (!isLocalOrAdmin && token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role === 'admin') isLocalOrAdmin = true;
    } catch(e) {}
  }

  if (!isLocalOrAdmin) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  await realizarBackup();
  res.json({ ok: true, message: 'Backup manual realizado.' });
});

// También exponemos una ruta GET oculta o interna únicamente para que los tests puedan gatillar
// el cron manualmente sin tener que esperar 1 hora
app.post('/api/admin/cron/run-manually', async (req, res) => {
  const token = req.cookies.admin_token;
  let isLocalOrAdmin = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
  
  if (!isLocalOrAdmin && token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role === 'admin') isLocalOrAdmin = true;
    } catch(e) {}
  }

  if (!isLocalOrAdmin) {
    return res.status(403).json({ error: 'Acceso denegado.' });
  }

  await liberarReservasVencidas();
  res.json({ ok: true, message: 'Cron ejecutado manualmente.' });
});

// Bloquear acceso directo a la carpeta de uploads/comprobantes (Bloque 11)
app.use('/uploads', (req, res) => {
  res.status(403).json({ error: 'Acceso directo denegado.' });
});

// Middleware de enrutamiento dinámico para el Panel de Ventas
let currentAdminPath = 'admin-panel';

async function loadAdminPath() {
  try {
    const cfg = await prisma.configGlobal.findUnique({ where: { clave: 'admin_path' } });
    if (cfg) {
      currentAdminPath = cfg.valor;
      console.log(`🔒 [ADMIN] Ruta personalizada cargada de DB: /${currentAdminPath}`);
    }
  } catch (e) {
    // Si la DB no está migrada aún, usar default
  }
}

async function loadSmtpConfig() {
  try {
    const host = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_host' } });
    const port = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_port' } });
    const user = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_user' } });
    const pass = await prisma.configGlobal.findUnique({ where: { clave: 'smtp_pass' } });

    if (host && port && user && pass) {
      mail.setSmtpConfig({
        host: host.valor,
        port: parseInt(port.valor, 10),
        user: user.valor,
        pass: pass.valor
      });
      console.log('📧 [MAIL] Servidor SMTP personalizado cargado desde la Base de Datos.');
    }
  } catch (e) {
    // Si la DB no está lista o no tiene registros
  }
}

async function loadGarantiaEmailConfig() {
  try {
    const cfg = await prisma.configGlobal.findUnique({ where: { clave: 'garantia_email_texto' } });
    if (cfg && cfg.valor) {
      mail.setTextoGarantia(cfg.valor);
      console.log('🛡️ [MAIL] Texto de garantía de correos cargado desde la Base de Datos.');
    }
  } catch (e) {
    // Si la DB no está lista o no tiene registros
  }
}

// loadAdminPath(), loadSmtpConfig() y loadGarantiaEmailConfig() se ejecutan dentro de la secuencia de auto-setup al final

app.use((req, res, next) => {
  const normPath = req.path.replace(/\/$/, '');
  if (normPath === `/${currentAdminPath}` || req.path.startsWith(`/${currentAdminPath}/`)) {
    req.url = req.url.replace('/' + currentAdminPath, '/admin-panel');
    return next();
  }
  if (currentAdminPath !== 'admin-panel' && (req.path === '/admin-panel' || req.path.startsWith('/admin-panel/'))) {
    return res.status(404).send('404 - No encontrado');
  }
  next();
});

// Desactivar caché para archivos de código crítico (HTML, JS, JSON) para evitar conflictos de caché del navegador y LiteSpeed
app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (ext === '.html' || ext === '.js' || ext === '.json') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-LiteSpeed-Cache-Control', 'no-cache');
  }
  next();
});

// ── SERVIR ARCHIVOS ESTÁTICOS ─────────────────────────────────
app.use(express.static(BASE));

// Fallback para URLs limpias de productos locales (evita 404 al abrir en pestaña nueva)
// Compatible con Express v5 (no usa wildcards * en rutas, usa middleware manual)
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path.includes('--id-') && !req.path.includes('.')) {
    return res.sendFile(path.join(BASE, 'index.html'));
  }
  next();
});

// Manejo de errores 404 para archivos no encontrados
app.use((req, res) => {
  res.status(404).send(`404 - No encontrado: ${req.path}`);
});

// ── AUTO-CONFIGURACIÓN DE PRODUCCIÓN / LOCAL ─────────────────────
async function autoSetup() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('🔄 [Auto-Setup] Verificando entorno de producción...');
  console.log('══════════════════════════════════════════════════════');

  // 1. Crear carpetas necesarias si no existen
  const requiredDirs = ['data', 'uploads', 'backups'];
  for (const dir of requiredDirs) {
    const dirPath = path.join(BASE, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`📁 [Auto-Setup] Carpeta creada: ${dir}/`);
    }
  }

  // 2. Ejecutar migraciones de Prisma de forma segura sin congelar el servidor
  try {
    const prismaCli = path.join(BASE, 'node_modules', 'prisma', 'build', 'index.js');
    if (fs.existsSync(prismaCli)) {
      console.log('⚙️  [Auto-Setup] Sincronizando esquema de base de datos...');
      execSync(`node "${prismaCli}" migrate deploy`, {
        cwd: BASE,
        stdio: 'ignore',
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db' }
      });
      console.log('✅ [Auto-Setup] Base de datos sincronizada.');
    }
  } catch (err) {
    console.warn('⚠️  [Auto-Setup] Migración en segundo plano:', err.message);
  }

  // 3. Semilla de ConfigGlobal (valores por defecto)
  try {
    const defaults = [
      { clave: 'admin_path', valor: 'admin-panel' },
      { clave: 'recovery_email', valor: 'pixisinformatica.contacto@gmail.com' },
      { clave: 'total_pedidos_historico', valor: '0' }
    ];
    for (const cfg of defaults) {
      await prisma.configGlobal.upsert({
        where: { clave: cfg.clave },
        update: {},
        create: cfg
      });
    }
    console.log('✅ [Auto-Setup] Configuración global verificada.');
  } catch (err) {
    console.error('⚠️  [Auto-Setup] Error en ConfigGlobal:', err.message);
  }

  // 4. Semilla de Administrador (solo si la tabla está vacía)
  try {
    const count = await prisma.empleadoVentas.count();
    if (count === 0) {
      const email = 'vendedor@pixis.com';
      const password = 'Pixis123!';
      const hash = await bcrypt.hash(password, 10);
      const secret = speakeasy.generateSecret({
        name: `Pixis Informatica (${email})`,
        issuer: 'Pixis Informatica'
      });

      await prisma.empleadoVentas.create({
        data: {
          nombre: 'Vendedor Principal',
          email,
          password_hash: hash,
          totp_secret: secret.base32,
          totp_activado: false,
          activo: true
        }
      });

      console.log('══════════════════════════════════════════════════════');
      console.log('🌱 [Auto-Setup] Administrador creado exitosamente:');
      console.log(`   📧 Email:    ${email}`);
      console.log(`   🔑 Clave:    ${password}`);
      console.log('══════════════════════════════════════════════════════');
    } else {
      console.log(`✅ [Auto-Setup] ${count} empleado(s) existente(s). Semilla omitida.`);
    }
  } catch (err) {
    console.error('⚠️  [Auto-Setup] Error en semilla de admin:', err.message);
  }

  console.log('🟢 [Auto-Setup] Verificación completada.\n');
}

// ── INICIAR SERVIDOR EXPRESS INMEDIATAMENTE (EVITA 504 GATEWAY TIMEOUT EN HOSTINGER) ──
const server = app.listen(PORT, () => {
  console.log('\x1b[95m');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        🟣 PIXIS LIVE EXPRESS — Servidor Activo        ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');
  console.log(`  \x1b[92m✅ Servidor activo en puerto:\x1b[0m ${PORT}`);
  console.log(`  \x1b[96m🌐 URL:\x1b[0m                       http://localhost:${PORT}`);
  console.log();
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\x1b[31m❌ El puerto ${PORT} ya está en uso.\x1b[0m`);
  } else {
    console.error(`\x1b[31m❌ Error de servidor: ${e.message}\x1b[0m`);
  }
});

// Tareas secundarias de inicialización asincrónica sin congelar la respuesta HTTP
(async () => {
  await autoSetup();
  await loadAdminPath();
  await loadSmtpConfig();
  await loadGarantiaEmailConfig();
})().catch(err => console.error('⚠️ Error en tareas secundarias:', err));
