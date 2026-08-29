/**
 * Módulo de envío de correos electrónicos — Pixis Informática
 * Usa nodemailer con SMTP de Gmail (puerto 465, SSL).
 * Variables de entorno: SMTP_USER, SMTP_PASS
 *
 * Todos los errores se capturan y se loguean en consola
 * sin interrumpir el flujo del llamador.
 */

const nodemailer = require('nodemailer');
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 465;
const SMTP_USER = process.env.SMTP_USER || 'pixisinformatica.contacto@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || '';

let transporter = null;
let smtpOverride = null;
let textoGarantiaPersonalizado = null;

const TEXTO_GARANTIA_DEFAULT = `Le comentamos que su producto cuenta con una garantía por un determinado tiempo según indique el ticket. (Sin ticket en mano no se podrá cubrir la garantía pactada, sin excepción alguna). La garantía cubre cualquier falla de fábrica que el producto pueda presentar. (La garantía queda exenta en caso de daños físicos ocasionados por mala manipulación .)
El producto solo será reemplazado de forma inmediata si se encuentra en las mismas condiciones en las que fue enviado o retirado de nuestro local, conservando su empaque o envoltorio original y todo lo que este relacionado al producto.

Asimismo, cabe mencionar que todos los cambios por garantía se realizarán únicamente en nuestro local de Pixis Informática, a fin de corroborar la falla del producto y efectuar el cambio correspondiente. (La garantía no cubre daños en pines de carga rotos por mala manipulación, ni desperfectos ocasionados por el uso indebido del producto.)

Importante: No se aceptan cambios ni devoluciones por errores en la elección del producto, compras realizadas por equivocación o disconformidad del cliente. Se recomienda verificar cuidadosamente la descripción del producto antes de concretar la compra. ☺️`;

// ── Configuración SMTP ──
function setSmtpConfig(config) {
  smtpOverride = config;
  transporter = null;
}

function setTextoGarantia(texto) {
  if (typeof texto === 'string') {
    textoGarantiaPersonalizado = texto.trim();
  }
}

function getTextoGarantia() {
  return textoGarantiaPersonalizado || TEXTO_GARANTIA_DEFAULT;
}

// ── Formateador de fecha seguro (evita Invalid Date) ──
// Acepta objetos Date o strings ISO. Siempre devuelve "DD/MM/YYYY, HH:mm hs"
function formatFechaHora(dateInput) {
  let d;
  if (dateInput instanceof Date) {
    d = dateInput;
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) return 'Fecha no disponible';
  const dia  = String(d.getDate()).padStart(2, '0');
  const mes  = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${anio}, ${hora}:${min} hs`;
}

// ── Bloque visual de Garantía ──
function generarBloqueGarantiaHTML() {
  const rawText = getTextoGarantia();
  const formattedText = rawText.replace(/\n/g, '<br>');
  return `
    <div style="margin-top: 28px; padding: 20px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 12px;">
      <h3 style="color: #c084fc; margin-top: 0; margin-bottom: 12px; font-size: 14px; letter-spacing: 0.5px;">
        🛡️ Política de Garantía y Términos de Compra — Pixis Informática
      </h3>
      <p style="color: #cbd5e1; font-size: 12px; line-height: 1.6; margin: 0;">${formattedText}</p>
    </div>
  `;
}

// ── Resumen completo del pedido (ítems, totales, cupón, pago, entrega) ──
function generarResumenPedidoHTML(order) {
  if (!order) return '';

  const items = Array.isArray(order.items) ? order.items : [];
  const filasItems = items.map(item => {
    const subtotalItem = ((item.precio_unitario_snapshot || 0) * (item.cantidad || 1)).toLocaleString('es-AR');
    const precioUnit   = (item.precio_unitario_snapshot || 0).toLocaleString('es-AR');
    return `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #e0e0e0; font-size: 13px;">${item.nombre_snapshot || 'Producto'}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #aaa; text-align: center; font-size: 13px;">${item.cantidad || 1}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #ccc; text-align: right; font-size: 13px;">$${precioUnit}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #fff; font-weight: 700; text-align: right; font-size: 13px;">$${subtotalItem}</td>
      </tr>`;
  }).join('');

  // Fila de subtotal (antes del descuento)
  let filasDescuento = '';
  if (order.cupon_codigo && order.monto_descuento > 0) {
    const subtotalBruto = (order.subtotal_sin_descuento || order.total + order.monto_descuento).toLocaleString('es-AR');
    const montoDesc     = (order.monto_descuento || 0).toLocaleString('es-AR');
    const etiquetaDesc  = order.cupon_tipo === 'PERCENTAGE'
      ? `Cupón ${order.cupon_codigo} (${order.descuento_porcentaje || ''}% OFF)`
      : `Cupón ${order.cupon_codigo} (descuento fijo)`;

    filasDescuento = `
      <tr>
        <td colspan="3" style="padding: 8px 12px; color: #aaa; font-size: 12px; text-align: right;">Subtotal:</td>
        <td style="padding: 8px 12px; color: #aaa; text-align: right; font-size: 12px;">$${subtotalBruto}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding: 8px 12px; color: #4ade80; font-size: 12px; text-align: right;">🎟️ ${etiquetaDesc}:</td>
        <td style="padding: 8px 12px; color: #4ade80; font-weight: 700; text-align: right; font-size: 12px;">- $${montoDesc}</td>
      </tr>`;
  }

  // Total final
  const totalFinal = (order.total || 0).toLocaleString('es-AR');

  // Forma de pago
  let formaPagoTexto = 'Efectivo';
  if (order.forma_pago === 'transferencia') formaPagoTexto = 'Transferencia bancaria';
  if (order.forma_pago === 'tarjeta') {
    formaPagoTexto = order.cuotas && order.cuotas > 1
      ? `Tarjeta — ${order.cuotas} cuotas`
      : 'Tarjeta (pago único)';
  }

  // Tipo de entrega
  const entregaTexto = (order.forma_pago === 'efectivo' || order.entrega === 'retiro')
    ? '🏪 Cliente Retira en nuestra Sucursal — Pixis Informática'
    : (order.entrega === 'envio'
      ? `📦 Envío a domicilio, Pendiente a Consultar costos de envío.${order.direccion ? ' (' + order.direccion + ')' : ''}`
      : '🏪 Cliente Retira en nuestra Sucursal — Pixis Informática');

  return `
    <div style="margin: 20px 0; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; overflow: hidden;">
      <div style="background: rgba(168, 85, 247, 0.15); padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <strong style="color: #c084fc; font-size: 13px; letter-spacing: 0.5px;">📋 Detalle de tu Pedido #${order.id}</strong>
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: rgba(0,0,0,0.3);">
            <th style="padding: 10px 12px; text-align: left; color: #888; font-size: 11px; font-weight: 600; letter-spacing: 0.5px;">PRODUCTO</th>
            <th style="padding: 10px 12px; text-align: center; color: #888; font-size: 11px; font-weight: 600;">CANT.</th>
            <th style="padding: 10px 12px; text-align: right; color: #888; font-size: 11px; font-weight: 600;">PRECIO U.</th>
            <th style="padding: 10px 12px; text-align: right; color: #888; font-size: 11px; font-weight: 600;">SUBTOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${filasItems}
          ${filasDescuento}
          <tr style="background: rgba(251, 191, 36, 0.08);">
            <td colspan="3" style="padding: 14px 12px; color: #fbbf24; font-weight: 700; font-size: 14px; text-align: right;">TOTAL A ABONAR:</td>
            <td style="padding: 14px 12px; color: #fbbf24; font-weight: 700; font-size: 16px; text-align: right;">$${totalFinal}</td>
          </tr>
        </tbody>
      </table>
      <div style="padding: 12px 16px; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.07); display: flex; flex-direction: column; gap: 6px;">
        <p style="margin: 0; font-size: 12px; color: #ccc;">💳 <strong>Forma de pago:</strong> ${formaPagoTexto}</p>
        <p style="margin: 0; font-size: 12px; color: #ccc;">${entregaTexto}</p>
      </div>
    </div>
  `;
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
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });
  return transporter;
}

// ── Template base HTML ──
function wrapHtml(title, bodyContent) {
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a14; color: #e0e0e0; padding: 40px; border-radius: 16px; max-width: 620px; margin: 0 auto;">
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

// ── Funciones de correo de cuenta ──

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

// ── Funciones de correo de pedidos (reciben el objeto `order` completo) ──

// Pedido creado en el checkout (estado: pendiente_revision)
async function enviarPedidoRegistrado(email, order) {
  const html = wrapHtml('🛒 Pedido Recibido', `
    <p>¡Hola! Recibimos tu pedido con éxito. A continuación encontrás el detalle de tu compra.</p>
    <div style="background: rgba(192, 132, 252, 0.1); border-left: 4px solid #c084fc; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0; color: #c084fc; font-size: 13px;">📋 Estado: <strong>Pendiente de revisión / Carga de comprobante</strong></p>
      <p style="margin: 6px 0 0 0; color: #aaa; font-size: 12px;">Te notificaremos cuando tu comprobante sea aprobado o el pedido cambie de estado.</p>
    </div>
    ${generarResumenPedidoHTML(order)}
    ${generarBloqueGarantiaHTML()}
  `);
  return sendMail(email, `🛒 Pedido #${order.id} recibido — Pixis Informática`, html);
}

// Cliente subió comprobante (notificación de recepción)
async function enviarComprobanteRecibido(email, order) {
  const html = wrapHtml('📎 Comprobante de Pago Recibido', `
    <p>Recibimos tu comprobante de pago. Estamos revisándolo y te avisaremos cuando sea aprobado.</p>
    <div style="background: rgba(192, 132, 252, 0.1); border-left: 4px solid #c084fc; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0; color: #c084fc; font-size: 13px;">📋 Estado: <strong>Comprobante en revisión</strong></p>
    </div>
    ${generarResumenPedidoHTML(order)}
    ${generarBloqueGarantiaHTML()}
  `);
  return sendMail(email, `📎 Comprobante recibido — Pedido #${order.id}`, html);
}

// Pedido aprobado/reservado
async function enviarPedidoReservado(email, order) {
  const html = wrapHtml('✅ Pedido Aprobado y Reservado', `
    <p>¡Excelente! Tu pedido fue aprobado y los productos están reservados a tu nombre.</p>
    ${generarResumenPedidoHTML(order)}
    ${generarBloqueGarantiaHTML()}
  `);
  return sendMail(email, `✅ Pedido #${order.id} aprobado y reservado — Pixis Informática`, html);
}

// Pedido listo para retirar en local
async function enviarPedidoListoParaRetirar(email, order) {
  const html = wrapHtml('📦 Pedido Listo para Retirar', `
    <p>¡Tu pedido está preparado y listo para ser retirado en nuestro local!</p>
    <div style="background: rgba(59, 130, 246, 0.1); border-left: 4px solid #3b82f6; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0; color: #60a5fa; font-weight: 700;">📍 Retiro en local — Pixis Informática</p>
      <p style="margin: 6px 0 0 0; color: #aaa; font-size: 12px;">Recordá presentar tu DNI o número de pedido al momento del retiro.</p>
    </div>
    ${generarResumenPedidoHTML(order)}
    ${generarBloqueGarantiaHTML()}
  `);
  return sendMail(email, `📦 Pedido #${order.id} listo para retirar — Pixis Informática`, html);
}

// Pedido completado / entregado
async function enviarPedidoEntregado(email, order) {
  const html = wrapHtml('🎉 ¡Pedido Entregado!', `
    <p>Tu pedido fue marcado como entregado con éxito. ¡Muchas gracias por tu compra en Pixis Informática!</p>
    <div style="background: rgba(168, 85, 247, 0.1); border-left: 4px solid #c084fc; padding: 12px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0; color: #c084fc; font-size: 13px;">✅ Estado: <strong>Entregado / Completado</strong></p>
      <p style="margin: 6px 0 0 0; color: #aaa; font-size: 12px;">Si tenés alguna consulta, no dudes en contactarnos.</p>
    </div>
    ${generarResumenPedidoHTML(order)}
    ${generarBloqueGarantiaHTML()}
  `);
  return sendMail(email, `🎉 Pedido #${order.id} entregado — Pixis Informática`, html);
}

// Pedido rechazado (por admin) o vencido (por cron)
async function enviarPedidoRechazado(email, order, motivo) {
  const html = wrapHtml('❌ Pedido No Procesado', `
    <p>Lamentablemente tu pedido no pudo ser procesado.</p>
    <div style="background: rgba(248, 113, 113, 0.1); border-left: 4px solid #f87171; padding: 14px 16px; border-radius: 8px; margin: 16px 0;">
      <p style="margin: 0; color: #f87171; font-weight: 700;">Motivo: ${motivo || 'No especificado'}</p>
    </div>
    ${generarResumenPedidoHTML(order)}
    <p style="color: #999; font-size: 13px;">Si creés que es un error, contactanos por WhatsApp o correo.</p>
    ${generarBloqueGarantiaHTML()}
  `);
  return sendMail(email, `❌ Pedido #${order.id} no procesado — Pixis Informática`, html);
}

// ── Notificación interna al admin ──
async function notificarAdminComprobanteNuevo(numeroPedido) {
  const adminEmail = SMTP_USER;
  if (!adminEmail) return false;
  const html = wrapHtml('🔔 Nuevo Comprobante', `
    <p>Se ha subido un nuevo comprobante de pago para el pedido <strong>#${numeroPedido}</strong>.</p>
    <p>Ingresá al panel de administración para revisarlo.</p>
  `);
  return sendMail(adminEmail, `🔔 Nuevo comprobante — Pedido #${numeroPedido}`, html);
}

// ── Correos de seguridad del panel admin ──
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
  enviarPedidoRegistrado,
  enviarComprobanteRecibido,
  enviarPedidoReservado,
  enviarPedidoListoParaRetirar,
  enviarPedidoEntregado,
  enviarPedidoRechazado,
  notificarAdminComprobanteNuevo,
  enviarCodigoReset2FA,
  enviarAlertaLogin,
  setSmtpConfig,
  setTextoGarantia,
  getTextoGarantia
};
