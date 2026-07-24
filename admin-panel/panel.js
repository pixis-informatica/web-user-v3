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
  document.cookie = 'admin_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
  showLogin();
  location.reload();
}

// ── RECUPERACIÓN DE 2FA (MODAL) ──
function open2FARecoveryModal() {
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
      errorBox.textContent = data.error;
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
  const errorBox = document.getElementById('recoveryErrorMsg');
  const successBox = document.getElementById('recoverySuccessMsg');

  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  try {
    const res = await fetch('/api/admin/recovery/confirm-reset-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, codigo })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error;
      errorBox.style.display = 'block';
      return;
    }

    alert(data.message);
    close2FARecoveryModal();
    // Volver a paso 1 para loguear de nuevo (ahora pedirá re-configurar QR)
    backToStep1();
  } catch (err) {
    errorBox.textContent = 'Error al confirmar el código de restablecimiento.';
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
    }
  } catch (e) {
    // ignorar silenciosamente
  }
}

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
        <div class="comprobante-preview" style="margin-top: 10px;">
          <h4>Comprobantes de Pago:</h4>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 5px;">
            ${order.comprobantes.map(c => `
              <a href="${c.archivo_url}" target="_blank" class="comprobante-link">
                📄 Ver Comprobante (${c.archivo_url.split('.').pop().toUpperCase()})
              </a>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      comprobantesHtml = `<p style="font-size: 0.85rem; color: var(--error); margin-top: 8px;">⚠️ Sin comprobante de pago subido aún.</p>`;
    }

    let actionsHtml = '';
    if (order.estado === 'pendiente_revision') {
      actionsHtml = `
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
        ${btnConfirmarPago}
        <button class="btn-action btn-action-complete" onclick="completeOrder(${order.id})">Entregar / Completar</button>
        <button class="btn-action btn-action-reject" onclick="openRejectModal(${order.id})">Rechazar</button>
      `;
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
          <div class="info-item"><span>Entrega:</span> ${order.entrega === 'envio' ? `Envío a domicilio` : `Retiro por sucursal`}</div>
          ${order.direccion ? `<div class="info-item"><span>Dirección:</span> ${order.direccion}</div>` : ''}
          <div class="info-item"><span>Provincia:</span> ${order.usuario?.provincia || '—'}</div>
          <div class="info-item"><span>Localidad:</span> ${order.usuario?.localidad || '—'}</div>
          <div class="info-item"><span>Código Postal:</span> ${order.usuario?.codigo_postal || '—'}</div>
          <div class="info-item"><span>Medio de Pago:</span> ${order.forma_pago.toUpperCase()} ${order.cuotas ? `(${order.cuotas} cuotas)` : ''}</div>
          <div class="info-item" style="font-size: 1rem; margin-top: 8px;"><strong>Total:</strong> <span style="color: var(--gold); font-weight: bold;">$${order.total.toLocaleString('es-AR')}</span></div>
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

// ── PESTAÑAS PRINCIPALES (PEDIDOS / CLIENTES / AJUSTES) ──
function switchMainTab(tab) {
  currentMainTab = tab;
  const seccionPedidos  = document.getElementById('seccionPedidos');
  const seccionClientes = document.getElementById('seccionClientes');
  const seccionAjustes  = document.getElementById('seccionAjustes');
  
  const btnPedidos      = document.getElementById('mainTab-pedidos');
  const btnClientes     = document.getElementById('mainTab-clientes');
  const btnAjustes      = document.getElementById('mainTab-ajustes');

  // Ocultar todo
  seccionPedidos.style.display  = 'none';
  seccionClientes.style.display = 'none';
  seccionAjustes.style.display  = 'none';
  
  btnPedidos.classList.remove('active');
  btnClientes.classList.remove('active');
  btnAjustes.classList.remove('active');

  if (tab === 'clientes') {
    seccionClientes.style.display = 'block';
    btnClientes.classList.add('active');
    loadClientes();
  } else if (tab === 'ajustes') {
    seccionAjustes.style.display = 'block';
    btnAjustes.classList.add('active');
    document.getElementById('ajustesErrorMsg').style.display = 'none';
    document.getElementById('ajustesSuccessMsg').style.display = 'none';
    previewNewPath();
    loadSMTPSettings();
  } else {
    seccionPedidos.style.display  = 'block';
    btnPedidos.classList.add('active');
    loadOrders();
  }
}

// ── SECCIÓN CLIENTES ──
let clientesList = [];

async function loadClientes() {
  const container = document.getElementById('clientesContainer');
  if (!container) return;
  container.innerHTML = '<div class="loading-state">Cargando clientes...</div>';

  const q               = (document.getElementById('clienteSearch')?.value || '').trim();
  const aceptaMarketing = document.getElementById('clienteMarketingFilter')?.value || '';
  const params          = new URLSearchParams();
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
      statsBar.textContent = `${data.total} clientes — ${conMkt} aceptan marketing`;
    }

    renderClientes(clientesList);
  } catch (e) {
    container.innerHTML = '<div class="empty-state">❌ Error al cargar clientes. Verificá tu sesión.</div>';
  }
}

function buscarClientes() {
  clearTimeout(buscarClientes._timer);
  buscarClientes._timer = setTimeout(loadClientes, 300);
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
      ? `<a href="https://wa.me/${c.telefono.replace(/\D/g,'')}" target="_blank" style="color:#4ade80; text-decoration:none;" title="Abrir WhatsApp">💬 ${c.telefono}</a>`
      : '—';
    return `
      <tr>
        <td style="text-align:center;"><input type="checkbox" class="chk-cliente" value="${c.id}" onchange="onClienteSelectionChange()"></td>
        <td style="font-weight:700; color:#c084fc;">#${c.id}</td>
        <td>${c.nombre}</td>
        <td><a href="mailto:${c.email}" style="color:#a855f7;">${c.email}</a></td>
        <td>${waLink}</td>
        <td style="font-size: 0.85rem; color: #ccc;">${c.direccion || '—'}${c.numero ? ' ' + c.numero : ''}</td>
        <td style="font-size: 0.85rem; color: #ccc;">${c.barrio ? c.barrio + ' — ' : ''}${c.localidad || '—'}</td>
        <td style="font-size: 0.85rem; color: #ccc;">${c.provincia || '—'}${c.codigo_postal ? ' (CP ' + c.codigo_postal + ')' : ''}</td>
        <td>
          ${mktBadge}
          ${verificadoBadge}
          ${recoveryInfo}
        </td>
        <td style="text-align:center; font-weight:700; color: var(--gold);">${c.pedidos_mes}</td>
        <td style="color:#666;">${fecha}</td>
        <td style="text-align:center;">
          <button onclick="restablecerClaveCliente(${c.id}, '${c.nombre}')" style="background:transparent; border:none; color:var(--gold); cursor:pointer; margin-right:6px;" title="Restablecer contraseña"><i class="fas fa-key"></i></button>
          <button onclick="eliminarClienteIndividual(${c.id}, '${c.nombre}')" style="background:transparent; border:none; color:#ef4444; cursor:pointer;" title="Eliminar cliente permanentemente"><i class="fas fa-trash-alt"></i></button>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-wrapper" style="overflow-x: auto;">
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

// ── CONFIGURACIÓN SMTP DINÁMICA ──
async function loadSMTPSettings() {
  try {
    const res = await fetch('/api/admin/settings/smtp');
    if (!res.ok) return;
    const data = await res.json();
    if (data.host) document.getElementById('smtpHost').value = data.host;
    if (data.port) document.getElementById('smtpPort').value = data.port;
    if (data.user) document.getElementById('smtpUser').value = data.user;
  } catch (err) {
    console.error('Error al cargar config SMTP de la API:', err);
  }
}

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
      document.getElementById('smtpPass').value = ''; // Limpiar contraseña por seguridad
    }
  } catch (err) {
    errorBox.textContent = 'Error de red al guardar la configuración SMTP.';
    errorBox.style.display = 'block';
  }
}

window.updateSMTPSettings = updateSMTPSettings;
