let currentTab = 'pendiente_revision';
let ordersList = [];
let currentMainTab = 'pedidos';

// Al cargar la página
window.addEventListener('DOMContentLoaded', async () => {
  loadTheme();
  const isLoggedIn = await checkSession();
  const authScreen = document.getElementById('authCheckingScreen');
  if (authScreen) authScreen.style.display = 'none';
  if (isLoggedIn) {
    showPanel();
  } else {
    showLogin();
  }
});

async function checkSession() {
  // Si la pestaña/navegador se cerró, sessionStorage estará vacío → obliga a loguearse
  if (!sessionStorage.getItem('pixis_admin_active')) {
    return false;
  }
  try {
    const res = await fetch('/api/admin/orders?estado=pendiente_revision');
    return res.status === 200;
  } catch (e) {
    return false;
  }
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminPanel').style.display = 'none';
}

function showPanel() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminPanel').style.display = 'block';
  loadOrders();
  loadStats();
  setInterval(loadStats, 15000);
}

// ── FLUX DE AUTENTICACIÓN ──
let currentTempToken = null;

async function handleAdminLogin(e) {
  e.preventDefault();
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  const errorBox = document.getElementById('loginErrorMsg');

  errorBox.style.display = 'none';
  
  const btn = document.getElementById('btnLoginNext');
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    btn.disabled = false;
    btn.textContent = 'Continuar';

    if (!res.ok) {
      errorBox.textContent = data.error || 'Error al iniciar sesión.';
      errorBox.style.display = 'block';
      return;
    }

    currentTempToken = data.tempToken;

    if (!data.totp_activado && data.qr) {
      document.getElementById('qrImage').src = data.qr;
      document.getElementById('qrContainer').style.display = 'block';
    } else {
      document.getElementById('qrContainer').style.display = 'none';
    }

    document.getElementById('formAdminLogin').style.display = 'none';
    document.getElementById('formAdmin2FA').style.display = 'block';
    document.getElementById('adminOTP').focus();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Continuar';
    errorBox.textContent = 'Error de conexión con el servidor.';
    errorBox.style.display = 'block';
  }
}

async function handleAdmin2FA(e) {
  e.preventDefault();
  const token = document.getElementById('adminOTP').value.trim();
  const errorBox = document.getElementById('loginErrorMsg');
  
  errorBox.style.display = 'none';
  
  const btn = document.getElementById('btnLoginSubmit');
  btn.disabled = true;
  btn.textContent = 'Validando OTP...';

  try {
    const res = await fetch('/admin/login/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: currentTempToken,
        codigo: token
      })
    });
    const data = await res.json();

    btn.disabled = false;
    btn.textContent = 'Verificar y Entrar';

    if (!res.ok) {
      errorBox.textContent = data.error || 'Código OTP inválido.';
      errorBox.style.display = 'block';
      return;
    }

    sessionStorage.setItem('pixis_admin_active', 'true');
    document.getElementById('loggedInUser').textContent = document.getElementById('adminEmail').value.trim();
    showPanel();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Verificar y Entrar';
    errorBox.textContent = 'Error al verificar el token de seguridad.';
    errorBox.style.display = 'block';
  }
}

function backToStep1() {
  document.getElementById('formAdmin2FA').style.display = 'none';
  document.getElementById('formAdminLogin').style.display = 'block';
  document.getElementById('loginErrorMsg').style.display = 'none';
}

async function handleLogout() {
  try {
    await fetch('/admin/logout', { method: 'POST' });
  } catch (err) {
    console.error('Error al cerrar sesión en el servidor:', err);
  }
  sessionStorage.removeItem('pixis_admin_active');
  document.cookie = 'admin_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
  showLogin();
  location.reload();
}

// ── RECUPERACIÓN DE CLAVE / 2FA (MODAL) ──
function open2FARecoveryModal(mode) {
  const modalMode = mode || 'pass';
  const modeInput = document.getElementById('recoveryMode');
  if (modeInput) modeInput.value = modalMode;

  const titleEl = document.getElementById('recoveryModalTitle');
  const descEl = document.getElementById('recoveryModalDesc');
  const passGroup = document.getElementById('groupRecoveryNewPass');
  const submitBtn = document.getElementById('btnSubmitConfirmRecovery');

  if (modalMode === 'pass') {
    if (titleEl) titleEl.textContent = '🔑 Recuperar Contraseña / Acceso';
    if (descEl) descEl.textContent = 'Ingresá tu correo de administración. Se enviará un código de seguridad de 6 dígitos a tu correo seguro de recuperación para definir una nueva contraseña.';
    if (passGroup) passGroup.style.display = 'block';
    if (submitBtn) submitBtn.textContent = 'Guardar y Restablecer Clave';
  } else {
    if (titleEl) titleEl.textContent = '🛡️ Restablecer Seguridad 2FA';
    if (descEl) descEl.textContent = 'Ingresá tu correo de administración. Se enviará un código de restablecimiento al correo seguro de recuperación para re-vincular tu 2FA.';
    if (passGroup) passGroup.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Restablecer 2FA';
  }

  // Pre-poblar email de login si fue escrito
  const adminEmailVal = document.getElementById('adminEmail')?.value.trim();
  if (adminEmailVal && document.getElementById('recoveryEmail')) {
    document.getElementById('recoveryEmail').value = adminEmailVal;
  }

  document.getElementById('modalRecovery').style.display = 'flex';
  document.getElementById('recoveryErrorMsg').style.display = 'none';
  document.getElementById('recoverySuccessMsg').style.display = 'none';
  document.getElementById('formRequestRecovery').style.display = 'block';
  document.getElementById('formConfirmRecovery').style.display = 'none';
}

function close2FARecoveryModal() {
  document.getElementById('modalRecovery').style.display = 'none';
}

async function requestRecovery2FA(e) {
  e.preventDefault();
  const email = document.getElementById('recoveryEmail').value.trim();
  const errorBox = document.getElementById('recoveryErrorMsg');
  const successBox = document.getElementById('recoverySuccessMsg');
  
  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  try {
    const res = await fetch('/api/admin/recovery/request-reset-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || 'Error al solicitar código.';
      errorBox.style.display = 'block';
      return;
    }

    successBox.textContent = data.message;
    successBox.style.display = 'block';
    
    // Pasar a confirmación
    document.getElementById('formRequestRecovery').style.display = 'none';
    document.getElementById('formConfirmRecovery').style.display = 'block';
  } catch (err) {
    errorBox.textContent = 'Error de red al solicitar el código.';
    errorBox.style.display = 'block';
  }
}

async function confirmRecovery2FA(e) {
  e.preventDefault();
  const email = document.getElementById('recoveryEmail').value.trim();
  const codigo = document.getElementById('recoveryCode').value.trim();
  const mode = document.getElementById('recoveryMode')?.value || 'pass';
  const newPassword = document.getElementById('recoveryNewPassword')?.value || '';

  const errorBox = document.getElementById('recoveryErrorMsg');
  const successBox = document.getElementById('recoverySuccessMsg');

  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  if (mode === 'pass' && (!newPassword || newPassword.trim().length < 8)) {
    errorBox.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.';
    errorBox.style.display = 'block';
    return;
  }

  try {
    const endpoint = mode === 'pass' 
      ? '/api/admin/recovery/reset-password-with-code' 
      : '/api/admin/recovery/confirm-reset-2fa';

    const payload = mode === 'pass'
      ? { email, codigo, new_password: newPassword }
      : { email, codigo };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      errorBox.textContent = data.error || 'Código de recuperación inválido o vencido.';
      errorBox.style.display = 'block';
      return;
    }

    alert(data.message || '¡Operación realizada con éxito!');
    close2FARecoveryModal();
    backToStep1();
  } catch (err) {
    console.error('Error al confirmar recuperación:', err);
    errorBox.textContent = err.message || 'Error al comunicarse con el servidor. Inténtalo de nuevo.';
    errorBox.style.display = 'block';
  }
}

// ── CARGA Y RENDERIZADO DE PEDIDOS ──
async function loadOrders() {
  const container = document.getElementById('ordersContainer');
  container.innerHTML = '<div class="loading-state">Cargando pedidos...</div>';

  try {
    const res = await fetch('/api/admin/orders');
    if (!res.ok) throw new Error();
    const data = await res.json();

    ordersList = data.orders || [];
    updateMetrics();
    renderOrders();
  } catch (e) {
    container.innerHTML = '<div class="empty-state">❌ Error de red al cargar los pedidos. Asegúrate de estar logueado.</div>';
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.ok) {
      const metricTotal = document.getElementById('metricTotalHistorico');
      if (metricTotal) metricTotal.textContent = data.total_pedidos_historico;
      const metricClientes = document.getElementById('metricClientes');
      if (metricClientes) metricClientes.textContent = data.total_clientes;
      const metricClientesOnline = document.getElementById('metricClientesOnline');
      if (metricClientesOnline) metricClientesOnline.textContent = data.total_online;
      const metricVisitas = document.getElementById('metricVisitasHoy');
      if (metricVisitas) metricVisitas.textContent = data.visitas_hoy !== undefined ? data.visitas_hoy : 0;
    }
  } catch (e) {
    // ignorar silenciosamente
  }
}

window.confirmarResetearTotalPedidos = async function() {
  if (!confirm('⚠️ ¿Estás seguro de que deseas resetear el contador acumulado de Total Pedidos Web a 0?')) {
    return;
  }
  try {
    const res = await fetch('/api/admin/settings/reset-total-pedidos', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.ok) {
      alert('✅ ' + (data.message || 'Contador de Total Pedidos Web reseteado a 0 exitosamente.'));
      if (typeof loadStats === 'function') loadStats();
    } else {
      alert('❌ ' + (data.error || 'Error al resetear el contador.'));
    }
  } catch (e) {
    console.error('Error al resetear total pedidos:', e);
    alert('❌ Error de conexión con el servidor.');
  }
};

function updateMetrics() {
  const pendientes = ordersList.filter(o => o.estado === 'pendiente_revision').length;
  const reservados = ordersList.filter(o => o.estado === 'reservado').length;
  const completados = ordersList.filter(o => o.estado === 'completado').length;

  document.getElementById('metricPendientes').textContent = pendientes;
  document.getElementById('metricReservados').textContent = reservados;
  document.getElementById('metricCompletados').textContent = completados;
}

function filterByTab(tab) {
  currentTab = tab;
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`tab-${tab}`);
  if (activeBtn) activeBtn.classList.add('active');

  renderOrders();
}

function renderOrders() {
  const container = document.getElementById('ordersContainer');
  const searchTerm = (document.getElementById('orderSearch')?.value || '').trim().toLowerCase();
  let filtered = ordersList.filter(o => o.estado === currentTab);

  if (searchTerm) {
    filtered = filtered.filter(o =>
      String(o.id).includes(searchTerm) ||
      (o.usuario?.nombre || '').toLowerCase().includes(searchTerm) ||
      (o.usuario?.email || '').toLowerCase().includes(searchTerm)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">No hay pedidos registrados en esta pestaña (${currentTab.replace('_', ' ')}).</div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(order => {
    const dateStr = new Date(order.creado_en).toLocaleString('es-AR');
    
    let comprobantesHtml = '';
    if (order.comprobantes && order.comprobantes.length > 0) {
      comprobantesHtml = `
        <div class="comprobante-preview">
          <h4>💳 Comprobante de Transferencia Informado por el Cliente:</h4>
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
            ${order.comprobantes.map(c => {
              const ext = (c.archivo_url || '').split('.').pop().toUpperCase();
              const isPdf = ext === 'PDF';
              const icon = isPdf ? '📄' : '🖼️';
              const signoMoneda = c.moneda === 'USD' ? 'US$' : '$';
              const montoFmt = c.monto_transferido != null
                ? signoMoneda + ' ' + Number(c.monto_transferido).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : 'No informado';
              return `
                <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(168,85,247,0.3); border-radius: 8px; padding: 10px 14px;">
                  <div style="font-size: 0.85rem; color: #e0e0ff; line-height: 1.7; margin-bottom: 8px;">
                    💵 <strong>Monto Transferido:</strong> <span style="color:#38bdf8; font-weight:700;">${montoFmt}</span>${c.moneda ? ' <span style="background:rgba(56,189,248,0.15); padding:1px 6px; border-radius:4px; font-size:0.75rem; color:#38bdf8; font-weight:600;">' + c.moneda + '</span>' : ''}<br>
                    👤 <strong>Titular:</strong> ${c.titular_nombre || 'No informado'}<br>
                    🆔 <strong>DNI/CUIT:</strong> ${c.titular_cuit || 'No informado'}<br>
                    🔢 <strong>N° Comprobante:</strong> ${c.numero_comprobante || 'No informado'}
                  </div>
                  <a href="${c.archivo_url}" target="_blank" class="comprobante-link" title="Abrir comprobante de pago en pestaña nueva">
                    ${icon} VER COMPROBANTE ADJUNTO (${ext})
                  </a>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else {
      comprobantesHtml = `
        <div style="margin-top: 10px; padding: 8px 12px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); border-radius: 8px;">
          <p style="font-size: 0.82rem; color: #f87171; font-weight: 700; margin: 0;">⚠️ Sin comprobante de pago subido aún por el cliente.</p>
        </div>
      `;
    }

    const btnExportarPxGres = `<button class="btn-action" onclick="exportarReservaPxGres(${order.id})" style="background: linear-gradient(135deg, #a855f7, #6366f1); color: #fff; border: 1px solid rgba(168,85,247,0.5); font-weight: 700; box-shadow: 0 0 10px rgba(168,85,247,0.3);" title="Exportar archivo .pxgres para Maestro POS">📥 Exportar Reserva (.pxgres)</button>`;

    let actionsHtml = '';
    if (order.estado === 'pendiente_revision') {
      actionsHtml = `
        ${btnExportarPxGres}
        <button class="btn-action btn-action-confirm" onclick="confirmOrder(${order.id})">Confirmar y Reservar Stock</button>
        <button class="btn-action btn-action-reject" onclick="openRejectModal(${order.id})">Rechazar</button>
      `;
    } else if (order.estado === 'reservado') {
      const compSinRevisar = order.forma_pago === 'transferencia'
        && order.comprobantes && order.comprobantes.some(c => !c.revisado_en);
      const btnConfirmarPago = compSinRevisar
        ? `<button class="btn-action btn-action-confirm" onclick="confirmOrder(${order.id})">✅ Confirmar Pago Transferencia</button>`
        : '';
      actionsHtml = `
        ${btnExportarPxGres}
        ${btnConfirmarPago}
        <button class="btn-action btn-action-complete" onclick="completeOrder(${order.id})">Entregar / Completar</button>
        <button class="btn-action btn-action-reject" onclick="openRejectModal(${order.id})">Rechazar</button>
      `;
    } else {
      actionsHtml = `${btnExportarPxGres}`;
    }

    const itemsRows = order.items.map(item => `
      <div class="item-row">
        <span>${item.nombre_snapshot} <strong>x${item.cantidad}</strong></span>
        <span>$${(item.precio_unitario_snapshot * item.cantidad).toLocaleString('es-AR')}</span>
      </div>
    `).join('');

    const cardHtml = `
      <div class="order-header">
        <div class="order-title">
          <span class="order-id">Pedido #${order.id}</span>
          <span class="order-date">${dateStr}</span>
        </div>
        <span class="status-badge status-${order.estado}">${order.estado.replace('_', ' ')}</span>
      </div>
      
      <div class="order-grid">
        <div class="customer-info">
          <h4>Datos del Cliente:</h4>
          <div class="info-item"><span>Nombre:</span> ${order.usuario?.nombre || '—'}</div>
          <div class="info-item"><span>Email:</span> ${order.usuario?.email || '—'}</div>
          <div class="info-item"><span>Celular:</span> ${order.usuario?.telefono ? `<a href="https://wa.me/${order.usuario.telefono.replace(/\+/g, '')}" target="_blank">${order.usuario.telefono} (Chat)</a>` : '—'}</div>
        </div>
        
        <div class="order-meta">
          <h4>Detalles de Entrega y Pago:</h4>
          <div class="info-item"><span>Entrega:</span> ${(order.forma_pago === 'efectivo' || order.entrega === 'retiro') ? 'Cliente Retira en nuestra Sucursal' : (order.entrega === 'envio' ? 'Envío a domicilio, Pendiente a Consultar costos de envío.' : (order.entrega || '—'))}</div>
          ${order.direccion ? `<div class="info-item"><span>Dirección:</span> ${order.direccion}</div>` : ''}
          <div class="info-item"><span>Provincia:</span> ${order.usuario?.provincia || '—'}</div>
          <div class="info-item"><span>Localidad:</span> ${order.usuario?.localidad || '—'}</div>
          <div class="info-item"><span>Código Postal:</span> ${order.usuario?.codigo_postal || '—'}</div>
          <div class="info-item"><span>Medio de Pago:</span> ${order.forma_pago.toUpperCase()} ${order.cuotas ? `(${order.cuotas} cuotas)` : ''}</div>
          ${order.cupon_codigo ? `
            <div class="info-item" style="background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); padding: 6px 10px; border-radius: 6px; margin-top: 6px; color: #e0b8ff;">
              🎟️ <strong>Cupón Aplicado:</strong> <span style="color:#fff; font-weight:700;">${order.cupon_codigo}</span> 
              ${order.monto_descuento ? `<span style="color:#4ade80; font-weight:700; margin-left:4px;">(-$${order.monto_descuento.toLocaleString('es-AR')})</span>` : ''}
              ${order.subtotal_sin_descuento ? `<div style="font-size:0.75rem; color:#aaa; margin-top:2px;">Subtotal original: $${order.subtotal_sin_descuento.toLocaleString('es-AR')}</div>` : ''}
            </div>
          ` : ''}
          <div class="info-item" style="font-size: 1rem; margin-top: 8px;"><strong>Total Final:</strong> <span style="color: var(--gold); font-weight: bold;">$${order.total.toLocaleString('es-AR')}</span></div>
        </div>
      </div>

      <div class="items-list">
        <h4>Productos:</h4>
        ${itemsRows}
      </div>

      ${comprobantesHtml}

      ${actionsHtml ? `<div class="order-actions" style="margin-top: 15px;">${actionsHtml}</div>` : ''}
    `;

    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = cardHtml;
    container.appendChild(card);
  });
}

function buscarPedidos() {
  clearTimeout(buscarPedidos._timer);
  buscarPedidos._timer = setTimeout(renderOrders, 200);
}

// ── ACCIONES ──
async function confirmOrder(id) {
  if (!confirm(`¿Estás seguro de confirmar el Pedido #${id} y reservar su stock?`)) return;

  try {
    const res = await fetch(`/api/admin/orders/${id}/confirm`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('🎉 Pedido confirmado con éxito. Notificaciones enviadas por email.');
    loadOrders();
  } catch (err) {
    alert('❌ Error al confirmar pedido: ' + err.message);
  }
}

async function completeOrder(id) {
  if (!confirm(`¿Estás seguro de marcar el Pedido #${id} como COMPLETADO y entregado?`)) return;

  try {
    const res = await fetch(`/api/admin/orders/${id}/complete`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('✅ Pedido completado correctamente.');
    loadOrders();
  } catch (err) {
    alert('❌ Error al completar pedido: ' + err.message);
  }
}

function openRejectModal(id) {
  document.getElementById('rejectOrderId').value = id;
  document.getElementById('rejectReason').value = '';
  document.getElementById('modalReject').style.display = 'flex';
}

function closeRejectModal() {
  document.getElementById('modalReject').style.display = 'none';
}

async function submitReject(e) {
  e.preventDefault();
  const id = document.getElementById('rejectOrderId').value;
  const motivo = document.getElementById('rejectReason').value.trim();

  const btn = document.getElementById('btnConfirmReject');
  btn.disabled = true;
  btn.textContent = 'Procesando rechazo...';

  try {
    const res = await fetch(`/api/admin/orders/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo })
    });
    const data = await res.json();

    btn.disabled = false;
    btn.textContent = 'Rechazar Pedido';

    if (!res.ok) throw new Error(data.error);

    alert(`Pedido #${id} rechazado con éxito.`);
    closeRejectModal();
    loadOrders();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Rechazar Pedido';
    alert('❌ Error al rechazar pedido: ' + err.message);
  }
}

// ── BARRERA DE SEGURIDAD 2FA PARA AJUSTES (GATEKEEPER) ──
let ajustesUnlocked = false;

function switchMainTab(tab) {
  currentMainTab = tab;
  const seccionPedidos  = document.getElementById('seccionPedidos');
  const seccionClientes = document.getElementById('seccionClientes');
  const seccionAjustes  = document.getElementById('seccionAjustes');
  const seccionCupones  = document.getElementById('seccionCupones');
  
  const btnPedidos  = document.getElementById('mainTab-pedidos');
  const btnClientes = document.getElementById('mainTab-clientes');
  const btnAjustes  = document.getElementById('mainTab-ajustes');
  const btnCupones  = document.getElementById('mainTab-cupones');
  const btnReset    = document.getElementById('btnResetTotalPedidos');

  // Control de visibilidad inteligente del botón Cupones (Solo visible si Ajustes está desbloqueado por 2FA)
  if (btnCupones) {
    if (ajustesUnlocked) {
      btnCupones.style.display = 'inline-flex';
    } else {
      btnCupones.style.display = 'none';
    }
  }

  // Control de visibilidad inteligente del botón Reset Total Pedidos (Solo visible si estamos DENTRO de la pestaña Ajustes)
  const btnFavicon = document.getElementById('btnFaviconModal');
  if (btnReset) {
    if (tab === 'ajustes' && ajustesUnlocked) {
      btnReset.style.display = 'inline-flex';
    } else {
      btnReset.style.display = 'none';
    }
  }
  if (btnFavicon) {
    if (tab === 'ajustes' && ajustesUnlocked) {
      btnFavicon.style.display = 'inline-flex';
    } else {
      btnFavicon.style.display = 'none';
    }
  }

  // Ocultar todo por defecto
  seccionPedidos.style.display  = 'none';
  seccionClientes.style.display = 'none';
  seccionAjustes.style.display  = 'none';
  if (seccionCupones) seccionCupones.style.display = 'none';
  
  btnPedidos.classList.remove('active');
  btnClientes.classList.remove('active');
  btnAjustes.classList.remove('active');
  if (btnCupones) btnCupones.classList.remove('active');

  if (tab === 'clientes') {
    seccionClientes.style.display = 'block';
    btnClientes.classList.add('active');
    loadClientes(1);
  } else if (tab === 'ajustes') {
    if (!ajustesUnlocked) {
      document.getElementById('unlockErrorMsg').style.display = 'none';
      document.getElementById('otpUnlockInput').value = '';
      document.getElementById('modal2FAGate').style.display = 'flex';
      setTimeout(() => document.getElementById('otpUnlockInput')?.focus(), 100);
      return;
    }
    seccionAjustes.style.display = 'block';
    btnAjustes.classList.add('active');
    document.getElementById('ajustesErrorMsg').style.display = 'none';
    document.getElementById('ajustesSuccessMsg').style.display = 'none';
    previewNewPath();
    loadAdminSettings();
  } else if (tab === 'cupones') {
    if (!ajustesUnlocked) {
      switchMainTab('ajustes');
      return;
    }
    if (seccionCupones) seccionCupones.style.display = 'block';
    if (btnCupones) btnCupones.classList.add('active');
    cargarCuponesAdmin();
  } else {
    seccionPedidos.style.display = 'block';
    btnPedidos.classList.add('active');
    loadOrders();
  }
}

// ── FUNCIONES DE DESBLOQUEO Y BLOQUEO 2FA DE AJUSTES ──
window.ejecutarDesbloqueoAjustes = async function(event) {
  event.preventDefault();
  const otpInput = document.getElementById('otpUnlockInput');
  const errorBox = document.getElementById('unlockErrorMsg');
  const btn = document.getElementById('btnSubmitUnlock');
  
  const otp_code = (otpInput?.value || '').trim();
  errorBox.style.display = 'none';

  if (!otp_code) {
    errorBox.textContent = 'Por favor ingresá el código de 6 dígitos.';
    errorBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    const res = await fetch('/api/admin/2fa/verify-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_code })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || 'Código 2FA incorrecto.';
      errorBox.style.display = 'block';
      otpInput.value = '';
      otpInput.focus();
      btn.disabled = false;
      btn.textContent = 'Desbloquear 🔓';
      return;
    }

    // Código correcto: marcar ajustesUnlocked = true y abrir pestaña Ajustes
    ajustesUnlocked = true;
    document.getElementById('modal2FAGate').style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Desbloquear 🔓';

    // Abrir Ajustes de inmediato
    switchMainTab('ajustes');
  } catch (e) {
    console.error('Error al desbloquear Ajustes:', e);
    errorBox.textContent = 'Error de conexión al verificar el 2FA.';
    errorBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Desbloquear 🔓';
  }
};

window.cancelarDesbloqueoAjustes = function() {
  document.getElementById('modal2FAGate').style.display = 'none';
  // Volver a la pestaña de Pedidos
  switchMainTab('pedidos');
};

window.bloquearAjustes = function() {
  ajustesUnlocked = false;
  document.getElementById('seccionAjustes').style.display = 'none';
  const seccionCupones = document.getElementById('seccionCupones');
  if (seccionCupones) seccionCupones.style.display = 'none';
  const btnCupones = document.getElementById('mainTab-cupones');
  if (btnCupones) btnCupones.style.display = 'none';
  switchMainTab('pedidos');
};

// ── SOLICITAR PIN DE EMERGENCIA POR EMAIL PARA DESBLOQUEAR AJUSTES ──
window.solicitarPinEmergenciaGatekeeper = async function() {
  const btn = document.getElementById('btnRequestGatePin');
  const msgBox = document.getElementById('gateEmergencyMsg');
  
  if (!btn || !msgBox) return;

  btn.disabled = true;
  btn.textContent = '⏳ Enviando...';
  msgBox.style.display = 'none';

  try {
    const res = await fetch('/api/admin/recovery/request-gate-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      msgBox.style.display = 'block';
      msgBox.style.background = 'rgba(0, 230, 118, 0.1)';
      msgBox.style.border = '1px solid #00e676';
      msgBox.style.color = '#00e676';
      msgBox.innerHTML = '✅ ' + data.message + '<br><span style="font-size:0.75rem; color:#ccc; margin-top:4px; display:block;">Ingresá el código recibido en la casilla de arriba y presioná Desbloquear 🔓</span>';
      // Focus en la casilla OTP para que ingrese el PIN recibido
      const otpInput = document.getElementById('otpUnlockInput');
      if (otpInput) { otpInput.value = ''; otpInput.focus(); }
    } else {
      msgBox.style.display = 'block';
      msgBox.style.background = 'rgba(248, 113, 113, 0.1)';
      msgBox.style.border = '1px solid #f87171';
      msgBox.style.color = '#f87171';
      msgBox.textContent = '❌ ' + (data.error || 'Error al solicitar el código.');
    }
  } catch (e) {
    console.error('Error al solicitar PIN de emergencia:', e);
    msgBox.style.display = 'block';
    msgBox.style.background = 'rgba(248, 113, 113, 0.1)';
    msgBox.style.border = '1px solid #f87171';
    msgBox.style.color = '#f87171';
    msgBox.textContent = '❌ Error de conexión. Intentá de nuevo.';
  }

  btn.disabled = false;
  btn.textContent = '📧 ¿Perdiste tu 2FA? Enviar código de emergencia a mi email';
};

// ── LIMPIAR PEDIDOS DE PRUEBA ──
async function limpiarPedidosDePrueba() {
  if (!confirm('⚠️ ATENCIÓN: Se eliminarán de forma permanente todos los pedidos de la base de datos para limpiar el historial de pruebas.\n\n¿Estás seguro de que deseas proceder?')) {
    return;
  }

  try {
    const res = await fetch('/api/admin/orders/purge-test', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`❌ Error: ${data.error || 'No se pudieron eliminar los pedidos.'}`);
      return;
    }

    alert(`✅ ${data.message || 'Se limpiaron los pedidos de prueba correctamente.'}`);
    loadOrders();
    loadStats();
  } catch (e) {
    console.error('Error al limpiar pedidos:', e);
    alert('❌ Error de conexión al limpiar pedidos.');
  }
}

// ── SECCIÓN CLIENTES CON PAGINACIÓN Y MARCADOR ACTIVO ──
let clientesList = [];
let currentClientesPage = 1;

async function loadClientes(page = 1) {
  currentClientesPage = page;
  const container = document.getElementById('clientesContainer');
  if (!container) return;
  container.innerHTML = '<div class="loading-state">Cargando clientes...</div>';

  const q               = (document.getElementById('clienteSearch')?.value || '').trim();
  const aceptaMarketing = document.getElementById('clienteMarketingFilter')?.value || '';
  const params          = new URLSearchParams();
  params.set('page', page);
  params.set('limit', 10);
  if (q)               params.set('q', q);
  if (aceptaMarketing) params.set('acepta_marketing', aceptaMarketing);

  try {
    const res  = await fetch(`/admin/customers?${params.toString()}`);
    if (!res.ok) throw new Error('No autorizado');
    const data = await res.json();

    clientesList = data.clientes || [];

    const metricEl = document.getElementById('metricClientes');
    if (metricEl) metricEl.textContent = data.total;

    const statsBar = document.getElementById('clientesStatsBar');
    const conMkt = clientesList.filter(c => c.acepta_marketing).length;
    if (statsBar) {
      statsBar.textContent = `${data.total} clientes totales — Página ${data.page} de ${data.totalPages}`;
    }

    renderClientes(clientesList);
    renderClientesPagination(data.page, data.totalPages, data.total);
  } catch (e) {
    container.innerHTML = '<div class="empty-state">❌ Error al cargar clientes. Verificá tu sesión.</div>';
  }
}

function buscarClientes() {
  clearTimeout(buscarClientes._timer);
  buscarClientes._timer = setTimeout(() => loadClientes(1), 300);
}

function renderClientes(clientes) {
  const container = document.getElementById('clientesContainer');
  if (!container) return;

  if (!clientes || clientes.length === 0) {
    container.innerHTML = '<div class="empty-state">No se encontraron clientes con esos criterios.</div>';
    return;
  }

  const rows = clientes.map(c => {
    const fecha = new Date(c.creado_en).toLocaleDateString('es-AR');
    const mktBadge = c.acepta_marketing
      ? '<span class="badge-marketing si">Mkt: Sí</span>'
      : '<span class="badge-marketing no">Mkt: No</span>';
    const verificadoBadge = c.verificado
      ? '<span class="badge-marketing si" style="display:block; margin-top:4px;">Activo</span>'
      : `<span class="badge-marketing no" style="display:block; margin-top:4px; margin-bottom:4px;">Pendiente</span>
         <div style="font-size:10px; color:#a855f7; margin-bottom:4px; font-family:monospace; font-weight:700;">Pin Reg: ${c.codigo_verificacion || '—'}</div>
         <button onclick="activarCliente(${c.id}, '${c.nombre}')" style="background:#22c55e; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:10px; font-weight:700; cursor:pointer;" title="Activar cuenta manualmente">Activar</button>`;
    
    const recoveryInfo = c.codigo_recuperacion
      ? `<div style="font-size:10px; color:var(--gold); margin-top:4px; font-family:monospace; font-weight:700;">Pin Recup: ${c.codigo_recuperacion}</div>`
      : '';
      
    const waLink = c.telefono
      ? `<a href="https://wa.me/${c.telefono.replace(/\D/g,'')}" target="_blank" style="color:#4ade80; text-decoration:none; font-weight:600;" title="Abrir WhatsApp">💬 ${c.telefono}</a>`
      : '—';
    return `
      <tr>
        <td style="text-align:center;"><input type="checkbox" class="chk-cliente" value="${c.id}" onchange="onClienteSelectionChange()"></td>
        <td style="font-weight:700; color:#c084fc;">#${c.id}</td>
        <td style="font-weight:700; color:#ffffff;">${c.nombre}</td>
        <td><a href="mailto:${c.email}" style="color:#a855f7; font-weight:600;">${c.email}</a></td>
        <td>${waLink}</td>
        <td style="font-size: 0.85rem; color: #e2e8f0;">${c.direccion || '—'}${c.numero ? ' ' + c.numero : ''}</td>
        <td style="font-size: 0.85rem; color: #e2e8f0;">${c.barrio ? c.barrio + ' — ' : ''}${c.localidad || '—'}</td>
        <td style="font-size: 0.85rem; color: #e2e8f0;">${c.provincia || '—'}${c.codigo_postal ? ' (CP ' + c.codigo_postal + ')' : ''}</td>
        <td>
          ${mktBadge}
          ${verificadoBadge}
          ${recoveryInfo}
        </td>
        <td style="text-align:center; font-weight:700; color: var(--gold);">${c.pedidos_mes}</td>
        <td style="color:#888;">${fecha}</td>
        <td style="text-align:center;">
          <button onclick="restablecerClaveCliente(${c.id}, '${c.nombre}')" style="background:transparent; border:none; color:var(--gold); cursor:pointer; margin-right:6px;" title="Restablecer contraseña"><i class="fas fa-key"></i></button>
          <button onclick="eliminarClienteIndividual(${c.id}, '${c.nombre}')" style="background:transparent; border:none; color:#ef4444; cursor:pointer;" title="Eliminar cliente permanentemente"><i class="fas fa-trash-alt"></i></button>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-wrapper" style="width: 100%; overflow: visible;">
      <table class="clientes-table">
        <thead>
          <tr>
            <th style="width:40px; text-align:center;"><input type="checkbox" id="chkClientesMaster" onchange="toggleSelectAllClientes(this)"></th>
            <th>ID</th>
            <th>Nombre</th>
            <th>Email</th>
            <th>Teléfono</th>
            <th>Dirección</th>
            <th>Barrio / Localidad</th>
            <th>Provincia / C.P.</th>
            <th>Mkt / Estado</th>
            <th style="text-align:center;" title="Pedidos realizados en los últimos 30 días">Pedidos (30d)</th>
            <th>Registrado</th>
            <th style="width:60px; text-align:center;">Acciones</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderClientesPagination(currentPage, totalPages, totalCount) {
  const pagEl = document.getElementById('clientesPagination');
  if (!pagEl) return;

  if (totalPages <= 1) {
    pagEl.innerHTML = '';
    return;
  }

  let btnsHtml = '';
  
  // Botón Anterior
  btnsHtml += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="loadClientes(${currentPage - 1})">◀ Anterior</button>`;

  // Números de página con el marcador resplandeciente activo en la página actual
  for (let i = 1; i <= totalPages; i++) {
    const isActive = i === currentPage;
    btnsHtml += `<button class="page-btn ${isActive ? 'active' : ''}" onclick="loadClientes(${i})">${i}</button>`;
  }

  // Botón Siguiente
  btnsHtml += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="loadClientes(${currentPage + 1})">Siguiente ▶</button>`;

  pagEl.innerHTML = `
    <div class="pagination-bar">
      <div style="font-size:13px; color:#aaa;">
        Página <strong style="color:#c084fc;">${currentPage}</strong> de <strong style="color:#fff;">${totalPages}</strong> (${totalCount} clientes en total)
      </div>
      <div class="pagination-buttons" style="display:flex; gap:6px;">
        ${btnsHtml}
      </div>
    </div>`;
}

window.toggleSelectAllClientes = function(master) {
  document.querySelectorAll('.chk-cliente').forEach(chk => {
    chk.checked = master.checked;
  });
  onClienteSelectionChange();
};

window.onClienteSelectionChange = function() {
  const checked = document.querySelectorAll('.chk-cliente:checked');
  const btn = document.getElementById('btnDeleteSelectedClientes');
  if (btn) {
    btn.style.display = checked.length > 0 ? 'inline-block' : 'none';
  }
};

window.eliminarClienteIndividual = async function(id, nombre) {
  if (!confirm(`⚠️ ATENCIÓN: Se eliminará permanentemente al cliente "${nombre}" y todos sus pedidos asociados.\n\nEsta acción no se puede deshacer. ¿Deseas continuar?`)) return;
  await ejecutarEliminacion([id]);
};

window.eliminarClientesSeleccionados = async function() {
  const checked = document.querySelectorAll('.chk-cliente:checked');
  const ids = Array.from(checked).map(chk => parseInt(chk.value, 10));
  if (ids.length === 0) return;
  if (!confirm(`⚠️ ATENCIÓN: Se eliminarán permanentemente los ${ids.length} clientes seleccionados y todos sus pedidos asociados.\n\nEsta acción no se puede deshacer. ¿Deseas continuar?`)) return;
  await ejecutarEliminacion(ids);
};

async function ejecutarEliminacion(ids) {
  try {
    const res = await fetch('/api/admin/customers/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar');
    alert('✅ Clientes eliminados correctamente.');
    loadClientes();
    loadStats();
  } catch (err) {
    alert('❌ Error al eliminar clientes: ' + err.message);
  }
}

function exportarClientesCSVActiveFilter() {
  const filterVal = document.getElementById('clienteMarketingFilter')?.value || '';
  const filterText = filterVal === 'true'
    ? 'Solo marketing (Ley 25.326 — clientes que aceptaron recibir comunicaciones)'
    : 'Todos los clientes (uso operativo)';

  if (!confirm(`¿Estás seguro de exportar la lista de clientes?\nFiltro: ${filterText}`)) return;

  const params = new URLSearchParams();
  if (filterVal) params.set('acepta_marketing', filterVal);

  const url = `/admin/customers/export?${params.toString()}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── ALTERNADOR DE TEMA (CLARO / OSCURO) ──
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('panel_theme', isLight ? 'light' : 'dark');
  document.getElementById('btnThemeToggle').textContent = isLight ? '☀️' : '🌙';
}

function loadTheme() {
  if (localStorage.getItem('panel_theme') === 'light') {
    document.body.classList.add('light-theme');
    const btn = document.getElementById('btnThemeToggle');
    if (btn) btn.textContent = '☀️';
  } else {
    document.body.classList.remove('light-theme');
    const btn = document.getElementById('btnThemeToggle');
    if (btn) btn.textContent = '🌙';
  }
}

// ── FUNCIONALIDADES DE AJUSTES ──
async function updateAdminName(e) {
  e.preventDefault();
  const nombre = document.getElementById('ajustesNombre').value.trim();
  const errorBox = document.getElementById('ajustesErrorMsg');
  const successBox = document.getElementById('ajustesSuccessMsg');

  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  try {
    const res = await fetch('/api/admin/profile/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error;
      errorBox.style.display = 'block';
      return;
    }

    successBox.textContent = data.message;
    successBox.style.display = 'block';
    document.getElementById('ajustesNombre').value = '';
  } catch (err) {
    errorBox.textContent = 'Error de red al actualizar el nombre.';
    errorBox.style.display = 'block';
  }
}

async function updateAdminCredentials(e) {
  e.preventDefault();
  const email = document.getElementById('ajustesEmail').value.trim();
  const password = document.getElementById('ajustesPassword').value;
  const otp_code = document.getElementById('ajustesCredOTP').value.trim();
  
  const errorBox = document.getElementById('ajustesErrorMsg');
  const successBox = document.getElementById('ajustesSuccessMsg');

  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  try {
    const body = { otp_code };
    if (email) body.email = email;
    if (password) body.password = password;

    const res = await fetch('/api/admin/profile/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error;
      errorBox.style.display = 'block';
      return;
    }

    alert(data.message);
    handleLogout();
  } catch (err) {
    errorBox.textContent = 'Error de red al actualizar credenciales.';
    errorBox.style.display = 'block';
  }
}

async function updateRecoveryEmail(e) {
  e.preventDefault();
  const recovery_email = document.getElementById('ajustesRecoveryEmail').value.trim();
  const otp_code = document.getElementById('ajustesRecoveryOTP').value.trim();

  const errorBox = document.getElementById('ajustesErrorMsg');
  const successBox = document.getElementById('ajustesSuccessMsg');

  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  try {
    const res = await fetch('/api/admin/settings/recovery-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recovery_email, otp_code })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error;
      errorBox.style.display = 'block';
      return;
    }

    successBox.textContent = data.message;
    successBox.style.display = 'block';
    document.getElementById('ajustesRecoveryEmail').value = '';
    document.getElementById('ajustesRecoveryOTP').value = '';
  } catch (err) {
    errorBox.textContent = 'Error de red al actualizar el correo de recuperación.';
    errorBox.style.display = 'block';
  }
}

async function updatePanelPath(e) {
  e.preventDefault();
  const new_path = document.getElementById('ajustesPath').value.trim();
  const otp_code = document.getElementById('ajustesPathOTP').value.trim();

  const errorBox = document.getElementById('ajustesErrorMsg');
  const successBox = document.getElementById('ajustesSuccessMsg');

  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  try {
    const res = await fetch('/api/admin/settings/panel-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_path, otp_code })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error;
      errorBox.style.display = 'block';
      return;
    }

    successBox.textContent = data.message;
    successBox.style.display = 'block';
    document.getElementById('ajustesPath').value = '';
    document.getElementById('ajustesPathOTP').value = '';
    
    // Actualizar url preview
    previewNewPath();
  } catch (err) {
    errorBox.textContent = 'Error de red al actualizar la ruta del panel.';
    errorBox.style.display = 'block';
  }
}

function previewNewPath() {
  const inputVal = document.getElementById('ajustesPath').value.trim().toLowerCase();
  const path = inputVal || 'admin-panel';
  const preview = document.getElementById('previewUrlSpan');
  if (preview) {
    preview.textContent = `pixistech.store/${path}`;
  }
}

// ── ACTIVACIÓN Y RESTABLECIMIENTO DE CLIENTES ──
window.activarCliente = async function(id, nombre) {
  if (!confirm(`¿Confirmas la activación manual de la cuenta de "${nombre}"?`)) return;
  try {
    const res = await fetch(`/api/admin/customers/${id}/verify`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al activar');
    alert('✅ Cuenta de cliente activada con éxito.');
    loadClientes();
  } catch (err) {
    alert('❌ Error al activar: ' + err.message);
  }
};

window.restablecerClaveCliente = async function(id, nombre) {
  if (!confirm(`¿Deseas restablecer la contraseña de "${nombre}"?\nSe generará una contraseña temporal.`)) return;
  try {
    const res = await fetch(`/api/admin/customers/${id}/reset-password`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al restablecer');
    alert(`✅ Contraseña restablecida con éxito.\n\nNueva clave temporal: ${data.tempPassword}\n\nCopiala y envíasela al cliente por WhatsApp.`);
    loadClientes();
  } catch (err) {
    alert('❌ Error al restablecer contraseña: ' + err.message);
  }
};

// ── CONFIGURACIÓN DE AJUSTES & CUALQUIER DATO PRE-CARGADO ──
async function loadAdminSettings() {
  try {
    const res = await fetch('/api/admin/settings/all');
    if (!res.ok) return;
    const data = await res.json();
    
    if (data.smtp_host) document.getElementById('smtpHost').value = data.smtp_host;
    if (data.smtp_port) document.getElementById('smtpPort').value = data.smtp_port;
    if (data.smtp_user) document.getElementById('smtpUser').value = data.smtp_user;
    if (data.nombre_comercial) document.getElementById('ajustesNombre').value = data.nombre_comercial;

    const recText = document.getElementById('currentRecoveryEmailText');
    if (recText) recText.textContent = data.recovery_email || 'No configurado';
    if (data.recovery_email) document.getElementById('ajustesRecoveryEmail').value = data.recovery_email;

    if (data.admin_email) document.getElementById('ajustesEmail').value = data.admin_email;

    const badge2FA = document.getElementById('2faStatusBadge');
    if (badge2FA) {
      if (data.totp_activado) {
        badge2FA.style.background = 'rgba(34, 197, 94, 0.15)';
        badge2FA.style.color = '#4ade80';
        badge2FA.style.borderColor = 'rgba(34, 197, 94, 0.3)';
        badge2FA.textContent = '🟢 2FA Activado y Vinculado (Seguridad Máxima Activa)';
      } else {
        badge2FA.style.background = 'rgba(239, 68, 68, 0.15)';
        badge2FA.style.color = '#f87171';
        badge2FA.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        badge2FA.textContent = '🔴 2FA Desactivado (Se recomienda activar)';
      }
    }

    // Cargar texto de garantía en la Tarjeta 7
    const garantiaTextarea = document.getElementById('ajustesGarantiaTexto');
    if (garantiaTextarea && data.garantia_email_texto) {
      garantiaTextarea.value = data.garantia_email_texto;
    }

    // Cargar metadatos SEO en la Tarjeta 8
    const seoTitleInput = document.getElementById('ajustesSeoTitle');
    const seoDescTextarea = document.getElementById('ajustesSeoDesc');
    const seoKwInput = document.getElementById('ajustesSeoKeywords');
    if (seoTitleInput && data.seo_title) seoTitleInput.value = data.seo_title;
    if (seoDescTextarea && data.seo_description) seoDescTextarea.value = data.seo_description;
    if (seoKwInput && data.seo_keywords) seoKwInput.value = data.seo_keywords;

    // Cargar estadísticas de almacenamiento para la Pestaña 1
    if (typeof cargarStorageStats === 'function') cargarStorageStats();

  } catch (err) {
    console.error('Error al cargar ajustes:', err);
  }
}

// ── GESTIÓN DE 2FA (DESACTIVAR Y RE-VINCULAR) ──
window.mostrarModalDesactivar2FA = function() {
  document.getElementById('panelRevincular2FA').style.display = 'none';
  document.getElementById('panelDesactivar2FA').style.display = 'block';
  document.getElementById('otpDisable2FA').value = '';
};

window.cancelarDesactivar2FA = function() {
  document.getElementById('panelDesactivar2FA').style.display = 'none';
};

window.ejecutarDesactivar2FA = async function() {
  const otp_code = document.getElementById('otpDisable2FA').value.trim();
  if (!otp_code) {
    alert('⚠️ Por favor ingresá el código OTP de 6 dígitos.');
    return;
  }

  try {
    const res = await fetch('/api/admin/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_code })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`❌ Error: ${data.error || 'No se pudo desactivar el 2FA.'}`);
      return;
    }

    alert(`✅ ${data.message || '2FA desactivado correctamente.'}`);
    cancelarDesactivar2FA();
    loadAdminSettings();
  } catch (e) {
    console.error('Error al desactivar 2FA:', e);
    alert('❌ Error de red al desactivar 2FA.');
  }
};

window.solicitarRevincular2FA = async function() {
  document.getElementById('panelDesactivar2FA').style.display = 'none';
  try {
    const res = await fetch('/api/admin/2fa/setup-new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`❌ Error: ${data.error || 'No se pudo generar nuevo código QR.'}`);
      return;
    }

    document.getElementById('imgNuevoQR2FA').src = data.qr;
    document.getElementById('otpConfirmNew2FA').value = '';
    document.getElementById('panelRevincular2FA').style.display = 'block';
  } catch (e) {
    console.error('Error al generar QR de re-vinculación:', e);
    alert('❌ Error de red al solicitar nuevo QR.');
  }
};

window.cancelarRevincular2FA = function() {
  document.getElementById('panelRevincular2FA').style.display = 'none';
};

window.confirmarRevincular2FA = async function() {
  const otp_code = document.getElementById('otpConfirmNew2FA').value.trim();
  if (!otp_code) {
    alert('⚠️ Por favor ingresá el código de 6 dígitos de tu app de autenticación.');
    return;
  }

  try {
    const res = await fetch('/api/admin/2fa/confirm-new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_code })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`❌ Error: ${data.error || 'Código 2FA incorrecto.'}`);
      return;
    }

    alert(`✅ ${data.message || '2FA vinculado y activado con éxito.'}`);
    cancelarRevincular2FA();
    loadAdminSettings();
  } catch (e) {
    console.error('Error al confirmar 2FA:', e);
    alert('❌ Error de red al confirmar 2FA.');
  }
};

async function updateSMTPSettings(event) {
  event.preventDefault();
  const host = document.getElementById('smtpHost').value.trim();
  const port = parseInt(document.getElementById('smtpPort').value, 10);
  const user = document.getElementById('smtpUser').value.trim();
  const pass = document.getElementById('smtpPass').value;

  const errorBox = document.getElementById('ajustesErrorMsg');
  const successBox = document.getElementById('ajustesSuccessMsg');

  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  try {
    const res = await fetch('/api/admin/settings/smtp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, user, pass })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || 'Error al guardar la configuración SMTP.';
      errorBox.style.display = 'block';
    } else {
      successBox.textContent = data.message || 'Configuración SMTP guardada correctamente.';
      successBox.style.display = 'block';
      document.getElementById('smtpPass').value = '';
      loadAdminSettings();
    }
  } catch (err) {
    errorBox.textContent = 'Error de red al guardar la configuración SMTP.';
    errorBox.style.display = 'block';
  }
}

window.loadAdminSettings = loadAdminSettings;
window.updateSMTPSettings = updateSMTPSettings;

// ── ALTERNAR VISIBILIDAD DE CONTRASEÑAS (OJITO 👁️) ──
window.toggleAdminPasswordVisibility = function(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  const icon = btn ? btn.querySelector('i') : null;
  if (icon) {
    icon.className = isPassword ? 'far fa-eye-slash' : 'far fa-eye';
  }
};

// ── EXPORTACIÓN DE RESERVA WEB (.pxgres) PARA MAESTRO POS ──
window.exportarReservaPxGres = function(orderId) {
  if (!orderId) return;
  const link = document.createElement('a');
  link.href = `/api/admin/orders/${orderId}/export-pxgres`;
  link.download = `reserva_${orderId}.pxgres`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// ── SISTEMA DE CUPONES DE DESCUENTO — LÓGICA DE INTERFAZ ──

window.cargarCuponesAdmin = async function() {
  const container = document.getElementById('listaCuponesAdmin');
  const tableBody = document.getElementById('tablaCuponesAdminBody');
  const cantBadge = document.getElementById('cantCuponesBadge');

  try {
    const res = await fetch('/api/admin/coupons');
    if (!res.ok) {
      if (container) container.innerHTML = '<div style="color:#f87171; font-size:0.82rem;">Error al cargar cupones.</div>';
      if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" style="color:#f87171; text-align:center; padding:15px;">Error al cargar cupones.</td></tr>';
      return;
    }
    const data = await res.json();
    const cupones = data.cupones || [];

    if (cantBadge) cantBadge.textContent = `(${cupones.length})`;

    if (cupones.length === 0) {
      if (container) container.innerHTML = '<div style="color:#888; font-size:0.82rem; text-align:center; padding:10px;">No hay cupones creados aún.</div>';
      if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" style="color:#888; text-align:center; padding:20px;">No hay cupones registrados aún.</td></tr>';
      return;
    }

    // RENDERIZADO: Tabla 1:1 en Sección Exclusiva Cupones (#seccionCupones)
    if (tableBody) {
      tableBody.innerHTML = cupones.map(c => {
        let estadoBadge = c.activo ? (c.expirado ? '<span style="background:rgba(234,179,8,0.2); color:#facc15; padding:3px 10px; border-radius:12px; font-size:0.75rem; font-weight:700;">EXPIRADO</span>' : '<span style="background:rgba(34,197,94,0.2); color:#4ade80; padding:3px 10px; border-radius:12px; font-size:0.75rem; font-weight:700;">🟢 ACTIVO</span>') : '<span style="background:rgba(239,68,68,0.2); color:#f87171; padding:3px 10px; border-radius:12px; font-size:0.75rem; font-weight:700;">INACTIVO</span>';
        const valorStr = c.tipo === 'PERCENTAGE' ? `${c.descuento_porcentaje}% OFF` : `$${c.descuento_monto.toLocaleString('es-AR')} OFF`;
        const minStr = c.monto_minimo > 0 ? `$${c.monto_minimo.toLocaleString('es-AR')}` : 'Sin mínimo';
        const expStr = c.expira_en ? new Date(c.expira_en).toLocaleString('es-AR') : 'Sin Vencimiento';
        const usosCount = typeof c.usos_count === 'number' ? c.usos_count : 0;

        return `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
            <td style="padding: 12px; font-family: 'Orbitron'; font-weight: 700; color: var(--gold);">${c.codigo}</td>
            <td style="padding: 12px; font-weight: 700; color: #c084fc;">${valorStr}</td>
            <td style="padding: 12px; color: #ccc;">${minStr}</td>
            <td style="padding: 12px; color: #aaa; font-size: 0.8rem;">📅 ${expStr}</td>
            <td style="padding: 12px;">${estadoBadge}</td>
            <td style="padding: 12px; text-align: center;">
              <span style="background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); padding: 3px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 700;">${usosCount}</span>
            </td>
            <td style="padding: 12px; text-align: right;">
              ${c.activo ? `<button type="button" onclick="eliminarCuponAdmin(${c.id})" style="background: rgba(234,179,8,0.15); color: #facc15; border: 1px solid rgba(234,179,8,0.3); padding: 5px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer;">Desactivar</button>` : `<button type="button" onclick="eliminarDefinitivoCuponAdmin(${c.id}, '${c.codigo}')" style="background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); padding: 5px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer;">🗑️ Eliminar</button>`}
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    if (container) container.innerHTML = '<div style="color:#f87171; font-size:0.82rem;">Error de conexión.</div>';
  }
};

window.eliminarCuponAdmin = async function(id) {
  if (!confirm('¿Seguro que querés desactivar este cupón?')) return;

  try {
    const res = await fetch(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert('⚠️ ' + (data.error || 'Error al desactivar cupón.'));
      return;
    }
    window.cargarCuponesAdmin();
  } catch (err) {
    alert('❌ Error de conexión al desactivar el cupón.');
  }
};

window.eliminarDefinitivoCuponAdmin = async function(id, codigo) {
  if (!confirm(`⚠️ ¿Eliminar DEFINITIVAMENTE el cupón "${codigo}"? Esta acción no se puede deshacer.`)) return;

  try {
    const res = await fetch(`/api/admin/coupons/${id}/destroy`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert('⚠️ ' + (data.error || 'Error al eliminar el cupón.'));
      return;
    }
    window.cargarCuponesAdmin();
  } catch (err) {
    alert('❌ Error de conexión al eliminar el cupón.');
  }
};

// ── FUNCIONES DE LA SECCIÓN DEDICADA DE CUPONES (VISTA EXCLUSIVA 1:1 MAESTRO POS) ──
window.toggleTipoCuponInputsSec = function() {
  const tipo = document.getElementById('cuponTipoSec').value;
  const lbl = document.getElementById('lblCuponValorSec');
  const input = document.getElementById('cuponValorSec');
  
  if (tipo === 'PERCENTAGE') {
    lbl.textContent = 'Porcentaje de Descuento (%) *';
    input.max = '100';
    input.placeholder = 'Ej: 15';
  } else {
    lbl.textContent = 'Monto Fijo de Descuento ($ ARS) *';
    input.removeAttribute('max');
    input.placeholder = 'Ej: 5000';
  }
};

window.toggleExpiracionCuponInputsSec = function() {
  const unidad = document.getElementById('cuponUnidadExpiracionSec').value;
  const wrapperValor = document.getElementById('wrapperValorExpiracionSec');
  const wrapperFecha = document.getElementById('wrapperFechaExactaSec');
  const lblValor = document.getElementById('lblValorExpiracionSec');

  if (unidad === 'SIN_EXPIRACION' || unidad === '24H') {
    wrapperValor.style.display = 'none';
    wrapperFecha.style.display = 'none';
  } else if (unidad === 'EXACTO') {
    wrapperValor.style.display = 'none';
    wrapperFecha.style.display = 'block';
  } else {
    wrapperValor.style.display = 'block';
    wrapperFecha.style.display = 'none';
    const nombres = { HORAS: 'Horas', DIAS: 'Días', SEMANAS: 'Semanas', MESES: 'Meses' };
    lblValor.textContent = `Cantidad de ${nombres[unidad] || 'Tiempo'}`;
  }
};

window.crearCuponAdminSeccion = async function(e) {
  e.preventDefault();
  const codigo = document.getElementById('cuponCodigoSec').value.trim();
  const tipo = document.getElementById('cuponTipoSec').value;
  const valor = document.getElementById('cuponValorSec').value;
  const minimo = document.getElementById('cuponMinimoSec').value;
  const unidad = document.getElementById('cuponUnidadExpiracionSec').value;
  const valorExp = document.getElementById('cuponValorExpiracionSec').value;
  const fechaExacta = document.getElementById('cuponFechaExactaSec').value;
  const btn = document.getElementById('btnCrearCuponSec');

  btn.disabled = true;
  btn.textContent = 'Creando cupón...';

  try {
    const payload = {
      codigo,
      tipo,
      descuento_porcentaje: tipo === 'PERCENTAGE' ? parseFloat(valor) : 0,
      descuento_monto: tipo === 'FIXED' ? parseFloat(valor) : 0,
      monto_minimo: parseFloat(minimo) || 0,
      unidad_expiracion: unidad === '24H' ? 'HORAS' : unidad,
      valor_expiracion: unidad === '24H' ? 24 : (valorExp ? parseInt(valorExp, 10) : null),
      fecha_exacta: unidad === 'EXACTO' ? fechaExacta : null
    };

    const res = await fetch('/api/admin/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    btn.disabled = false;
    btn.textContent = 'Crear Cupón';

    if (!res.ok) {
      alert('⚠️ ' + (data.error || 'Error al crear el cupón.'));
      return;
    }

    alert(`✅ Cupón ${data.cupon.codigo} creado con éxito.`);
    document.getElementById('formCrearCuponSeccion').reset();
    window.toggleTipoCuponInputsSec();
    window.toggleExpiracionCuponInputsSec();
    window.cargarCuponesAdmin();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Crear Cupón';
    alert('❌ Error de conexión al crear el cupón.');
  }
};

// ── IMPORTACIÓN Y EXPORTACIÓN BIDIRECCIONAL .pxgcupon (WEB ↔ MAESTRO POS) ──
window.triggerImportarCuponesWeb = function() {
  const input = document.getElementById('fileInputPxgcupon');
  if (input) input.click();
};

window.importarCuponesPxgcuponWeb = async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const content = e.target.result;
      const payload = JSON.parse(content);

      if (payload.tipo !== 'COUPONS_SYNC_PACKAGE' || !Array.isArray(payload.cupones)) {
        alert("⚠️ El archivo seleccionado no es un paquete válido de cupones .pxgcupon.");
        return;
      }

      const res = await fetch('/api/admin/coupons/import-pxgcupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        alert('⚠️ ' + (data.error || 'Error al importar los cupones.'));
        return;
      }

      alert(`✅ ${data.message || 'Cupones sincronizados correctamente.'}`);
      window.cargarCuponesAdmin();
    } catch (err) {
      alert("❌ Error al procesar el archivo .pxgcupon: " + err.message);
    } finally {
      event.target.value = '';
    }
  };

  reader.readAsText(file);
};

window.exportarCuponesPxgcuponWeb = function() {
  const link = document.createElement('a');
  link.href = '/api/admin/coupons/export-pxgcupon';
  link.download = 'cupones_pixis.pxgcupon';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// ── SISTEMA DE GARANTÍA EN CORREOS AUTOMÁTICOS ──
window.guardarGarantiaEmail = async function(event) {
  event.preventDefault();
  const textarea = document.getElementById('ajustesGarantiaTexto');
  const btn = document.getElementById('btnGuardarGarantia');
  const msg = document.getElementById('garantiaSaveMsg');
  const texto = textarea ? textarea.value.trim() : '';

  if (!texto) {
    if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '⚠️ El texto no puede estar vacío.'; }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando...';
  if (msg) msg.style.display = 'none';

  try {
    const res = await fetch('/api/admin/settings/garantia-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto })
    });
    const data = await res.json();

    btn.disabled = false;
    btn.textContent = '💾 Guardar Texto de Garantía';

    if (!res.ok) {
      if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '❌ ' + (data.error || 'Error al guardar.'); }
      return;
    }

    if (msg) {
      msg.style.display = 'inline';
      msg.style.color = '#4ade80';
      msg.textContent = '✅ Guardado con éxito.';
      setTimeout(() => { msg.style.display = 'none'; }, 3000);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '💾 Guardar Texto de Garantía';
    if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '❌ Error de conexión.'; }
  }
};

// ── CONFIGURACIÓN DE SEO GLOBAL Y POSICIONAMIENTO ──
window.guardarAjustesSEO = async function(event) {
  event.preventDefault();
  const seo_title = document.getElementById('ajustesSeoTitle').value.trim();
  const seo_description = document.getElementById('ajustesSeoDesc').value.trim();
  const seo_keywords = document.getElementById('ajustesSeoKeywords').value.trim();
  const btn = document.getElementById('btnGuardarSEO');
  const msg = document.getElementById('seoSaveMsg');

  if (!seo_title || !seo_description) {
    if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '⚠️ Título y Descripción son obligatorios.'; }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando SEO...';
  if (msg) msg.style.display = 'none';

  try {
    const res = await fetch('/api/admin/settings/seo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seo_title, seo_description, seo_keywords })
    });
    const data = await res.json();

    btn.disabled = false;
    btn.textContent = '🌐 Guardar Configuración SEO y Posicionamiento';

    if (!res.ok) {
      if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '❌ ' + (data.error || 'Error al guardar.'); }
      return;
    }

    if (msg) {
      msg.style.display = 'inline';
      msg.style.color = '#4ade80';
      msg.textContent = '✅ Guardado con éxito.';
      setTimeout(() => { msg.style.display = 'none'; }, 3000);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '🌐 Guardar Configuración SEO y Posicionamiento';
    if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '❌ Error de conexión.'; }
  }
};

// ── NAVEGACIÓN ENTRE PESTAÑAS DE AJUSTES (BLOQUE 2) ──
window.switchAjustesTab = function(tabName) {
  const tabs = ['storage', 'garantia', 'seo', 'seguridad', 'reserva'];
  tabs.forEach(t => {
    const btn = document.getElementById('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
    const content = document.getElementById('tabContent' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.remove('tab-ajustes-active');
    if (content) content.style.display = 'none';
  });

  const targetBtn = document.getElementById('tabBtn' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  const targetContent = document.getElementById('tabContent' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (targetBtn) targetBtn.classList.add('tab-ajustes-active');
  if (targetContent) targetContent.style.display = 'block';

  if (tabName === 'storage') {
    cargarStorageStats();
  } else if (tabName === 'reserva') {
    cargarConfigReservaAdmin();
  }
};

// ── OPTIMIZACIÓN Y PURGA DE ALMACENAMIENTO (PESTAÑA 1) ──
window.cargarStorageStats = async function() {
  try {
    const res = await fetch('/api/admin/settings/storage-stats');
    if (!res.ok) return;
    const data = await res.json();

    const mbElem = document.getElementById('statTotalMB');
    const archElem = document.getElementById('statTotalArchivos');
    const purgElem = document.getElementById('statPurgables');

    if (mbElem) mbElem.textContent = data.total_mb + ' MB';
    if (archElem) archElem.textContent = data.total_archivos;
    if (purgElem) purgElem.textContent = data.purgables_60_dias;
  } catch (e) {
    console.error('Error al cargar estadísticas de almacenamiento:', e);
  }
};

window.ejecutarLimpiezaDisco = async function() {
  const btn = document.getElementById('btnLimpiezaDisco');
  const msg = document.getElementById('storagePurgeMsg');

  if (!confirm('¿Desea escanear y purgar los comprobantes de pedidos antiguos (+60 días) ahora mismo?')) {
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Purgando comprobantes...';
  if (msg) msg.style.display = 'none';

  try {
    const res = await fetch('/api/admin/settings/purge-storage', { method: 'POST' });
    const data = await res.json();

    btn.disabled = false;
    btn.textContent = '🧹 Escanear y Purgar Almacenamiento Ahora';

    if (!res.ok) {
      if (msg) {
        msg.style.display = 'block';
        msg.style.color = '#f87171';
        msg.textContent = '❌ ' + (data.error || 'Error al ejecutar purga.');
      }
      return;
    }

    if (msg) {
      msg.style.display = 'block';
      msg.style.color = '#4ade80';
      msg.textContent = `✅ ${data.message || 'Purga completada con éxito.'}`;
    }

    cargarStorageStats();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '🧹 Escanear y Purgar Almacenamiento Ahora';
    if (msg) {
      msg.style.display = 'block';
      msg.style.color = '#f87171';
      msg.textContent = '❌ Error de conexión con el servidor.';
    }
  }
};

// ── CONFIGURACIÓN DE TIEMPOS DE RESERVA Y PAGOS (PESTAÑA 5) ──

window.cargarConfigReservaAdmin = async function() {
  try {
    const res = await fetch('/api/admin/settings/reservation');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;

    const transfValor = document.getElementById('reservaTransfValor');
    const transfUnidad = document.getElementById('reservaTransfUnidad');
    const efectivoValor = document.getElementById('reservaEfectivoValor');
    const efectivoUnidad = document.getElementById('reservaEfectivoUnidad');
    const timerMsg = document.getElementById('reservaTimerMsg');
    const efectivoMsg = document.getElementById('reservaEfectivoMsg');

    if (transfValor) transfValor.value = data.transf_valor || 60;
    if (transfUnidad) transfUnidad.value = data.transf_unidad || 'minutos';
    if (efectivoValor) efectivoValor.value = data.efectivo_valor || 1440;
    if (efectivoUnidad) efectivoUnidad.value = data.efectivo_unidad || 'minutos';
    if (timerMsg) timerMsg.value = data.timer_msg || '';
    if (efectivoMsg) efectivoMsg.value = data.efectivo_msg || '';
  } catch (e) {
    console.error('Error al cargar config de reserva:', e);
  }
};

window.guardarConfigReservaAdmin = async function() {
  const btn = document.getElementById('btnGuardarReserva');
  const msg = document.getElementById('reservaGuardarMsg');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando...'; }
  if (msg) msg.style.display = 'none';

  const transf_valor = document.getElementById('reservaTransfValor')?.value;
  const transf_unidad = document.getElementById('reservaTransfUnidad')?.value;
  const efectivo_valor = document.getElementById('reservaEfectivoValor')?.value;
  const efectivo_unidad = document.getElementById('reservaEfectivoUnidad')?.value;
  const timer_msg = document.getElementById('reservaTimerMsg')?.value;
  const efectivo_msg = document.getElementById('reservaEfectivoMsg')?.value;

  try {
    const res = await fetch('/api/admin/settings/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transf_valor, transf_unidad, efectivo_valor, efectivo_unidad, timer_msg, efectivo_msg })
    });
    const data = await res.json();

    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar Configuración de Tiempos y Mensajes'; }

    if (!res.ok) {
      if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '❌ ' + (data.error || 'Error al guardar.'); }
      return;
    }

    if (msg) { msg.style.display = 'inline'; msg.style.color = '#4ade80'; msg.textContent = '✅ ' + (data.message || 'Configuración guardada.'); }
  } catch (e) {
    console.error('Error al guardar config de reserva:', e);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar Configuración de Tiempos y Mensajes'; }
    if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '❌ Error de conexión.'; }
  }
};

// =====================================================================
// ── GESTIÓN DE ÍCONOS DE PESTAÑA (FAVICONS) ──────────────────────────
// =====================================================================
let faviconConfigState = {
  slot1: null,
  slot2: null,
  web_assigned: 'default',
  admin_assigned: 'default'
};

window.abrirModalFaviconManager = async function() {
  const modal = document.getElementById('modalFaviconManager');
  if (!modal) return;
  modal.style.display = 'flex';
  await cargarFaviconConfigAdmin();
};

window.cerrarModalFaviconManager = function() {
  const modal = document.getElementById('modalFaviconManager');
  if (modal) modal.style.display = 'none';
  const msg = document.getElementById('msgFaviconSave');
  if (msg) msg.style.display = 'none';
};

window.cargarFaviconConfigAdmin = async function() {
  try {
    const res = await fetch('/api/shop/favicon-config');
    const data = await res.json();
    if (data && data.ok) {
      faviconConfigState = data;
      renderFaviconUI();
      if (data.admin_favicon) {
        aplicarFaviconEnNavegador(data.admin_favicon);
      }
    }
  } catch (err) {
    console.error('Error al cargar config de favicons:', err);
  }
};

function renderFaviconUI() {
  const defaultIcon = '../img/logo_pixis.png';
  
  // Slot 1
  const prev1 = document.getElementById('previewSlot1');
  const badge1 = document.getElementById('badgeSlot1');
  if (faviconConfigState.slots && faviconConfigState.slots.slot1) {
    if (prev1) { prev1.src = faviconConfigState.slots.slot1.url; prev1.style.opacity = '1'; }
    if (badge1) { badge1.textContent = 'Activo'; badge1.style.background = 'rgba(56,189,248,0.2)'; badge1.style.color = '#38bdf8'; }
  } else {
    if (prev1) { prev1.src = defaultIcon; prev1.style.opacity = '0.35'; }
    if (badge1) { badge1.textContent = 'Vacío'; badge1.style.background = 'rgba(255,255,255,0.1)'; badge1.style.color = '#aaa'; }
  }

  // Slot 2
  const prev2 = document.getElementById('previewSlot2');
  const badge2 = document.getElementById('badgeSlot2');
  if (faviconConfigState.slots && faviconConfigState.slots.slot2) {
    if (prev2) { prev2.src = faviconConfigState.slots.slot2.url; prev2.style.opacity = '1'; }
    if (badge2) { badge2.textContent = 'Activo'; badge2.style.background = 'rgba(168,85,247,0.2)'; badge2.style.color = '#c084fc'; }
  } else {
    if (prev2) { prev2.src = defaultIcon; prev2.style.opacity = '0.35'; }
    if (badge2) { badge2.textContent = 'Vacío'; badge2.style.background = 'rgba(255,255,255,0.1)'; badge2.style.color = '#aaa'; }
  }

  // Selects
  const selWeb = document.getElementById('selectFaviconWeb');
  const selAdmin = document.getElementById('selectFaviconAdmin');
  if (selWeb) selWeb.value = faviconConfigState.web_assigned || 'default';
  if (selAdmin) selAdmin.value = faviconConfigState.admin_assigned || 'default';

  actualizarPreviewsPestanas();
}

window.actualizarPreviewsPestanas = function() {
  const defaultIcon = '../img/logo_pixis.png';
  const selWeb = document.getElementById('selectFaviconWeb')?.value || 'default';
  const selAdmin = document.getElementById('selectFaviconAdmin')?.value || 'default';

  const mockWeb = document.getElementById('tabMockWebIcon');
  const mockAdmin = document.getElementById('tabMockAdminIcon');

  let urlWeb = defaultIcon;
  if (selWeb === 'slot1' && faviconConfigState.slots?.slot1) urlWeb = faviconConfigState.slots.slot1.url;
  else if (selWeb === 'slot2' && faviconConfigState.slots?.slot2) urlWeb = faviconConfigState.slots.slot2.url;

  let urlAdmin = defaultIcon;
  if (selAdmin === 'slot1' && faviconConfigState.slots?.slot1) urlAdmin = faviconConfigState.slots.slot1.url;
  else if (selAdmin === 'slot2' && faviconConfigState.slots?.slot2) urlAdmin = faviconConfigState.slots.slot2.url;

  if (mockWeb) mockWeb.src = urlWeb;
  if (mockAdmin) mockAdmin.src = urlAdmin;
};

window.subirFaviconSlot = async function(slot, inputEl) {
  if (!inputEl.files || inputEl.files.length === 0) return;
  const file = inputEl.files[0];

  const formData = new FormData();
  formData.append('slot', slot);
  formData.append('file', file);

  try {
    const res = await fetch('/api/admin/favicons/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) {
      alert('⚠️ ' + (data.error || 'Error al subir el ícono.'));
      return;
    }
    inputEl.value = '';
    await cargarFaviconConfigAdmin();
  } catch (err) {
    console.error('Error al subir favicon:', err);
    alert('⚠️ Error de conexión al subir la imagen.');
  }
};

window.eliminarFaviconSlot = async function(slot) {
  if (!confirm(`¿Eliminar de forma permanente la imagen de ${slot === 'slot1' ? 'Ícono 1' : 'Ícono 2'} y liberar espacio en disco?`)) return;

  try {
    const res = await fetch(`/api/admin/favicons/${slot}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) {
      alert('⚠️ ' + (data.error || 'No se pudo eliminar el ícono.'));
      return;
    }
    await cargarFaviconConfigAdmin();
  } catch (err) {
    console.error('Error al eliminar favicon:', err);
    alert('⚠️ Error de conexión al eliminar.');
  }
};

window.guardarFaviconConfigAdmin = async function() {
  const web_assigned = document.getElementById('selectFaviconWeb')?.value || 'default';
  const admin_assigned = document.getElementById('selectFaviconAdmin')?.value || 'default';
  const btn = document.getElementById('btnGuardarFaviconConfig');
  const msg = document.getElementById('msgFaviconSave');

  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    const res = await fetch('/api/admin/favicons/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ web_assigned, admin_assigned })
    });
    const data = await res.json();

    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar Asignaciones'; }

    if (!res.ok) {
      if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '❌ ' + (data.error || 'Error al guardar.'); }
      return;
    }

    if (msg) { msg.style.display = 'inline'; msg.style.color = '#4ade80'; msg.textContent = '✅ ' + (data.message || 'Asignaciones guardadas.'); }
    await cargarFaviconConfigAdmin();
  } catch (err) {
    console.error('Error al guardar asignaciones de favicon:', err);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar Asignaciones'; }
    if (msg) { msg.style.display = 'inline'; msg.style.color = '#f87171'; msg.textContent = '❌ Error de conexión.'; }
  }
};

function aplicarFaviconEnNavegador(url) {
  if (!url) return;
  const f = document.getElementById('adminFavicon');
  const s = document.getElementById('adminShortcutIcon');
  if (f) f.href = url;
  if (s) s.href = url;
}

// Inicializar favicon de admin al cargar panel
cargarFaviconConfigAdmin();
