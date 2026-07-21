/**
 * Módulo de envío de correos electrónicos — Pixis Informática
 * Usa nodemailer con SMTP de Gmail (puerto 465, SSL).
 * Variables de entorno: GMAIL_USER, GMAIL_APP_PASSWORD
 * 
 * Todos los errores se capturan y se loguean en consola
 * sin interrumpir el flujo del llamador.
 */

const nodemailer = require('nodemailer');
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 465;
const SMTP_USER = process.env.SMTP_USER || 'pixisinformatica.contacto@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || 'yqvmurocfzytezvg';

let transporter = null;
let smtpOverride = null;

function setSmtpConfig(config) {
  smtpOverride = config;
  transporter = null; // Fuerza la recreación del transporter
}

function getTransporter() {
  if (transporter) return transporter;

  const host = (smtpOverride && smtpOverride.host) || SMTP_HOST;
  const port = (smtpOverride && smtpOverride.port) || SMTP_PORT;
  const user = (smtpOverride && smtpOverride.user) || SMTP_USER;
  const pass = (smtpOverride && smtpOverride.pass) || SMTP_PASS;

  if (!user || !pass) {
    console.warn('⚠️ [MAIL] SMTP no configurado. Los mails no se enviarán.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });
  return transporter;
}

// ── Template base HTML ──
function wrapHtml(title, bodyContent) {
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a14; color: #e0e0e0; padding: 40px; border-radius: 16px; max-width: 600px; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #c084fc; margin: 0;">${title}</h2>
      <div style="height: 2px; background: linear-gradient(90deg, transparent, #c084fc, transparent); margin: 16px 0;"></div>
    </div>
    ${bodyContent}
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #333; text-align: center;">
      <p style="color: #666; font-size: 12px; margin: 0;">Pixis Informática — No respondas a este correo.</p>
    </div>
  </div>`;
}

async function sendMail(to, subject, html) {
  const t = getTransporter();
  if (!t) {
    console.log(`📧 [MAIL SIMULADO] Para: ${to} | Asunto: ${subject}`);
    return false;
  }
  try {
    await t.sendMail({
      from: `"Pixis Informática" <${SMTP_USER}>`,
      to,
      subject,
      html
    });
    const now = new Date().toLocaleTimeString('es-AR');
    console.log(`  \x1b[32m📧 [${now}] Mail enviado a ${to}: ${subject}\x1b[0m`);
    return true;
  } catch (err) {
    console.error(`  \x1b[31m❌ [MAIL] Error enviando a ${to}: ${err.message}\x1b[0m`);
    return false;
  }
}

// ── Funciones de correo específicas ──

async function enviarCodigoRecuperacion(email, codigo) {
  const html = wrapHtml('🔐 Código de Recuperación', `
    <p>Se ha solicitado un código para restablecer tu contraseña.</p>
    <div style="text-align: center; margin: 24px 0;">
      <div style="display: inline-block; font-size: 32px; font-weight: bold; background: #1a1a2e; padding: 16px 32px; border-radius: 12px; color: #fbbf24; letter-spacing: 6px; border: 1px solid #333;">
        ${codigo}
      </div>
    </div>
    <p style="color: #999; font-size: 13px;">Este código expira en 10 minutos. Si no solicitaste este cambio, ignorá este correo.</p>
  `);
  return sendMail(email, '🔐 Código de Recuperación — Pixis Informática', html);
}

async function enviarCodigoVerificacion(email, codigo) {
  const html = wrapHtml('📧 Activa tu Cuenta', `
    <p>¡Gracias por registrarte en Pixis Informática!</p>
    <p>Ingresá el siguiente código de 6 dígitos para verificar tu dirección de correo electrónico:</p>
    <div style="text-align: center; margin: 24px 0;">
      <div style="display: inline-block; font-size: 32px; font-weight: bold; background: #1a1a2e; padding: 16px 32px; border-radius: 12px; color: #4ade80; letter-spacing: 6px; border: 1px solid #333;">
        ${codigo}
      </div>
    </div>
    <p style="color: #999; font-size: 13px;">Este código expira en 24 horas. Si no registraste esta cuenta, ignorá este correo.</p>
  `);
  return sendMail(email, '📧 Código de Verificación — Pixis Informática', html);
}

async function enviarComprobanteRecibido(email, numeroPedido) {
  const html = wrapHtml('📎 Comprobante Recibido', `
    <p>Recibimos tu comprobante de pago para el pedido <strong>#${numeroPedido}</strong>.</p>
    <p>Estamos revisándolo. Te notificaremos cuando sea aprobado.</p>
    <div style="background: #1a1a2e; padding: 16px; border-radius: 8px; margin-top: 16px;">
      <p style="margin: 0; color: #c084fc;">Estado actual: <strong>En revisión</strong></p>
    </div>
  `);
  return sendMail(email, `📎 Comprobante recibido — Pedido #${numeroPedido}`, html);
}

async function enviarPedidoReservado(email, numeroPedido, fechaLimite) {
  const fechaFormateada = new Date(fechaLimite).toLocaleString('es-AR', {
    dateStyle: 'long',
    timeStyle: 'short'
  });
  const html = wrapHtml('✅ Pedido Reservado', `
    <p>¡Tu pedido <strong>#${numeroPedido}</strong> fue aprobado y los productos están reservados!</p>
    <div style="background: #1a2e1a; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #4ade80;">
      <p style="margin: 0; color: #4ade80;">📦 Reservado hasta: <strong>${fechaFormateada}</strong></p>
    </div>
    <p style="color: #999; font-size: 13px;">Si no retirás o coordinás la entrega antes de esa fecha, la reserva se liberará automáticamente.</p>
  `);
  return sendMail(email, `✅ Pedido #${numeroPedido} reservado — Pixis Informática`, html);
}

async function enviarPedidoEntregado(email, numeroPedido) {
  const html = wrapHtml('🎉 Pedido Entregado', `
    <p>Tu pedido <strong>#${numeroPedido}</strong> fue marcado como entregado.</p>
    <p>¡Gracias por tu compra! Esperamos que disfrutes tus productos.</p>
    <div style="background: #1a1a2e; padding: 16px; border-radius: 8px; margin-top: 16px;">
      <p style="margin: 0; color: #c084fc;">Si tenés algún inconveniente, no dudes en contactarnos.</p>
    </div>
  `);
  return sendMail(email, `🎉 Pedido #${numeroPedido} entregado — Pixis Informática`, html);
}

async function enviarPedidoRechazado(email, numeroPedido, motivo) {
  const html = wrapHtml('❌ Pedido Rechazado', `
    <p>Lamentablemente, tu pedido <strong>#${numeroPedido}</strong> no pudo ser procesado.</p>
    <div style="background: #2e1a1a; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #f87171;">
      <p style="margin: 0; color: #f87171;">Motivo: <strong>${motivo || 'No especificado'}</strong></p>
    </div>
    <p style="color: #999; font-size: 13px;">Si creés que es un error, contactanos por WhatsApp o correo.</p>
  `);
  return sendMail(email, `❌ Pedido #${numeroPedido} rechazado — Pixis Informática`, html);
}

async function notificarAdminComprobanteNuevo(numeroPedido) {
  const adminEmail = GMAIL_USER;
  if (!adminEmail) return false;
  const html = wrapHtml('🔔 Nuevo Comprobante', `
    <p>Se ha subido un nuevo comprobante de pago para el pedido <strong>#${numeroPedido}</strong>.</p>
    <p>Ingresá al panel de administración para revisarlo.</p>
  `);
  return sendMail(adminEmail, `🔔 Nuevo comprobante — Pedido #${numeroPedido}`, html);
}

async function enviarCodigoReset2FA(email, codigo) {
  const html = wrapHtml('⚠️ Restablecimiento de 2FA', `
    <p>Se ha solicitado un código para restablecer la verificación en dos pasos (2FA) de tu cuenta de administración de Pixis.</p>
    <div style="text-align: center; margin: 24px 0;">
      <div style="display: inline-block; font-size: 32px; font-weight: bold; background: #1a1a2e; padding: 16px 32px; border-radius: 12px; color: #fbbf24; letter-spacing: 6px; border: 1px solid #333;">
        ${codigo}
      </div>
    </div>
    <p style="color: #999; font-size: 13px;">Este código expira en 10 minutos. Si no solicitaste este cambio, ignorá este correo.</p>
  `);
  return sendMail(email, '⚠️ Restablecimiento de 2FA — Pixis Informática', html);
}

async function enviarAlertaLogin(email, { fecha, ip, userAgent }) {
  const html = wrapHtml('🔔 Inicio de Sesión Detectado', `
    <p>Se ha iniciado sesión en el Panel de Ventas de Pixis Informática.</p>
    <div style="background: #1a1a2e; padding: 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 4px 0; color: #ccc;">📅 <strong>Fecha:</strong> ${fecha}</p>
      <p style="margin: 4px 0; color: #ccc;">🌐 <strong>IP:</strong> ${ip}</p>
      <p style="margin: 4px 0; color: #ccc;">💻 <strong>Dispositivo:</strong> ${userAgent}</p>
    </div>
    <p style="color: #f87171; font-size: 13px;">Si no fuiste vos, cambiá tu contraseña inmediatamente.</p>
  `);
  return sendMail(email, '🔔 Nuevo inicio de sesión — Panel Pixis', html);
}

module.exports = {
  enviarCodigoRecuperacion,
  enviarCodigoVerificacion,
  enviarComprobanteRecibido,
  enviarPedidoReservado,
  enviarPedidoEntregado,
  enviarPedidoRechazado,
  notificarAdminComprobanteNuevo,
  enviarCodigoReset2FA,
  enviarAlertaLogin,
  setSmtpConfig
};
