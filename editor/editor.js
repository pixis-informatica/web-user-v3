/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           PIXIS LIVE EDITOR — editor.js  v1.0               ║
 * ║  Motor principal de edición visual                           ║
 * ║  Solo se activa con ?edit=true en la URL                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

/* ════════════════════════════════════════════════════════════════
   GUARD: solo ejecutar en modo edición
════════════════════════════════════════════════════════════════ */
(function () {
  const isEditorEnabled =
    window.location.search.includes('edit=true') ||
    (window.location.hostname === 'localhost' && window.location.search.includes('edit=true'));

  if (!isEditorEnabled) return;

  // Cargar dependencias del editor
  loadEditorAssets().then(() => {
    document.addEventListener('DOMContentLoaded', initPixisEditor);
    if (document.readyState !== 'loading') initPixisEditor();
  });
})();

/* ════════════════════════════════════════════════════════════════
   CARGA DINÁMICA DE ASSETS DEL EDITOR
════════════════════════════════════════════════════════════════ */
function loadEditorAssets() {
  return new Promise((resolve) => {
    // CSS del editor
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'editor/styles.css';
    document.head.appendChild(link);

    // overlay.js
    const script = document.createElement('script');
    script.src = 'editor/overlay.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

/* ════════════════════════════════════════════════════════════════
   ESTADO GLOBAL DEL EDITOR
════════════════════════════════════════════════════════════════ */
const PixisEditor = {
  // Datos en memoria
  data: {
    site: {},
    products: [],
    categories: [],
    ui: {}
  },

  // Estado UI
  state: {
    activeMode: null,      // 'texts' | 'images' | 'sections' | null
    selectedElement: null,
    unsaved: false,
    autosave: false,
    autosaveTimer: null,
    editingText: false,
    resizing: false,
    lastScrollTop: 0,      // Recordar posición en la lista
    lastEditedId: null,    // Recordar cuál se editó
    lastSearchQuery: '',   // Memoria del buscador
    selectedItems: new Set(), // Elementos seleccionados para acciones masivas
    editedProductIds: new Set(), // Registro de editados en la sesión
    activeProductTab: 'json'   // Pestaña activa en el panel de productos
  },

  // Selectores de elementos editables
  selectors: {
    texts: [
      'h1', 'h2', 'h3', 'h4', 'p',
      '.linea1', '.header-top-text span',
      '.ib-text b', '.ib-text span',
      'span.precio', '.open-text',
      '.ubicacion small', '.header-web span',
      '.linea1', '.servicio-tecnico', '.linea2',
      'footer p', 'footer span', 'footer a',
      '.categorias-titulo', '.ubicacion-title', '.redes-title'
    ],
    images: [
      'img.logo', 'img.mascota',
      '.banner-slide img', '.banner-slide source',
      '.brands-track img',
      '.card img:not(.fly-product)',
      'img[src]'
    ],
    sections: [
      'section', 'header', 'footer',
      '.destacados', '.brands-carousel',
      '#catalogo-completo > section',
      '.banner-carousel-outer'
    ]
  },

  // ── Seguridad y Sesión ──
  session: {
    idleTimer: null,
    IDLE_TIMEOUT: 30 * 60 * 1000, // 30 minutos

    initInactivityTimer() {
      const resetTimer = () => {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
          this.autoLogout();
        }, this.IDLE_TIMEOUT);
      };

      // Eventos que reinician el contador de inactividad
      ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, resetTimer, { passive: true });
      });

      resetTimer();
      console.log('[PIXIS] Temporizador de inactividad activado (4m)');
    },

    autoLogout() {
      console.warn('[PIXIS] Sesión cerrada por inactividad.');
      window.PixisOverlay.showToast('🔒 Sesión cerrada por inactividad', 'warning', 5000);
      
      setTimeout(() => {
        sessionStorage.removeItem('pixis_session');
        window.location.href = 'login.html';
      }, 1500);
    }
  }
};

/* ════════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════════ */
async function initPixisEditor() {
  console.log('%c[PIXIS LIVE EDITOR] Iniciando...', 'color:#b026ff;font-weight:bold;font-size:13px;');

  // 1. Construir UI del editor
  window.PixisOverlay.buildTopbar();
  window.PixisOverlay.buildElementToolbar();
  window.PixisOverlay.buildSidePanel();
  window.PixisOverlay.buildBackupsSidebar();
  window.PixisOverlay.buildToast();

  populateColorPresets();

  // 2. Asignar IDs estables a todas las cards HTML ANTES de cargar JSON
  autoAssignCardIds();

  // 3. Cargar datos via PixisState (Single Source of Truth)
  if (window.PixisState) {
    await window.PixisState.loadState();
    PixisEditor.data = window.PixisState.state;

    window.PixisState.applyStateToDOM();

    // Envolver applyStateToDOM para que siempre re-inyecte los botones del editor
    const originalApply = window.PixisState.applyStateToDOM.bind(window.PixisState);
    window.PixisState.applyStateToDOM = function() {
      originalApply();
      injectCardEditButtons();
      autoAssignCardIds();
    };
  } else {
    await loadAllData();
    applyLoadedData();
  }

  // 4. Registrar eventos del topbar
  bindTopbarEvents();

  // 5. Registrar eventos globales (click, hover) + botones de edición en cards
  bindGlobalEvents();
  injectCardEditButtons();

  // 6. Iniciar seguridad por inactividad
  PixisEditor.session.initInactivityTimer();

  // 7. Construir UI de acciones masivas flotante
  buildFloatingBulkDeleteUI();

  window.PixisOverlay.showToast('✨ PIXIS Live Editor activado', 'success', 4000);
  console.log('%c[PIXIS LIVE EDITOR] Listo ✓', 'color:#00e676;font-weight:bold;');
}


/* ────────────────────────────────────────────────────────
   UI DE ACCIONES MASIVAS FLOTANTE
──────────────────────────────────────────────────────── */
function buildFloatingBulkDeleteUI() {
  if (document.getElementById('pixis-floating-bulk-delete')) return;
  const btn = document.createElement('button');
  btn.id = 'pixis-floating-bulk-delete';
  btn.innerHTML = `🗑️ Borrar seleccionados (0)`;
  btn.addEventListener('click', () => {
    PixisEditor.bulkDelete('json'); // Por ahora solo JSON en la vista principal
  });
  document.body.appendChild(btn);
}

function updateBulkDeleteFloatingUI() {
  const count = PixisEditor.state.selectedItems.size;
  const btn = document.getElementById('pixis-floating-bulk-delete');
  if (btn) {
    btn.style.display = count > 0 ? 'flex' : 'none';
    btn.innerHTML = `🗑️ Borrar seleccionados (${count})`;
  }
}


/* ════════════════════════════════════════════════════════════════
   CARGA DE DATOS JSON
════════════════════════════════════════════════════════════════ */
async function loadAllData() {
  const files = [
    { key: 'site', path: 'data/site.json' },
    { key: 'products', path: 'data/products.json' },
    { key: 'categories', path: 'data/categories.json' },
    { key: 'ui', path: 'data/ui.json' }
  ];

  await Promise.allSettled(files.map(async ({ key, path }) => {
    try {
      const res = await fetch(path + '?_=' + Date.now());
      if (res.ok) {
        PixisEditor.data[key] = await res.json();
        console.log(`[PIXIS] Datos cargados: ${key}`);
      }
    } catch (e) {
      console.warn(`[PIXIS] No se pudo cargar ${path} — se usarán valores por defecto`);
    }
  }));
}

/* ════════════════════════════════════════════════════════════════
   APLICAR DATOS AL DOM
════════════════════════════════════════════════════════════════ */
function applyLoadedData() {
  const { ui = {}, site = {} } = PixisEditor.data;

  // Aplicar textos guardados
  if (ui.texts) {
    Object.entries(ui.texts).forEach(([dataId, value]) => {
      const el = document.querySelector(`[data-pixis-id="${dataId}"]`);
      if (el) el.textContent = value;
    });
  }

  // Aplicar imágenes guardadas
  if (ui.images) {
    Object.entries(ui.images).forEach(([dataId, value]) => {
      const el = document.querySelector(`[data-pixis-id="${dataId}"]`);
      if (el && el.tagName === 'IMG') el.src = value;
    });
  }

  // Aplicar datos del sitio
  if (site.topBannerText) {
    const banner = document.querySelector('.header-top-text span');
    if (banner) banner.textContent = site.topBannerText;
  }
  if (site.address) {
    const addr = document.querySelector('.ubicacion small');
    if (addr) addr.textContent = site.address;
  }
}

/* ════════════════════════════════════════════════════════════════
   EVENTOS TOPBAR
════════════════════════════════════════════════════════════════ */
function bindTopbarEvents() {
  // Botón guardar
  document.getElementById('editorBtnSave')?.addEventListener('click', saveAllData);

  // Botón deshacer
  document.getElementById('editorBtnUndo')?.addEventListener('click', async () => {
    if (window.PixisState) {
      const ok = await window.PixisState.undo();
      if (ok) window.PixisOverlay.showToast('↩️ Cambio deshecho', 'info', 2000);
    }
  });

  // Botón salir
  document.getElementById('editorBtnExit')?.addEventListener('click', () => {
    if (PixisEditor.state.unsaved) {
      if (!confirm('Tenés cambios sin guardar. ¿Salir igual?')) return;
    }
    // Cerrar sesión y volver al index normal
    sessionStorage.removeItem('pixis_session');
    window.location.href = 'index.html';
  });

  // Botón respaldos (Toggle Sidebar)
  document.getElementById('editorBtnBackups')?.addEventListener('click', () => {
    window.PixisOverlay.toggleBackupsSidebar();
  });

  // Botón cerrar sidebar
  document.getElementById('sidebarClose')?.addEventListener('click', () => {
    window.PixisOverlay.toggleBackupsSidebar(false);
  });

  // Cargar historial en la barra lateral
  refreshBackupsSidebar();

  // Autosave toggle
  document.getElementById('editorAutosave')?.addEventListener('change', (e) => {
    PixisEditor.state.autosave = e.target.checked;
    if (e.target.checked) {
      PixisEditor.state.autosaveTimer = setInterval(() => {
        if (PixisEditor.state.unsaved) saveAllData(true);
      }, 30000);
      window.PixisOverlay.showToast('Autosave activado (cada 30s)', 'info');
    } else {
      clearInterval(PixisEditor.state.autosaveTimer);
    }
  });

  // Botones de modo
  document.getElementById('editorBtnTexts')?.addEventListener('click', () => toggleMode('texts'));
  document.getElementById('editorBtnImages')?.addEventListener('click', () => toggleMode('images'));
  document.getElementById('editorBtnSections')?.addEventListener('click', () => toggleMode('sections'));
  document.getElementById('editorBtnProducts')?.addEventListener('click', openProductsPanel);
  document.getElementById('editorBtnSiteData')?.addEventListener('click', openSiteDataPanel);
  document.getElementById('editorBtnFinanzas')?.addEventListener('click', openFinanzasPanel);
  document.getElementById('editorBtnAdmin')?.addEventListener('click', openAdminConfigPanel);
  document.getElementById('editorBtnRGB')?.addEventListener('click', openRGBConfigPanel);
  document.getElementById('editorBtnDiseno')?.addEventListener('click', openDisenoConfigPanel);
  document.getElementById('editorBtnBannersLaterales')?.addEventListener('click', openBannersLateralesPanel);
  document.getElementById('editorBtnVentas')?.addEventListener('click', () => {
    window.PixisOverlay.showToast('📊 Gestión de ventas — próximamente disponible', 'info', 3000);
  });
}

async function refreshBackupsSidebar() {
  if (!window.PixisState) return;
  const cps = await window.PixisState.getCheckpoints();
  
  window.PixisOverlay.updateBackupsSidebar(cps, {
    onCreate: async (name) => {
      window.PixisOverlay.showToast('🛡️ Creando respaldo...', 'info');
      const ok = await window.PixisState.createCheckpoint(name);
      if (ok) {
        window.PixisOverlay.showToast('✅ Respaldo creado', 'success');
        refreshBackupsSidebar();
      }
    },
    onRestore: async (id) => {
      if (!confirm('⚠️ ¿Estás seguro? Se perderán los cambios actuales no guardados.')) return;
      window.PixisOverlay.showToast('🔄 Restaurando...', 'info');
      const ok = await window.PixisState.restoreCheckpoint(id);
      if (ok) {
        window.PixisOverlay.showToast('✅ Restauración completada. Recargando...', 'success');
        setTimeout(() => window.location.reload(), 1500);
      }
    },
    onDelete: async (id) => {
      if (!confirm('¿Eliminar este respaldo?')) return;
      const ok = await window.PixisState.deleteCheckpoint(id);
      if (ok) refreshBackupsSidebar();
    },
    onDeleteMany: async (ids) => {
      let anyFailed = false;
      for (const id of ids) {
        const ok = await window.PixisState.deleteCheckpoint(id);
        if (!ok) anyFailed = true;
      }
      window.PixisOverlay.showToast(
        anyFailed ? '⚠️ Algunos respaldos no pudieron eliminarse' : `🗑️ ${ids.length} respaldo${ids.length > 1 ? 's eliminados' : ' eliminado'}`,
        anyFailed ? 'warning' : 'success'
      );
      refreshBackupsSidebar();
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   MODOS DE EDICIÓN (resaltar elementos)
════════════════════════════════════════════════════════════════ */
function toggleMode(mode) {
  const wasActive = PixisEditor.state.activeMode === mode;

  // Desactivar todos los modos
  clearAllModes();

  if (!wasActive) {
    PixisEditor.state.activeMode = mode;
    highlightElements(mode);
    updateModeButtons(mode);
  }
}

function clearAllModes() {
  PixisEditor.state.activeMode = null;

  // Remover clases de highlight
  document.querySelectorAll('.pixis-editable, .pixis-editable-text, .pixis-editable-image, .pixis-editable-section').forEach(el => {
    el.classList.remove('pixis-editable', 'pixis-editable-text', 'pixis-editable-image', 'pixis-editable-section');
    el.removeAttribute('data-pixis-type');
  });

  updateModeButtons(null);
  window.PixisOverlay.hideToolbar();
}

function highlightElements(mode) {
  const classMap = {
    texts: 'pixis-editable-text',
    images: 'pixis-editable-image',
    sections: 'pixis-editable-section'
  };

  const selectorList = PixisEditor.selectors[mode] || [];
  const cssClass = classMap[mode];

  selectorList.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach((el, i) => {
        // No marcar elementos del editor ni funcionales del header
        if (el.closest('#pixis-editor-topbar') || el.closest('#pixis-side-panel') ||
            el.closest('#pixis-element-toolbar') || el.closest('.pixis-modal-overlay') ||
            el.closest('.theme-toggle')) return;

        el.classList.add('pixis-editable', cssClass);
        el.setAttribute('data-pixis-type', mode);

        // Asignar data-pixis-id determinístico
        if (!el.dataset.pixisId) {
          el.dataset.pixisId = window.getCssPath ? window.getCssPath(el) : `${mode}-${i}-${Date.now()}`;
        }
      });
    } catch (e) { /* selector inválido */ }
  });
}

function updateModeButtons(activeMode) {
  ['editorBtnTexts', 'editorBtnImages', 'editorBtnSections'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const modeMap = { editorBtnTexts: 'texts', editorBtnImages: 'images', editorBtnSections: 'sections' };
    btn.classList.toggle('active', modeMap[id] === activeMode);
  });
}

/* ════════════════════════════════════════════════════════════════
   EVENTOS GLOBALES (CLICK, HOVER)
════════════════════════════════════════════════════════════════ */
function bindGlobalEvents() {
  // ── Click en elementos editables ──
  document.addEventListener('click', handleElementClick, true);

  // ── Mousedown en elementos editables (Arrastre instantáneo) ──
  document.addEventListener('mousedown', handleElementMouseDown, true);

  // ── Doble click en texto → edición inline ──
  document.addEventListener('dblclick', handleTextDoubleClick, true);

  // Delegación de eventos para botones en las cards (Captura para bloquear modal público)
  document.addEventListener('click', handleProductCardClick, true);

  // ── Mouse Move para Resizing ──
  document.addEventListener('mousemove', handleGlobalMouseMove);
  document.addEventListener('mouseup', handleGlobalMouseUp);
  const updateUI = () => {
    if (PixisEditor.state.selectedElement && resizerBox && resizerBox.classList.contains('visible')) {
      updateResizerPosition(PixisEditor.state.selectedElement);
      window.PixisOverlay.positionToolbar(PixisEditor.state.selectedElement);
    }
  };
  window.addEventListener('scroll', updateUI);
  window.addEventListener('resize', updateUI);

  // ── ESC para cerrar edición / panel / modal / sidebar ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // 1. Terminar edición de texto inline si existe
      if (typeof commitTextEdit === 'function') commitTextEdit();
      
      // 2. Cerrar modales activos
      if (window.PixisOverlay?.closeModal) window.PixisOverlay.closeModal();
      
      // 3. Cerrar panel lateral
      if (window.PixisOverlay?.closePanel) window.PixisOverlay.closePanel();
      
      // 4. Cerrar sidebar de backups
      if (window.PixisOverlay?.toggleBackupsSidebar) window.PixisOverlay.toggleBackupsSidebar(false);
      
      // 5. Ocultar toolbar flotante
      if (window.PixisOverlay?.hideToolbar) window.PixisOverlay.hideToolbar();
      
      // 6. Cerrar modal de producto del carrito (por si acaso)
      if (typeof window.cerrarModalProducto === 'function') window.cerrarModalProducto();
    }

    // ── ENTER para "Aplicar" en paneles o modales ──
    // Eliminado: Ahora se gestiona de forma global en overlay.js para mayor compatibilidad

    // ── Ctrl+Z para Deshacer ──
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (window.PixisState && !PixisEditor.state.editingText) {
        e.preventDefault();
        window.PixisState.undo().then(ok => {
          if (ok) window.PixisOverlay.showToast('↩️ Cambio deshecho (Ctrl+Z)', 'info', 2000);
        });
      }
    }
    // ── Ctrl+S para Guardar ──
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (typeof saveAllData === 'function') saveAllData();
    }
  });

  // ── Element toolbar buttons ──
  document.getElementById('etbEdit')?.addEventListener('click', () => {
    const el = PixisEditor.state.selectedElement;
    if (!el) return;
    const type = el.dataset.pixisType;
    if (type === 'texts') startTextEdit(el);
    if (type === 'images') openImageEditor(el);
    if (type === 'sections') openSectionEditor(el);
  });

  document.getElementById('etbAlign')?.addEventListener('click', () => {
    const el = PixisEditor.state.selectedElement;
    if (!el || el.dataset.pixisType !== 'texts') return;
    
    const aligns = ['left', 'center', 'right'];
    const current = window.getComputedStyle(el).textAlign;
    let nextIndex = (aligns.indexOf(current) + 1) % aligns.length;
    if (nextIndex < 0) nextIndex = 1; // Default to center if unknown
    
    el.style.textAlign = aligns[nextIndex];
    saveElementStyles(el);
    window.PixisOverlay.showToast(`Alineación: ${aligns[nextIndex]}`, 'info', 1000);
  });

  // Controles de texto agregados
  document.getElementById('etbFontSize')?.addEventListener('input', (e) => {
    const el = PixisEditor.state.selectedElement;
    if (!el || el.dataset.pixisType !== 'texts') return;
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      el.style.fontSize = `${val}px`;
      updateResizerPosition(el);
      window.PixisOverlay.positionToolbar(el);
      saveElementStyles(el);
    }
  });

  document.getElementById('etbFontFamily')?.addEventListener('change', (e) => {
    const el = PixisEditor.state.selectedElement;
    if (!el || el.dataset.pixisType !== 'texts') return;
    el.style.fontFamily = e.target.value;
    updateResizerPosition(el);
    window.PixisOverlay.positionToolbar(el);
    saveElementStyles(el);
  });

  document.addEventListener('click', (e) => {
    const targetColorBtn = e.target.closest('#etbColorBtn');
    if (targetColorBtn) {
      e.stopPropagation();
      const currentPopover = document.getElementById('pixis-color-popover');
      if (!currentPopover) return;
      const isVisible = currentPopover.style.display === 'block';
      currentPopover.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        const btnRect = targetColorBtn.getBoundingClientRect();
        let top = btnRect.bottom + window.scrollY + 6;
        let left = btnRect.left + window.scrollX - 100;
        
        // Asegurarse de que no se salga por la derecha
        const popoverWidth = 250;
        if (left + popoverWidth > window.innerWidth) {
          left = window.innerWidth - popoverWidth - 16;
        }
        // Asegurarse de que no se salga por la izquierda
        if (left < 16) {
          left = 16;
        }
        
        currentPopover.style.top = `${top}px`;
        currentPopover.style.left = `${left}px`;
      }
    }
  });

  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('#etbColorPopoverClose');
    if (closeBtn) {
      e.stopPropagation();
      const currentPopover = document.getElementById('pixis-color-popover');
      if (currentPopover) currentPopover.style.display = 'none';
    }
  });

  // Cerrar al hacer click afuera
  document.addEventListener('click', (e) => {
    const currentPopover = document.getElementById('pixis-color-popover');
    if (currentPopover && currentPopover.style.display === 'block' && !currentPopover.contains(e.target) && !e.target.closest('#etbColorBtn')) {
      currentPopover.style.display = 'none';
    }
  });

  // Tabs del popover de colores dinámico
  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.popover-tab');
    if (tabBtn) {
      e.stopPropagation();
      const currentPopover = document.getElementById('pixis-color-popover');
      if (!currentPopover) return;
      currentPopover.querySelectorAll('.popover-tab').forEach(b => b.classList.remove('active'));
      currentPopover.querySelectorAll('.popover-grid').forEach(g => g.classList.remove('active'));
      
      tabBtn.classList.add('active');
      const tabId = tabBtn.dataset.tab;
      if (tabId === 'solids') {
        document.getElementById('popoverGridSolids').classList.add('active');
      } else {
        document.getElementById('popoverGridGradients').classList.add('active');
      }
    }
  });

  // Custom Color Input dinámico
  document.addEventListener('input', (e) => {
    if (e.target.id === 'etbCustomColorPicker') {
      applyColorToSelected(e.target.value, false);
    }
  });

  document.getElementById('etbDuplicate')?.addEventListener('click', duplicateElement);
  document.getElementById('etbMoveUp')?.addEventListener('click', () => moveElement(-1));
  document.getElementById('etbMoveDown')?.addEventListener('click', () => moveElement(1));
  document.getElementById('etbDelete')?.addEventListener('click', deleteElement);
}

/* ════════════════════════════════════════════════════════════════
   MOUSEDOWN HANDLER PRINCIPAL (ARRASTRE INSTANTÁNEO)
   Permite seleccionar y empezar a arrastrar un elemento con un solo click
════════════════════════════════════════════════════════════════ */
function handleElementMouseDown(e) {
  if (!PixisEditor.state.activeMode) return;
  const el = e.target.closest('.pixis-editable');
  if (!el) return;

  // Evitar clicks en el resizer box o en el toolbar
  if (e.target.closest('#pixis-element-toolbar') || e.target.closest('.pixis-resizer-box') || 
      e.target.closest('#pixis-editor-topbar') || e.target.closest('#pixis-side-panel') || 
      e.target.closest('.pixis-modal-overlay')) return;

  e.preventDefault();
  e.stopPropagation();

  // Si había un texto en edición, commitear
  commitTextEdit();

  PixisEditor.state.selectedElement = el;

  // Actualizar label del toolbar
  const label = document.getElementById('etbLabel');
  if (label) {
    const typeLabel = { texts: '📝 Texto', images: '🖼️ Imagen', sections: '📦 Sección', default: 'Elemento' };
    label.textContent = typeLabel[el.dataset.pixisType] || typeLabel.default;
  }

  // Mostrar u ocultar controles de texto en la barra de herramientas
  const textControls = document.getElementById('etbTextControls');
  const textSep = document.getElementById('etbTextSep');
  const popover = document.getElementById('pixis-color-popover');
  
  if (el.dataset.pixisType === 'texts') {
    if (textControls) textControls.style.display = 'flex';
    if (textSep) textSep.style.display = 'block';
    
    // Sincronizar tamaño y familia de fuente actuales
    const style = window.getComputedStyle(el);
    const sizeInput = document.getElementById('etbFontSize');
    if (sizeInput) {
      sizeInput.value = Math.round(parseFloat(style.fontSize));
    }
    const familySelect = document.getElementById('etbFontFamily');
    if (familySelect) {
      const currentFF = style.fontFamily.replace(/['"]/g, '').split(',')[0].trim().toLowerCase();
      let matchedValue = '';
      for (const opt of familySelect.options) {
        if (opt.value && opt.value.toLowerCase().includes(currentFF)) {
          matchedValue = opt.value;
          break;
        }
      }
      familySelect.value = matchedValue;
    }
  } else {
    if (textControls) textControls.style.display = 'none';
    if (textSep) textSep.style.display = 'none';
    if (popover) popover.style.display = 'none';
  }

  window.PixisOverlay.positionToolbar(el);

  // Mostrar resizer
  if (el.dataset.pixisType === 'texts' || el.dataset.pixisType === 'images') {
    showResizer(el);
  } else {
    hideResizer();
  }

  if (el.dataset.pixisType === 'images' && el.tagName === 'IMG') {
    openImageEditor(el);
  }

  if (el.dataset.pixisType === 'sections') {
    openSectionEditor(el);
  }

  // Iniciar arrastre inmediato
  if (el.dataset.pixisType === 'texts' || el.dataset.pixisType === 'images') {
    PixisEditor.state.resizing = true;
    currentResizeHandle = 'move';
    
    initialMouseX = e.clientX;
    initialMouseY = e.clientY;
    
    const style = window.getComputedStyle(el);
    initialWidth = parseFloat(style.width);
    initialFontSize = parseFloat(style.fontSize);
    initialLineHeight = parseFloat(style.lineHeight) || initialFontSize * 1.2;

    const matrix = new DOMMatrix(style.transform);
    initialTranslateX = matrix.m41;
    initialTranslateY = matrix.m42;

    el.classList.add('resizing');
    if (resizerBox) resizerBox.classList.add('grabbing');
    document.body.style.cursor = 'grabbing';
  }
}

/* ════════════════════════════════════════════════════════════════
   CLICK HANDLER PRINCIPAL
   Conserva la selección de elementos en click estándar
════════════════════════════════════════════════════════════════ */
function handleElementClick(e) {
  const el = e.target.closest('.pixis-editable');
  if (!el) return;

  // Prevenir navegación mientras estamos en modo edición
  if (PixisEditor.state.activeMode) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Si había un texto en edición, commitear
  commitTextEdit();

  PixisEditor.state.selectedElement = el;

  // Actualizar label del toolbar
  const label = document.getElementById('etbLabel');
  if (label) {
    const typeLabel = { texts: '📝 Texto', images: '🖼️ Imagen', sections: '📦 Sección', default: 'Elemento' };
    label.textContent = typeLabel[el.dataset.pixisType] || typeLabel.default;
  }

  // Mostrar u ocultar controles de texto en la barra de herramientas
  const textControls = document.getElementById('etbTextControls');
  const textSep = document.getElementById('etbTextSep');
  const popover = document.getElementById('pixis-color-popover');
  
  if (el.dataset.pixisType === 'texts') {
    if (textControls) textControls.style.display = 'flex';
    if (textSep) textSep.style.display = 'block';
    
    // Sincronizar tamaño y familia de fuente actuales
    const style = window.getComputedStyle(el);
    const sizeInput = document.getElementById('etbFontSize');
    if (sizeInput) {
      sizeInput.value = Math.round(parseFloat(style.fontSize));
    }
    const familySelect = document.getElementById('etbFontFamily');
    if (familySelect) {
      const currentFF = style.fontFamily.replace(/['"]/g, '').split(',')[0].trim().toLowerCase();
      // Buscar coincidencia parcial
      let matchedValue = '';
      for (const opt of familySelect.options) {
        if (opt.value && opt.value.toLowerCase().includes(currentFF)) {
          matchedValue = opt.value;
          break;
        }
      }
      familySelect.value = matchedValue;
    }
  } else {
    if (textControls) textControls.style.display = 'none';
    if (textSep) textSep.style.display = 'none';
    if (popover) popover.style.display = 'none';
  }

  window.PixisOverlay.positionToolbar(el);

  // Si es texto o imagen → mostrar resizer
  if (el.dataset.pixisType === 'texts' || el.dataset.pixisType === 'images') {
    showResizer(el);
  } else {
    hideResizer();
  }

  // Si es imagen → abrir editor directamente
  if (el.dataset.pixisType === 'images' && el.tagName === 'IMG') {
    openImageEditor(el);
  }

  // Si es sección → mostrar en panel lateral
  if (el.dataset.pixisType === 'sections') {
    openSectionEditor(el);
  }
}

/* ════════════════════════════════════════════════════════════════
   SISTEMA DE RESIZER VISUAL
   Permite achicar el ancho (wrapping) y estirar la letra (font-size)
════════════════════════════════════════════════════════════════ */
let resizerBox = null;
let currentResizeHandle = null;
let initialMouseX, initialMouseY;
let initialWidth, initialFontSize, initialLineHeight;
let initialTranslateX = 0, initialTranslateY = 0;

function showResizer(el) {
  if (!resizerBox) createResizer();
  
  resizerBox.classList.add('visible');
  updateResizerPosition(el);
}

function hideResizer() {
  if (resizerBox) resizerBox.classList.remove('visible');
}

function createResizer() {
  resizerBox = document.createElement('div');
  resizerBox.className = 'pixis-resizer-box';
  resizerBox.innerHTML = `
    <div class="pixis-resizer-handle move" data-handle="move" title="Mover libremente"></div>
    <div class="pixis-resizer-handle right" data-handle="width" title="Ajustar ancho"></div>
    <div class="pixis-resizer-handle bottom" data-handle="line-height" title="Ajustar interlineado"></div>
    <div class="pixis-resizer-handle bottom-right" data-handle="font-size" title="Ajustar tamaño de letra"></div>
  `;
  document.body.appendChild(resizerBox);

  // Mousedown en el cuerpo del resizer -> mover desde el centro/cualquier parte
  resizerBox.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('pixis-resizer-handle')) return;
    
    const el = PixisEditor.state.selectedElement;
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();

    PixisEditor.state.resizing = true;
    currentResizeHandle = 'move';
    
    initialMouseX = e.clientX;
    initialMouseY = e.clientY;
    
    const style = window.getComputedStyle(el);
    initialWidth = parseFloat(style.width);
    initialFontSize = parseFloat(style.fontSize);
    initialLineHeight = parseFloat(style.lineHeight) || initialFontSize * 1.2;

    const matrix = new DOMMatrix(style.transform);
    initialTranslateX = matrix.m41;
    initialTranslateY = matrix.m42;

    el.classList.add('resizing');
    resizerBox.classList.add('grabbing');
    document.body.style.cursor = 'grabbing';
  });

  // Doble click en el resizer -> edición inline de texto
  resizerBox.addEventListener('dblclick', (e) => {
    if (e.target.classList.contains('pixis-resizer-handle')) return;
    
    const el = PixisEditor.state.selectedElement;
    if (!el || el.dataset.pixisType !== 'texts') return;
    
    e.preventDefault();
    e.stopPropagation();
    startTextEdit(el);
  });

  resizerBox.querySelectorAll('.pixis-resizer-handle').forEach(h => {
    h.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const el = PixisEditor.state.selectedElement;
      if (!el) return;

      PixisEditor.state.resizing = true;
      currentResizeHandle = e.target.dataset.handle;
      
      initialMouseX = e.clientX;
      initialMouseY = e.clientY;
      
      const style = window.getComputedStyle(el);
      initialWidth = parseFloat(style.width);
      initialFontSize = parseFloat(style.fontSize);
      initialLineHeight = parseFloat(style.lineHeight) || initialFontSize * 1.2;

      // Obtener transform actual
      const matrix = new DOMMatrix(style.transform);
      initialTranslateX = matrix.m41;
      initialTranslateY = matrix.m42;

      el.classList.add('resizing');
      document.body.style.cursor = window.getComputedStyle(e.target).cursor;
    });
  });
}

function updateResizerPosition(el) {
  if (!resizerBox || !el) return;
  
  const rect = el.getBoundingClientRect();
  resizerBox.style.width = `${rect.width}px`;
  resizerBox.style.height = `${rect.height}px`;
  resizerBox.style.top = `${rect.top + window.scrollY}px`;
  resizerBox.style.left = `${rect.left + window.scrollX}px`;
}

function handleGlobalMouseMove(e) {
  if (!PixisEditor.state.resizing || !PixisEditor.state.selectedElement) return;

  const el = PixisEditor.state.selectedElement;
  const dx = e.clientX - initialMouseX;
  const dy = e.clientY - initialMouseY;

  if (currentResizeHandle === 'width') {
    el.style.width = `${initialWidth + dx}px`;
    el.style.display = 'inline-block'; // Asegurar que respete el width
    el.style.maxWidth = '100%';
  }
  
  if (currentResizeHandle === 'font-size') {
    // Proporcional al movimiento diagonal o mayor de los dos
    const delta = Math.max(dx, dy);
    const newSize = Math.max(8, Math.round(initialFontSize + (delta * 0.5)));
    el.style.fontSize = `${newSize}px`;
    const sizeInput = document.getElementById('etbFontSize');
    if (sizeInput) {
      sizeInput.value = newSize;
    }
  }

  if (currentResizeHandle === 'line-height') {
    el.style.lineHeight = `${initialLineHeight + dy}px`;
  }

  if (currentResizeHandle === 'move') {
    el.style.transform = `translate(${initialTranslateX + dx}px, ${initialTranslateY + dy}px)`;
    // Si no tiene posición relativa/absoluta, forzarla para que el transform no rompa el flujo de forma rara
    if (window.getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
      el.style.zIndex = '100';
    }
  }

  updateResizerPosition(el);
  window.PixisOverlay.positionToolbar(el);
}

function handleGlobalMouseUp() {
  if (!PixisEditor.state.resizing) return;

  PixisEditor.state.resizing = false;
  document.body.style.cursor = '';
  if (resizerBox) resizerBox.classList.remove('grabbing');
  
  const el = PixisEditor.state.selectedElement;
  if (el) {
    el.classList.remove('resizing');
    saveElementStyles(el);
  }
  
  currentResizeHandle = null;
}

function saveElementStyles(el) {
  const id = el.dataset.pixisId;
  if (!id) return;
  const type = el.dataset.pixisType; // 'texts' o 'images'

  const styles = {
    width: el.style.width,
    fontSize: el.style.fontSize,
    lineHeight: el.style.lineHeight,
    textAlign: el.style.textAlign,
    display: el.style.display,
    transform: el.style.transform,
    position: el.style.position,
    zIndex: el.style.zIndex,
    color: el.style.color,
    fontFamily: el.style.fontFamily,
    background: el.style.background,
    webkitBackgroundClip: el.style.webkitBackgroundClip,
    webkitTextFillColor: el.style.webkitTextFillColor
  };

  let updateData;
  if (type === 'texts') {
    const hasTags = el.innerHTML.includes('<') && el.innerHTML.includes('>');
    updateData = {
      [hasTags ? 'html' : 'text']: hasTags ? el.innerHTML : el.textContent.trim(),
      style: styles
    };
  } else if (type === 'images') {
    // Si ya existían datos de imagen (src, alt, href), mantenerlos
    const existing = (PixisEditor.data.ui.images || {})[id] || {};
    updateData = {
      ...existing,
      src: el.src,
      alt: el.alt,
      style: styles
    };
  } else {
    return; // No soportado aún
  }

  if (window.PixisState) {
    window.PixisState.updateState({ type: 'ui', path: [type, id], value: updateData })
      .then(() => {
        window.PixisOverlay.showToast('✨ Cambios visuales guardados', 'success', 1000);
        markUnsaved();
      });
  } else {
    if (!PixisEditor.data.ui[type]) PixisEditor.data.ui[type] = {};
    PixisEditor.data.ui[type][id] = updateData;
    markUnsaved();
  }
}

/* ════════════════════════════════════════════════════════════════
   DOBLE CLICK → EDICIÓN DE TEXTO INLINE
════════════════════════════════════════════════════════════════ */
function handleTextDoubleClick(e) {
  const el = e.target.closest('.pixis-editable-text');
  if (!el) return;

  e.preventDefault();
  e.stopPropagation();
  startTextEdit(el);
}

function startTextEdit(el) {
  if (PixisEditor.state.editingText) commitTextEdit();

  hideResizer(); // Ocultar resizer para poder posicionar cursor libremente

  el.classList.add('editing');
  el.contentEditable = 'true';
  el.focus();

  // Seleccionar todo el texto
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  PixisEditor.state.editingText = true;
  PixisEditor.state.selectedElement = el;

  el.addEventListener('keydown', handleTextEditKeydown);
  el.addEventListener('blur', commitTextEdit, { once: true });

  window.PixisOverlay.showToast('✏️ Editando texto — Enter para guardar, Esc para cancelar', 'info', 3000);
}

function handleTextEditKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commitTextEdit();
  }
}

function commitTextEdit() {
  if (!PixisEditor.state.editingText) return;

  const el = PixisEditor.state.selectedElement;
  if (!el || el.contentEditable !== 'true') return;

  el.contentEditable = 'false';
  el.classList.remove('editing');
  el.removeEventListener('keydown', handleTextEditKeydown);
  PixisEditor.state.editingText = false;

  // Mostrar de nuevo el resizer si sigue seleccionado
  if (el && (el.dataset.pixisType === 'texts' || el.dataset.pixisType === 'images')) {
    showResizer(el);
  }

  // Guardar en datos via PixisState → JSON
  const id = el.dataset.pixisId;
  const text = el.textContent.trim();
  
  if (id && text) {
    const value = {
      text: text,
      style: {
        width: el.style.width,
        fontSize: el.style.fontSize,
        lineHeight: el.style.lineHeight,
        textAlign: el.style.textAlign,
        display: el.style.display,
        transform: el.style.transform,
        position: el.style.position,
        zIndex: el.style.zIndex,
        color: el.style.color,
        fontFamily: el.style.fontFamily,
        background: el.style.background,
        webkitBackgroundClip: el.style.webkitBackgroundClip,
        webkitTextFillColor: el.style.webkitTextFillColor
      }
    };

    if (window.PixisState) {
      window.PixisState.updateState({ type: 'ui', path: ['texts', id], value })
        .then(saved => {
          window.PixisOverlay.showToast(saved ? '✅ Texto guardado' : '📥 Texto actualizado (descargá JSON)', 'success', 1500);
          markUnsaved();
        });
    } else {
      if (!PixisEditor.data.ui.texts) PixisEditor.data.ui.texts = {};
      PixisEditor.data.ui.texts[id] = value;
      markUnsaved();
      window.PixisOverlay.showToast('Texto actualizado', 'success', 1500);
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   EDITOR DE IMAGEN
════════════════════════════════════════════════════════════════ */
function openImageEditor(imgEl) {
  // Función auxiliar para obtener ruta relativa limpia sin dominio ni query params de versionado
  const cleanImgPath = (url) => {
    if (!url) return '';
    return url.replace(/^https?:\/\/[^\/]+\//, '').split('?')[0].split('#')[0].trim();
  };

  const currentRawSrc = imgEl.getAttribute('src') || imgEl.src || imgEl.getAttribute('srcset') || '';
  const currentCleanSrc = cleanImgPath(currentRawSrc);

  // Detectar si la imagen pertenece a una categoría del menú de productos
  const catLink = imgEl.closest('.categorias-lista a');
  const catIdFromData = imgEl.dataset.catId || (catLink?.getAttribute('href') || '').replace('#', '');
  const isCatIcon = Boolean(catIdFromData && (imgEl.classList.contains('cat-icon-img') || catLink));

  const body = `
    <div class="panel-section">
      <div class="panel-section-title">🖼️ Vista previa</div>
      <img src="${currentRawSrc}" id="imgPreviewModal" class="panel-img-preview" alt="Preview">
    </div>

    <div class="panel-section">
      <div class="panel-section-title">📁 Archivo local</div>
      <div class="panel-field">
        <label class="panel-label">Seleccionar imagen del equipo</label>
        <input type="file" id="imgFileInput" class="panel-input" accept="image/*,image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
               style="padding:4px;font-size:11px;cursor:pointer;">
        <div style="font-size:10px;color:#666;margin-top:2px;">Sube una foto directamente desde tu computadora (${isCatIcon ? 'se guardará en img/categorias/' : 'se guardará en img/uploads/'}).</div>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">🔗 URL de imagen</div>
      <div class="panel-field">
        <label class="panel-label">Ruta de la imagen</label>
        <input type="text" id="imgUrlInput" class="panel-input" 
               placeholder="img/uploads/foto.jpg"
               value="${escHtml(currentCleanSrc)}">
        <div style="font-size:10px;color:#666;margin-top:2px;">Ruta relativa o enlace web de la imagen.</div>
      </div>
      <button class="panel-btn" id="imgPreviewBtn">👁️ Ver preview</button>
    </div>

      <div class="panel-section">
        <div class="panel-section-title">📐 Alternativa responsiva</div>
        <div class="panel-field">
          <label class="panel-label">Alt text (descripción SEO)</label>
          <input type="text" id="imgAltInput" class="panel-input" 
                 placeholder="Descripción de la imagen"
                 value="${escHtml(imgEl.alt || '')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">Breve descripción de la imagen para mejorar el posicionamiento en Google.</div>
        </div>
      </div>

      ${!isCatIcon ? `
      <div class="panel-section">
        <div class="panel-section-title">🔗 Enlace de destino (Link)</div>
        <div style="font-size:11px;color:#999;margin-bottom:12px;line-height:1.4;">
          <strong>¿Qué es esto?</strong> Aquí puedes elegir qué sucede cuando alguien hace clic en esta imagen. Lo más común es usarla como un "botón" hacia una de tus promociones (Banners).
        </div>
        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label">Vincular a un Banner Promocional existente:</label>
          <select class="panel-select" id="imgBannerSelect" onchange="if(this.value) document.getElementById('imgHrefInput').value = '?banner=' + this.value;">
            <option value="">-- No enlazar a un banner --</option>
            ${window._bannerData ? Object.entries(window._bannerData).map(([bId, bData]) => {
              const currentHref = imgEl.closest('a')?.getAttribute('href') || '';
              const isSelected = currentHref === '?banner=' + bId ? 'selected' : '';
              return `<option value="${escHtml(bId)}" ${isSelected}>${escHtml(bData.t)}</option>`;
            }).join('') : ''}
          </select>
        </div>
        <div class="panel-field">
          <label class="panel-label">URL manual</label>
          <input type="text" id="imgHrefInput" class="panel-input" 
                 placeholder="Ej: ?banner=navidad-2026 o https://google.com"
                 value="${escHtml(imgEl.closest('a')?.getAttribute('href') || '')}">
        </div>
      </div>
      ` : ''}
    `;

  const footer = `
    <button class="panel-btn" onclick="window.PixisOverlay.closeModal()">Cancelar</button>
    <button class="panel-btn panel-btn-primary" id="imgApplyBtn">✅ Aplicar imagen</button>
  `;

  window.PixisOverlay.openModal('<span class="modal-icon">🖼️</span> Editar imagen', body, footer);

  // File input → upload al servidor y preview
  document.getElementById('imgFileInput')?.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;

    // Mostrar preview inmediato en base64 mientras sube
    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = document.getElementById('imgPreviewModal');
      if (preview) preview.src = e.target.result;
    };
    reader.readAsDataURL(file);

    // Subir al servidor para obtener ruta real
    try {
      window.PixisOverlay.showToast('📤 Subiendo imagen...', 'info', 2000);
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      
      let folder = 'img/uploads';
      let filename = `img-${Date.now()}.${ext}`;

      if (isCatIcon) {
        folder = 'img/categorias';
        const cleanCatId = catIdFromData.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        filename = `cat-${cleanCatId}-${Date.now()}.${ext}`;
      }

      const res = await fetch(`/api/upload-image?filename=${encodeURIComponent(filename)}&folder=${encodeURIComponent(folder)}`, {
        method: 'POST',
        body: file
      });
      const data = await res.json();
      if (data.ok && data.url) {
        document.getElementById('imgUrlInput').value = data.url;
        const preview = document.getElementById('imgPreviewModal');
        if (preview) preview.src = data.url;
        window.PixisOverlay.showToast('✅ Imagen subida: ' + data.url, 'success', 3000);
      } else {
        window.PixisOverlay.showToast('⚠️ No se pudo subir al servidor: ' + (data.error || ''), 'warning', 4000);
      }
    } catch (e) {
      window.PixisOverlay.showToast('⚠️ Error al subir imagen: ' + e.message, 'warning', 4000);
    }
  });

  // URL preview
  document.getElementById('imgPreviewBtn')?.addEventListener('click', () => {
    const url = document.getElementById('imgUrlInput').value.trim();
    if (url) {
      const preview = document.getElementById('imgPreviewModal');
      if (preview) preview.src = url;
    }
  });

  // Aplicar
  document.getElementById('imgApplyBtn')?.addEventListener('click', async () => {
    const rawSrc = document.getElementById('imgUrlInput').value.trim();
    const newAlt = document.getElementById('imgAltInput').value.trim();
    const hrefInput = document.getElementById('imgHrefInput');
    const newHref = hrefInput ? hrefInput.value.trim() : '';

    if (!rawSrc) {
      window.PixisOverlay.showToast('Ingresá una URL o seleccioná un archivo', 'error');
      return;
    }

    const cleanNewSrc = cleanImgPath(rawSrc);
    const cleanOldSrc = currentCleanSrc;

    // ── CASO A: Imagen de Categoría en el Menú de Productos ──
    if (isCatIcon) {
      const catId = catIdFromData;
      const cat = (PixisEditor.data.categories || []).find(c => c.id === catId);
      const stateCat = (window.PixisState?.state?.categories || []).find(c => c.id === catId);

      // 🗑️ Eliminar la imagen anterior físicamente del servidor si pertenecía a img/categorias o img/uploads y cambió
      const oldIconUrl = (cat && cat.customIcon) || cleanOldSrc;
      if (oldIconUrl && (oldIconUrl.startsWith('img/categorias/') || oldIconUrl.startsWith('img/uploads/')) && oldIconUrl !== cleanNewSrc) {
        try {
          await fetch('/api/remove-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: oldIconUrl })
          });
        } catch (delErr) {
          console.warn('[PixisEditor] No se pudo borrar el icono previo del servidor:', delErr);
        }
      }

      if (cat) cat.customIcon = cleanNewSrc;
      if (stateCat) stateCat.customIcon = cleanNewSrc;

      // Sincronizar en el input del modal lateral si está abierto
      const modalCustomInput = document.getElementById('editCatCustomIcon');
      if (modalCustomInput) modalCustomInput.value = cleanNewSrc;

      // Persistir via PixisState y refrescar DOM
      if (window.PixisState) {
        window.PixisState.pushHistory();
        await window.PixisState.saveState();
        window.PixisState.applyStateToDOM();
      }

      markUnsaved();
      window.PixisOverlay.closeModal();
      window.PixisOverlay.showToast('✅ Ícono de categoría actualizado y limpiado en disco', 'success');
      return;
    }

    // ── CASO B: Imagen UI Normal ──
    // 🗑️ Eliminar imagen previa del servidor si fue una subida personalizada en img/uploads
    if (cleanOldSrc && cleanOldSrc.startsWith('img/uploads/') && cleanOldSrc !== cleanNewSrc) {
      try {
        await fetch('/api/remove-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cleanOldSrc })
        });
      } catch (delErr) {
        console.warn('[PixisEditor] No se pudo borrar la imagen previa del servidor:', delErr);
      }
    }

    // Actualizar DOM
    imgEl.src = cleanNewSrc;
    if (newAlt) imgEl.alt = newAlt;
    
    let aParent = imgEl.closest('a');
    if (newHref) {
      if (!aParent) {
         aParent = document.createElement('a');
         imgEl.parentNode.insertBefore(aParent, imgEl);
         aParent.appendChild(imgEl);
      }
      aParent.href = newHref;
      aParent.removeAttribute('onclick');
    } else if (aParent && !newHref && !isCatIcon) {
      aParent.removeAttribute('href');
    }

    // Guardar via PixisState → JSON
    const id = imgEl.dataset.pixisId;
    if (id && window.PixisState) {
      window.PixisState.updateState({ type: 'ui', path: ['images', id], value: { src: cleanNewSrc, alt: newAlt, href: newHref } })
        .then(saved => markUnsaved());
    } else if (id) {
      if (!PixisEditor.data.ui.images) PixisEditor.data.ui.images = {};
      PixisEditor.data.ui.images[id] = { src: cleanNewSrc, alt: newAlt, href: newHref };
      markUnsaved();
    }

    window.PixisOverlay.closeModal();
    window.PixisOverlay.showToast('✅ Imagen actualizada', 'success');
  });
}

/* ════════════════════════════════════════════════════════════════
   EDITOR DE SECCIÓN
════════════════════════════════════════════════════════════════ */
function openSectionEditor(section) {
  const sectionName = section.id || section.className.split(' ')[0] || 'sección';
  const childCount = section.querySelectorAll('.card, h2, h3, img').length;

  window.PixisOverlay.openPanel(
    `📦 Sección: ${sectionName}`,
    `
    <div class="panel-section">
      <div class="panel-section-title">📋 Información</div>
      <div class="panel-field">
        <label class="panel-label">ID / Clase</label>
        <input class="panel-input" value="${sectionName}" readonly>
      </div>
      <div class="panel-field">
        <label class="panel-label">Elementos internos</label>
        <input class="panel-input" value="${childCount} elementos" readonly>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">👁️ Visibilidad</div>
      <div class="panel-field">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;" class="panel-label">
          <input type="checkbox" id="sectionVisible" ${section.style.display !== 'none' ? 'checked' : ''}>
          Sección visible
        </label>
        <div style="font-size:10px;color:#666;margin-top:2px;">Si desmarcas esto, la sección entera desaparecerá de la web pública.</div>
      </div>
    </div>

    </div>

    <div class="panel-section">
      <div class="panel-section-title">⚡ Acciones</div>
      <button class="panel-btn" id="sectionApplyStyles">✅ Aplicar estilos</button>
      <button class="panel-btn panel-btn-danger" id="sectionDelete">🗑️ Ocultar sección</button>
    </div>
    `
  );

  // Visibility toggle
  document.getElementById('sectionVisible')?.addEventListener('change', function () {
    section.style.display = this.checked ? '' : 'none';
    markUnsaved();
  });


  document.getElementById('sectionApplyStyles')?.addEventListener('click', () => {
    const pt = document.getElementById('sectionPaddingTop').value;
    const pb = document.getElementById('sectionPaddingBottom').value;

    if (pt) section.style.paddingTop = pt + 'px';
    if (pb) section.style.paddingBottom = pb + 'px';
    
    // Forzar fondo transparente/vacio al aplicar estilos
    section.style.backgroundColor = '';

    // Guardar via PixisState → JSON
    const id = section.id || section.dataset.pixisId;
    if (id) {
      const sectionData = {
        paddingTop: section.style.paddingTop,
        paddingBottom: section.style.paddingBottom,
        backgroundColor: '', // Siempre vacío
        display: section.style.display
      };
      if (window.PixisState) {
        window.PixisState.updateState({ type: 'ui', path: ['sections', id], value: sectionData })
          .then(() => markUnsaved());
      } else {
        if (!PixisEditor.data.ui.sections) PixisEditor.data.ui.sections = {};
        PixisEditor.data.ui.sections[id] = sectionData;
        markUnsaved();
      }
    }
    window.PixisOverlay.showToast('Estilos de sección aplicados', 'success');
  });

  // Delete/hide section
  document.getElementById('sectionDelete')?.addEventListener('click', () => {
    if (confirm('¿Ocultar esta sección?')) {
      section.style.display = 'none';
      markUnsaved();
      window.PixisOverlay.closePanel();
      window.PixisOverlay.showToast('Sección ocultada', 'warning');
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   PANEL DE PRODUCTOS
════════════════════════════════════════════════════════════════ */
function openProductsPanel() {
  const panelBody = document.getElementById('panelBody');
  const currentScroll = panelBody ? panelBody.scrollTop : 0;

  window.PixisOverlay.openPanel('🛒 Gestión de Productos', buildProductsPanelHTML());
  bindProductsPanelEvents();
  
  if (panelBody) panelBody.scrollTop = currentScroll;
  
  // Restaurar búsqueda si existía
  if (PixisEditor.state.lastSearchQuery) {
    const searchInput = document.getElementById('searchJsonList');
    if (searchInput) {
      searchInput.value = PixisEditor.state.lastSearchQuery;
      window.pixisFilterJsonList(PixisEditor.state.lastSearchQuery);
    }
  }

  // Restaurar posición y resaltar último editado
  const container = document.getElementById('productListContainer');
  if (container) {
    if (PixisEditor.state.lastScrollTop) {
      container.scrollTop = PixisEditor.state.lastScrollTop;
    }
    
    if (PixisEditor.state.lastEditedId) {
      const lastItem = container.querySelector(`[data-product-id="${PixisEditor.state.lastEditedId}"]`);
      if (lastItem) {
        lastItem.classList.add('last-edited-focus');
        // Asegurar que sea visible
        lastItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
}

/* ─── M3: Helper datalist subcategorías ──────────────────── */
window.pixisUpdateSubcatSuggestions = function(catId, datalistId) {
  const dl = document.getElementById(datalistId);
  if (!dl || !catId) return;
  const products = window.PixisState?.state?.products || PixisEditor?.data?.products || [];
  const subcats = new Set();
  products.forEach(p => {
    if (p.category === catId || p.category2 === catId || p.category3 === catId) {
      if (p.subcategoria) p.subcategoria.split(',').forEach(s => { if (s.trim()) subcats.add(s.trim()); });
    }
  });
  dl.innerHTML = [...subcats].sort().map(s => `<option value="${s}">`).join('');
};

function buildProductsPanelHTML() {
  const jsonProducts = PixisEditor.data.products || [];
  const categories   = PixisEditor.data.categories || [];

  const categoryOptions = categories.map(c =>
    `<option value="${c.id}">${c.name}</option>`
  ).join('');

  // ── Escanear TODAS las cards HTML del sitio, agrupadas por sección ──
  const htmlCardsBySection = [];
  document.querySelectorAll('section, .destacados, #catalogo-completo > div').forEach(sec => {
    const cards = [...sec.querySelectorAll('.card:not(.yt-card)')];
    if (!cards.length) return;
    const label = sec.querySelector('h2, h3, .neon-title, .categorias-titulo')?.textContent?.trim()
                || sec.id || sec.className.split(' ')[0] || 'Sección';
    htmlCardsBySection.push({ label, cards });
  });

  const htmlCardsHTML = htmlCardsBySection.length
    ? htmlCardsBySection.map(({ label, cards }) => `
        <div class="panel-section">
          <div class="panel-section-title">📂 ${escHtml(label)}</div>
          ${cards.map(card => {
            const cid   = card.dataset.id || '';
            const title = card.dataset.title || card.querySelector('h3')?.textContent?.trim() || 'Sin nombre';
            const price = card.dataset.price || '';
            const sinStock = card.classList.contains('sin-stock');
            return `
              <div class="product-panel-card" style="opacity:${sinStock ? '.6' : '1'}">
                <div class="product-panel-info">
                  <div class="product-panel-name">${escHtml(title)}${sinStock ? ' <span style="color:#ff4757;font-size:10px">SIN STOCK</span>' : ''}</div>
                  <div class="product-panel-price">${escHtml(price)}</div>
                  <div style="font-size:9px;color:#555">ID: ${escHtml(cid)}</div>
                </div>
                <div class="product-panel-actions">
                  <button class="product-action-btn" title="Editar"
                    onclick="window.PixisEditorAPI.editCardById('${escHtml(cid)}')">✏️</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      `).join('')
    : '<div class="panel-empty-state"><div class="empty-icon">📦</div><p>No se encontraron cards en el HTML</p></div>';

  // ── Productos del JSON ──
  const jsonHTML = jsonProducts.length
    ? jsonProducts.map((p, i) => {
        const isEdited = PixisEditor.state.editedProductIds.has(p.id);
        const isCurrentlySelected = PixisEditor.state.lastEditedId === p.id;
        
        let statusTag = '';
        if (isCurrentlySelected) {
          statusTag = '<span class="editing-tag">🟢 EDITANDO</span>';
        } else if (isEdited) {
          statusTag = '<span class="edited-tag">✅ COMPLETADO</span>';
        }

        const pSinStock = (p.inStock === false) || (p.stock !== undefined && p.stock !== null && p.stock !== '' && Number(p.stock) === 0);
        const stockTag = pSinStock
          ? '<span style="color:#ff4757;font-size:9px;font-weight:bold;margin-left:4px;">SIN STOCK</span>'
          : (p.stock !== undefined && p.stock !== null && p.stock !== ''
              ? `<span style="color:#2ed573;font-size:9px;margin-left:4px;">📦 ${Number(p.stock)}</span>`
              : '');
        return `
        <div class="product-panel-card ${isCurrentlySelected ? 'last-edited-focus' : (isEdited ? 'is-edited' : '')}" 
             data-product-idx="${i}" 
             data-product-id="${p.id}"
             style="display: flex; align-items: center; gap: 10px; opacity:${pSinStock ? '.65' : '1'}">
          
          <input type="checkbox" class="bulk-item-checkbox" data-id="${p.id}" 
                 ${PixisEditor.state.selectedItems.has(p.id) ? 'checked' : ''}
                 onclick="window.PixisEditorAPI.toggleSelectItem('${p.id}')"
                 style="width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;">

          <div class="product-panel-info" style="flex: 1;">
            <div class="product-panel-name">
              ${statusTag}
              ${escHtml(p.title || 'Sin nombre')}${stockTag}
            </div>
            <div class="product-panel-price">$${Number(p.price || 0).toLocaleString()}</div>
          </div>
          <div class="product-panel-actions">
            <button class="product-action-btn" title="Editar" onclick="window.PixisEditorAPI.editProduct(${i})">✏️</button>
            <button class="product-action-btn del" title="Eliminar" onclick="window.PixisEditorAPI.deleteProduct(${i})">🗑️</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="panel-empty-state" style="font-size:12px;color:#555;padding:8px">No hay productos en JSON</div>';

  return `
    <div class="panel-tabs">
      <button class="panel-tab ${PixisEditor.state.activeProductTab === 'json' ? 'active' : ''}" onclick="switchProdTab('json', this)">JSON</button>
      <button class="panel-tab ${PixisEditor.state.activeProductTab === 'add' ? 'active' : ''}" onclick="switchProdTab('add', this)">+ Agregar</button>
      <button class="panel-tab ${PixisEditor.state.activeProductTab === 'destacados' ? 'active' : ''}" onclick="switchProdTab('destacados', this)">⭐ Destacados</button>
      <button class="panel-tab ${PixisEditor.state.activeProductTab === 'nuevos' ? 'active' : ''}" onclick="switchProdTab('nuevos', this)">🆕 Nuevos</button>
      <button class="panel-tab ${PixisEditor.state.activeProductTab === 'cats' ? 'active' : ''}" onclick="switchProdTab('cats', this)">Categorías</button>
      <button class="panel-tab ${PixisEditor.state.activeProductTab === 'banners' ? 'active' : ''}" onclick="switchProdTab('banners', this)">🎯 Banners</button>
    </div>

    <div id="prodTabJson" class="panel-tab-content ${PixisEditor.state.activeProductTab === 'json' ? 'active' : ''}">
      <div style="font-size:11px;color:#888;margin-bottom:10px;line-height:1.3;">
        📦 <b>Productos JSON:</b> Gestión total de tus productos personalizados.
      </div>
      <div style="padding:10px 0; display:flex; gap:10px; align-items:center;">
        <input type="text" class="panel-input" id="searchJsonList" placeholder="🔍 Buscar..." onkeyup="window.pixisFilterJsonList(this.value)" value="${escHtml(PixisEditor.state.lastSearchQuery || '')}" style="flex:1">
      </div>
      
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:rgba(255,255,255,0.03); padding:8px; border-radius:6px;">
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#aaa; cursor:pointer;">
          <input type="checkbox" id="bulkSelectAll" onclick="window.PixisEditorAPI.toggleSelectAll('json', this.checked)"> 
          Seleccionar visibles
        </label>
        <button id="bulkDeleteBtn" class="product-action-btn del" style="display:none; width:auto; padding:0 12px; font-size:11px; height:28px;" onclick="window.PixisEditorAPI.bulkDelete('json')">
          🗑️ Borrar seleccionados
        </button>
      </div>

      <div class="panel-section">
        <div class="panel-section-title" id="jsonListTitle">Productos en JSON (${jsonProducts.length})</div>
        <div class="product-list-panel" id="productListContainer">${jsonHTML}</div>
      </div>
    </div>

    <div id="prodTabAdd" class="panel-tab-content ${PixisEditor.state.activeProductTab === 'add' ? 'active' : ''}">
      <div style="font-size:11px;color:#888;margin-bottom:10px;line-height:1.3;">
        ➕ <b>Agregar:</b> Crea un producto nuevo que no existe en la web original. Se guardará en tu lista personalizada.
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Nuevo Producto (JSON)</div>
        <div class="panel-field">
          <label class="panel-label">Título *</label>
          <input type="text" class="panel-input" id="newProdTitle" placeholder="Nombre del producto">
        </div>
        <div class="panel-field">
          <label class="panel-label">Precio transferencia ($) *</label>
          <input type="number" class="panel-input" id="newProdPrice" placeholder="150000">
        </div>
        <div class="panel-field">
          <label class="panel-label">Precio efectivo ($)</label>
          <input type="number" class="panel-input" id="newProdPriceLocal" placeholder="143000">
        </div>
        <div class="panel-field">
          <label class="panel-label">Categoría * <span style="color:#ff4757;font-size:10px;">(obligatorio — sin categoría el producto no aparece en el sitio)</span></label>
          <select class="panel-select" id="newProdCategory" onchange="pixisUpdateSubcatSuggestions(this.value,'pixisSubcatListNew')">
            <option value="" disabled selected>— Selecciona una categoría —</option>
            ${categoryOptions}
          </select>
          <div style="font-size:10px;color:#ff9f43;margin-top:4px;">⚠️ Si no asignás una categoría, el producto NO aparecerá en ningún lado del sitio.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Categoría secundaria (Opcional)</label>
          <select class="panel-select" id="newProdCategory2">
            <option value="" selected>— Ninguna —</option>
            ${categoryOptions}
          </select>
          <div style="font-size:10px;color:#888;margin-top:4px;">Permite que el producto aparezca en una segunda sección del catálogo.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Subcategoría / filtro</label>
          <input type="text" class="panel-input" id="newProdSubcat" placeholder="ej: nvidia, 512GB" list="pixisSubcatListNew" autocomplete="off">
          <datalist id="pixisSubcatListNew"></datalist>
          <div style="font-size:10px;color:#888;margin-top:2px;">Elegí una de las ya usadas en la categoría elegida — o escribí una nueva. Esto define los filtros del catálogo.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">🎯 Banners Promocionales (opcional)</label>
          <div style="font-size:11px;color:#999;margin-bottom:8px;line-height:1.4;">
            <strong>¿Qué es esto?</strong> Si marcas una de estas opciones, este producto aparecerá dentro de la lista especial de esa promoción (por ejemplo, si creas un banner "Ofertas Navidad" y lo marcas aquí, este producto aparecerá cuando un usuario entre a ver las Ofertas de Navidad).
          </div>
          <div id="newProdBanners" style="display:flex;gap:10px;flex-wrap:wrap;background:#0d0d1a;padding:10px;border-radius:6px;">
            ${window._bannerData ? Object.entries(window._bannerData).map(([bId, bData]) => {
              return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#ccc;cursor:pointer;background:#1a1a2e;padding:4px 8px;border-radius:4px;">
                        <input type="checkbox" class="new-banner-checkbox" value="${escHtml(bId)}">
                        ${escHtml(bData.t)}
                      </label>`;
            }).join('') : ''}
          </div>
          <div style="font-size:11px;color:#999;margin-top:10px;margin-bottom:8px;line-height:1.4;background:rgba(255,255,255,0.03);padding:8px;border-radius:4px;border-left:3px solid #b026ff;">
            <strong>🚀 Paso a paso:</strong><br>
            1. Escribe un nombre y dale a <b>➕ Crear Banner</b>.<br>
            2. Asegúrate de que el producto tenga el <b>visto [✓]</b> marcado.<br>
            3. ¡Listo! Ahora solo ve a una imagen del carrusel, hazle <b>clic derecho -> Editar</b> y selecciónalo en la lista para que al hacer clic te lleve a estos productos.
          </div>
          <div style="display:flex; gap:6px;">
            <input type="text" id="inlineBannerNameAdd" class="panel-input" placeholder="Ej: Especial Navidad" style="padding:4px 8px; font-size:11px;">
            <button class="panel-btn" style="padding:4px 8px; font-size:11px; white-space:nowrap;" onclick="window.PixisEditorAPI.createInlineBanner(document.getElementById('inlineBannerNameAdd').value, 'newProdBanners', 'new-banner-checkbox'); document.getElementById('inlineBannerNameAdd').value = '';">➕ Crear Banner</button>
          </div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Imágenes (URL o archivos locales)</label>
          <div style="display:flex; gap:8px; margin-bottom:8px;">
            <button class="panel-btn" style="flex:1; background:#0d0d1a; border:1px dashed #b026ff; color:#b026ff;" 
                    onclick="window.PixisEditorAPI.uploadProductImages('newProdTitle', 'newProdImg')">
              🖼️ Seleccionar Imágenes (Escritorio/PC)
            </button>
          </div>
          <textarea class="panel-textarea" id="newProdImg" placeholder="img/productos/foto1.jpg, img/productos/foto2.jpg" rows="2" oninput="if(window.pixisUpdateImgPreview) pixisUpdateImgPreview(this.value, 'newProdImgPreview', 'newProdImg')"></textarea>
          <div id="newProdImgPreview" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>
          <div style="font-size:10px;color:#888;margin-top:4px;">Se creará una carpeta propia con el nombre del producto. Puedes subir hasta 10 fotos.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Descripción</label>
          <textarea class="panel-textarea" id="newProdDesc" placeholder="Descripción del producto..."></textarea>
        </div>
        <div class="panel-field">
          <label class="panel-label">URL video (YouTube/web)</label>
          <input type="text" class="panel-input" id="newProdVideo" placeholder="https://...">
        </div>
        <div class="panel-field">
          <label class="panel-label">En stock</label>
          <select class="panel-select" id="newProdStock">
            <option value="true">✅ Disponible</option>
            <option value="false">❌ Sin stock</option>
          </select>
        </div>
        <button class="panel-btn panel-btn-primary" id="addProductBtn">➕ Agregar producto</button>
      </div>
    </div>

    <div id="prodTabDestacados" class="panel-tab-content ${PixisEditor.state.activeProductTab === 'destacados' ? 'active' : ''}">
      ${window.PixisEditorAPI.buildReorderTabHTML('destacados')}
    </div>

    <div id="prodTabNuevos" class="panel-tab-content ${PixisEditor.state.activeProductTab === 'nuevos' ? 'active' : ''}">
      ${window.PixisEditorAPI.buildReorderTabHTML('nuevos')}
    </div>

    <div id="prodTabCats" class="panel-tab-content ${PixisEditor.state.activeProductTab === 'cats' ? 'active' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:rgba(255,255,255,0.03); padding:8px; border-radius:6px;">
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#aaa; cursor:pointer;">
          <input type="checkbox" onclick="window.PixisEditorAPI.toggleSelectAll('cats', this.checked)"> 
          Seleccionar todas
        </label>
        <button id="bulkDeleteBtnCats" class="product-action-btn del" style="display:none; width:auto; padding:0 12px; font-size:11px; height:28px;" onclick="window.PixisEditorAPI.bulkDelete('cats')">
          🗑️ Borrar seleccionadas
        </button>
      </div>

      <div class="panel-section">
        <div class="panel-section-title">Categorías (${categories.length})</div>
        ${categories.map((c, i) => `
          <div class="section-list-item" data-id="${c.id}" style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" class="bulk-item-checkbox" data-id="${c.id}" 
                   ${PixisEditor.state.selectedItems.has(c.id) ? 'checked' : ''}
                   onclick="window.PixisEditorAPI.toggleSelectItem('${c.id}')"
                   style="width: 16px; height: 16px; cursor: pointer;">
            <span class="si-icon">${c.icon || '📁'}</span>
            <div class="si-info" style="flex: 1;">
              <div class="si-name">${escHtml(c.name)} ${c.active === false ? '<span style="color:#ff4444;font-size:10px;">(Oculto)</span>' : ''}</div>
              <div class="si-type">ID: ${escHtml(c.id)}</div>
            </div>
            <button class="product-action-btn" title="Ocultar/Mostrar en el menú" onclick="event.stopPropagation(); window.PixisEditorAPI.toggleCategoryActive(${i})" style="color: ${c.active === false ? '#888' : '#fff'}; width:30px;">${c.active === false ? '👁️‍🗨️' : '👁️'}</button>
            <button class="product-action-btn del" title="Eliminar" onclick="window.PixisEditorAPI.deleteCategory(${i})">🗑️</button>
          </div>
        `).join('') || '<div class="panel-empty-state"><div class="empty-icon">📂</div><p>No hay categorías</p></div>'}
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Nueva categoría</div>
        <div class="panel-field">
          <label class="panel-label">Nombre *</label>
          <input type="text" class="panel-input" id="newCatName" placeholder="ej: Periféricos">
          <div style="font-size:10px;color:#666;margin-top:2px;">El nombre que aparecerá en el menú lateral.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">ID interno *</label>
          <input type="text" class="panel-input" id="newCatId" placeholder="ej: perifericos">
          <div style="font-size:10px;color:#666;margin-top:2px;">Un identificador único (sin espacios ni acentos).</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Icono (emoji)</label>
          <input type="text" class="panel-input" id="newCatIcon" placeholder="🖱️" maxlength="4">
          <div style="font-size:10px;color:#666;margin-top:2px;">El emoji que decorará el nombre en el menú.</div>
        </div>
        <button class="panel-btn panel-btn-primary" id="addCategoryBtn">➕ Agregar categoría</button>
      </div>
    </div>

    <div id="prodTabBanners" class="panel-tab-content ${PixisEditor.state.activeProductTab === 'banners' ? 'active' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:rgba(255,255,255,0.03); padding:8px; border-radius:6px;">
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#aaa; cursor:pointer;">
          <input type="checkbox" onclick="window.PixisEditorAPI.toggleSelectAll('banners', this.checked)"> 
          Seleccionar todos
        </label>
        <button id="bulkDeleteBtnBanners" class="product-action-btn del" style="display:none; width:auto; padding:0 12px; font-size:11px; height:28px;" onclick="window.PixisEditorAPI.bulkDelete('banners')">
          🗑️ Borrar seleccionados
        </button>
      </div>

      <div class="panel-section">
        <div class="panel-section-title">Gestión de Banners</div>
        <div style="font-size:11px;color:#999;margin-bottom:12px;line-height:1.4;">
          Borra promociones viejas para mantener el catálogo limpio.
        </div>
        
        <div id="bannersListContainer">
          ${window._bannerData ? Object.entries(window._bannerData).map(([bId, bData]) => `
            <div class="section-list-item" data-id="${bId}" style="display:flex; justify-content:space-between; align-items:center; background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:8px; gap: 10px;">
              <input type="checkbox" class="bulk-item-checkbox" data-id="${bId}" 
                     ${PixisEditor.state.selectedItems.has(bId) ? 'checked' : ''}
                     onclick="window.PixisEditorAPI.toggleSelectItem('${bId}')"
                     style="width: 16px; height: 16px; cursor: pointer;">
              <div style="flex: 1;">
                <div style="color:#fff; font-weight:bold; font-size:13px;">${escHtml(bData.t)}</div>
                <div style="color:#aaa; font-size:11px;">ID: ${escHtml(bId)}</div>
              </div>
              <button class="product-action-btn del" title="Eliminar Banner" onclick="window.PixisEditorAPI.deleteBanner('${escHtml(bId)}')">🗑️</button>
            </div>
          `).join('') : '<div style="color:#666;font-size:12px;">No hay banners configurados.</div>'}
        </div>
      </div>

      <div class="panel-section" style="margin-top: 15px; background: rgba(255,255,255,0.02); padding: 15px; border-radius: 8px;">
        <div class="panel-section-title" style="margin-bottom:10px;">Crear Nuevo Banner</div>
        <div class="panel-field">
          <label class="panel-label">Nombre del Banner (Ej: Especial Navidad)</label>
          <input type="text" class="panel-input" id="newBannerTitle" placeholder="Ej: Especial Navidad">
        </div>
        <div class="panel-field">
          <label class="panel-label">ID Único (Sin espacios, ej: especial-navidad)</label>
          <input type="text" class="panel-input" id="newBannerId" placeholder="ej: especial-navidad">
          <div style="font-size:10px; color:#888; margin-top:4px;">Este ID se usa para el link. Por ejemplo: ?banner=especial-navidad</div>
        </div>
        <button class="panel-btn panel-btn-primary" style="margin-top:10px; width:100%;" id="addBannerBtn">➕ Crear Banner</button>
      </div>
    </div>
  `;
}



function bindProductsPanelEvents() {
  // Add product
  document.getElementById('addProductBtn')?.addEventListener('click', addProduct);

  // Add category
  document.getElementById('addCategoryBtn')?.addEventListener('click', addCategory);

  // Add banner
  document.getElementById('addBannerBtn')?.addEventListener('click', addBanner);
}

// Tab switcher (expuesto globalmente)
window.switchProdTab = function (tab, btn) {
  PixisEditor.state.activeProductTab = tab;
  
  // Limpiar clases
  document.querySelectorAll('.panel-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.panel-tab').forEach(el => el.classList.remove('active'));
  
  // Activar contenido
  const targetId = `prodTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`;
  const content = document.getElementById(targetId);
  if (content) content.classList.add('active');
  
  // Activar botón (si no se pasa, lo buscamos por su atributo onclick)
  const targetBtn = btn || document.querySelector(`.panel-tab[onclick*="'${tab}'"]`);
  if (targetBtn) targetBtn.classList.add('active');
};

function addProduct() {
  const title = document.getElementById('newProdTitle')?.value.trim();
  const price = document.getElementById('newProdPrice')?.value;
  const priceLocal = document.getElementById('newProdPriceLocal')?.value;
  const img = document.getElementById('newProdImg')?.value.trim();
  const desc = document.getElementById('newProdDesc')?.value.trim();
  const video = document.getElementById('newProdVideo')?.value.trim();
  const category = document.getElementById('newProdCategory')?.value;
  const category2 = document.getElementById('newProdCategory2')?.value;
  const subcategoria = document.getElementById('newProdSubcat')?.value.trim();
  const inStock = document.getElementById('newProdStock')?.value === 'true';

  if (!title || !price) {
    window.PixisOverlay.showToast('Título y precio son obligatorios', 'error');
    return;
  }

  // ════════════════════════════════════════════════════════════
  // GUARDIA DEL EDITOR: Categoría OBLIGATORIA.
  // Sin categoría, el producto no aparecerá en ningún lugar del sitio.
  // ════════════════════════════════════════════════════════════
  if (!category) {
    window.PixisOverlay.showToast('⚠️ Debés seleccionar una categoría para el producto. Sin categoría no aparecerá en el sitio.', 'error');
    document.getElementById('newProdCategory')?.focus();
    return;
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const newBanners = Array.from(document.querySelectorAll('.new-banner-checkbox:checked')).map(cb => cb.value);

  const imgList = img.split(',').map(s => s.trim()).filter(Boolean);
  const mainImg = imgList[0] || '';
  const galleryStr = imgList.join(',');

  const product = {
    id: `prod-${Date.now()}`,
    title, 
    img: mainImg, 
    gallery: galleryStr,
    desc, video, category, category2, subcategoria, inStock, slug,
    price: parseInt(price),
    priceLocal: parseInt(priceLocal || price),
    banners: newBanners
  };

  // Guardar via PixisState → JSON
  if (window.PixisState) {
    window.PixisState.pushHistory(); // Registrar antes de cambiar
    const products = window.PixisState.state.products;
    products.push(product);
    window.PixisState.saveState().then(saved => {
      window.PixisOverlay.showToast(
        saved ? `✅ Producto "${title}" guardado en JSON` : `📥 "${title}" agregado (descargá JSON)`,
        'success'
      );
      window.PixisState.applyStateToDOM();
      markUnsaved();
    });
  } else {
    PixisEditor.data.products.push(product);
    markUnsaved();
    injectProductCard(product);
  }

  // Refrescar panel
  openProductsPanel();
}

function addCategory() {
  const name = document.getElementById('newCatName')?.value.trim();
  const id = document.getElementById('newCatId')?.value.trim();
  const icon = document.getElementById('newCatIcon')?.value.trim() || '📁';

  if (!name || !id) {
    window.PixisOverlay.showToast('Nombre e ID son obligatorios', 'error');
    return;
  }

  // Guardar via PixisState → JSON
  if (window.PixisState) {
    window.PixisState.state.categories.push({ name, id, icon });
    window.PixisState.saveState().then(saved => {
      window.PixisOverlay.showToast(
        saved ? `✅ Categoría "${name}" guardada` : `📥 "${name}" agregada (descargá JSON)`,
        'success'
      );
      markUnsaved();
    });
  } else {
    PixisEditor.data.categories.push({ name, id, icon });
    markUnsaved();
  }
  openProductsPanel();
}

function addBanner() {
  const title = document.getElementById('newBannerTitle')?.value.trim();
  const id = document.getElementById('newBannerId')?.value.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');

  if (!title || !id) {
    window.PixisOverlay.showToast('Nombre e ID son obligatorios', 'error');
    return;
  }

  if (window._bannerData && window._bannerData[id]) {
    window.PixisOverlay.showToast('Ya existe un banner con ese ID', 'error');
    return;
  }

  // Guardar via PixisState → JSON
  if (window.PixisState) {
    if (!window.PixisState.state.site.banners) {
      window.PixisState.state.site.banners = window._bannerData || {};
    }
    window.PixisState.state.site.banners[id] = { f: id, t: title }; // 'f' no se usa realmente en el nuevo motor
    window.PixisState.saveState().then(saved => {
      window.PixisOverlay.showToast(
        saved ? `✅ Banner "${title}" guardado` : `📥 Banner creado localmente`,
        'success'
      );
      markUnsaved();
      window.PixisState.applyStateToDOM();
      openProductsPanel();
      setTimeout(() => switchProdTab('banners'), 50); // Volver a la pestaña de banners
    });
  } else {
    window.PixisOverlay.showToast('El motor de estado no está activo.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════════
   API PÚBLICA (para botones inline en el HTML del panel)
════════════════════════════════════════════════════════════════ */
window.PixisEditorAPI = {
  /**
   * Comprime una imagen en el cliente antes de subirla
   * @param {File} file 
   * @returns {Promise<Blob>}
   */
  async _compressImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_SIZE = 1200;

          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          // Comprimimos a JPEG con calidad 0.9 (90%) - Excelente equilibrio
          canvas.toBlob((blob) => {
            resolve(blob || file);
          }, 'image/jpeg', 0.9);
        };
      };
    });
  },

  /**
   * Carga múltiples imágenes y las organiza en una carpeta basada en el título del producto.
   * @param {string} titleId ID del input del título (para generar nombre de carpeta)
   * @param {string} targetInputId ID del input donde se escribirán las URLs resultantes
   */
  async uploadProductImages(titleId, targetInputId) {
    const title = document.getElementById(titleId)?.value.trim();
    if (!title) {
      window.PixisOverlay.showToast('⚠️ Por favor, escribe primero un título para crear la carpeta del producto.', 'error');
      document.getElementById(titleId)?.focus();
      return;
    }

    // Crear input invisible para selección múltiple
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*';
    
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files);
      if (files.length === 0) return;
      if (files.length > 10) {
        window.PixisOverlay.showToast('⚠️ Máximo 10 imágenes permitidas.', 'warning');
      }

      // Sanitizar título para nombre de carpeta
      const folderName = title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'producto-sin-nombre';
      
      const folder = `img/productos/${folderName}`;
      const uploadedUrls = [];

      window.PixisOverlay.showToast(`Subiendo ${files.length} imágenes...`, 'info');

      for (const file of files.slice(0, 10)) {
        try {
          const ext = 'jpg'; // Forzamos jpg para las comprimidas
          const cleanName = file.name.split('.')[0].replace(/[^a-z0-9]/gi, '-').toLowerCase();
          const filename = `${cleanName}-${Date.now()}.${ext}`;

          // Comprimir automáticamente antes de enviar
          const compressedBlob = await this._compressImage(file);

          const res = await fetch(`/api/upload-image?folder=${folder}&filename=${filename}`, {
            method: 'POST',
            body: compressedBlob
          });
          const json = await res.json();
          if (json.ok) {
            uploadedUrls.push(json.url);
          }
        } catch (e) {
          console.error('Error subiendo imagen:', e);
        }
      }

      if (uploadedUrls.length > 0) {
        const targetInput = document.getElementById(targetInputId);
        if (targetInput) {
          // Si ya había contenido, preguntar si quiere reemplazar o añadir
          const existing = targetInput.value.trim();
          if (existing && confirm('¿Deseas reemplazar las imágenes actuales por las nuevas?')) {
            targetInput.value = uploadedUrls.join(', ');
          } else {
            targetInput.value = existing ? (existing + ', ' + uploadedUrls.join(', ')) : uploadedUrls.join(', ');
          }

          // Determinar el ID del contenedor de preview según el input destino
          const previewContainerId = targetInputId === 'cardImg' 
            ? 'cardImgGalleryPreview' 
            : (targetInputId + 'Preview');
          
          // Actualizar preview de galería (funciona para cardImg y newProdImg)
          if (window.pixisUpdateImgPreview) {
            window.pixisUpdateImgPreview(targetInput.value, previewContainerId, targetInputId);
          }
        }
        window.PixisOverlay.showToast(`✅ ${uploadedUrls.length} imágenes cargadas en /${folder}`, 'success');
      } else {
        window.PixisOverlay.showToast('❌ No se pudo subir ninguna imagen.', 'error');
      }
    };

    fileInput.click();
  },

  /**
   * Elimina una imagen físicamente del servidor y del input
   * @param {string} imgUrl URL de la imagen a borrar
   * @param {string} targetInputId ID del input/textarea a actualizar
   * @param {string} previewContainerId ID del contenedor de preview
   */
  async deleteProductImage(imgUrl, targetInputId, previewContainerId) {
    if (!confirm('¿Estás seguro de eliminar esta imagen permanentemente del servidor? No se puede deshacer.')) return;

    try {
      // 1. Llamar al servidor para borrar el archivo físico
      const res = await fetch('/api/remove-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imgUrl })
      });
      const json = await res.json();

      if (json.ok) {
        // 2. Actualizar el input eliminando la URL de la lista
        const input = document.getElementById(targetInputId);
        if (input) {
          const urls = input.value.split(',').map(s => s.trim()).filter(Boolean);
          const newUrls = urls.filter(u => u !== imgUrl);
          input.value = newUrls.join(', ');
          
          // 3. Refrescar el preview
          if (window.pixisUpdateImgPreview) {
            window.pixisUpdateImgPreview(input.value, previewContainerId, targetInputId);
          }
          window.PixisOverlay.showToast('Imagen eliminada físicamente ✓', 'success');
        }
      } else {
        window.PixisOverlay.showToast(`Error: ${json.error || 'No se pudo borrar'}`, 'error');
      }
    } catch (e) {
      console.error('Error al borrar:', e);
      window.PixisOverlay.showToast('Error de conexión al borrar archivo', 'error');
    }
  },

  createInlineBanner(title, containerId, checkboxClass) {
    if (!title) {
      window.PixisOverlay.showToast('Ingresa un nombre para el banner', 'error');
      return;
    }
    const id = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!id) return;

    if (!window._bannerData) window._bannerData = {};
    if (window._bannerData[id]) {
      window.PixisOverlay.showToast('Ya existe un banner con este nombre', 'error');
      return;
    }

    // Agregar al estado global temporal
    window._bannerData[id] = { f: id, t: title };

    // Guardar en JSON si el motor está activo
    if (window.PixisState) {
      if (!window.PixisState.state.site.banners) window.PixisState.state.site.banners = {};
      window.PixisState.state.site.banners[id] = { f: id, t: title };
      window.PixisState.saveState().then(() => {
        window.PixisOverlay.showToast(`Banner "${title}" creado exitosamente`, 'success');
      });
    }

    // Insertar el checkbox dinámicamente en el DOM modal
    const container = document.getElementById(containerId);
    if (container) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:#ccc;cursor:pointer;background:#1a1a2e;padding:4px 8px;border-radius:4px;';
      label.innerHTML = `<input type="checkbox" class="${checkboxClass}" value="${escHtml(id)}" checked> ${escHtml(title)}`;
      container.appendChild(label);
    }
    const input = document.getElementById('inlineBannerName');
    if (input) input.value = '';
  },

  toggleSelectItem(id) {
    if (PixisEditor.state.selectedItems.has(id)) {
      PixisEditor.state.selectedItems.delete(id);
    } else {
      PixisEditor.state.selectedItems.add(id);
    }
    this.updateBulkUI();
  },

  toggleSelectAll(type, checked) {
    let selector = '';
    if (type === 'json') selector = '#productListContainer .product-panel-card';
    if (type === 'cats') selector = '#prodTabCats .section-list-item';
    if (type === 'banners') selector = '#prodTabBanners .section-list-item';

    const visibleItems = [...document.querySelectorAll(selector)].filter(el => el.style.display !== 'none');
    
    visibleItems.forEach(item => {
      const id = item.dataset.id || item.dataset.productId;
      if (!id) return;
      const cb = item.querySelector('.bulk-item-checkbox');
      if (cb) cb.checked = checked;

      if (checked) PixisEditor.state.selectedItems.add(id);
      else PixisEditor.state.selectedItems.delete(id);
    });

    this.updateBulkUI();
  },

  updateBulkUI() {
    const count = PixisEditor.state.selectedItems.size;
    
    // Botón para productos
    const btnJson = document.getElementById('bulkDeleteBtn');
    if (btnJson) {
      btnJson.style.display = count > 0 ? 'block' : 'none';
      btnJson.innerHTML = `🗑️ Borrar seleccionados (${count})`;
    }

    // Botón para categorías
    const btnCats = document.getElementById('bulkDeleteBtnCats');
    if (btnCats) {
      btnCats.style.display = count > 0 ? 'block' : 'none';
      btnCats.innerHTML = `🗑️ Borrar seleccionadas (${count})`;
    }

    // Botón para banners
    const btnBanners = document.getElementById('bulkDeleteBtnBanners');
    if (btnBanners) {
      btnBanners.style.display = count > 0 ? 'block' : 'none';
      btnBanners.innerHTML = `🗑️ Borrar seleccionados (${count})`;
    }
  },

  async bulkDelete(type) {
    console.log('[PIXIS] Iniciando bulkDelete:', type);
    const count = PixisEditor.state.selectedItems.size;
    if (count === 0) return;

    if (!confirm(`¿Estás SEGURO de que quieres eliminar estos ${count} elementos?`)) return;

    if (window.PixisState) window.PixisState.pushHistory();

    const idsToDelete = new Set(PixisEditor.state.selectedItems);

    if (type === 'json') {
      // Identificar cuáles son productos del JSON y cuáles son cards estáticas
      const jsonProducts = PixisEditor.data.products || [];
      const jsonIds = new Set(jsonProducts.map(p => p.id));

      // 1. Filtrar los del JSON
      PixisEditor.data.products = jsonProducts.filter(p => !idsToDelete.has(p.id));

      // 2. Los que sobran en la selección (que no estaban en el JSON) son estáticos -> ui.deleted
      idsToDelete.forEach(id => {
        if (!jsonIds.has(id)) {
          if (!window.PixisState.state.ui.deleted) window.PixisState.state.ui.deleted = [];
          if (!window.PixisState.state.ui.deleted.includes(id)) {
            window.PixisState.state.ui.deleted.push(id);
          }
        }
      });
    } else if (type === 'cats') {
      // Borrar categorías y productos huérfanos
      PixisEditor.data.categories = PixisEditor.data.categories.filter(c => !idsToDelete.has(c.id));
      PixisEditor.data.products = PixisEditor.data.products.filter(p => !idsToDelete.has(p.category));
    } else if (type === 'banners') {
      // Borrar banners
      if (!window.PixisState.state.site.banners) window.PixisState.state.site.banners = {};
      idsToDelete.forEach(id => {
        delete window.PixisState.state.site.banners[id];
        delete window._bannerData[id];
      });
    }
    
    // Limpiar selección
    PixisEditor.state.selectedItems.clear();
    updateBulkDeleteFloatingUI();

    if (window.PixisState) {
      await window.PixisState.saveState();
      window.PixisState.applyStateToDOM();
    }

    markUnsaved();
    openProductsPanel();
    window.PixisOverlay.showToast(`${count} elementos eliminados`, 'warning');
  },

  editProduct(idx) {
    const product = PixisEditor.data.products[idx];
    if (!product) return;

    // Marcar como selección actual inmediatamente
    PixisEditor.state.lastEditedId = product.id;

    // Guardar posición de scroll antes de editar
    const container = document.getElementById('productListContainer');
    if (container) PixisEditor.state.lastScrollTop = container.scrollTop;

    // Usamos el mismo editor "rico" que las cards HTML
    openCardEditor(null, product, idx);
  },

  // saveProduct() eliminado: era código muerto con un bug (leía 'editProdSubcat' que no existe).
  // La ruta correcta de guardado es: editProduct() → openCardEditor() → applyCardBtn listener
  // que lee 'cardSubcat' correctamente y guarda vía PixisState.

  deleteProduct(idx) {
    const product = PixisEditor.data.products[idx];
    if (!product) return;
    if (!confirm(`¿Eliminar "${product.title}"?`)) return;

    if (window.PixisState) window.PixisState.pushHistory();
    PixisEditor.data.products.splice(idx, 1);
    markUnsaved();
    openProductsPanel();
    window.PixisOverlay.showToast('Producto eliminado', 'warning');
  },

  toggleCategoryActive(idx) {
    const cat = PixisEditor.data.categories[idx];
    if (!cat) return;
    
    // Si no tiene la propiedad, asumimos que era true. Lo invertimos.
    cat.active = cat.active === false ? true : false;
    
    // Guardar via PixisState
    if (window.PixisState) {
      window.PixisState.pushHistory();
      window.PixisState.applyChange({ type: 'categories', path: [idx, 'active'], value: cat.active });
      
      // Aplicar de forma instantánea al sitio
      window.PixisState.applyStateToDOM();
      
      // Actualizar el panel de productos de forma instantánea
      openProductsPanel();
      
      // Mostrar feedback y guardar en segundo plano
      window.PixisOverlay.showToast(cat.active ? '👁️ Categoría visible' : '👁️‍🗨️ Categoría oculta', 'success');
      window.PixisState.saveState();
    } else {
      markUnsaved();
      openProductsPanel();
    }
  },

  deleteCategory(idx) {
    const cat = PixisEditor.data.categories[idx];
    if (!cat) return;

    // Buscar productos que pertenecen a esta categoría
    const productsInCat = (PixisEditor.data.products || []).filter(p => p.category === cat.id);
    const countInCat = productsInCat.length;

    let confirmMsg = `¿Eliminar categoría "${cat.name}"?`;
    if (countInCat > 0) {
      confirmMsg += `\n\n⚠️ ATENCIÓN: Hay ${countInCat} producto(s) asignados a esta categoría:\n`;
      confirmMsg += productsInCat.map(p => `  • ${p.title}`).join('\n');
      confirmMsg += `\n\nEstos productos serán eliminados automáticamente para evitar que aparezcan en secciones incorrectas.`;
    }

    if (!confirm(confirmMsg)) return;

    // Eliminar productos huérfanos (los que eran de esta categoría)
    if (countInCat > 0) {
      PixisEditor.data.products = PixisEditor.data.products.filter(p => p.category !== cat.id);
    }

    // 🗑️ Eliminar imagen física del servidor si tenía customIcon
    const oldIconUrl = cat.customIcon;
    if (oldIconUrl && oldIconUrl.startsWith('img/categorias/')) {
      try {
        fetch('/api/remove-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: oldIconUrl })
        }).catch(() => {});
      } catch (_) {}
    }

    // Eliminar la categoría
    PixisEditor.data.categories.splice(idx, 1);

    // Persistir cambios si PixisState está activo
    if (window.PixisState) {
      window.PixisState.pushHistory(); // Registrar antes de cambiar
      window.PixisState.state.categories = PixisEditor.data.categories;
      window.PixisState.state.products   = PixisEditor.data.products;
      window.PixisState.saveState().then(() => {
        window.PixisState.applyStateToDOM();
      });
    }

    markUnsaved();
    openProductsPanel();
    const msg = countInCat > 0
      ? `Categoría eliminada. ${countInCat} producto(s) huérfano(s) eliminados.`
      : 'Categoría eliminada';
    window.PixisOverlay.showToast(msg, 'warning');
  },

  deleteBanner(id) {
    if (!confirm(`¿Eliminar banner "${id}"? Los productos asignados a este banner dejarán de mostrarse en él.`)) return;

    if (window.PixisState && window.PixisState.state.site.banners && window.PixisState.state.site.banners[id]) {
      window.PixisState.pushHistory();
      delete window.PixisState.state.site.banners[id];
      delete window._bannerData[id];
      window.PixisState.saveState().then(() => {
        window.PixisOverlay.showToast('Banner eliminado', 'warning');
        markUnsaved();
        window.PixisState.applyStateToDOM();
        openProductsPanel();
        setTimeout(() => switchProdTab('banners'), 50);
      });
    } else {
       // Eliminar del temporal si no hay state
       if (window._bannerData) delete window._bannerData[id];
       window.PixisOverlay.showToast('Banner eliminado localmente', 'warning');
       openProductsPanel();
       setTimeout(() => switchProdTab('banners'), 50);
    }
  },

  /**
   * Abre el selector de archivos para subir un ícono PNG para una categoría.
   * @param {string} catId ID de la categoría
   */
  async editCategoryIcon(catId) {
    const cat = (PixisEditor.data.categories || []).find(c => c.id === catId);
    if (!cat) {
      window.PixisOverlay.showToast(`Error: No se encontró la categoría ${catId}`, 'error');
      return;
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,image/png,image/jpeg,image/webp,image/svg+xml,image/gif';
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;

      window.PixisOverlay.showToast('Subiendo y actualizando icono...', 'info');
      try {
        const oldIconUrl = cat.customIcon;
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanCatId = catId.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const filename = `cat-${cleanCatId}-${Date.now()}.${ext}`;
        const folder = 'img/categorias';
        
        const res = await fetch(`/api/upload-image?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`, {
          method: 'POST',
          body: file
        });
        const json = await res.json();

        if (json.ok) {
          // 🗑️ Eliminar automáticamente la imagen anterior del disco si pertenecía a img/categorias
          if (oldIconUrl && oldIconUrl.startsWith('img/categorias/') && oldIconUrl !== json.url) {
            try {
              await fetch('/api/remove-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: oldIconUrl })
              });
            } catch (delErr) {
              console.warn('[PixisEditor] No se pudo borrar el icono previo del servidor:', delErr);
            }
          }

          cat.customIcon = json.url;

          // Sincronizar en el input del modal si está abierto
          const modalCustomInput = document.getElementById('editCatCustomIcon');
          if (modalCustomInput) modalCustomInput.value = json.url;

          // Sincronizar con PixisState
          if (window.PixisState) {
            const stateCat = (window.PixisState.state.categories || []).find(c => c.id === catId);
            if (stateCat) stateCat.customIcon = json.url;
            window.PixisState.pushHistory();
            await window.PixisState.saveState();
            window.PixisState.applyStateToDOM();
          }

          window.PixisOverlay.showToast('✅ Icono de categoría actualizado y limpiado', 'success');
          markUnsaved();
        } else {
          window.PixisOverlay.showToast(`Error: ${json.error}`, 'error');
        }
      } catch (e) {
        console.error('Error al subir icono:', e);
        window.PixisOverlay.showToast('Error de conexión al subir icono', 'error');
      }
    };
    fileInput.click();
  },

  /**
   * (Opcional) Abre un modal para editar nombre e ID de la categoría (reparando el bug previo mencionado en el historial)
   */
  editCategory(idx) {
    const cat = PixisEditor.data.categories[idx];
    if (!cat) return;

    window.PixisOverlay.openModal('📝 Editar Categoría', `
      <div class="panel-field">
        <label class="panel-label">Nombre de Categoría</label>
        <input type="text" id="editCatName" class="panel-input" value="${escHtml(cat.name)}">
      </div>
      <div class="panel-field">
        <label class="panel-label">ID de Categoría (usado en productos)</label>
        <input type="text" id="editCatId" class="panel-input" value="${escHtml(cat.id)}">
        <div style="font-size:10px; color:#ff3d3d; margin-top:4px;">⚠️ Si cambiás el ID, debés actualizar los productos que lo usaban.</div>
      </div>
      <div class="panel-field">
        <label class="panel-label">Icono Emoji (solo si no hay PNG custom)</label>
        <input type="text" id="editCatIcon" class="panel-input" value="${escHtml(cat.icon || '')}">
      </div>
      <div class="panel-field">
        <label class="panel-label">Icono PNG Custom</label>
        <div style="display:flex; gap:10px; align-items:center;">
          <input type="text" id="editCatCustomIcon" class="panel-input" value="${escHtml(cat.customIcon || '')}" placeholder="img/categorias/icon.png">
          <button class="panel-btn" onclick="window.PixisEditorAPI.editCategoryIcon('${cat.id}')">📁 Subir</button>
        </div>
      </div>
    `, `
      <button class="panel-btn" onclick="window.PixisOverlay.closeModal()">Cancelar</button>
      <button class="panel-btn panel-btn-primary" id="saveCatBtn">Guardar cambios</button>
    `);

    document.getElementById('saveCatBtn')?.addEventListener('click', async () => {
      const oldId = cat.id;
      cat.name = document.getElementById('editCatName').value.trim();
      cat.id = document.getElementById('editCatId').value.trim();
      cat.icon = document.getElementById('editCatIcon').value.trim();
      cat.customIcon = document.getElementById('editCatCustomIcon').value.trim();

      if (window.PixisState) {
        window.PixisState.pushHistory();
        // Si el ID cambió, actualizar productos (opcional/deseable)
        if (oldId !== cat.id && confirm(`¿Deseas actualizar automáticamente todos los productos de "${oldId}" a la nueva categoría "${cat.id}"?`)) {
          PixisEditor.data.products.forEach(p => {
            if (p.category === oldId) p.category = cat.id;
            if (p.category2 === oldId) p.category2 = cat.id;
          });
        }
        await window.PixisState.saveState();
        window.PixisState.applyStateToDOM();
      }

      window.PixisOverlay.closeModal();
      window.PixisOverlay.showToast('✅ Categoría actualizada', 'success');
      markUnsaved();
      openProductsPanel(); // Refrescar lista
    });
  },

  /**
   * Genera el HTML para las pestañas de reordenamiento (Destacados / Nuevos)
   * @param {string} categoryId 'destacados' o 'nuevos'
   */
  buildReorderTabHTML(categoryId) {
    const products = (PixisEditor.data.products || []).filter(p => 
      p.category === categoryId || p.category2 === categoryId || p.category3 === categoryId
    );

    if (products.length === 0) {
      return `<div class="panel-empty-state"><div class="empty-icon">⭐</div><p>No hay productos en esta sección</p></div>`;
    }

    const title = categoryId === 'destacados' ? '⭐ ORDENAR DESTACADOS' : '🆕 ORDENAR NUEVOS';
    const sub = categoryId === 'destacados' ? 'Los productos aparecerán en este orden en el carrusel superior.' : 'Los productos aparecerán en este orden en la sección de nuevos ingresos.';

    let html = `
      <div style="font-size:11px;color:#888;margin-bottom:12px;line-height:1.4;">
        <b>${title}:</b> Arrastra los productos para posicionarlos.<br>${sub}
      </div>
      <div class="pixis-reorder-grid" id="reorderGrid_${categoryId}" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
    `;

    html += products.map((p, i) => {
      const coverImg = (p.img || '').trim().split(',')[0].trim();
      const catLabel = categoryId === 'destacados' ? 'Destacados' : 'Nuevos Ingresos';
      return `
        <div class="pixis-reorder-item" 
             draggable="true"
             data-id="${p.id}"
             ondragstart="window.PixisEditorAPI.pixisHandleProductDragStart(event, '${p.id}')"
             ondragover="event.preventDefault()"
             ondrop="window.PixisEditorAPI.pixisHandleProductDrop(event, '${p.id}', '${categoryId}')"
             style="position:relative; aspect-ratio:1/1; cursor:move; border-radius:6px; overflow:hidden; border:2px solid rgba(255,255,255,0.1); transition: transform 0.2s, border-color 0.2s;"
             onmouseover="this.style.borderColor='var(--editor-purple)'"
             onmouseout="this.style.borderColor='rgba(255,255,255,0.1)'">
          <img src="${coverImg}" style="width:100%; height:100%; object-fit:cover;">
          
          <!-- Título inferior -->
          <div style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.75); color:#fff; font-size:8px; padding:2px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; text-align:center;">
            ${escHtml(p.title)}
          </div>
          
          <!-- Badge de número de orden a la izquierda -->
          <div style="position:absolute; top:2px; left:2px; background:rgba(0,0,0,0.85); color:#aaa; font-size:8px; font-weight:700; width:15px; height:15px; display:flex; align-items:center; justify-content:center; border-radius:50%; border:1px solid rgba(255,255,255,0.2); pointer-events:none;">
            ${i + 1}
          </div>

          <!-- Botón Cruz (×) para remover de Destacados / Nuevos a la derecha -->
          <button type="button"
                  onclick="window.PixisEditorAPI.pixisRemoveFromReorderCategory(event, '${p.id}', '${categoryId}')"
                  title="Quitar de ${catLabel}"
                  style="position:absolute; top:2px; right:2px; background:rgba(239,68,68,0.92); color:#fff; font-size:12px; font-weight:900; width:16px; height:16px; border-radius:50%; border:1px solid rgba(255,255,255,0.4); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:10; transition:transform 0.15s, background 0.15s; line-height:1; padding:0;"
                  onmouseover="this.style.transform='scale(1.2)'; this.style.background='#dc2626';"
                  onmouseout="this.style.transform='scale(1)'; this.style.background='rgba(239,68,68,0.92)';">
            &times;
          </button>
        </div>
      `;
    }).join('');

    html += `</div>`;
    return html;
  },

  /**
   * Quita un producto de Destacados o Nuevos Ingresos directamente desde la pestaña de reordenar
   */
  async pixisRemoveFromReorderCategory(e, prodId, categoryId) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    const prod = (PixisEditor.data.products || []).find(p => String(p.id) === String(prodId));
    const prodName = prod ? prod.title : 'el producto';
    const catLabel = categoryId === 'destacados' ? 'Destacados' : 'Nuevos Ingresos';

    if (!confirm(`¿Deseas quitar "${prodName}" de ${catLabel}?`)) {
      return;
    }

    if (window.PixisState) window.PixisState.pushHistory();

    const products = [...PixisEditor.data.products];
    const targetProd = products.find(p => String(p.id) === String(prodId));

    if (targetProd) {
      if (targetProd.category === categoryId) targetProd.category = '';
      if (targetProd.category2 === categoryId) targetProd.category2 = '';
      if (targetProd.category3 === categoryId) targetProd.category3 = '';

      // Si la categoría principal quedó vacía pero tenía category2, promover category2 a principal
      if (!targetProd.category && targetProd.category2) {
        targetProd.category = targetProd.category2;
        targetProd.category2 = '';
      }

      PixisEditor.data.products = products;

      if (window.PixisState) {
        window.PixisState.state.products = products;
        await window.PixisState.saveState();
        window.PixisState.applyStateToDOM();
      }

      // Re-renderizar el panel de productos manteniendo abierta la misma pestaña
      openProductsPanel();
      window.PixisOverlay.showToast(`✅ Quitado de ${catLabel}`, 'success', 1500);
    }
  },

  pixisHandleProductDragStart(e, prodId) {
    this._draggedProdId = prodId;
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
  },

  async pixisHandleProductDrop(e, targetProdId, categoryId) {
    e.preventDefault();
    const fromId = this._draggedProdId;
    if (!fromId || fromId === targetProdId) return;

    if (window.PixisState) window.PixisState.pushHistory();

    const products = [...PixisEditor.data.products];
    const fromIdx = products.findIndex(p => p.id === fromId);
    const toIdx = products.findIndex(p => p.id === targetProdId);

    if (fromIdx === -1 || toIdx === -1) return;

    // Mover elemento en el array
    const [movedItem] = products.splice(fromIdx, 1);
    products.splice(toIdx, 0, movedItem);

    PixisEditor.data.products = products;
    
    if (window.PixisState) {
      window.PixisState.state.products = products;
      await window.PixisState.saveState();
      window.PixisState.applyStateToDOM();
    }

    // Refrescar el panel
    openProductsPanel();
    window.PixisOverlay.showToast('✅ Orden actualizado', 'success', 1000);
  }
};



/* ════════════════════════════════════════════════════════════════
   PANEL DATOS DEL SITIO
════════════════════════════════════════════════════════════════ */
function openSiteDataPanel() {
  const site = PixisEditor.data.site || {};

  window.PixisOverlay.openPanel('⚙️ Datos del Sitio', `
    <!-- ═══ ACORDEÓN: INFORMACIÓN GENERAL ═══ -->
    <div class="panel-section" style="padding:0; overflow:hidden;">
      <button onclick="window.pixisToggleAccordion('siteInfoAccordion','siteInfoArrow')" style="width:100%; background:rgba(255,165,0,0.07); border:none; border-bottom:1px solid rgba(255,165,0,0.2); padding:11px 14px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; border-radius:0;">
        <span style="font-size:12px; font-weight:700; color:#ffa500; letter-spacing:.4px;">🏪 INFORMACIÓN GENERAL</span>
        <span id="siteInfoArrow" style="font-size:10px; color:#ffa500; transition:transform .25s;">▼</span>
      </button>
      <div id="siteInfoAccordion" style="display:none; padding:12px 10px 10px;">
        <div class="panel-field">
          <label class="panel-label">Banner superior (texto)</label>
          <input type="text" class="panel-input" id="siteTopBanner"
                 value="${escHtml(site.topBannerText || 'SERVICIO TECNICO ESPECIALIZADO EN COMPUTACION Y MANTENIMIENTO EN CONSOLAS')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">El texto que corre por arriba de todo en la web.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Dirección local</label>
          <input type="text" class="panel-input" id="siteAddress"
                 value="${escHtml(site.address || 'Jujuy 412 Edificio San Antonio 2° piso oficina \"B\"')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">Se muestra en el pie de página (footer).</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Teléfono / WhatsApp</label>
          <input type="text" class="panel-input" id="sitePhone"
                 value="${escHtml(site.phone || '+54 9 3856 97-0135')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">Número de contacto principal.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Email de contacto</label>
          <input type="email" class="panel-input" id="siteEmail"
                 value="${escHtml(site.email || 'pixisinformatica.contacto@gmail.com')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">Dirección de correo electrónico de la empresa.</div>
        </div>
      </div>
    </div>


    <!-- ═══ ACORDEÓN: REDES SOCIALES ═══ -->
    <div class="panel-section" style="padding:0; overflow:hidden;">
      <button onclick="window.pixisToggleAccordion('siteRedesAccordion','siteRedesArrow')" style="width:100%; background:rgba(29,161,242,0.07); border:none; border-bottom:1px solid rgba(29,161,242,0.2); padding:11px 14px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; border-radius:0;">
        <span style="font-size:12px; font-weight:700; color:#1da1f2; letter-spacing:.4px;">📱 REDES SOCIALES</span>
        <span id="siteRedesArrow" style="font-size:10px; color:#1da1f2; transition:transform .25s;">▼</span>
      </button>
      <div id="siteRedesAccordion" style="display:none; padding:12px 10px 10px;">
        <div class="panel-field">
          <label class="panel-label">Instagram URL</label>
          <input type="text" class="panel-input" id="siteInstagram" value="${escHtml(site.instagram || '')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">Enlace a tu perfil de Instagram.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">Facebook URL</label>
          <input type="text" class="panel-input" id="siteFacebook" value="${escHtml(site.facebook || '')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">Enlace a tu página de Facebook.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">TikTok URL</label>
          <input type="text" class="panel-input" id="siteTiktok" value="${escHtml(site.tiktok || '')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">Enlace a tu perfil de TikTok.</div>
        </div>
        <div class="panel-field">
          <label class="panel-label">YouTube URL</label>
          <input type="text" class="panel-input" id="siteYoutube" value="${escHtml(site.youtube || '')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">Enlace a tu canal de YouTube.</div>
        </div>
      </div>
    </div>

    <!-- ═══ ACORDEÓN: CARRUSEL SUPERIOR ═══ -->
    <div class="panel-section" style="padding:0; overflow:hidden;">
      <button onclick="window.pixisToggleCarouselAccordion('top')" style="width:100%; background:rgba(176,38,255,0.08); border:none; border-bottom:1px solid rgba(176,38,255,0.2); padding:11px 14px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; border-radius:0;">
        <span style="font-size:12px; font-weight:700; color:#b026ff; letter-spacing:.4px;">🖼️ CARRUSEL SUPERIOR (Inicio)</span>
        <span id="carouselTopArrow" style="font-size:10px; color:#b026ff; transition:transform .25s;">▼</span>
      </button>
      <div id="carouselTopAccordion" style="display:none; padding:12px 10px 10px;">
        <div style="font-size:11px;color:#888;margin-bottom:8px;">Gestioná las imágenes rotativas de arriba de todo.</div>
        <div style="background:rgba(176,38,255,0.1);border:1px solid rgba(176,38,255,0.3);padding:8px 10px;border-radius:6px;font-size:11px;color:#d8b4fe;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
          <span>📐</span>
          <div><strong>Medidas recomendadas:</strong> 1720 × 540 px (PC) | 800 × 600 px (Móvil)</div>
        </div>
        <div id="carouselTopContainer">
          ${renderCarouselEditor(site.carouselTop || [], 'top')}
        </div>
        <div style="display:flex; gap:10px; margin-top:10px;">
          <button class="panel-btn" style="flex:1; border:1px dashed #b026ff; color:#b026ff; background:transparent;"
                  onclick="window.PixisEditorAPI.addCarouselSlide('top')">➕ Agregar slide</button>
          <button class="panel-btn panel-btn-primary" style="flex:2;"
                  onclick="window.PixisEditorAPI.saveCarousel('top')">💾 Aplicar Todo Superior</button>
        </div>
      </div>
    </div>

    <!-- ═══ ACORDEÓN: CARRUSEL INFERIOR ═══ -->
    <div class="panel-section" style="padding:0; overflow:hidden;">
      <button onclick="window.pixisToggleCarouselAccordion('bottom')" style="width:100%; background:rgba(0,180,216,0.08); border:none; border-bottom:1px solid rgba(0,180,216,0.2); padding:11px 14px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; border-radius:0;">
        <span style="font-size:12px; font-weight:700; color:#00b4d8; letter-spacing:.4px;">🖼️ CARRUSEL INFERIOR (Nuevos Ingresos)</span>
        <span id="carouselBottomArrow" style="font-size:10px; color:#00b4d8; transition:transform .25s;">▼</span>
      </button>
      <div id="carouselBottomAccordion" style="display:none; padding:12px 10px 10px;">
        <div style="font-size:11px;color:#888;margin-bottom:8px;">Gestioná las imágenes rotativas que aparecen abajo.</div>
        <div style="background:rgba(0,180,216,0.1);border:1px solid rgba(0,180,216,0.3);padding:8px 10px;border-radius:6px;font-size:11px;color:#90e0ef;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
          <span>📐</span>
          <div><strong>Medidas recomendadas:</strong> 1180 × 440 px (Centro PC) | 800 × 600 px (Móvil)</div>
        </div>
        <div id="carouselBottomContainer">
          ${renderCarouselEditor(site.carouselBottom || [], 'bottom')}
        </div>
        <div style="display:flex; gap:10px; margin-top:10px;">
          <button class="panel-btn" style="flex:1; border:1px dashed #00b4d8; color:#00b4d8; background:transparent;"
                  onclick="window.PixisEditorAPI.addCarouselSlide('bottom')">➕ Agregar slide</button>
          <button class="panel-btn panel-btn-primary" style="flex:2;"
                  onclick="window.PixisEditorAPI.saveCarousel('bottom')">💾 Aplicar Todo Inferior</button>
        </div>
      </div>
    </div>

    <!-- ═══ ACORDEÓN: CONFIGURACIÓN DE VENTAS ═══ -->
    <div class="panel-section" style="padding:0; overflow:hidden;">
      <button onclick="window.pixisToggleAccordion('siteVentasAccordion','siteVentasArrow')" style="width:100%; background:rgba(0,230,118,0.07); border:none; border-bottom:1px solid rgba(0,230,118,0.2); padding:11px 14px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; border-radius:0;">
        <span style="font-size:12px; font-weight:700; color:#00e676; letter-spacing:.4px;">💳 CONFIGURACIÓN DE VENTAS</span>
        <span id="siteVentasArrow" style="font-size:10px; color:#00e676; transition:transform .25s;">▼</span>
      </button>
      <div id="siteVentasAccordion" style="display:none; padding:12px 10px 10px;">
        <div class="panel-field">
          <label class="panel-label">WhatsApp link (wa.me)</label>
          <input type="text" class="panel-input" id="siteWaLink" value="${escHtml(site.whatsappLink || 'https://wa.me/message/EYUUSVNG5HPNF1')}">
          <div style="font-size:10px;color:#666;margin-top:2px;">El link directo que se abre al querer comprar un producto.</div>
        </div>
      </div>
    </div>

    <div class="panel-section">
      <button class="panel-btn panel-btn-primary" id="saveSiteDataBtn">💾 Guardar datos del sitio</button>
    </div>
  `);

  document.getElementById('saveSiteDataBtn')?.addEventListener('click', () => {
    // Recolectar datos carrusel superior
    const carouselTop = [];
    document.querySelectorAll('#carouselTopContainer .carousel-slide-item').forEach(item => {
      const pc = item.querySelector('.slide-img-pc')?.value.trim();
      const mob = item.querySelector('.slide-img-mob')?.value.trim();
      const bid = item.dataset.bannerId ?? item.querySelector('.slide-banner-id')?.value.trim() ?? '';
      if (pc || mob) carouselTop.push({ imgPc: pc, imgMobile: mob, bannerId: bid });
    });

    // Recolectar datos carrusel inferior
    const carouselBottom = [];
    document.querySelectorAll('#carouselBottomContainer .carousel-slide-item').forEach(item => {
      const pc = item.querySelector('.slide-img-pc')?.value.trim();
      const mob = item.querySelector('.slide-img-mob')?.value.trim();
      const bid = item.dataset.bannerId ?? item.querySelector('.slide-banner-id')?.value.trim() ?? '';
      if (pc || mob) carouselBottom.push({ imgPc: pc, imgMobile: mob, bannerId: bid });
    });

    const siteData = {
      topBannerText:  document.getElementById('siteTopBanner')?.value.trim(),
      address:        document.getElementById('siteAddress')?.value.trim(),
      phone:          document.getElementById('sitePhone')?.value.trim(),
      email:          document.getElementById('siteEmail')?.value.trim(),
      instagram:      document.getElementById('siteInstagram')?.value.trim(),
      facebook:       document.getElementById('siteFacebook')?.value.trim(),
      tiktok:         document.getElementById('siteTiktok')?.value.trim(),
      youtube:        document.getElementById('siteYoutube')?.value.trim(),
      whatsappLink:   document.getElementById('siteWaLink')?.value.trim(),
      carouselTop:    carouselTop,
      carouselBottom: carouselBottom,
      banners:        site.banners // Preservar banners existentes
    };

    if (window.PixisState) {
      window.PixisState.updateState({ type: 'site', path: [], value: siteData })
        .then(saved => {
          window.PixisOverlay.showToast(saved ? '✅ Datos del sitio guardados' : '📥 Actualizados (descargá JSON)', 'success');
          markUnsaved();
        });
    } else {
      PixisEditor.data.site = siteData;
      applyLoadedData();
      markUnsaved();
      window.PixisOverlay.showToast('Datos del sitio actualizados', 'success');
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   CLICK EN CARD DE PRODUCTO (handler de producto en HTML)
════════════════════════════════════════════════════════════════ */
function handleProductCardClick(e) {
  // Ignorar clicks en el botón flotante de borrado masivo para que su propio listener funcione
  if (e.target.closest('#pixis-floating-bulk-delete')) return;

  // En modo editor, el botón lápiz maneja los clicks → ignorar clicks directos en cards
  // EXCEPCIÓN: si el click viene del botón .pixis-edit-card-btn, abrir modal
  // 1. Botón Lápiz (Editar)
  const editBtn = e.target.closest('.pixis-edit-card-btn');
  if (editBtn) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const card = editBtn.closest('.card');
    if (card) openCardEditor(card);
    return;
  }

  // 2. Botón Basurero (Eliminar Directo)
  const deleteBtn = e.target.closest('.pixis-delete-card-btn');
  if (deleteBtn) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const card = deleteBtn.closest('.card');
    if (!card) return;

    // Obtener info del producto para el confirm
    const title = card.dataset.title || card.querySelector('h3')?.textContent?.trim() || 'este producto';
    if (!confirm(`⚠️ ¿ELIMINAR PRODUCTO? \n\n"${title}" se borrará del catálogo.\nRecordá que podés usar "Deshacer" si te equivocás.`)) return;

    // Ejecutar borrado
    const pixisId = card.dataset.pixisId || card.dataset.id;
    const isDynamic = card.classList.contains('dynamic-injected');

    if (isDynamic) {
      // Borrar de JSON
      const idx = PixisEditor.data.products.findIndex(p => p.id === pixisId);
      if (idx !== -1 && window.PixisState) {
        window.PixisState.pushHistory();
        const newProducts = [...window.PixisState.state.products];
        newProducts.splice(idx, 1);
        window.PixisState.state.products = newProducts;
        window.PixisState.saveState().then(() => {
          window.PixisOverlay.showToast('🗑️ Producto eliminado', 'success');
          window.PixisState.applyStateToDOM();
        });
      }
    } else {
      // Borrar card estática (usando ui.deleted)
      if (window.PixisState) {
        window.PixisState.pushHistory();
        if (!window.PixisState.state.ui.deleted) window.PixisState.state.ui.deleted = [];
        window.PixisState.state.ui.deleted.push(pixisId);
        window.PixisState.saveState().then(() => {
          window.PixisOverlay.showToast('🗑️ Tarjeta eliminada', 'success');
          window.PixisState.applyStateToDOM();
        });
      }
    }
    return;
  }

  // 3. Botón Seleccionar (Acción masiva)
  const selectBtn = e.target.closest('.pixis-select-card-btn');
  if (selectBtn) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const card = selectBtn.closest('.card');
    if (!card) return;
    const id = card.dataset.pixisId || card.dataset.id;
    if (!id) return;

    if (PixisEditor.state.selectedItems.has(id)) {
      PixisEditor.state.selectedItems.delete(id);
      selectBtn.innerHTML = '⬜';
      selectBtn.classList.remove('selected');
    } else {
      PixisEditor.state.selectedItems.add(id);
      selectBtn.innerHTML = '✅';
      selectBtn.classList.add('selected');
    }
    updateBulkDeleteFloatingUI();
    return;
  }

  // En modo 'sections' también abrir al hacer click en la card
  if (PixisEditor.state.activeMode !== 'sections') return;
  const card = e.target.closest('.card:not(.yt-card)');
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  openCardEditor(card);
}

function openCardEditor(card, productData = null, productIdx = null) {
  // DETECCIÓN AUTOMÁTICA DE TIPO (HTML vs JSON)
  if (card && card.classList.contains('dynamic-injected')) {
    const pixisId = card.dataset.pixisId || card.dataset.id;
    const idx = PixisEditor.data.products.findIndex(p => p.id === pixisId);
    if (idx !== -1) {
      productData = PixisEditor.data.products[idx];
      productIdx = idx;
    }
  }

  let cardId = card ? (card.dataset.id || card.dataset.pixisId) : (productData ? productData.id : null);
  
  if (!cardId && !productData) {
    window.PixisOverlay.showToast('⚠️ No se pudo identificar el producto', 'error');
    return;
  }

  // Leer datos: 
  // 1. Si es producto JSON (productData)
  // 2. Si es card HTML (usar overrides de PixisState.ui.cards o dataset)
  let title, priceNum, priceLocal, cashPrice, img, video, desc, inStock, proximoIngreso, customBtns, banners, priceVisible, subcat, category, category2, category3, stockNum, ivaText;

  if (productData) {
    // Es un producto JSON puro
    title      = productData.title || '';
    priceNum   = productData.price || '';
    priceLocal = productData.priceLocal || '';
    cashPrice  = productData.priceLocal || ''; // Para JSON usamos priceLocal como cashPrice
    
    // Si tiene galería, la mostramos toda en el campo de imágenes para editar
    if (productData.gallery) {
      img = productData.gallery;
    } else {
      img = productData.img || '';
    }

    video        = productData.video || productData.videoUrl || '';
    desc         = productData.desc || '';
    inStock    = productData.inStock !== false;
    proximoIngreso = productData.proximoIngreso === true;
    customBtns = productData.customButtons || [];
    banners    = productData.banners || [];
    priceVisible = productData.priceVisible || (priceNum ? `$${Number(priceNum).toLocaleString()}` : '');
    subcat     = productData.subcategoria || '';
    category   = productData.category || '';
    category2  = productData.category2 || '';
    category3  = productData.category3 || '';
    stockNum   = productData.stock !== undefined ? productData.stock : '';
    ivaText    = productData.iva || '';
  } else {
    // Es una card HTML
    const saved  = (window.PixisState?.state?.ui?.cards || {})[cardId] || {};
    title        = saved.title    || card.dataset.title    || card.querySelector('h3')?.textContent?.trim() || '';
    priceNum     = saved.priceNum || card.querySelector('.btn-add-cart')?.dataset.price || '';
    priceLocal   = saved.priceLocal || card.querySelector('.btn-add-cart')?.dataset.priceLocal || '';
    cashPrice    = saved.cashPrice  || card.dataset.cashPrice || '';
    
    // Prioridad a la galería guardada para el campo de edición
    if (saved.gallery) {
      img = saved.gallery;
    } else if (card.dataset.gallery) {
      img = card.dataset.gallery;
    } else {
      img = saved.img || card.dataset.img || card.querySelector('img:not(.fly-product)')?.getAttribute('src') || '';
    }

    video        = saved.video || saved.videoUrl || card.dataset.video || card.dataset.videoUrl || '';
    desc         = saved.desc     || card.dataset.desc     || '';
    inStock      = saved.inStock  !== undefined ? saved.inStock : !card.classList.contains('sin-stock');
    proximoIngreso = saved.proximoIngreso !== undefined ? saved.proximoIngreso : (card.dataset.proximoIngreso === 'true' || card.classList.contains('proximo-ingreso'));
    customBtns   = saved.customButtons || (card.dataset.customButtons ? JSON.parse(card.dataset.customButtons) : []) || [];
    banners      = saved.banners  || (card.dataset.banners ? JSON.parse(card.dataset.banners) : null) || [];
    priceVisible = saved.price    || card.dataset.price || '';
    subcat       = card.dataset.subcategoria || '';
    category     = saved.category || card.dataset.category || '';
    category2    = saved.category2 || card.dataset.category2 || '';
    category3    = saved.category3 || card.dataset.category3 || '';
    stockNum     = saved.stock !== undefined ? saved.stock : (card.dataset.stock !== undefined ? card.dataset.stock : '');
    ivaText      = saved.iva || card.dataset.iva || '';
  }

  let excludeExport = productData ? productData.excludeFromExport === true : false;
  if (!productData && (window.PixisState?.state?.ui?.cards || {})[cardId]) {
    excludeExport = (window.PixisState.state.ui.cards[cardId]).excludeFromExport === true;
  }

  // Calcular cuotas preview usando las tasas del sitio
  const tasas = { 1: 1.13, 3: 1.31, 6: 1.31, 9: 1.60, 12: 1.60 };
  const basePrice = parseInt(priceNum) || 0;
  const cuotasHTML = basePrice > 0
    ? Object.entries(tasas).map(([n, t]) => {
        const total = Math.round(basePrice * t);
        const cuota = Math.round(total / n);
        return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#aaa">
          <span>${n} cuota${n > 1 ? 's' : ''}</span>
          <span style="color:#b026ff">$${cuota.toLocaleString()}</span>
          <span style="color:#666">Total: $${total.toLocaleString()}</span>
        </div>`;
      }).join('')
    : '<p style="color:#666;font-size:11px">Ingresá el precio transferencia para ver cuotas</p>';

  // Botones personalizados actuales
  const customBtnsHTML = customBtns.map((b, i) => `
    <div class="panel-field" style="display:flex;gap:6px;align-items:center" id="customBtn_${i}">
      <input type="text" class="panel-input" placeholder="Etiqueta" 
             id="cbLabel_${i}" value="${escHtml(b.label || '')}" style="flex:1">
      <input type="text" class="panel-input" placeholder="URL" 
             id="cbLink_${i}"  value="${escHtml(b.link  || '')}" style="flex:2">
      <button class="product-action-btn del" onclick="pixisRemoveCustomBtn(${i})">🗑️</button>
    </div>
  `).join('');

  const body = `
    <div class="panel-section">
      <div class="panel-section-title">📦 Datos del producto</div>
      <div class="panel-field">
        <label class="panel-label">Título</label>
        <input type="text" class="panel-input" id="cardTitle" value="${escHtml(title)}">
        <div style="font-size:10px;color:#666;margin-top:2px;">El nombre que verá el cliente.</div>
      </div>
      <div class="panel-field">
        <label class="panel-label">Imágenes del producto</label>
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <button class="panel-btn" style="flex:1; background:#0d0d1a; border:1px dashed #b026ff; color:#b026ff;" 
                  onclick="window.PixisEditorAPI.uploadProductImages('cardTitle', 'cardImg')">
            🖼️ Seleccionar Imágenes (Escritorio/PC)
          </button>
        </div>
        <input type="text" class="panel-input" id="cardImg" value="${escHtml(img)}" oninput="pixisUpdateImgPreview(this.value, 'cardImgGalleryPreview')">
        <div style="font-size:10px;color:#666;margin-top:2px;">Enlace de la foto. Puedes poner varias separadas por coma para crear una galería.</div>
        <div id="cardImgGalleryPreview" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>
      </div>
      <div class="panel-field">
        <label class="panel-label">Descripción</label>
        <textarea class="panel-textarea" id="cardDesc">${escHtml(desc)}</textarea>
        <div style="font-size:10px;color:#666;margin-top:2px;">Detalles técnicos del producto.</div>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title" style="color: #b026ff;">🎬 Video del producto (opcional)</div>
      <div class="panel-field">
        <input type="text" class="panel-input" id="cardVideo" value="${escHtml(video)}" placeholder="https://...">
        <div style="font-size:10px;color:#888;margin-top:4px;">Pegá el link de YouTube, Vimeo o un archivo .mp4 directo.</div>
        <div style="font-size:10px;color:#888;margin-top:2px;">Aparecerá una miniatura de ▶ video en la galería del modal del producto.</div>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">💰 Precios</div>
      <div class="panel-field">
        <label class="panel-label">💳 Precio Transferencia (base para cuotas)</label>
        <input type="number" class="panel-input" id="cardPriceNum" value="${priceNum}" 
               oninput="pixisUpdateCuotasPreview(this.value)" placeholder="ej: 137500">
        <div style="font-size:10px;color:#666;margin-top:2px;">Precio base. Se usa para calcular las cuotas con recargo.</div>
      </div>

      <div class="panel-field">
        <label class="panel-label">💵 Precio efectivo en local</label>
        <input type="number" class="panel-input" id="cardCashPrice" value="${cashPrice}" placeholder="ej: 131500">
        <div style="font-size:10px;color:#666;margin-top:2px;">Precio con descuento para cobrar en el local.</div>
      </div>
      <!-- 'Precio local / otros medios' removido a petición del usuario. Se usa el precio calculado de cuotas o el efectivo automáticamente. -->
    </div>

    <div class="panel-section">
      <div class="panel-section-title">📊 Cuotas (calculadas desde precio transferencia)</div>
      <div id="cuotasPreviewEditor" style="background:#0d0d1a;padding:8px;border-radius:6px;margin-top:4px">
        ${cuotasHTML}
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">🎯 Aparecer en Banners Promocionales</div>
      <div style="font-size:11px;color:#999;margin-bottom:8px;line-height:1.4;">
        <strong>¿Qué es esto?</strong> Si marcas una de estas opciones, este producto aparecerá dentro de la lista especial de esa promoción (banner).
      </div>
      <div id="bannersPreviewEditor" style="display:flex;gap:10px;flex-wrap:wrap;background:#0d0d1a;padding:10px;border-radius:6px;">
        ${
          window._bannerData ? Object.entries(window._bannerData).map(([bId, bData]) => {
            const isChecked = banners.includes(bId) ? 'checked' : '';
            return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#ccc;cursor:pointer;background:#1a1a2e;padding:4px 8px;border-radius:4px;">
                      <input type="checkbox" class="banner-checkbox-editor" value="${escHtml(bId)}" ${isChecked}>
                      ${escHtml(bData.t)}
                    </label>`;
          }).join('') : '<p style="color:#666;font-size:11px">No se encontraron banners disponibles</p>'
        }
      </div>
      <div style="font-size:11px;color:#999;margin-top:10px;margin-bottom:8px;line-height:1.4;background:rgba(255,255,255,0.03);padding:8px;border-radius:4px;border-left:3px solid #b026ff;">
        <strong>🚀 Paso a paso:</strong><br>
        1. Escribe un nombre y dale a <b>➕ Crear Banner</b>.<br>
        2. Asegúrate de que el producto tenga el <b>visto [✓]</b> marcado.<br>
        3. ¡Listo! Ahora solo ve a una imagen del carrusel, hazle <b>clic derecho -> Editar</b> y selecciónalo en la lista para que al hacer clic te lleve a estos productos.
      </div>
      <div style="display:flex; gap:6px;">
        <input type="text" id="inlineBannerNameCard" class="panel-input" placeholder="Ej: Especial Navidad" style="padding:4px 8px; font-size:11px;">
        <button class="panel-btn" style="padding:4px 8px; font-size:11px; white-space:nowrap;" onclick="window.PixisEditorAPI.createInlineBanner(document.getElementById('inlineBannerNameCard').value, 'bannersPreviewEditor', 'banner-checkbox-editor'); document.getElementById('inlineBannerNameCard').value = '';">➕ Crear Banner</button>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">📦 Stock y Disponibilidad</div>
      
      <!-- Campos de Stock numérico e IVA -->
      <div style="display:flex; gap:10px; margin-bottom:12px;">
        <div class="panel-field" style="flex:1; margin-bottom:0;">
          <label class="panel-label">Cantidad Stock</label>
          <input type="number" class="panel-input" id="cardStockNum" value="${stockNum !== undefined ? stockNum : ''}" placeholder="Ej: 28">
        </div>
        <div class="panel-field" style="flex:1; margin-bottom:0;">
          <label class="panel-label">IVA (%)</label>
          <input type="text" class="panel-input" id="cardIva" value="${escHtml(ivaText)}" placeholder="Ej: 21,00%">
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="panel-btn ${!inStock ? 'panel-btn-danger' : ''}" id="btnSinStock" 
                style="flex:1" data-pixis-stock="false">❌ Sin stock</button>
        <button class="panel-btn ${inStock ? 'panel-btn-primary' : ''}" id="btnEnStock" 
                style="flex:1" data-pixis-stock="true">✅ En stock</button>
      </div>
      <div style="font-size:10px;color:#666;margin-top:6px;">El botón seleccionado es la autoridad. Stock=0 fuerza "Sin stock". Podés dejar un producto sin stock aunque tenga cantidad disponible (para protegerlo ante sobredemanda).</div>
      <input type="hidden" id="cardStockVal" value="${inStock ? 'true' : 'false'}">

      <!-- Toggle Próximo Ingreso (Featured Gold Premium) -->
      <div style="margin-top: 12px; background: rgba(212, 175, 55, 0.05); border: 1px solid rgba(212, 175, 55, 0.3); padding: 8px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; flex-direction: column;">
          <span style="font-size: 12.5px; font-weight: bold; color: #ffd700;">✨ Próximo Ingreso</span>
          <span style="font-size: 9px; color: #aaa;">Activa el diseño Featured Gold Premium</span>
        </div>
        <label class="pixis-gold-switch" style="position: relative; display: inline-block; width: 44px; height: 22px;">
          <input type="checkbox" id="cardProximoIngreso" ${proximoIngreso ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
          <span class="pixis-gold-slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #333; transition: .4s; border-radius: 22px; border: 1px solid rgba(212,175,55,0.4);"></span>
        </label>
      </div>
    </div>

    <div class="panel-section" style="background:rgba(176,38,255,0.05); border:1px solid rgba(176,38,255,0.2);">
      <div class="panel-section-title" style="color:#b026ff;">🔒 Exclusividad y Sincronización</div>
      <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:5px 0;">
        <input type="checkbox" id="cardExcludeExport" ${excludeExport ? 'checked' : ''} style="width:18px; height:18px;">
        <div style="flex:1;">
          <span style="font-size:12px; font-weight:bold; color:#fff;">Excluir de exportación y sincronización</span>
          <p style="font-size:10px; color:#aaa; margin:2px 0 0 0;">
            Si se marca, este producto NO aparecerá en Excel/CSV y NO se borrará automáticamente al importar inventario.
          </p>
        </div>
      </label>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">🔘 Botones personalizados</div>
      <div id="customBtnsContainer">${customBtnsHTML}</div>
      <button class="panel-btn" style="margin-top:6px;width:100%" 
              onclick="pixisAddCustomBtn()">➕ Agregar botón</button>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">🏷️ Categoría y Filtros</div>
      <div class="panel-field">
        <label class="panel-label">Categoría * <span style="color:#ff4757;font-size:10px;">(obligatorio — sin categoría el producto no aparece en el sitio)</span></label>
        <select class="panel-select" id="cardCategory" onchange="pixisUpdateSubcatSuggestions(this.value,'pixisSubcatListEdit')">
          <option value="" disabled ${!category ? 'selected' : ''}>— Selecciona una categoría —</option>
          ${(PixisEditor.data.categories || []).map(c => 
            `<option value="${escHtml(c.id)}" ${category === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`
          ).join('')}
        </select>
        <div style="font-size:10px;color:#ff9f43;margin-top:4px;">⚠️ Si no asignás una categoría, el producto NO aparecerá en ningún lado del sitio.</div>
      </div>
      <div class="panel-field">
        <label class="panel-label">Categoría secundaria (Opcional)</label>
        <select class="panel-select" id="cardCategory2">
          <option value="" ${!category2 ? 'selected' : ''}>— Ninguna —</option>
          ${(PixisEditor.data.categories || []).map(c => 
            `<option value="${escHtml(c.id)}" ${category2 === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`
          ).join('')}
        </select>
        <div style="font-size:10px;color:#888;margin-top:4px;">Permite que el producto aparezca en una segunda sección del catálogo.</div>
      </div>
      <div class="panel-field">
        <label class="panel-label">Categoría terciaria (Opcional)</label>
        <select class="panel-select" id="cardCategory3">
          <option value="" ${!category3 ? 'selected' : ''}>— Ninguna —</option>
          ${(PixisEditor.data.categories || []).map(c => 
            `<option value="${escHtml(c.id)}" ${category3 === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`
          ).join('')}
        </select>
        <div style="font-size:10px;color:#888;margin-top:4px;">Permite que el producto aparezca en una tercera sección del catálogo.</div>
      </div>
      <div class="panel-field">
        <label class="panel-label">Subcategoría / Filtros</label>
        <input type="text" class="panel-input" id="cardSubcat" value="${escHtml(subcat)}" list="pixisSubcatListEdit" autocomplete="off">
        <datalist id="pixisSubcatListEdit">
          ${(() => {
            const cats = [category, category2, category3].filter(Boolean);
            const subcats = new Set();
            (PixisEditor.data.products || []).forEach(p => {
              if (cats.includes(p.category) || cats.includes(p.category2) || cats.includes(p.category3)) {
                if (p.subcategoria) p.subcategoria.split(',').forEach(s => { if (s.trim()) subcats.add(s.trim()); });
              }
            });
            return [...subcats].sort().map(s => `<option value="${escHtml(s)}">`).join('');
          })()}
        </datalist>
        <div style="font-size:10px;color:#888;margin-top:2px;">Sugerencias basadas en la categoría seleccionada. Podés elegir una existente o escribir una nueva.</div>
      </div>
    </div>
  `;

  const footer = `
    <button class="panel-btn panel-btn-danger" id="deleteProductBtn" style="margin-right: auto;">🗑️ Eliminar producto</button>
    <button class="panel-btn" onclick="window.PixisOverlay.closeModal()">Cancelar</button>
    <button class="panel-btn panel-btn-primary" id="applyCardBtn">✅ Aplicar y guardar</button>
  `;

  window.PixisOverlay.openModal(`<span class="modal-icon">🃏</span> Editar: ${escHtml(title)}`, body, footer);

  // La vista previa de imágenes ahora usa la función global window.pixisUpdateImgPreview


  // Inicializar preview con las imágenes ya existentes al abrir el modal
  window.pixisUpdateImgPreview(img, 'cardImgGalleryPreview', 'cardImg');

  // Helpers globales temporales para el modal
  window.pixisSetStock = function(val) {
    const hidden = document.getElementById('cardStockVal');
    const btnSin = document.getElementById('btnSinStock');
    const btnEn  = document.getElementById('btnEnStock');
    if (!hidden || !btnSin || !btnEn) return;
    hidden.value = val ? 'true' : 'false';
    btnSin.className = `panel-btn${!val ? ' panel-btn-danger'   : ''}`;
    btnEn.className  = `panel-btn${val  ? ' panel-btn-primary' : ''}`;
  };

  // Wiring por addEventListener — más confiable que onclick inline
  setTimeout(() => {
    const btnSin = document.getElementById('btnSinStock');
    const btnEn  = document.getElementById('btnEnStock');
    if (btnSin) btnSin.addEventListener('click', (e) => { e.preventDefault(); window.pixisSetStock(false); });
    if (btnEn)  btnEn.addEventListener('click',  (e) => { e.preventDefault(); window.pixisSetStock(true);  });

    // Auto: stock=0 → sin stock. Stock > 0 NO cambia el botón (manual gana).
    const stockNumInput = document.getElementById('cardStockNum');
    if (stockNumInput) {
      stockNumInput.addEventListener('input', () => {
        const v = parseInt(stockNumInput.value, 10);
        if (!isNaN(v) && v === 0) {
          window.pixisSetStock(false);
        }
      });
    }
  }, 100);

  window.pixisUpdateCuotasPreview = function(rawPrice) {
    const p = parseInt(rawPrice) || 0;
    const cont = document.getElementById('cuotasPreviewEditor');
    if (!cont) return;
    if (!p) { cont.innerHTML = '<p style="color:#666;font-size:11px">Ingresá el precio transferencia</p>'; return; }
    cont.innerHTML = Object.entries(tasas).map(([n, t]) => {
      const total = Math.round(p * t);
      const cuota = Math.round(total / n);
      return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#aaa">
        <span>${n} cuota${n > 1 ? 's' : ''}</span>
        <span style="color:#b026ff">$${cuota.toLocaleString()}</span>
        <span style="color:#666">Total: $${total.toLocaleString()}</span>
      </div>`;
    }).join('');
  };

  window.pixisAddCustomBtn = function() {
    const cont = document.getElementById('customBtnsContainer');
    const i = cont.querySelectorAll('[id^="customBtn_"]').length;
    const div = document.createElement('div');
    div.className = 'panel-field';
    div.id = `customBtn_${i}`;
    div.style.cssText = 'display:flex;gap:6px;align-items:center';
    div.innerHTML = `
      <input type="text" class="panel-input" placeholder="Etiqueta" id="cbLabel_${i}" style="flex:1">
      <input type="text" class="panel-input" placeholder="URL"      id="cbLink_${i}"  style="flex:2">
      <button class="product-action-btn del" onclick="pixisRemoveCustomBtn(${i})">🗑️</button>
    `;
    cont.appendChild(div);
  };

  window.pixisRemoveCustomBtn = function(i) {
    document.getElementById(`customBtn_${i}`)?.remove();
  };

  // BOTÓN ELIMINAR — borra el producto del catálogo
  document.getElementById('deleteProductBtn')?.addEventListener('click', async () => {
    const confirmName = title || 'este producto';
    if (!confirm(`⚠️ ¿ESTÁS SEGURO? \n\nVas a eliminar definitivamente: "${confirmName}"\nEsta acción no se puede deshacer.`)) return;

    window.PixisOverlay.showToast('🗑️ Eliminando...', 'info');

    if (productIdx !== null) {
      // Caso 1: Es un producto del catálogo JSON
      if (window.PixisState) {
        window.PixisState.pushHistory();
        const newProducts = [...window.PixisState.state.products];
        newProducts.splice(productIdx, 1);
        
        // Actualizamos el estado global
        window.PixisState.state.products = newProducts;
        
        const ok = await window.PixisState.saveState();
        if (ok) {
          window.PixisOverlay.showToast('✅ Producto eliminado del catálogo', 'success');
          window.PixisOverlay.closeModal();
          window.PixisState.applyStateToDOM();
          openProductsPanel();
        }
      } else {
        PixisEditor.data.products.splice(productIdx, 1);
        markUnsaved();
        window.PixisOverlay.closeModal();
        openProductsPanel();
      }
    } else if (cardId) {
      // Caso 2: Es una card HTML estática
      if (window.PixisState) {
        window.PixisState.pushHistory();
        
        // El sistema en state.js espera una lista en ui.deleted
        if (!window.PixisState.state.ui.deleted) window.PixisState.state.ui.deleted = [];
        if (!window.PixisState.state.ui.deleted.includes(cardId)) {
          window.PixisState.state.ui.deleted.push(cardId);
        }
        
        const ok = await window.PixisState.saveState();
        if (ok) {
          window.PixisOverlay.showToast('✅ Tarjeta eliminada', 'success');
          window.PixisOverlay.closeModal();
          window.PixisState.applyStateToDOM();
        }
      } else {
        card?.remove();
        markUnsaved();
        window.PixisOverlay.closeModal();
      }
    }
  });

  // BOTÓN APLICAR — guarda todo via PixisState
  document.getElementById('applyCardBtn')?.addEventListener('click', () => {
    const newTitle      = document.getElementById('cardTitle')?.value.trim() || '';
    const newPriceNum   = document.getElementById('cardPriceNum')?.value || '';
    const newCashPrice  = document.getElementById('cardCashPrice')?.value || '';
    const newImg        = document.getElementById('cardImg')?.value.trim() || '';
    const newDesc       = document.getElementById('cardDesc')?.value.trim() || '';
    const newVideo      = document.getElementById('cardVideo')?.value.trim() || '';
    let newStock        = document.getElementById('cardStockVal')?.value === 'true';
    const newStockNumVal = document.getElementById('cardStockNum')?.value;
    const newStockNum   = newStockNumVal !== '' ? parseInt(newStockNumVal, 10) : undefined;
    // Regla: stock=0 fuerza sin stock (imposible tener 0 unidades en stock).
    // Si stock > 0, el botón manual Es la autoridad — NO se sobreescribe aquí.
    if (newStockNum === 0) newStock = false;
    const newIva        = document.getElementById('cardIva')?.value.trim() || '';
    const newExclude    = document.getElementById('cardExcludeExport')?.checked === true;
    const newProximoIngreso = document.getElementById('cardProximoIngreso')?.checked === true;

    // Recolectar botones personalizados
    const newCustomBtns = [];
    document.querySelectorAll('#customBtnsContainer [id^="customBtn_"]').forEach(row => {
      const idx   = row.id.split('_')[1];
      const label = document.getElementById(`cbLabel_${idx}`)?.value.trim();
      const link  = document.getElementById(`cbLink_${idx}`)?.value.trim();
      if (label) newCustomBtns.push({ label, link: link || '#' });
    });

    // Recolectar banners seleccionados
    const newBanners = Array.from(document.querySelectorAll('.banner-checkbox-editor:checked')).map(cb => cb.value);
    
    // Subcategoría
    const newSubcat = document.getElementById('cardSubcat')?.value.trim() || '';
    
    // Categoría
    const newCategory = document.getElementById('cardCategory')?.value || '';
    const newCategory2 = document.getElementById('cardCategory2')?.value || '';
    const newCategory3 = document.getElementById('cardCategory3')?.value || '';

    // Procesar lista de imágenes para separar principal y galería
    const imgList = newImg.split(',').map(s => s.trim()).filter(Boolean);
    const mainImg = imgList[0] || '';
    const galleryStr = imgList.join(',');

    // Construir objeto completo
    const finalData = {
      title:         newTitle,
      price:         newPriceNum ? `$${Number(newPriceNum).toLocaleString()}` : '',
      priceNum:      newPriceNum,
      cashPrice:     newCashPrice,
      img:           mainImg,
      gallery:       galleryStr,
      video:         newVideo,
      videoUrl:      newVideo,
      desc:          newDesc,
      inStock:       newStock,
      stock:         newStockNum,
      iva:           newIva,
      proximoIngreso: newProximoIngreso,
      customButtons: newCustomBtns,
      banners:       newBanners,
      subcategoria:  newSubcat,
      category:      newCategory,
      category2:     newCategory2,
      category3:     newCategory3,
      excludeFromExport: newExclude
    };

    if (productData) {
      // GUARDAR EN ARRAY DE PRODUCTOS JSON
      const updatedProduct = {
        ...productData,
        ...finalData,
        price: parseInt(newPriceNum) || 0,
        priceLocal: parseInt(newCashPrice) || parseInt(newPriceNum) || 0,
        excludeFromExport: newExclude,
        proximoIngreso: newProximoIngreso,
        // Garantizar que inStock y stock siempre reflejen la intención del botón
        inStock: newStock,
        stock:   newStockNum !== undefined ? newStockNum : (productData.stock !== undefined ? productData.stock : undefined),
        video:   newVideo,
        videoUrl: newVideo,
      };
      
      if (window.PixisState) {
        window.PixisState.pushHistory();
        window.PixisState.applyChange({ type: 'products', path: [productIdx], value: updatedProduct });
        window.PixisState.saveState().then(saved => {
          window.PixisOverlay.showToast(saved ? '✅ Producto JSON guardado' : '📥 Producto actualizado localmente', 'success');
          markUnsaved();
          window.PixisState.applyStateToDOM();
          openProductsPanel();
          // Volver a la pestaña JSON y aplicar filtro si había uno
          setTimeout(() => {
             switchProdTab('json');
             if (document.getElementById('searchJsonList')) window.pixisFilterJsonList(document.getElementById('searchJsonList').value);
          }, 50);
        });
      } else {
        PixisEditor.data.products[productIdx] = updatedProduct;
        markUnsaved();
        openProductsPanel();
      }
    } else {
      // GUARDAR EN OVERRIDES DE CARDS HTML
      if (window.PixisState) {
        window.PixisState.updateState({ type: 'ui', path: ['cards', cardId], value: finalData })
          .then(saved => {
            window.PixisOverlay.showToast(saved ? '✅ Card HTML guardada' : '📥 Aplicado localmente', saved ? 'success' : 'warning');
            markUnsaved();
          });
      } else {
        if (!PixisEditor.data.ui.cards) PixisEditor.data.ui.cards = {};
        PixisEditor.data.ui.cards[cardId] = finalData;
        applyCardDataToDOM(card, finalData);
        markUnsaved();
      }
    }

    window.PixisOverlay.closeModal();
  });
}


/* ════════════════════════════════════════════════════════════════
   INYECTAR CARD DE NUEVO PRODUCTO AL DOM
════════════════════════════════════════════════════════════════ */
function injectProductCard(product) {
  const destacadosTrack = document.getElementById('destacadosTrack');
  if (!destacadosTrack) return;

  const priceFormatted = `$${Number(product.price).toLocaleString()}`;
  const card = document.createElement('div');
  
  const isProximo = product.proximoIngreso === true;
  card.className = `card pulsante2${isProximo ? ' proximo-ingreso' : ''}`;
  card.dataset.proximoIngreso = isProximo ? 'true' : 'false';
  
  card.dataset.title = product.title;
  card.dataset.price = priceFormatted;
  card.dataset.img = product.img || '';
  card.dataset.desc = product.desc || '';
  if (product.video) {
    card.dataset.video = product.video;
    card.dataset.videoUrl = product.video;
  } else if (product.videoUrl) {
    card.dataset.video = product.videoUrl;
    card.dataset.videoUrl = product.videoUrl;
  }
  card.dataset.subcategoria = product.subcategoria || '';
  card.dataset.pixisId = product.id;

  card.innerHTML = `
    <div class="card-top-bar">
      ${isProximo 
        ? '<span class="card-pill badge-proximo">⏳ Próximamente</span>' 
        : '<span class="card-pill badge-destacado">★ Destacado</span>'}
      <span class="card-stock-pill ${isProximo ? 'stock-proximo' : 'stock-disponible'}">
        ${isProximo ? '● Próximo' : '● En stock'}
      </span>
    </div>
    <div class="card-img-wrap">
      <img src="${product.img || ''}" alt="${escHtml(product.title)}" loading="lazy">
    </div>
    <div class="card-subcat">${escHtml(product.subcategoria || 'Hardware')}</div>
    <h3 class="card-title">${escHtml(product.title)}</h3>
    <div class="precio-box">
      <span class="precio-label">PRECIO ESPECIAL WEB</span>
      <span class="precio">${priceFormatted}</span>
    </div>
    <div class="card-actions">
      ${isProximo ? `
        <button type="button" class="btn-add-cart"
                data-name="${escHtml(product.title)}"
                data-price="${product.price}"
                data-price-local="${product.priceLocal}">
          🛒 Reservar
        </button>
        <a href="https://wa.me/message/EYUUSVNG5HPNF1" class="btn-wsp" onclick="event.stopPropagation();">Consultar</a>
      ` : `
        <div class="card-qty-stepper" onclick="event.stopPropagation();">
          <button type="button" class="card-qty-btn qty-minus" aria-label="Restar">−</button>
          <input type="number" class="card-qty-input" value="1" min="1" max="99" aria-label="Cantidad">
          <button type="button" class="card-qty-btn qty-plus" aria-label="Sumar">+</button>
        </div>
        <button type="button" class="btn-add-cart"
                data-name="${escHtml(product.title)}"
                data-price="${product.price}"
                data-price-local="${product.priceLocal}">
          <i class="fas fa-shopping-cart"></i> Agregar
        </button>
      `}
    </div>
  `;

  destacadosTrack.appendChild(card);
}

/* ════════════════════════════════════════════════════════════════
   ACCIONES DEL ELEMENT TOOLBAR
════════════════════════════════════════════════════════════════ */
function duplicateElement() {
  const el = PixisEditor.state.selectedElement;
  if (!el) return;

  if (window.PixisState) window.PixisState.pushHistory();

  const clone = el.cloneNode(true);
  clone.removeAttribute('data-pixis-id');
  el.parentNode.insertBefore(clone, el.nextSibling);

  // Re-assign ID
  highlightElements(PixisEditor.state.activeMode);
  markUnsaved();
  window.PixisOverlay.showToast('Elemento duplicado', 'success');
}

function moveElement(direction) {
  const el = PixisEditor.state.selectedElement;
  if (!el || !el.parentNode) return;

  if (window.PixisState) window.PixisState.pushHistory();

  const siblings = [...el.parentNode.children];
  const idx = siblings.indexOf(el);
  const newIdx = idx + direction;

  if (newIdx < 0 || newIdx >= siblings.length) return;

  if (direction === -1) {
    el.parentNode.insertBefore(el, siblings[newIdx]);
  } else {
    el.parentNode.insertBefore(siblings[newIdx], el);
  }

  markUnsaved();
  window.PixisOverlay.positionToolbar(el);
  window.PixisOverlay.showToast('Elemento movido', 'success');
}

function deleteElement() {
  const el = PixisEditor.state.selectedElement;
  if (!el) return;

  if (!confirm('¿Eliminar este elemento de la vista?')) return;

  const id = el.dataset.pixisId;
  el.remove();
  window.PixisOverlay.hideToolbar();

  // Guardar via PixisState → JSON
  if (id && window.PixisState) {
    const current = window.PixisState.state.ui.deleted || [];
    current.push(id);
    window.PixisState.updateState({ type: 'ui', path: ['deleted'], value: current })
      .then(() => markUnsaved());
  } else if (id) {
    if (!PixisEditor.data.ui.deleted) PixisEditor.data.ui.deleted = [];
    PixisEditor.data.ui.deleted.push(id);
    markUnsaved();
  }

  window.PixisOverlay.showToast('Elemento eliminado de la vista', 'warning');
}

/* ════════════════════════════════════════════════════════════════
   GUARDAR TODO → JSON
════════════════════════════════════════════════════════════════ */
async function saveAllData(silent = false) {
  const btn = document.getElementById('editorBtnSave');
  if (btn) { btn.classList.add('saving'); btn.innerHTML = '<span>⏳</span> Guardando...'; }

  try {
    let allOk = false;

    if (window.PixisState) {
      // Registrar historial antes de aplicar cambios masivos si hubo cambios
      if (PixisEditor.state.unsaved) window.PixisState.pushHistory();
      // Sincronizar PixisState.state con PixisEditor.data (por si se modificó sin PixisState)
      window.PixisState.state.site = PixisEditor.data.site;
      window.PixisState.state.products = PixisEditor.data.products;
      window.PixisState.state.categories = PixisEditor.data.categories;
      window.PixisState.state.ui = PixisEditor.data.ui;
      allOk = await window.PixisState.saveState();
    } else {
      const files = [
        { name: 'site.json',       data: PixisEditor.data.site       },
        { name: 'products.json',   data: PixisEditor.data.products   },
        { name: 'categories.json', data: PixisEditor.data.categories },
        { name: 'ui.json',         data: PixisEditor.data.ui         }
      ];

      const results = await Promise.allSettled(
        files.map(({ name, data }) => saveJSON(name, data))
      );
      allOk = results.every(r => r.status === 'fulfilled' && r.value);
    }

    if (allOk) {
      window.PixisOverlay.markSaved();
      PixisEditor.state.unsaved = false;
      if (!silent) window.PixisOverlay.showToast('¡Cambios guardados exitosamente! 🎉', 'success');
    } else {
      offerDownloadFallback();
    }
  } catch (err) {
    console.error('[PIXIS] Error guardando:', err);
    offerDownloadFallback();
  } finally {
    if (btn) { btn.classList.remove('saving'); btn.innerHTML = '<span>💾</span> Aplicar cambios'; }
  }
}


async function saveJSON(filename, data) {
  try {
    const jsonString = JSON.stringify(data, null, 2);
    // Base64 encoding compatible con caracteres especiales UTF-8
    const base64Payload = btoa(unescape(encodeURIComponent(jsonString)));

    const res = await fetch(`/api/sync?file=data/${filename}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ payload: base64Payload })
    });
    
    const text = await res.text();
    let responseData;
    try {
      responseData = JSON.parse(text);
    } catch(e) {
      console.error(`[PIXIS] Error al procesar respuesta del servidor (no es JSON):`, text);
      window.PixisOverlay?.showToast?.(`Error de red: El servidor retornó una página de error en lugar de JSON.`, 'danger', 10000);
      return false;
    }

    if (!res.ok || responseData.ok === false) {
      const errMsg = responseData.error || res.statusText || 'Error desconocido';
      console.error(`[PIXIS] Error guardando ${filename}:`, errMsg);
      window.PixisOverlay?.showToast?.(`Error al guardar ${filename}: ${errMsg}`, 'danger', 10000);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[PIXIS] Error de red guardando ${filename}:`, err);
    return false;
  }
}

/* ════════════════════════════════════════════════════════════════
   EXPORTAR / IMPORTAR INVENTARIO (CSV PRO — COMPATIBLE EXCEL)
════════════════════════════════════════════════════════════════ */

/** Formatea un número como precio argentino: $ 1.000,00 */
function formatPriceARS(num) {
  const n = Number(num) || 0;
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return '$ ' + parts[0] + ',' + parts[1];
}

/**
 * Limpia un string de precio: elimina $, espacios, puntos de miles,
 * convierte coma decimal → punto.  "$ 1.250,00" → 1250
 */
function parsePriceARS(str) {
  if (str == null || str === '') return '';
  const cleaned = String(str)
    .replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '.').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? '' : Math.round(n);
}

/**
 * Parsea y formatea el valor de IVA para guardarlo homogéneamente como "10,50%", "21,00%", etc.
 */
function parseAndFormatIVA(val) {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'number') {
    // Si es decimal (ej. 0.21 o 0.105)
    if (val < 1) {
      return (val * 100).toFixed(2).replace('.', ',') + '%';
    }
    return val.toFixed(2).replace('.', ',') + '%';
  }
  let s = String(val).trim();
  if (!s.includes('%') && !isNaN(parseFloat(s))) {
    let n = parseFloat(s);
    if (n < 1) n = n * 100;
    return n.toFixed(2).replace('.', ',') + '%';
  }
  return s;
}

/**
 * Exporta el inventario completo a un archivo Excel (.xlsx)
 * Los precios se exportan como números puros para que Excel los trate
 * correctamente y la reimportación no tenga problemas de formato.
 */
function exportProductsToXLSX() {
  let products = window.PixisState?.state?.products || PixisEditor.data.products || [];
  
  // Filtrar productos que tengan excludeFromExport: true
  products = products.filter(p => p.excludeFromExport !== true);

  if (!products.length) {
    window.PixisOverlay.showToast('No hay productos para exportar.', 'warning');
    return;
  }

  // Preparar datos para SheetJS (Array of Arrays)
  // Orden: ID | Producto | Precio Efectivo | Precio Transferencia | Stock | IVA
  const data = [
    ['ID', 'Producto', 'Precio Efectivo', 'Precio Transferencia', 'Stock', 'IVA']
  ];

  products.forEach(p => {
    data.push([
      p.id || '',
      p.title || '',
      Number(p.priceLocal || p.price) || 0,
      Number(p.price) || 0,
      p.stock !== undefined && p.stock !== null && p.stock !== '' ? Number(p.stock) : '',
      p.iva || ''
    ]);
  });

  // Crear libro y hoja
  const worksheet = XLSX.utils.aoa_to_sheet(data);

  // Aplicar formato de moneda argentina a las columnas de precio (C y D)
  // IMPORTANTE: Los códigos de formato de Excel siempre usan ',' para miles y '.' para decimal
  // (sin importar el locale). Excel muestra el resultado según el locale del usuario.
  // En Argentina: '$ #,##0.00' → muestra '$ 7.000,00'
  const fmtPrecio = '$ #,##0.00';
  const totalRows = data.length; // header + productos
  for (let r = 1; r < totalRows; r++) {
    // Columna C (índice 2) = Precio Efectivo
    const cellC = XLSX.utils.encode_cell({ r, c: 2 });
    if (worksheet[cellC]) worksheet[cellC].z = fmtPrecio;
    // Columna D (índice 3) = Precio Transferencia
    const cellD = XLSX.utils.encode_cell({ r, c: 3 });
    if (worksheet[cellD]) worksheet[cellD].z = fmtPrecio;
  }

  // Ajustar anchos de columna
  const wscols = [
    { wch: 30 }, // ID
    { wch: 60 }, // Producto
    { wch: 24 }, // Precio Efectivo
    { wch: 24 }, // Precio Transferencia
    { wch: 12 }, // Stock
    { wch: 12 }  // IVA
  ];
  worksheet['!cols'] = wscols;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario Pixis");

  // Generar y descargar el archivo XLSX
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `inventario_pixis_${dateStr}.xlsx`;
  
  try {
    XLSX.writeFile(workbook, fileName);
    window.PixisOverlay.showToast(`✅ ${products.length} productos exportados a Excel (.xlsx)`, 'success');
  } catch (err) {
    console.error('[Export XLSX Error]', err);
    window.PixisOverlay.showToast('❌ Error al exportar Excel: ' + err.message, 'error');
  }
}

/**
 * Importa productos desde un CSV (Pixis o Excel sep=;)
 * Limpia automáticamente $, puntos y comas de los precios.
 */
function importProductsFromCSV(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let text = e.target.result;
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM

      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) throw new Error('Archivo vacío');

      let sep = ';';
      let startLine = 0;
      if (lines[0].toLowerCase().startsWith('sep=')) {
        sep = lines[0].slice(4).trim() || ';';
        startLine = 1;
      }

      function parseCSVLine(line) {
        const result = []; let current = ''; let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { if (inQ && line[i+1] === '"') { current += '"'; i++; } else inQ = !inQ; }
          else if (ch === sep && !inQ) { result.push(current); current = ''; }
          else current += ch;
        }
        result.push(current);
        return result;
      }

      const headerLine = parseCSVLine(lines[startLine]);
      startLine++;

      const colMap = {};
      const aliases = {
        id: ['id'],
        title: ['título','titulo','nombre','title','producto'],
        price: ['precio transferencia','price'],
        priceLocal: ['precio efectivo','precio local','pricelocal','cash'],
        category: ['categoría','categoria','category'],
        category2: ['categoría 2','categoria 2','category2'],
        category3: ['categoría 3','categoria 3','category3'],
        subcategoria: ['subcategoría','subcategoria','sub'],
        img: ['imagen','img','image','foto'],
        desc: ['descripción','descripcion','desc'],
        inStock: ['en stock','instock','estado stock'],
        stock: ['stock','cantidad','unidades'],
        iva: ['iva','impuesto'],
        banners: ['banners','banner']
      };

      headerLine.forEach((h, i) => {
        const key = h.trim().toLowerCase();
        for (const [field, arr] of Object.entries(aliases)) {
          if (arr.some(a => key.includes(a))) { colMap[field] = i; break; }
        }
      });

      const currentProducts = window.PixisState?.state?.products || PixisEditor.data.products || [];
      const prodMap = new Map();
      currentProducts.forEach(p => { if (p.id) prodMap.set(p.id, p); });

      const imported = [];
      let updatedCount = 0;
      let addedCount = 0;

      for (let i = startLine; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = parseCSVLine(lines[i]);
        // Devolvemos undefined si la columna no existe en el CSV
        const get = (f) => colMap[f] !== undefined ? (cols[colMap[f]] || '').trim() : undefined;

        const id = get('id');
        const existing = id ? prodMap.get(id) : null;
        
        // FUSIÓN (MERGE): Preservar datos anteriores (imágenes, descripciones, etc)
        const prod = existing ? { ...existing } : {};

        prod.id = id || `prod-import-${Date.now()}-${i}`;
        
        if (get('title') !== undefined) prod.title = get('title');
        
        const rawPrice = get('price');
        if (rawPrice !== undefined) prod.price = parsePriceARS(rawPrice);
        
        const rawPriceLocal = get('priceLocal');
        if (rawPriceLocal !== undefined) prod.priceLocal = parsePriceARS(rawPriceLocal) || prod.price;

        if (get('category') !== undefined) prod.category = get('category');
        if (get('category2') !== undefined) prod.category2 = get('category2');
        if (get('category3') !== undefined) prod.category3 = get('category3');
        if (get('subcategoria') !== undefined) prod.subcategoria = get('subcategoria');
        if (get('img') !== undefined) prod.img = get('img');
        if (get('desc') !== undefined) prod.desc = get('desc');
        
        const stockStr = get('inStock');
        if (stockStr !== undefined) prod.inStock = !['no','false','0','sin stock'].includes(stockStr.toLowerCase());

        const stockNumStr = get('stock');
        if (stockNumStr !== undefined && stockNumStr !== null && stockNumStr !== '') {
          const sNum = parseInt(stockNumStr, 10);
          prod.stock = isNaN(sNum) ? 0 : sNum;
          // Auto: stock 0 → sin stock | stock > 0 → en stock
          if (prod.stock === 0) {
            prod.inStock = false;
          } else if (prod.stock > 0) {
            prod.inStock = true;
          }
        }

        const ivaStr = get('iva');
        if (ivaStr !== undefined && ivaStr !== null) {
          prod.iva = parseAndFormatIVA(ivaStr);
        }
        
        const banStr = get('banners');
        if (banStr !== undefined) prod.banners = banStr ? banStr.split(',').map(b=>b.trim()).filter(Boolean) : [];

        if (!prod.title) continue;
        
        imported.push(prod);
        if (existing) updatedCount++; else addedCount++;
      }

      procesarImportacionProductos(imported, updatedCount, addedCount, currentProducts);
    } catch (err) {
      console.error('[PIXIS CSV Import]', err);
      window.PixisOverlay.showToast('❌ Error al leer CSV: ' + err.message, 'error', 5000);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/**
 * Importa productos desde un XLSX (Excel)
 * Convierte la primera hoja a CSV con separador ';' para reutilizar el flujo actual.
 */
function importProductsFromXLSX(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      // cellDates:false, raw:false → SheetJS devuelve los valores ya convertidos a string
      // raw:true → devuelve el valor numérico real para celdas numéricas
      const workbook = XLSX.read(data, { type: 'array', cellDates: false });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // sheet_to_json devuelve objetos con las claves del header (fila 1)
      // raw:true preserva los números como JS numbers (sin formateo regional)
      const rows = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' });
      
      if (!rows.length) {
        window.PixisOverlay.showToast('No se encontraron filas en el archivo.', 'error');
        return;
      }

      // Mapeo flexible de columnas (igual que el importador CSV)
      const aliases = {
        id:           ['id'],
        title:        ['título','titulo','nombre','title','producto'],
        price:        ['precio transferencia','price'],
        priceLocal:   ['precio efectivo','precio local','pricelocal','cash'],
        category:     ['categoría','categoria','category'],
        category2:    ['categoría 2','categoria 2','category2'],
        category3:    ['categoría 3','categoria 3','category3'],
        subcategoria: ['subcategoría','subcategoria','sub'],
        img:          ['imagen','img','image','foto'],
        desc:         ['descripción','descripcion','desc'],
        inStock:      ['en stock','instock','estado stock'],
        stock:        ['stock','cantidad','unidades'],
        iva:          ['iva','impuesto'],
        banners:      ['banners','banner']
      };

      // Construir mapa: clave_real_del_excel → campo_nuestro
      const firstRow = rows[0];
      const colMap = {};
      Object.keys(firstRow).forEach(excelKey => {
        const keyLower = excelKey.toLowerCase().trim();
        for (const [field, arr] of Object.entries(aliases)) {
          if (arr.some(a => keyLower.includes(a))) { colMap[excelKey] = field; break; }
        }
      });

      const get = (row, field) => {
        const excelKey = Object.keys(colMap).find(k => colMap[k] === field);
        return excelKey !== undefined ? row[excelKey] : undefined;
      };

      const currentProducts = window.PixisState?.state?.products || PixisEditor.data.products || [];
      const prodMap = new Map();
      currentProducts.forEach(p => { if (p.id) prodMap.set(String(p.id), p); });

      const imported = [];
      let updatedCount = 0;
      let addedCount = 0;

      rows.forEach((row, idx) => {
        const id = String(get(row, 'id') || '').trim();
        const existing = id ? prodMap.get(id) : null;
        const prod = existing ? { ...existing } : {};

        prod.id = id || `prod-import-${Date.now()}-${idx}`;

        const titleVal = get(row, 'title');
        if (titleVal !== undefined) prod.title = String(titleVal).trim();

        // Precios: SheetJS devuelve números reales si la celda era número
        const priceVal = get(row, 'price');
        if (priceVal !== undefined && priceVal !== '') {
          const n = typeof priceVal === 'number' ? Math.round(priceVal) : parsePriceARS(String(priceVal));
          if (n !== '' && !isNaN(n)) prod.price = n;
        }

        const priceLocalVal = get(row, 'priceLocal');
        if (priceLocalVal !== undefined && priceLocalVal !== '') {
          const n = typeof priceLocalVal === 'number' ? Math.round(priceLocalVal) : parsePriceARS(String(priceLocalVal));
          if (n !== '' && !isNaN(n)) prod.priceLocal = n;
        } else if (!prod.priceLocal) {
          prod.priceLocal = prod.price;
        }

        const catVal = get(row, 'category');
        if (catVal !== undefined) prod.category = String(catVal).trim();
        const cat2Val = get(row, 'category2');
        if (cat2Val !== undefined) prod.category2 = String(cat2Val).trim();
        const cat3Val = get(row, 'category3');
        if (cat3Val !== undefined) prod.category3 = String(cat3Val).trim();
        const subVal = get(row, 'subcategoria');
        if (subVal !== undefined) prod.subcategoria = String(subVal).trim();
        const imgVal = get(row, 'img');
        if (imgVal !== undefined) prod.img = String(imgVal).trim();
        const descVal = get(row, 'desc');
        if (descVal !== undefined) prod.desc = String(descVal).trim();

        const stockVal = get(row, 'inStock');
        if (stockVal !== undefined) {
          const s = String(stockVal).toLowerCase().trim();
          prod.inStock = !['no','false','0','sin stock'].includes(s);
        }

        const stockNumVal = get(row, 'stock');
        if (stockNumVal !== undefined && stockNumVal !== null && stockNumVal !== '') {
          const sNum = typeof stockNumVal === 'number' ? Math.round(stockNumVal) : parseInt(stockNumVal, 10);
          prod.stock = isNaN(sNum) ? 0 : sNum;
          // Auto: stock 0 → sin stock | stock > 0 → en stock
          if (prod.stock === 0) {
            prod.inStock = false;
          } else if (prod.stock > 0) {
            prod.inStock = true;
          }
        }

        const ivaVal = get(row, 'iva');
        if (ivaVal !== undefined && ivaVal !== null) {
          prod.iva = parseAndFormatIVA(ivaVal);
        }

        const banVal = get(row, 'banners');
        if (banVal !== undefined) {
          prod.banners = String(banVal) ? String(banVal).split(',').map(b=>b.trim()).filter(Boolean) : [];
        }

        if (!prod.title) return; // Saltar filas sin nombre
        imported.push(prod);
        if (existing) updatedCount++; else addedCount++;
      });

      procesarImportacionProductos(imported, updatedCount, addedCount, currentProducts);

    } catch (err) {
      console.error('[PIXIS XLSX Import]', err);
      window.PixisOverlay.showToast('❌ Error al leer Excel: ' + err.message, 'error', 5000);
    }
  };
  reader.readAsArrayBuffer(file);
}

/**
 * Muestra el modal interactivo para elegir entre Fusión Incremental o Sincronización Total
 */
function procesarImportacionProductos(imported, updatedCount, addedCount, currentProducts) {
  if (!imported || !imported.length) {
    window.PixisOverlay.showToast('No se encontraron productos válidos en el archivo.', 'error');
    return;
  }

  const modalTitle = `<span class="modal-icon">📦</span> Importar Productos (${imported.length} detectados)`;
  const modalBody = `
    <div style="font-size:13px; color:#e0e0ff; line-height:1.6; margin-bottom:16px;">
      Se detectaron <strong>${imported.length} productos</strong> en tu archivo:
      <div style="margin:10px 0; padding:10px 14px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid rgba(176,38,255,0.3);">
        <span style="color:#00e676; font-weight:700;">🆕 ${addedCount} productos nuevos</span> para agregar.<br>
        <span style="color:#00b4d8; font-weight:700;">✏️ ${updatedCount} productos existentes</span> para actualizar.
      </div>
      Elegí cómo querés procesar estos productos:
    </div>

    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:12px;">
      <label style="display:flex; align-items:flex-start; gap:12px; padding:12px 14px; background:rgba(0,230,118,0.08); border:1.5px solid rgba(0,230,118,0.4); border-radius:10px; cursor:pointer;">
        <input type="radio" name="modoImportacionPixis" value="merge" checked style="margin-top:3px; accent-color:#00e676;">
        <div>
          <strong style="color:#00e676; font-size:13px;">➕ Sumar y Actualizar (Fusión Incremental)</strong>
          <p style="font-size:11px; color:#ccc; margin:4px 0 0 0;">
            <strong>Mantiene todos tus productos actuales de la web.</strong> Agrega los nuevos y actualiza precios/stock de los que coincidan. (Ideal para subir listas parciales de 2 o más productos).
          </p>
        </div>
      </label>

      <label style="display:flex; align-items:flex-start; gap:12px; padding:12px 14px; background:rgba(255,165,0,0.08); border:1.5px solid rgba(255,165,0,0.4); border-radius:10px; cursor:pointer;">
        <input type="radio" name="modoImportacionPixis" value="replace" style="margin-top:3px; accent-color:#ffa500;">
        <div>
          <strong style="color:#ffa500; font-size:13px;">🔄 Sincronización Total (Reemplazar catálogo)</strong>
          <p style="font-size:11px; color:#ccc; margin:4px 0 0 0;">
            El catálogo de la web quedará idéntico al archivo. <strong>Los productos que no estén en este archivo serán eliminados</strong> de la web. (Ideal para subir el inventario maestro completo).
          </p>
        </div>
      </label>
    </div>
  `;

  const modalFooter = `
    <button class="panel-btn" onclick="window.PixisOverlay.closeModal()">Cancelar</button>
    <button class="panel-btn panel-btn-primary" id="btnEjecutarImportacionPixis" style="background:linear-gradient(135deg, #00e676, #00b4d8); border:none; color:#000; font-weight:700;">
      🚀 Procesar Importación
    </button>
  `;

  window.PixisOverlay.openModal(modalTitle, modalBody, modalFooter);

  document.getElementById('btnEjecutarImportacionPixis')?.addEventListener('click', () => {
    const modo = document.querySelector('input[name="modoImportacionPixis"]:checked')?.value || 'merge';
    window.PixisOverlay.closeModal();
    aplicarImportacionProductos(imported, modo, currentProducts, updatedCount, addedCount);
  });
}

/**
 * Ejecuta la importación según el modo seleccionado (Merge o Replace)
 */
function aplicarImportacionProductos(imported, modo, currentProducts, updatedCount, addedCount) {
  let finalCatalog = [];

  if (modo === 'merge') {
    // ➕ FUSIÓN INCREMENTAL: Conserva todos los existentes y agrega/actualiza los nuevos
    finalCatalog = [...currentProducts];
    imported.forEach(imp => {
      const idx = finalCatalog.findIndex(p => String(p.id).trim() === String(imp.id).trim());
      if (idx !== -1) {
        finalCatalog[idx] = { ...finalCatalog[idx], ...imp };
      } else {
        finalCatalog.push(imp);
      }
    });
  } else {
    // 🔄 REEMPLAZO TOTAL: El archivo reemplaza el catálogo (comportamiento previo)
    finalCatalog = [...imported];
    currentProducts.forEach(p => {
      if (p.excludeFromExport === true && !finalCatalog.some(imp => String(imp.id).trim() === String(p.id).trim())) {
        finalCatalog.push(p);
      }
    });
  }

  if (window.PixisState) {
    window.PixisState.pushHistory();
    window.PixisState.state.products = finalCatalog;
    window.PixisState.saveState().then(saved => {
      const toastMsg = modo === 'merge'
        ? `✅ Fusión exitosa: ${finalCatalog.length} productos en catálogo (+${addedCount} nuevos, ${updatedCount} actualizados)`
        : `✅ Sincronización total: ${finalCatalog.length} productos en catálogo`;
      window.PixisOverlay.showToast(toastMsg, 'success', 5000);
      window.PixisState.applyStateToDOM();
      if (typeof openProductsPanel === 'function') openProductsPanel();
      if (typeof markUnsaved === 'function') markUnsaved();
    });
  } else {
    PixisEditor.data.products = finalCatalog;
    if (typeof markUnsaved === 'function') markUnsaved();
    if (typeof openProductsPanel === 'function') openProductsPanel();
    window.PixisOverlay.showToast(`✅ Catálogo actualizado (${finalCatalog.length} productos)`, 'success');
  }
}

function offerDownloadFallback() {
  const files = [
    { name: 'site.json', data: PixisEditor.data.site },
    { name: 'products.json', data: PixisEditor.data.products },
    { name: 'categories.json', data: PixisEditor.data.categories },
    { name: 'ui.json', data: PixisEditor.data.ui }
  ];

  window.PixisOverlay.openModal(
    '<span class="modal-icon">💾</span> Guardar archivos JSON',
    `
    <p style="color:#8888aa;font-size:13px;margin-bottom:16px;line-height:1.6;">
      El editor está corriendo en modo local (sin servidor).<br>
      Descargá los archivos JSON y copiálos a la carpeta <code style="background:#1a1a2e;padding:2px 6px;border-radius:4px">data/</code> de tu proyecto:
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${files.map(f => `
        <button class="panel-btn panel-btn-primary" onclick="window.PixisEditorAPI.downloadJSON('${f.name}')">
          ⬇️ Descargar ${f.name}
        </button>
      `).join('')}
    </div>
    <p style="color:#b026ff;font-size:11px;margin-top:16px;text-align:center;">
      ✅ Los cambios visuales ya están aplicados en la página
    </p>
    `
  );

  window.PixisOverlay.showToast('Descargá los JSON para guardar los cambios', 'warning', 6000);
}

// API para descargar JSON
window.PixisEditorAPI.downloadJSON = function (filename) {
  const dataMap = {
    'site.json': PixisEditor.data.site,
    'products.json': PixisEditor.data.products,
    'categories.json': PixisEditor.data.categories,
    'ui.json': PixisEditor.data.ui
  };

  const data = dataMap[filename];
  if (!data) return;

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  window.PixisOverlay.showToast(`${filename} descargado`, 'success');
};

/* ════════════════════════════════════════════════════════════════
   ESTADO UNSAVED
════════════════════════════════════════════════════════════════ */
function markUnsaved() {
  PixisEditor.state.unsaved = true;
  window.PixisOverlay.markUnsaved();
}

/* ════════════════════════════════════════════════════════════════
   UTILIDADES
════════════════════════════════════════════════════════════════ */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rgbToHex(rgb) {
  if (!rgb) return '';
  if (rgb.startsWith('#')) return rgb;
  const result = rgb.match(/\d+/g);
  if (!result || result.length < 3) return '';
  return '#' + result.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

window.getCssPath = function(el) {
  if (!(el instanceof Element)) return;
  const path = [];
  while (el.nodeType === Node.ELEMENT_NODE) {
    let selector = el.nodeName.toLowerCase();
    if (el.id) {
      selector += '#' + el.id;
      path.unshift(selector);
      break;
    } else {
      let sib = el, nth = 1;
      while (sib = sib.previousElementSibling) {
        if (sib.nodeName.toLowerCase() == selector) nth++;
      }
      if (nth != 1) selector += ":nth-of-type("+nth+")";
    }
    path.unshift(selector);
    el = el.parentNode;
  }
  return path.join(" > ");
};

/* ════════════════════════════════════════════════════════════════
   AUTO-ASIGNACIÓN DE IDs A CARDS HTML
════════════════════════════════════════════════════════════════ */
function autoAssignCardIds() {
  let count = 0;
  document.querySelectorAll('.card:not(.yt-card)').forEach((card) => {
    if (card.dataset.id) return; // ya tiene ID

    // Intentar generar slug desde título
    const rawTitle = card.dataset.title
      || card.querySelector('h3')?.textContent?.trim()
      || card.querySelector('[data-title]')?.dataset.title
      || '';

    let slug = rawTitle
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);

    if (!slug) slug = `card-${count}`;

    card.dataset.id = slug;
    count++;
  });
  console.log(`[PIXIS] autoAssignCardIds: ${count} IDs asignados`);
}

/* ════════════════════════════════════════════════════════════════
   INYECTAR BOTÓN LÁPIZ EN CADA CARD (visible en modo editor)
════════════════════════════════════════════════════════════════ */
function injectCardEditButtons() {
  document.querySelectorAll('.card:not(.yt-card)').forEach(card => {
    if (card.querySelector('.pixis-edit-card-btn')) return; // ya inyectado

    // Asegurar posición relativa para los botones absolutos
    card.style.position = 'relative';

    // 1. Botón Editar (Derecha)
    const btnEdit = document.createElement('button');
    btnEdit.className = 'pixis-edit-card-btn';
    btnEdit.title = 'Editar producto';
    btnEdit.innerHTML = '✏️';
    btnEdit.style.cssText = `
      position:absolute;top:6px;right:6px;z-index:9999;
      background:#b026ff;color:#fff;border:none;border-radius:50%;
      width:28px;height:28px;font-size:13px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity .2s, transform .2s;pointer-events:auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    `;

    // 2. Botón Eliminar (Izquierda)
    const btnDel = document.createElement('button');
    btnDel.className = 'pixis-delete-card-btn';
    btnDel.title = 'Eliminar producto para siempre';
    btnDel.innerHTML = '🗑️';
    btnDel.style.cssText = `
      position:absolute;top:6px;left:6px;z-index:9999;
      background:#ff3d3d;color:#fff;border:none;border-radius:50%;
      width:28px;height:28px;font-size:12px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity .2s, transform .2s;pointer-events:auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    `;

    // 3. Botón Seleccionar (Medio)
    const pixisId = card.dataset.pixisId || card.dataset.id;
    const isSelected = PixisEditor.state.selectedItems.has(pixisId);
    const btnSelect = document.createElement('button');
    btnSelect.className = `pixis-select-card-btn ${isSelected ? 'selected' : ''}`;
    btnSelect.title = 'Seleccionar para acción masiva';
    btnSelect.innerHTML = isSelected ? '✅' : '⬜';

    card.appendChild(btnEdit);
    card.appendChild(btnDel);
    card.appendChild(btnSelect);

    // Efectos hover
    card.addEventListener('mouseenter', () => { 
      btnEdit.style.opacity = '1'; 
      btnDel.style.opacity = '1'; 
      btnSelect.style.opacity = '1';
    });
    card.addEventListener('mouseleave', () => { 
      btnEdit.style.opacity = '0'; 
      btnDel.style.opacity = '0'; 
      if (!btnSelect.classList.contains('selected')) btnSelect.style.opacity = '0';
    });

    // Pequeño zoom al pasar sobre el botón
    [btnEdit, btnDel, btnSelect].forEach(b => {
      b.addEventListener('mouseenter', () => b.style.transform = b === btnSelect ? 'translateX(-50%) scale(1.15)' : 'scale(1.15)');
      b.addEventListener('mouseleave', () => b.style.transform = b === btnSelect ? 'translateX(-50%) scale(1)' : 'scale(1)');
    });
  });
}

/* ════════════════════════════════════════════════════════════════
   APLICAR OVERRIDE DE CARD AL DOM (visual inmediato)
════════════════════════════════════════════════════════════════ */
function applyCardDataToDOM(card, data) {
  if (!card || !data) return;

  if (data.title) {
    card.dataset.title = data.title;
    const h3 = card.querySelector('h3');
    if (h3) h3.textContent = data.title;
  }
  if (data.price) {
    card.dataset.price = data.price;
    const sp = card.querySelector('.precio');
    if (sp) sp.textContent = data.price;
  }
  if (data.priceNum) {
    const addBtn = card.querySelector('.btn-add-cart');
    if (addBtn) addBtn.dataset.price = data.priceNum;
  }
  if (data.priceLocal) {
    const addBtn = card.querySelector('.btn-add-cart');
    if (addBtn) addBtn.dataset.priceLocal = data.priceLocal;
  }
  if (data.img) {
    card.dataset.img = data.img;
    const im = card.querySelector('img:not(.fly-product)');
    if (im) im.src = data.img;
  }
  if (data.desc !== undefined) card.dataset.desc = data.desc;
  if (data.video !== undefined) {
    card.dataset.video = data.video;
    card.dataset.videoUrl = data.video;
  }

  // Stock
  const sinStock = data.inStock === false;
  card.classList.toggle('sin-stock', sinStock);

  // Próximo Ingreso
  if (data.proximoIngreso !== undefined) {
    card.dataset.proximoIngreso = data.proximoIngreso ? 'true' : 'false';
    card.classList.toggle('proximo-ingreso', data.proximoIngreso);
  }
  // Re-inyectar botón lápiz si la card es nueva
  if (!card.querySelector('.pixis-edit-card-btn')) {
    injectCardEditButtons();
  }

  // Botones personalizados (se guardan en dataset para el modal)
  if (Array.isArray(data.customButtons)) {
    card.dataset.customButtons = JSON.stringify(data.customButtons);
    // Eliminar zona si existiera (limpieza)
    card.querySelector('.pixis-custom-btns')?.remove();
  }
}

/* ════════════════════════════════════════════════════════════════
   EDITAR CARD POR ID (desde panel de secciones)
════════════════════════════════════════════════════════════════ */
window.PixisEditorAPI.editCardById = function(cardId) {
  if (!cardId) return;
  const card = document.querySelector(`.card[data-id="${CSS.escape(cardId)}"]`);
  if (!card) {
    window.PixisOverlay.showToast(`Card "${cardId}" no encontrada en el DOM`, 'error');
    return;
  }
  openCardEditor(card);
};

window.pixisFilterHtmlList = function(term) {
  const q = term.toLowerCase().trim();
  const container = document.getElementById('htmlListContainer');
  if (!container) return;
  
  // Buscar en todas las cards renderizadas
  container.querySelectorAll('.product-panel-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? 'flex' : 'none';
  });

  // Ocultar secciones enteras si todos sus productos están ocultos
  container.querySelectorAll('.panel-section').forEach(sec => {
    const allCards = Array.from(sec.querySelectorAll('.product-panel-card'));
    if (allCards.length === 0) return;
    const anyVisible = allCards.some(c => c.style.display !== 'none');
    sec.style.display = anyVisible ? 'block' : 'none';
  });
};
window.pixisFilterJsonList = function(term) {
  PixisEditor.state.lastSearchQuery = term; // Guardar en memoria
  const q = term.toLowerCase().trim();
  const container = document.getElementById('productListContainer');
  if (!container) return;
  
  let visibleCount = 0;
  container.querySelectorAll('.product-panel-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    const visible = text.includes(q);
    card.style.display = visible ? 'flex' : 'none';
    if (visible) visibleCount++;
  });

  // Actualizar contador en el título
  const titleEl = document.getElementById('jsonListTitle');
  if (titleEl) {
    titleEl.textContent = `Productos en JSON (${visibleCount})`;
  }
};
/* ════════════════════════════════════════════════════════════════
   PANEL DE CONFIGURACIÓN DE ADMIN (Cambiar credenciales de acceso)
════════════════════════════════════════════════════════════════ */
function openAdminConfigPanel() {
  const savedUser = localStorage.getItem('pixis_admin_user') || 'pixis';

  const bodyHTML = `
    <div class="panel-section">
      <div class="panel-section-title">🔐 Credenciales de Acceso al Editor</div>
      <p style="font-size:11px;color:var(--editor-text-dim);line-height:1.6;margin-bottom:16px;">
        Desde aquí podés cambiar el usuario y la contraseña que se piden en la pantalla de inicio de sesión.<br>
        <span style="color:var(--editor-orange);font-weight:600;">⚠️ Recordá las nuevas credenciales antes de guardar.</span>
      </p>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">👤 Nuevo usuario</div>
      <div class="panel-field">
        <label class="panel-label">Usuario actual: <strong style="color:var(--editor-purple);">${savedUser}</strong></label>
        <input type="text" id="adminNewUser" class="panel-input" placeholder="Nuevo usuario..." autocomplete="off" spellcheck="false">
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">🔑 Nueva contraseña</div>
      <div class="panel-field">
        <label class="panel-label">Nueva contraseña</label>
        <div style="position:relative;">
          <input type="password" id="adminNewPass" class="panel-input" placeholder="Nueva contraseña..." autocomplete="new-password" style="padding-right:36px;">
          <button type="button" id="adminTogglePass" title="Mostrar/ocultar" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--editor-text-dim);font-size:14px;line-height:1;padding:0;">👁</button>
        </div>
      </div>
      <div class="panel-field">
        <label class="panel-label">Confirmar contraseña</label>
        <div style="position:relative;">
          <input type="password" id="adminConfPass" class="panel-input" placeholder="Repetí la contraseña..." autocomplete="new-password" style="padding-right:36px;">
          <button type="button" id="adminToggleConf" title="Mostrar/ocultar" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--editor-text-dim);font-size:14px;line-height:1;padding:0;">👁</button>
        </div>
      </div>
    </div>

    <div class="panel-section" style="background:rgba(176,38,255,0.05); border:1px solid rgba(176,38,255,0.2); padding:15px; border-radius:12px; margin-bottom: 15px;">
      <div class="panel-section-title" style="color:#b026ff;">🛡️ Seguridad Doble Factor (2FA)</div>
      <p style="font-size:10px; color:#aaa; margin-bottom:10px; line-height:1.4;">
        Vinculá tu celular con <b>Microsoft Authenticator</b> para bloquear el acceso a desconocidos. Una vez vinculado, el sistema te pedirá el código de tu celular al entrar.
      </p>
      
      <div id="qrContainer" style="display:none; text-align:center; background:#fff; padding:10px; border-radius:8px; margin-bottom:12px;">
        <img id="qrImage" src="" style="width:160px; height:160px; display:block; margin:0 auto;">
        <div style="color:#000; font-size:10px; font-weight:bold; margin-top:8px;">Escaneá este código con tu App</div>
      </div>

      <button class="panel-btn" id="btnShowQR" style="width:100%; border-color:#b026ff; color:#b026ff; background:transparent;">📱 Vincular Celular (Mostrar QR)</button>
    </div>

    <div class="panel-section" style="background:rgba(0,230,118,0.05); border:1px solid rgba(0,230,118,0.2); padding:15px; border-radius:12px; margin-bottom: 15px;">
      <div class="panel-section-title" style="color:#00e676;">📧 Recuperación por Email</div>
      <p style="font-size:10px; color:#aaa; margin-bottom:10px;">Si perdés el celular, el sistema te enviará un código a este correo.</p>
      <div class="panel-field">
        <label class="panel-label">Correo de Emergencia</label>
        <input type="email" id="adminRecoveryEmail" class="panel-input" placeholder="tu-correo@gmail.com">
      </div>
    </div>

    <div id="adminConfigMsg" style="display:none;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:12px;"></div>

    <div class="panel-section">
      <div class="panel-section-title">📦 Gestión de Inventario (Excel/CSV)</div>
      <p style="font-size:11px;color:var(--editor-text-dim);line-height:1.6;margin-bottom:14px;">
        Exportá tu inventario completo a Excel/CSV para editarlo en masa, o importá un archivo CSV previamente editado.
        <br><span style="color:var(--editor-orange);font-weight:600;">⚠️ La importación reemplaza todos los productos actuales.</span>
      </p>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="panel-btn panel-btn-primary" id="btnExportInventario" style="flex:1; min-width:160px;">
          📊 Exportar Inventario
        </button>
        <button class="panel-btn" id="btnImportExcel" style="flex:1; min-width:160px; border-color:rgba(0,230,118,0.4); color:#00e676;">
          📥 Importar Excel
        </button>
        <input type="file" id="csvImportInput" accept=".csv,.xlsx" style="display:none;">
      </div>
    </div>
  `;

  const footerHTML = `
    <button class="panel-btn" onclick="window.PixisOverlay.closeModal()">Cancelar</button>
    <button class="panel-btn panel-btn-primary" id="adminSaveBtn">💾 Guardar credenciales</button>
  `;

  window.PixisOverlay.openModal('🔐 Configuración Admin', bodyHTML, footerHTML);

  // Toggle mostrar contraseña
  document.getElementById('adminTogglePass')?.addEventListener('click', () => {
    const inp = document.getElementById('adminNewPass');
    const btn = document.getElementById('adminTogglePass');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁' : '🙈';
  });
  document.getElementById('adminToggleConf')?.addEventListener('click', () => {
    const inp = document.getElementById('adminConfPass');
    const btn = document.getElementById('adminToggleConf');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁' : '🙈';
  });

  // Guardar
  document.getElementById('adminSaveBtn')?.addEventListener('click', () => {
    const newUser = document.getElementById('adminNewUser').value.trim();
    const newPass = document.getElementById('adminNewPass').value;
    const confPass = document.getElementById('adminConfPass').value;
    const msgEl   = document.getElementById('adminConfigMsg');

    function showMsg(text, ok) {
      msgEl.style.display = 'block';
      msgEl.style.background = ok ? 'rgba(0,230,118,0.08)' : 'rgba(255,61,61,0.08)';
      msgEl.style.border = ok ? '1px solid var(--editor-green)' : '1px solid var(--editor-red)';
      msgEl.style.color  = ok ? 'var(--editor-green)' : '#ff6b6b';
      msgEl.textContent  = text;
    }

    // Validaciones
    if (!newUser && !newPass) {
      showMsg('⚠️ Ingresá al menos un nuevo usuario o contraseña.', false);
      return;
    }
    if (newPass && newPass !== confPass) {
      showMsg('❌ Las contraseñas no coinciden. Verificá e intentá de nuevo.', false);
      document.getElementById('adminNewPass').value = '';
      document.getElementById('adminConfPass').value = '';
      return;
    }
    if (newPass && newPass.length < 6) {
      showMsg('❌ La contraseña debe tener al menos 6 caracteres.', false);
      return;
    }

    const recoveryEmail = document.getElementById('adminRecoveryEmail').value.trim();

    if (newUser) localStorage.setItem('pixis_admin_user', newUser);
    if (newPass) localStorage.setItem('pixis_admin_pass', newPass);
    if (recoveryEmail) localStorage.setItem('pixis_admin_recovery_email', recoveryEmail);

    fetch('/api/config-admin', {
      method: 'POST',
      body: JSON.stringify({ user: newUser, pass: newPass, recoveryEmail })
    })
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        showMsg(`✅ Credenciales actualizadas y sincronizadas con el servidor.`, true);
      }
    })
    .catch(err => {
      console.error('Error al sincronizar:', err);
    });

    window.PixisOverlay.showToast('🔐 Credenciales actualizadas', 'success', 3000);
    setTimeout(() => window.PixisOverlay.closeModal(), 2000);
  });

  // ── Botones de Inventario (Excel) ──
  document.getElementById('btnExportInventario')?.addEventListener('click', () => {
    exportProductsToXLSX();
  });

  // ── Botón Mostrar QR 2FA ──
  document.getElementById('btnShowQR')?.addEventListener('click', function() {
    const qrCont = document.getElementById('qrContainer');
    const qrImg  = document.getElementById('qrImage');
    const label  = 'Pixis:Admin';
    const secret = 'PIXIS777SAFECODE';
    const issuer = 'PixisInformatica';
    const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`;
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauth)}`;
    qrCont.style.display = 'block';
    this.style.display = 'none'; 
  });

  document.getElementById('btnImportExcel')?.addEventListener('click', () => {
    const input = document.getElementById('csvImportInput');
    if (input) input.click();
  });

  document.getElementById('csvImportInput')?.addEventListener('change', function() {
    const file = this.files && this.files[0];
    if (file) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'csv') {
        importProductsFromCSV(file);
      } else if (ext === 'xlsx') {
        importProductsFromXLSX(file);
      } else {
        window.PixisOverlay.showToast('❌ Formato no válido. Use .csv o .xlsx', 'error');
      }
      this.value = ''; // resetear para poder importar el mismo archivo dos veces
    }
  });
}

// ════════════════════════════════════════════════════════════════
// FUNCIONES DEL CARRUSEL (FASE A)
// ════════════════════════════════════════════════════════════════

function renderCarouselEditor(slides, type = 'top') {
  const banners = window._bannerData || {};
  
  return slides.map((s, i) => {
    const idPc  = `slide-pc-${type}-${i}`;
    const idMob = `slide-mob-${type}-${i}`;
    const colorType  = type === 'top' ? '#b026ff' : '#00b4d8';
    const labelType  = type === 'top' ? 'SUPERIOR' : 'INFERIOR';
    const total      = slides.length;
    // Opciones del selector: una por cada posicion disponible
    const posOptions = Array.from({length: total}, (_, j) => {
      const active = j === i ? 'font-weight:bold; background:rgba(176,38,255,0.25);' : '';
      return `<div class="pixis-pos-option" data-pos="${j}" onclick="window.pixisMoveToPosition(this,'${type}')" style="padding:5px 10px; cursor:pointer; font-size:11px; color:#ddd; ${active} border-radius:4px; transition:background .15s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='${j===i?'rgba(176,38,255,0.25)':'transparent'}'">📍 Posición ${j + 1}${j === 0 ? ' (Primero)' : j === total - 1 ? ' (Último)' : ''}</div>`;
    }).join('');
    
    return `
    <div class="carousel-slide-item" data-banner-id="${escHtml(s.bannerId || '')}" style="background:rgba(255,255,255,0.03); padding:10px; border-radius:6px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.1); position:relative;">

      <!-- Botón eliminar -->
      <button class="product-action-btn del" style="position:absolute; top:5px; right:5px; width:24px; height:24px; font-size:10px;" onclick="this.closest('.carousel-slide-item').remove(); window.pixisRefreshSlidePositions('${type}')" title="Eliminar banner">✕</button>

      <!-- Cabecera: badge + selector desplegable de posición -->
      <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px; position:relative;">
        <div class="pixis-slide-pos-badge" style="font-size:10px; color:${colorType}; font-weight:bold; background:rgba(255,255,255,0.05); padding:2px 7px; border-radius:10px; border:1px solid ${colorType}40; white-space:nowrap;">${labelType} #${i + 1}</div>
        <!-- Botón plegable para elegir posición directa -->
        <div class="pixis-pos-wrap" style="position:relative; display:inline-block;">
          <button class="pixis-pos-toggle" title="Mover a posición" onclick="window.pixisTogglePosDropdown(this, '${type}')" style="background:rgba(176,38,255,0.18); border:1px solid rgba(176,38,255,0.4); color:#b026ff; border-radius:5px; padding:0 8px; height:22px; font-size:10px; cursor:pointer; white-space:nowrap; display:flex; align-items:center; gap:3px;">📌 Posición <span style="font-size:8px;">▾</span></button>
          <!-- Dropdown de posiciones -->
          <div class="pixis-pos-dropdown" style="display:none; position:absolute; top:26px; left:0; background:#1a1a2e; border:1px solid rgba(176,38,255,0.4); border-radius:7px; z-index:9999; min-width:140px; padding:4px; box-shadow:0 6px 20px rgba(0,0,0,0.6);">
            ${posOptions}
          </div>
        </div>
        <div style="font-size:9px; color:#555; flex:1; text-align:right;">del carrusel</div>
      </div>
      
      <div class="panel-field" style="margin-bottom:8px;">
        <label class="panel-label" style="font-size:9px;">Imagen PC</label>
        <div style="display:flex; gap:5px;">
          <input type="text" class="panel-input slide-img-pc" id="${idPc}" value="${escHtml(s.imgPc || '')}" placeholder="img/banners/pc.jpg">
          <button class="panel-btn" style="width:auto; padding:0 8px; font-size:10px; height:32px;" onclick="window.PixisEditorAPI.triggerUpload('${idPc}', 'img/carrusel')">📁 Subir</button>
        </div>
      </div>
      
      <div class="panel-field" style="margin-bottom:8px;">
        <label class="panel-label" style="font-size:9px;">Imagen Celular</label>
        <div style="display:flex; gap:5px;">
          <input type="text" class="panel-input slide-img-mob" id="${idMob}" value="${escHtml(s.imgMobile || '')}" placeholder="img/banners/mobile.jpg">
          <button class="panel-btn" style="width:auto; padding:0 8px; font-size:10px; height:32px;" onclick="window.PixisEditorAPI.triggerUpload('${idMob}', 'img/carrusel')">📁 Subir</button>
        </div>
      </div>
      
      <div class="panel-field" style="margin-bottom:10px;">
        <label class="panel-label" style="font-size:9px;">Vínculo a Banner</label>
        <select class="panel-select slide-banner-id" style="font-size:11px; height:28px; padding:0 5px;"
                onchange="this.closest('.carousel-slide-item').dataset.bannerId = this.value">
          <option value="">— Ninguno —</option>
          ${Object.entries(banners).map(([id, b]) => `
            <option value="${escHtml(id)}" ${s.bannerId === id ? 'selected' : ''}>${escHtml(b.t)}</option>
          `).join('')}
        </select>
      </div>

      <!-- Botón Aplicar individual por banner -->
      <button onclick="window.PixisEditorAPI.saveCarousel('${type}')" style="width:100%; background:rgba(176,38,255,0.12); border:1px solid rgba(176,38,255,0.35); color:#b026ff; border-radius:6px; padding:5px 0; font-size:10px; font-weight:600; cursor:pointer; letter-spacing:.3px;" title="Guardar todo el carrusel ${type === 'top' ? 'Superior' : 'Inferior'}">💾 Aplicar ${type === 'top' ? 'Superior' : 'Inferior'}</button>
    </div>
    `;
  }).join('');
}

// ── Abrir/cerrar acordeón de carrusel (Superior / Inferior) ──
window.pixisToggleCarouselAccordion = function(type) {
  const bodyId  = type === 'top' ? 'carouselTopAccordion'  : 'carouselBottomAccordion';
  const arrowId = type === 'top' ? 'carouselTopArrow'      : 'carouselBottomArrow';
  window.pixisToggleAccordion(bodyId, arrowId);
};

// ── Abrir/cerrar cualquier acordeón genérico del panel Datos del Sitio ──
window.pixisToggleAccordion = function(bodyId, arrowId) {
  const body  = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
};


// ── Abrir/cerrar el dropdown de posición (cierra todos los demás antes) ──
window.pixisTogglePosDropdown = function(btn, type) {
  // Cerrar otros dropdowns abiertos en el mismo contenedor
  const containerId = type === 'top' ? 'carouselTopContainer' : 'carouselBottomContainer';
  const container = document.getElementById(containerId);
  if (container) {
    container.querySelectorAll('.pixis-pos-dropdown').forEach(dd => {
      if (dd !== btn.nextElementSibling) dd.style.display = 'none';
    });
  }
  const dd = btn.nextElementSibling;
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
};

// ── Mover banner directo a la posición elegida ──
window.pixisMoveToPosition = function(optionEl, type) {
  const targetPos   = parseInt(optionEl.dataset.pos);
  const dropdown    = optionEl.closest('.pixis-pos-dropdown');
  const item        = optionEl.closest('.carousel-slide-item');
  const containerId = type === 'top' ? 'carouselTopContainer' : 'carouselBottomContainer';
  const container   = document.getElementById(containerId);
  if (!container || !item || isNaN(targetPos)) return;

  // ━━ Capturar valores ANTES del movimiento DOM (evita pérdida de estado en algunos navegadores)
  const savedBannerId = item.dataset.bannerId
    || item.querySelector('.slide-banner-id')?.value
    || '';

  const allItems = Array.from(container.querySelectorAll('.carousel-slide-item'));
  const currentPos = allItems.indexOf(item);
  if (currentPos === targetPos) { if (dropdown) dropdown.style.display = 'none'; return; }

  // Reinserta el elemento en la posición deseada
  if (targetPos >= allItems.length - 1) {
    container.appendChild(item);
  } else {
    const referenceNode = allItems[targetPos < currentPos ? targetPos : targetPos + 1];
    container.insertBefore(item, referenceNode);
  }

  // ━━ Restaurar bannerId después del movimiento DOM
  item.dataset.bannerId = savedBannerId;
  const sel = item.querySelector('.slide-banner-id');
  if (sel && savedBannerId) sel.value = savedBannerId;

  if (dropdown) dropdown.style.display = 'none';
  window.pixisRefreshSlidePositions(type);
};

// ── Actualizar badges + opciones del dropdown tras cada cambio ──
window.pixisRefreshSlidePositions = function(type) {
  const containerId = type === 'top' ? 'carouselTopContainer' : 'carouselBottomContainer';
  const container = document.getElementById(containerId);
  if (!container) return;
  const labelType  = type === 'top' ? 'SUPERIOR' : 'INFERIOR';
  const colorType  = type === 'top' ? '#b026ff' : '#00b4d8';
  const allItems   = Array.from(container.querySelectorAll('.carousel-slide-item'));
  const total      = allItems.length;

  allItems.forEach((item, idx) => {
    // Sincronizar data-banner-id con el valor actual del select (por si acaso)
    const selPre = item.querySelector('.slide-banner-id');
    if (selPre && selPre.value) item.dataset.bannerId = selPre.value;

    // Actualizar badge de posición
    const badge = item.querySelector('.pixis-slide-pos-badge');
    if (badge) {
      badge.textContent = `${labelType} #${idx + 1}`;
      badge.style.color = colorType;
      badge.style.borderColor = colorType + '40';
    }
    // Regenerar las opciones del dropdown
    const dd = item.querySelector('.pixis-pos-dropdown');
    if (dd) {
      dd.innerHTML = Array.from({length: total}, (_, j) => {
        const active = j === idx ? 'font-weight:bold; background:rgba(176,38,255,0.25);' : '';
        return `<div class="pixis-pos-option" data-pos="${j}" onclick="window.pixisMoveToPosition(this,'${type}')" style="padding:5px 10px; cursor:pointer; font-size:11px; color:#ddd; ${active} border-radius:4px; transition:background .15s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='${j===idx?'rgba(176,38,255,0.25)':'transparent'}'">\ud83d\udccd Posición ${j + 1}${j === 0 ? ' (Primero)' : j === total - 1 ? ' (Último)' : ''}</div>`;
      }).join('');
    }

    // Restaurar el valor del select desde data-banner-id (resguardo post-movimiento)
    const storedBid = item.dataset.bannerId;
    const selPost = item.querySelector('.slide-banner-id');
    if (selPost && storedBid !== undefined) selPost.value = storedBid;
  });

  // Cerrar cualquier dropdown abierto
  container.querySelectorAll('.pixis-pos-dropdown').forEach(dd => dd.style.display = 'none');
};

// ── Cerrar dropdowns al hacer click fuera ──
document.addEventListener('click', function(e) {
  if (!e.target.closest('.pixis-pos-wrap')) {
    document.querySelectorAll('.pixis-pos-dropdown').forEach(dd => dd.style.display = 'none');
  }
}, true);

// Extender API global del editor
if (!window.PixisEditorAPI) window.PixisEditorAPI = {};

window.PixisEditorAPI.addCarouselSlide = function(type = 'top') {
  const containerId = type === 'top' ? 'carouselTopContainer' : 'carouselBottomContainer';
  const container = document.getElementById(containerId);
  if (!container) return;
  const banners = window._bannerData || {};
  const idPc = `slide-pc-${type}-new-${Date.now()}`;
  const idMob = `slide-mob-${type}-new-${Date.now()}`;

  const colorType    = type === 'top' ? '#b026ff' : '#00b4d8';
  const labelType    = type === 'top' ? 'SUPERIOR' : 'INFERIOR';
  const currentCount = container.querySelectorAll('.carousel-slide-item').length + 1;
  const total        = currentCount; // el nuevo slide todavía no existe en el DOM

  // Generar opciones del dropdown para el nuevo slide (va al final por defecto)
  const posOptions = Array.from({length: total}, (_, j) => {
    const active = j === total - 1 ? 'font-weight:bold; background:rgba(176,38,255,0.25);' : '';
    return `<div class="pixis-pos-option" data-pos="${j}" onclick="window.pixisMoveToPosition(this,'${type}')" style="padding:5px 10px; cursor:pointer; font-size:11px; color:#ddd; ${active} border-radius:4px;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='${j===total-1?'rgba(176,38,255,0.25)':'transparent'}'">📍 Posición ${j + 1}${j === 0 ? ' (Primero)' : j === total - 1 ? ' (Último)' : ''}</div>`;
  }).join('');

  const div = document.createElement('div');
  div.className = 'carousel-slide-item';
  div.dataset.bannerId = '';
  div.style.cssText = 'background:rgba(255,255,255,0.03); padding:10px; border-radius:6px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.08); position:relative;';
  div.innerHTML = `
    <button class="product-action-btn del" style="position:absolute; top:5px; right:5px; width:24px; height:24px; font-size:10px;" onclick="this.closest('.carousel-slide-item').remove(); window.pixisRefreshSlidePositions('${type}')" title="Eliminar banner">✕</button>

    <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px; position:relative;">
      <div class="pixis-slide-pos-badge" style="font-size:10px; color:${colorType}; font-weight:bold; background:rgba(255,255,255,0.05); padding:2px 7px; border-radius:10px; border:1px solid ${colorType}40; white-space:nowrap;">${labelType} #${currentCount}</div>
      <div class="pixis-pos-wrap" style="position:relative; display:inline-block;">
        <button class="pixis-pos-toggle" title="Mover a posición" onclick="window.pixisTogglePosDropdown(this, '${type}')" style="background:rgba(176,38,255,0.18); border:1px solid rgba(176,38,255,0.4); color:#b026ff; border-radius:5px; padding:0 8px; height:22px; font-size:10px; cursor:pointer; white-space:nowrap; display:flex; align-items:center; gap:3px;">📌 Posición <span style="font-size:8px;">▾</span></button>
        <div class="pixis-pos-dropdown" style="display:none; position:absolute; top:26px; left:0; background:#1a1a2e; border:1px solid rgba(176,38,255,0.4); border-radius:7px; z-index:9999; min-width:140px; padding:4px; box-shadow:0 6px 20px rgba(0,0,0,0.6);">
          ${posOptions}
        </div>
      </div>
      <div style="font-size:9px; color:#555; flex:1; text-align:right;">del carrusel</div>
    </div>
    
    <div class="panel-field" style="margin-bottom:8px;">
      <label class="panel-label" style="font-size:9px;">Imagen PC</label>
      <div style="display:flex; gap:5px;">
        <input type="text" class="panel-input slide-img-pc" id="${idPc}" placeholder="img/banners/pc.jpg">
        <button class="panel-btn" style="width:auto; padding:0 8px; font-size:10px; height:32px;" onclick="window.PixisEditorAPI.triggerUpload('${idPc}', 'img/carrusel')">📁 Subir</button>
      </div>
    </div>
    
    <div class="panel-field" style="margin-bottom:8px;">
      <label class="panel-label" style="font-size:9px;">Imagen Celular</label>
      <div style="display:flex; gap:5px;">
        <input type="text" class="panel-input slide-img-mob" id="${idMob}" placeholder="img/banners/mobile.jpg">
        <button class="panel-btn" style="width:auto; padding:0 8px; font-size:10px; height:32px;" onclick="window.PixisEditorAPI.triggerUpload('${idMob}', 'img/carrusel')">📁 Subir</button>
      </div>
    </div>
    
    <div class="panel-field" style="margin-bottom:10px;">
      <label class="panel-label" style="font-size:9px;">Vínculo a Banner</label>
      <select class="panel-select slide-banner-id" style="font-size:11px; height:28px; padding:0 5px;"
              onchange="this.closest('.carousel-slide-item').dataset.bannerId = this.value">
        <option value="" selected>— Ninguno —</option>
        ${Object.entries(banners).map(([id, b]) => `<option value="${escHtml(id)}">${escHtml(b.t)}</option>`).join('')}
      </select>
    </div>

    <!-- Botón Aplicar individual -->
    <button onclick="window.PixisEditorAPI.saveCarousel('${type}')" style="width:100%; background:rgba(176,38,255,0.12); border:1px solid rgba(176,38,255,0.35); color:#b026ff; border-radius:6px; padding:5px 0; font-size:10px; font-weight:600; cursor:pointer; letter-spacing:.3px;">💾 Aplicar ${type === 'top' ? 'Superior' : 'Inferior'}</button>
  `;
  container.appendChild(div);
  window.pixisRefreshSlidePositions(type);
};

window.PixisEditorAPI.triggerUpload = function(inputId, folder = 'img/uploads') {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    window.PixisOverlay.showToast('Subiendo banner en calidad original...', 'info');
    
    try {
      // Normalizar nombre de archivo y forzar JPG
      const ext = 'jpg';
      const cleanName = file.name.split('.')[0].replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const filename = `${cleanName}-${Date.now()}.${ext}`;

      // Subida en calidad 100% original (sin compresión destructiva) para banners de máxima nitidez
      const res = await fetch(`/api/upload-image?folder=${folder}&filename=${filename}`, {
        method: 'POST',
        body: file
      });
      const json = await res.json();
      if (json.ok) {
        const input = document.getElementById(inputId);
        if (input) {
          input.value = json.url;
          // Disparar evento input para refrescar posibles previews
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        window.PixisOverlay.showToast('✅ Banner subido en calidad original', 'success');
      } else {
        throw new Error(json.error);
      }
    } catch (e) {
      window.PixisOverlay.showToast('❌ Error al subir banner: ' + e.message, 'error');
    }
  };
  fileInput.click();
};

window.PixisEditorAPI._safeCleanupImages = async function(oldList, newList, contextType) {
  if (!Array.isArray(oldList) || oldList.length === 0) return;
  
  // 1. Recolectar todas las URLs presentes en la nueva configuración
  const newUrls = new Set();
  (newList || []).forEach(item => {
    if (item.imgPc) newUrls.add(item.imgPc.trim());
    if (item.imgMobile) newUrls.add(item.imgMobile.trim());
    if (item.img) newUrls.add(item.img.trim());
  });

  // 2. Recolectar todas las URLs protegidas en otras partes del sitio
  const site = window.PixisState?.state?.site || PixisEditor.data.site || {};
  const protectedUrls = new Set();
  
  // Otro carrusel
  const otherCarousel = contextType === 'top' ? (site.carouselBottom || []) : (site.carouselTop || []);
  otherCarousel.forEach(s => {
    if (s.imgPc) protectedUrls.add(s.imgPc.trim());
    if (s.imgMobile) protectedUrls.add(s.imgMobile.trim());
  });

  // Laterales fanpage
  if (site.fanpageBanners?.left?.img) protectedUrls.add(site.fanpageBanners.left.img.trim());
  if (site.fanpageBanners?.right?.img) protectedUrls.add(site.fanpageBanners.right.img.trim());

  // Laterales catálogo
  if (site.lateralBanners?.items) {
    site.lateralBanners.items.forEach(it => { if (it?.img) protectedUrls.add(it.img.trim()); });
  }

  // 3. Eliminar únicamente huérfanas reales del disco
  for (const old of oldList) {
    const urlsToCheck = [old.imgPc, old.imgMobile, old.img].filter(Boolean);
    for (const u of urlsToCheck) {
      const cleanUrl = u.trim();
      const isDynamicUpload = cleanUrl.startsWith('img/uploads/') || cleanUrl.startsWith('img/carrusel/');
      if (isDynamicUpload && !newUrls.has(cleanUrl) && !protectedUrls.has(cleanUrl)) {
        await fetch('/api/remove-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cleanUrl })
        }).catch(() => {});
      }
    }
  }
};

window.PixisEditorAPI.saveCarousel = function(type) {
  const containerId = type === 'top' ? 'carouselTopContainer' : 'carouselBottomContainer';
  const container = document.getElementById(containerId);
  if (!container) return;

  const slides = [];
  container.querySelectorAll('.carousel-slide-item').forEach(item => {
    const pc  = item.querySelector('.slide-img-pc')?.value.trim();
    const mob = item.querySelector('.slide-img-mob')?.value.trim();
    // data-banner-id es la fuente de verdad (sobrevive movimientos DOM); fallback al select
    const bid = item.dataset.bannerId
      ?? item.querySelector('.slide-banner-id')?.value.trim()
      ?? '';
    if (pc || mob) slides.push({ imgPc: pc, imgMobile: mob, bannerId: bid });
  });

  const stateKey = type === 'top' ? 'carouselTop' : 'carouselBottom';
  const oldSlides = window.PixisState?.state?.site?.[stateKey] || [];
  
  if (window.PixisState) {
    const siteData = { ...window.PixisState.state.site };
    siteData[stateKey] = slides;
    
    // Autolimpieza segura en servidor Hostinger de imágenes viejas
    window.PixisEditorAPI._safeCleanupImages(oldSlides, slides, type);

    window.PixisState.updateState({ type: 'site', path: [], value: siteData })
      .then(saved => {
        window.PixisOverlay.showToast(saved ? `✅ Carrusel ${type === 'top' ? 'Superior' : 'Inferior'} actualizado` : '📥 Guardado localmente', 'success');
        markUnsaved();
      });
  }
};

/* ════════════════════════════════════════════════════════════════
   PANEL DE FINANZAS Y OPTIMIZACIÓN
════════════════════════════════════════════════════════════════ */
function openFinanzasPanel() {
  const site = PixisEditor.data.site || {};
  const tasas = site.tasasCuotas || [1, 1.13, 1.31, 1.60, 1.60];
  const opt = site.imageOptimization || { enabled: true, proxyUrl: 'https://images.weserv.nl/?url=' };

  window.PixisOverlay.openPanel('💰 Finanzas y Optimización', `
    <div class="panel-section">
      <div class="panel-section-title">📈 Coeficientes de Cuotas</div>
      <div style="font-size:11px;color:#888;margin-bottom:12px;line-height:1.4;">
        Establecé el multiplicador para cada plan de cuotas. <br>
        <i>Ejemplo: 1.13 significa un 13% de recargo.</i>
      </div>
      
      <div class="panel-field">
        <label class="panel-label">1 Cuota (Base)</label>
        <input type="number" step="0.01" class="panel-input tasa-input" data-idx="0" value="${tasas[0]}">
      </div>
      <div class="panel-field">
        <label class="panel-label">3 Cuotas</label>
        <input type="number" step="0.01" class="panel-input tasa-input" data-idx="1" value="${tasas[1]}">
      </div>
      <div class="panel-field">
        <label class="panel-label">6 Cuotas</label>
        <input type="number" step="0.01" class="panel-input tasa-input" data-idx="2" value="${tasas[2]}">
      </div>
      <div class="panel-field">
        <label class="panel-label">9 Cuotas</label>
        <input type="number" step="0.01" class="panel-input tasa-input" data-idx="3" value="${tasas[3]}">
      </div>
      <div class="panel-field">
        <label class="panel-label">12 Cuotas</label>
        <input type="number" step="0.01" class="panel-input tasa-input" data-idx="4" value="${tasas[4]}">
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">⚡ Optimización de Imágenes</div>
      <div style="font-size:11px;color:#888;margin-bottom:12px;line-height:1.4;">
        Convierte imágenes a WebP y las redimensiona automáticamente para mejorar la velocidad de carga.
      </div>
      
      <div class="panel-field">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;" class="panel-label">
          <input type="checkbox" id="optEnabled" ${opt.enabled ? 'checked' : ''}>
          Activar optimización (Weserv Proxy)
        </label>
      </div>

      <div style="background:rgba(245,197,24,0.1); border-left:4px solid #f5c518; padding:10px; border-radius:4px; margin-top:10px;">
        <div style="color:#f5c518; font-size:12px; font-weight:bold; margin-bottom:4px;">⚠️ Aviso de seguridad</div>
        <div style="color:#e0e0e0; font-size:11px; line-height:1.4;">
          Esta opción <b>no funciona en Localhost</b>. Si las imágenes no cargan o se ven rotas en producción, desactívala para volver al modo original.
        </div>
      </div>
    </div>

    <div class="panel-section">
      <button class="panel-btn panel-btn-primary" id="saveFinanzasBtn">💾 Guardar Configuración</button>
    </div>
  `);

  document.getElementById('saveFinanzasBtn')?.addEventListener('click', () => {
    const newTasas = Array.from(document.querySelectorAll('.tasa-input')).map(inp => parseFloat(inp.value) || 1);
    const newOpt = {
      enabled: document.getElementById('optEnabled').checked,
      proxyUrl: opt.proxyUrl || 'https://images.weserv.nl/?url='
    };

    if (window.PixisState) {
      window.PixisState.pushHistory();
      
      // Actualizar tasas
      window.PixisState.updateState({ type: 'site', path: ['tasasCuotas'], value: newTasas });
      // Actualizar optimización
      window.PixisState.updateState({ type: 'site', path: ['imageOptimization'], value: newOpt })
        .then(saved => {
          window.PixisOverlay.showToast(saved ? '✅ Configuración financiera guardada' : '📥 Actualizado localmente', 'success');
          markUnsaved();
          
          // Forzar re-aplicación del estado para que las imágenes se optimicen/des-optimicen
          window.PixisState.applyStateToDOM();
        });
    } else {
      PixisEditor.data.site.tasasCuotas = newTasas;
      PixisEditor.data.site.imageOptimization = newOpt;
      markUnsaved();
      window.PixisOverlay.showToast('Configuración actualizada', 'success');
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   SISTEMA DE GESTIÓN VISUAL DE IMÁGENES (DRAG & DROP)
════════════════════════════════════════════════════════════════ */

/**
 * Renderiza miniaturas de imágenes con soporte para Drag & Drop y eliminación.
 * @param {string} value String de rutas separadas por coma
 * @param {string} containerId ID del div donde renderizar
 * @param {string} targetInputId ID del input/textarea que contiene el valor
 */
window.pixisUpdateImgPreview = function(value, containerId, targetInputId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const imgs = value.split(',').map(s => s.trim()).filter(Boolean);
  if (!imgs.length) { 
    container.innerHTML = '<div style="font-size:11px;color:#666;padding:10px;border:1px dashed #333;width:100%;text-align:center;border-radius:6px;">Sin imágenes seleccionadas</div>'; 
    return; 
  }
  
  container.innerHTML = imgs.map((src, i) => `
    <div class="pixis-img-thumb-container" 
         draggable="true"
         ondragstart="window.pixisHandleDragStart(event, ${i})"
         ondragover="window.pixisHandleDragOver(event)"
         onleave="this.classList.remove('drag-over')"
         ondragenter="this.classList.add('drag-over')"
         ondrop="window.pixisHandleDrop(event, ${i}, '${targetInputId}', '${containerId}')"
         ondragend="this.classList.remove('dragging'); document.querySelectorAll('.pixis-img-thumb-container').forEach(el => el.classList.remove('drag-over'))"
         title="Arrastrá para reordenar. La primera es la portada.">
      
      <img src="${src}" 
           onerror="this.style.opacity='0.25';this.title='No encontrada: '+this.src">
      
      ${i === 0 ? '<span style="position:absolute;bottom:2px;left:2px;background:var(--editor-purple);color:#fff;font-size:8px;padding:1px 3px;border-radius:3px;pointer-events:none;z-index:3;">PORTADA</span>' : ''}
      
      <button class="pixis-img-del-btn" 
              onclick="window.PixisEditorAPI.deleteProductImage('${src}', '${targetInputId}', '${containerId}')"
              style="position:absolute;top:-5px;right:-5px;background:#ff0033;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.5);z-index:4;"
              title="Eliminar permanentemente">
        ✕
      </button>
    </div>
  `).join('');
};

let draggedImgIndex = null;

window.pixisHandleDragStart = function(e, index) {
  draggedImgIndex = index;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Firefox requiere setData para que el drag funcione
  e.dataTransfer.setData('text/plain', index);
};

window.pixisHandleDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
};

window.pixisHandleDrop = function(e, targetIndex, targetInputId, containerId) {
  e.preventDefault();
  e.stopPropagation();
  
  const fromIndex = draggedImgIndex;
  const toIndex = targetIndex;
  
  if (fromIndex === null || fromIndex === toIndex) return;
  
  const input = document.getElementById(targetInputId);
  if (!input) return;
  
  const urls = input.value.split(',').map(s => s.trim()).filter(Boolean);
  
  // Reordenar array
  const element = urls.splice(fromIndex, 1)[0];
  urls.splice(toIndex, 0, element);
  
  const newValue = urls.join(', ');
  input.value = newValue;
  
  // Disparar evento input para que el sistema detecte el cambio (si es necesario)
  input.dispatchEvent(new Event('input', { bubbles: true }));
  
  // Refrescar vista previa
  window.pixisUpdateImgPreview(newValue, containerId, targetInputId);
  
  window.PixisOverlay.showToast('Orden actualizado ✓', 'info', 1000);
  
  return false;
};

/* ════════════════════════════════════════════════════════════════
   PANEL DE CONFIGURACIÓN RGB
   ════════════════════════════════════════════════════════════════ */
function openRGBConfigPanel() {
  const site = PixisEditor.data.site || {};
  if (!site.designSettings) {
    site.designSettings = {
      borderColorGamer: "rainbow",
      borderColorOficina: "rainbow",
      backgroundTypeGamer: "default",
      backgroundValueGamer: "",
      backgroundTypeOficina: "default",
      backgroundValueOficina: ""
    };
  }
  const settings = site.designSettings;

  // Garantizar valores por defecto si no existen
  if (settings.rgbCardsDisabled === undefined) settings.rgbCardsDisabled = settings.rgbDisabled || false;
  if (settings.rgbCardsSpeed === undefined) settings.rgbCardsSpeed = settings.rgbSpeed || 6;
  if (settings.rgbBannersDisabled === undefined) settings.rgbBannersDisabled = settings.rgbDisabled || false;
  if (settings.rgbBannersSpeed === undefined) settings.rgbBannersSpeed = settings.rgbSpeed || 6;
  if (settings.catPanelRgbDisabled === undefined) settings.catPanelRgbDisabled = false;
  if (settings.catPanelRgbSpeed === undefined) settings.catPanelRgbSpeed = 6;
  if (settings.catPanelRgbThickness === undefined) settings.catPanelRgbThickness = 2;

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:10px 0;">
      <!-- SECCIÓN CARDS -->
      <div style="border-right:1px solid rgba(255,255,255,0.1);padding-right:20px;">
        <h3 style="color:#b026ff;border-bottom:1px solid #b026ff;padding-bottom:5px;margin-bottom:15px;display:flex;align-items:center;gap:8px;">
          🛒 Iluminación en Cards
        </h3>
        <label class="panel-label" style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;margin-bottom:15px;">
          <input type="checkbox" id="rgbCardsToggle" ${!settings.rgbCardsDisabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:#b026ff;">
          <strong>Habilitar RGB en Cards</strong>
        </label>
        
        <div id="rgbCardsSpeedSection" style="margin-top:15px; transition:0.3s; ${settings.rgbCardsDisabled ? 'opacity:0.5;pointer-events:none;' : ''}">
          <label class="panel-label"><strong>Velocidad de iluminación (Segundos por ciclo)</strong></label>
          <div style="display:flex;align-items:center;gap:15px;margin-top:10px;">
            <input type="range" id="rgbCardsSpeedRange" min="1" max="15" value="${settings.rgbCardsSpeed}" style="flex:1;accent-color:#b026ff;">
            <span id="rgbCardsSpeedVal" style="font-weight:bold;font-size:16px;min-width:40px;text-align:right;">${settings.rgbCardsSpeed}s</span>
          </div>
        </div>
      </div>

      <!-- SECCIÓN BANNERS -->
      <div>
        <h3 style="color:#00e5ff;border-bottom:1px solid #00e5ff;padding-bottom:5px;margin-bottom:15px;display:flex;align-items:center;gap:8px;">
          🖼️ Iluminación en Banners
        </h3>
        <label class="panel-label" style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;margin-bottom:15px;">
          <input type="checkbox" id="rgbBannersToggle" ${!settings.rgbBannersDisabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:#00e5ff;">
          <strong>Habilitar RGB en Banners</strong>
        </label>
        
        <div id="rgbBannersSpeedSection" style="margin-top:15px; transition:0.3s; ${settings.rgbBannersDisabled ? 'opacity:0.5;pointer-events:none;' : ''}">
          <label class="panel-label"><strong>Velocidad de iluminación (Segundos por ciclo)</strong></label>
          <div style="display:flex;align-items:center;gap:15px;margin-top:10px;">
            <input type="range" id="rgbBannersSpeedRange" min="1" max="15" value="${settings.rgbBannersSpeed}" style="flex:1;accent-color:#00e5ff;">
            <span id="rgbBannersSpeedVal" style="font-weight:bold;font-size:16px;min-width:40px;text-align:right;">${settings.rgbBannersSpeed}s</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- RGB DEL MENÚ DE PRODUCTOS -->
    <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:20px;margin-top:15px;display:grid;grid-template-columns:1fr 1fr;gap:30px;">
      <div>
        <h3 style="color:#ffaa00;border-bottom:1px solid #ffaa00;padding-bottom:5px;margin-bottom:15px;display:flex;align-items:center;gap:8px;">
          🍔 RGB del Menú de Productos
        </h3>
        <label class="panel-label" style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;margin-bottom:15px;">
          <input type="checkbox" id="catPanelRgbToggle" ${!settings.catPanelRgbDisabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:#ffaa00;">
          <strong>Habilitar RGB en Menú de Productos</strong>
        </label>
        
        <div id="catPanelRgbSpeedSection" style="margin-top:15px; transition:0.3s; ${settings.catPanelRgbDisabled ? 'opacity:0.5;pointer-events:none;' : ''}">
          <label class="panel-label"><strong>Velocidad de iluminación (Segundos por ciclo)</strong></label>
          <div style="display:flex;align-items:center;gap:15px;margin-top:10px;">
            <input type="range" id="catPanelRgbSpeedRange" min="1" max="15" value="${settings.catPanelRgbSpeed}" style="flex:1;accent-color:#ffaa00;">
            <span id="catPanelRgbSpeedVal" style="font-weight:bold;font-size:16px;min-width:40px;text-align:right;">${settings.catPanelRgbSpeed}s</span>
          </div>
        </div>
      </div>

    </div>
    <p style="font-size:11px;color:var(--editor-text-dim);margin-top:20px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);padding-top:10px;">
      *Nota: Los botones destacados, reels y otros accesos principales mantendrán su iluminación RGB por diseño de marca.
    </p>
  `;

  const footerHTML = `
    <button class="panel-btn panel-btn-primary" id="saveRgbSettingsBtn">💾 Aplicar Configuración RGB</button>
  `;

  window.PixisOverlay.openModal('🌈 Configuración RGB', bodyHTML, footerHTML);

  const cardsToggle = document.getElementById('rgbCardsToggle');
  const cardsSpeedSection = document.getElementById('rgbCardsSpeedSection');
  const cardsRange = document.getElementById('rgbCardsSpeedRange');
  const cardsValSpan = document.getElementById('rgbCardsSpeedVal');

  const bannersToggle = document.getElementById('rgbBannersToggle');
  const bannersSpeedSection = document.getElementById('rgbBannersSpeedSection');
  const bannersRange = document.getElementById('rgbBannersSpeedRange');
  const bannersValSpan = document.getElementById('rgbBannersSpeedVal');

  const catToggle = document.getElementById('catPanelRgbToggle');
  const catSpeedSection = document.getElementById('catPanelRgbSpeedSection');
  const catRange = document.getElementById('catPanelRgbSpeedRange');
  const catValSpan = document.getElementById('catPanelRgbSpeedVal');


  cardsToggle?.addEventListener('change', (e) => {
    cardsSpeedSection.style.opacity = e.target.checked ? '1' : '0.5';
    cardsSpeedSection.style.pointerEvents = e.target.checked ? 'auto' : 'none';
  });

  bannersToggle?.addEventListener('change', (e) => {
    bannersSpeedSection.style.opacity = e.target.checked ? '1' : '0.5';
    bannersSpeedSection.style.pointerEvents = e.target.checked ? 'auto' : 'none';
  });

  catToggle?.addEventListener('change', (e) => {
    catSpeedSection.style.opacity = e.target.checked ? '1' : '0.5';
    catSpeedSection.style.pointerEvents = e.target.checked ? 'auto' : 'none';
  });

  cardsRange?.addEventListener('input', (e) => {
    if (cardsValSpan) cardsValSpan.textContent = e.target.value + 's';
  });

  bannersRange?.addEventListener('input', (e) => {
    if (bannersValSpan) bannersValSpan.textContent = e.target.value + 's';
  });

  catRange?.addEventListener('input', (e) => {
    if (catValSpan) catValSpan.textContent = e.target.value + 's';
  });



  document.getElementById('saveRgbSettingsBtn')?.addEventListener('click', () => {
    settings.rgbCardsDisabled = !cardsToggle.checked;
    settings.rgbCardsSpeed = parseInt(cardsRange.value);
    settings.rgbBannersDisabled = !bannersToggle.checked;
    settings.rgbBannersSpeed = parseInt(bannersRange.value);

    settings.catPanelRgbDisabled = !catToggle.checked;
    settings.catPanelRgbSpeed = parseInt(catRange.value) || 6;

    // Mantener retrocompatibilidad
    settings.rgbDisabled = settings.rgbCardsDisabled && settings.rgbBannersDisabled;
    settings.rgbSpeed = settings.rgbCardsSpeed;

    PixisEditor.state.unsaved = true;
    saveAllData().then(() => {
      if (window.PixisState) {
        window.PixisState.applyStateToDOM();
      }
      window.PixisOverlay.showToast('✅ Configuración RGB aplicada', 'success', 2000);
    });
  });
}

/* ════════════════════════════════════════════════════════════════
   PANEL DE DISEÑO (BORDES Y LIENZOS)
   ════════════════════════════════════════════════════════════════ */
function openDisenoConfigPanel() {
  const site = PixisEditor.data.site || {};
  if (!site.designSettings) {
    site.designSettings = {
      borderColorGamer: "rainbow",
      borderColorOficina: "rainbow",
      backgroundTypeGamer: "default",
      backgroundValueGamer: "",
      backgroundTypeOficina: "default",
      backgroundValueOficina: ""
    };
  }
  const settings = site.designSettings;

  if (settings.gamerMenuBtnRgbEnabled === undefined) {
    settings.gamerMenuBtnRgbEnabled = settings.gamerMenuBtnRgb !== false;
  }
  if (settings.oficinaMenuBtnRgbEnabled === undefined) {
    settings.oficinaMenuBtnRgbEnabled = settings.oficinaMenuBtnRgb !== false;
  }

  // Inicializar variables de tipografía/colores si no existen
  const defaults = {
    gamerFontFamily: "Orbitron", gamerCardTitleColor: "#ffffff", gamerCardTitleSize: "18px", gamerCardDescColor: "#d0bfff", gamerCardDescSize: "14px", gamerCardPriceColor: "#00ffa6", gamerCardPriceSize: "20px",
    oficinaFontFamily: "Segoe UI", oficinaCardTitleColor: "#333333", oficinaCardTitleSize: "18px", oficinaCardDescColor: "#666666", oficinaCardDescSize: "14px", oficinaCardPriceColor: "#10b981", oficinaCardPriceSize: "20px",
    headerBgTypeGamer: "default", headerBgValueGamer: "", headerBgTypeOficina: "default", headerBgValueOficina: "",
    // Textos Globales per-modo
    gamerGlobalH1Color: "", gamerGlobalH2Color: "", gamerHeaderTopColor: "", gamerLinea1Color: "", gamerUbicacionColor: "", gamerRedesTitleColor: "",
    gamerBtnVerCuotasColor: "", gamerBtnVolverColor: "",
    oficinaGlobalH1Color: "", oficinaGlobalH2Color: "", oficinaHeaderTopColor: "", oficinaLinea1Color: "", oficinaUbicacionColor: "", oficinaRedesTitleColor: "",
    oficinaBtnVerCuotasColor: "", oficinaBtnVolverColor: "",
    
    // Menú Lateral de Productos (Móvil)
    gamerCatPanelBgColor: "#0e0016",
    gamerCatPanelTitleColor: "#b026ff",
    gamerCatPanelCloseColor: "#b026ff",
    gamerCatItemBgColor: "transparent",
    gamerCatItemTextColor: "#ffffff",
    gamerCatItemBorderColor: "#b026ff",
    gamerCatItemActiveBgColor: "rgba(176,38,255,0.25)",
    gamerCatItemActiveTextColor: "#ffffff",

    oficinaCatPanelBgColor: "#ffffff",
    oficinaCatPanelTitleColor: "#4338ca",
    oficinaCatPanelCloseColor: "#4338ca",
    oficinaCatItemBgColor: "#f1f5f9",
    oficinaCatItemTextColor: "#334155",
    oficinaCatItemBorderColor: "#cbd5e1",
    oficinaCatItemActiveBgColor: "#1e293b",
    oficinaCatItemActiveTextColor: "#ffffff"
  };
  Object.keys(defaults).forEach(key => {
    if (settings[key] === undefined) settings[key] = defaults[key];
  });

  const fontOptions = `
    <option value="Orbitron">Orbitron (Gamer / Tech)</option>
    <option value="'Segoe UI', sans-serif">Segoe UI (Estándar)</option>
    <option value="'Inter', sans-serif">Inter (Moderno / Premium)</option>
    <option value="'Montserrat', sans-serif">Montserrat</option>
    <option value="'Roboto', sans-serif">Roboto</option>
    <option value="'Outfit', sans-serif">Outfit</option>
    <option value="'Poppins', sans-serif">Poppins</option>
    <option value="'Lato', sans-serif">Lato</option>
    <option value="'Open Sans', sans-serif">Open Sans</option>
    <option value="'Oswald', sans-serif">Oswald</option>
    <option value="'Raleway', sans-serif">Raleway</option>
    <option value="'Nunito', sans-serif">Nunito</option>
    <option value="'Ubuntu', sans-serif">Ubuntu</option>
    <option value="'Playfair Display', serif">Playfair Display</option>
    <option value="'Cinzel', serif">Cinzel</option>
    <option value="'Kanit', sans-serif">Kanit</option>
    <option value="'Bebas Neue', sans-serif">Bebas Neue</option>
    <option value="'Fira Sans', sans-serif">Fira Sans</option>
    <option value="'Quicksand', sans-serif">Quicksand</option>
    <option value="'Syne', sans-serif">Syne</option>
    <option value="'Teko', sans-serif">Teko</option>
  `;

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;min-width:800px;max-height:65vh;overflow-y:auto;padding-right:10px;">
      
      <!-- COLUMNA MODO GAMER -->
      <div style="border-right:1px solid rgba(255,255,255,0.1);padding-right:20px;">
        <h3 style="color:#b026ff;border-bottom:1px solid #b026ff;padding-bottom:5px;margin-bottom:15px;display:flex;align-items:center;gap:8px;">🎮 Modo Gamer (Oscuro)</h3>
        
        <!-- Borde Cards/Banners -->
        <div class="panel-section" style="margin-bottom:15px;">
          <div style="background:rgba(176,38,255,0.18);border-left:4px solid #b026ff;border-radius:7px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🖼️</span><span style="color:#e0b8ff;font-weight:800;font-size:15px;letter-spacing:.3px;">Color de bordes (Cards / Banners)</span></div>
          <select id="borderGamerSelect" class="panel-input" style="margin-top:5px;">
            <option value="none" ${settings.borderColorGamer === 'none' ? 'selected' : ''}>🚫 Ninguno (Sin Borde)</option>
            <option value="rainbow" ${settings.borderColorGamer === 'rainbow' ? 'selected' : ''}>🌈 Arcoíris RGB</option>
            <option value="gold" ${settings.borderColorGamer === 'gold' ? 'selected' : ''}>✨ Dorado Metálico (Oro)</option>
            <option value="#ff00ff" ${settings.borderColorGamer === '#ff00ff' ? 'selected' : ''}>💖 Magenta / Fucsia</option>
            <option value="#00ffff" ${settings.borderColorGamer === '#00ffff' ? 'selected' : ''}>🌐 Cyan / Celeste</option>
            <option value="#00ff00" ${settings.borderColorGamer === '#00ff00' ? 'selected' : ''}>💚 Verde Neón</option>
            <option value="#ff0000" ${settings.borderColorGamer === '#ff0000' ? 'selected' : ''}>❤️ Rojo Fuego</option>
            <option value="#ffaa00" ${settings.borderColorGamer === '#ffaa00' ? 'selected' : ''}>🧡 Naranja</option>
            <option value="#7f00ff" ${settings.borderColorGamer === '#7f00ff' ? 'selected' : ''}>💜 Violeta</option>
          </select>
        </div>

        <!-- Lienzo (Fondo) -->
        <div class="panel-section" style="margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:15px;">
          <div style="background:rgba(176,38,255,0.18);border-left:4px solid #b026ff;border-radius:7px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🌄</span><span style="color:#e0b8ff;font-weight:800;font-size:15px;letter-spacing:.3px;">Lienzo / Fondo del Sitio</span></div>
          <select id="bgTypeGamerSelect" class="panel-input" style="margin-top:5px;margin-bottom:10px;">
            <option value="default" ${settings.backgroundTypeGamer === 'default' ? 'selected' : ''}>Original (Imagen de fondo Pixis)</option>
            <option value="solid" ${settings.backgroundTypeGamer === 'solid' ? 'selected' : ''}>🎨 Color Sólido (Gama amplia)</option>
            <option value="image" ${settings.backgroundTypeGamer === 'image' ? 'selected' : ''}>🖼️ Imagen Personalizada (Cargar/URL)</option>
          </select>
          <div id="bgValGamerContainer"></div>
        </div>

        <!-- Fondo del Header (Gamer) -->
        <div class="panel-section" style="margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:15px;">
          <div style="background:rgba(176,38,255,0.18);border-left:4px solid #b026ff;border-radius:7px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🎮</span><span style="color:#e0b8ff;font-weight:800;font-size:15px;letter-spacing:.3px;">Fondo del Header (Gamer)</span></div>
          <select id="headerBgTypeGamerSelect" class="panel-input" style="margin-top:5px;margin-bottom:10px;">
            <option value="default" ${settings.headerBgTypeGamer === 'default' ? 'selected' : ''}>Original (Imagen de cabecera Pixis)</option>
            <option value="solid" ${settings.headerBgTypeGamer === 'solid' ? 'selected' : ''}>🎨 Color Sólido (Gama amplia)</option>
            <option value="image" ${settings.headerBgTypeGamer === 'image' ? 'selected' : ''}>🖼️ Imagen Personalizada (Cargar/URL)</option>
          </select>
          <div id="headerBgValGamerContainer"></div>
        </div>

        <!-- Retroiluminación en Categorías -->
        <div class="panel-section" style="margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:15px;">
          <div style="background:rgba(176,38,255,0.18);border-left:4px solid #b026ff;border-radius:7px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">✨</span><span style="color:#e0b8ff;font-weight:800;font-size:15px;letter-spacing:.3px;">Retroiluminación de Categorías</span></div>
          <select id="categoryGlowTypeGamer" class="panel-input" style="margin-top:5px;margin-bottom:10px;">
            <option value="original" ${settings.categoryGlowTypeGamer === 'original' || !settings.categoryGlowTypeGamer ? 'selected' : ''}>Original (Cyan / Amarillo)</option>
            <option value="rainbow" ${settings.categoryGlowTypeGamer === 'rainbow' ? 'selected' : ''}>🌈 Arcoíris RGB</option>
            <option value="gold" ${settings.categoryGlowTypeGamer === 'gold' ? 'selected' : ''}>✨ Dorado Metálico</option>
            <option value="cyan" ${settings.categoryGlowTypeGamer === 'cyan' ? 'selected' : ''}>🌐 Celeste / Cyan</option>
            <option value="off" ${settings.categoryGlowTypeGamer === 'off' ? 'selected' : ''}>🛑 Apagado (Detener)</option>
          </select>
          <div style="margin-top:10px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="categoryGlowActiveGamer" ${settings.categoryGlowActiveGamer !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#b026ff;cursor:pointer;">
            <label for="categoryGlowActiveGamer" style="cursor:pointer;font-size:12px;font-weight:bold;">Habilitar efecto de palpitación</label>
          </div>
          <div id="categoryGlowSpeedGamerContainer" style="margin-top:5px;${settings.categoryGlowActiveGamer === false || settings.categoryGlowTypeGamer === 'off' ? 'opacity:0.5;pointer-events:none;' : ''}">
            <label class="panel-label" style="font-size:11px;">Velocidad de palpitación (s por ciclo):</label>
            <div style="display:flex;align-items:center;gap:10px;margin-top:5px;">
              <input type="range" id="categoryGlowSpeedGamer" min="0.5" max="4.0" step="0.1" value="${settings.categoryGlowSpeedGamer || 1.5}" style="flex:1;accent-color:#b026ff;">
              <span id="categoryGlowSpeedGamerVal" style="font-weight:bold;font-size:13px;min-width:30px;text-align:right;">${settings.categoryGlowSpeedGamer || 1.5}s</span>
            </div>
          </div>
        </div>



        <!-- Tipografías y Colores de Cards -->
        <div style="background:rgba(176,38,255,0.18);border-left:4px solid #b026ff;border-radius:7px;padding:10px 14px;margin:18px 0 12px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🎨</span><span style="color:#e0b8ff;font-weight:800;font-size:15px;letter-spacing:.3px;">Estilo de Cards</span></div>
        
        <div class="panel-section" style="margin-bottom:10px;">
          <label class="panel-label"><strong>Tipografía (Letra)</strong></label>
          <select id="gamerFontFamily" class="panel-input">${fontOptions}</select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Color Título</strong></label>
            <input type="color" id="gamerCardTitleColor" class="panel-input" value="${settings.gamerCardTitleColor}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Tamaño Título</strong></label>
            <input type="text" id="gamerCardTitleSize" class="panel-input" value="${settings.gamerCardTitleSize}" placeholder="18px">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Color Descripción</strong></label>
            <input type="color" id="gamerCardDescColor" class="panel-input" value="${settings.gamerCardDescColor}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Tamaño Desc.</strong></label>
            <input type="text" id="gamerCardDescSize" class="panel-input" value="${settings.gamerCardDescSize}" placeholder="14px">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Color Precio</strong></label>
            <input type="color" id="gamerCardPriceColor" class="panel-input" value="${settings.gamerCardPriceColor}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Tamaño Precio</strong></label>
            <input type="text" id="gamerCardPriceSize" class="panel-input" value="${settings.gamerCardPriceSize}" placeholder="20px">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Fondo de las Cards</strong></label>
            <input type="color" id="gamerCardBgColor" class="panel-input" value="${settings.gamerCardBgColor || '#0e0016'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Fondo del Modal</strong></label>
            <input type="color" id="gamerModalBgColor" class="panel-input" value="${settings.gamerModalBgColor || '#0e0016'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Texto General Modal</strong></label>
            <input type="color" id="gamerModalTextColor" class="panel-input" value="${settings.gamerModalTextColor || '#d0bfff'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Precios del Modal</strong></label>
            <input type="color" id="gamerModalPriceColor" class="panel-input" value="${settings.gamerModalPriceColor || '#00ffa6'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <!-- Textos Globales del Sitio Gamer -->
        <div style="background:rgba(176,38,255,0.18);border-left:4px solid #b026ff;border-radius:7px;padding:10px 14px;margin:18px 0 12px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🌐</span><span style="color:#e0b8ff;font-weight:800;font-size:15px;letter-spacing:.3px;">Textos Globales del Sitio</span></div>
        <p style="font-size:11px;color:#888;margin-bottom:10px;">Colores para h1, h2, pliegue, ubicación, redes — guardados por modo.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Color H1 del Sitio</strong></label>
            <input type="color" id="gamerGlobalH1Color" class="panel-input" value="${settings.gamerGlobalH1Color || '#ffffff'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Color H2 del Sitio</strong></label>
            <input type="color" id="gamerGlobalH2Color" class="panel-input" value="${settings.gamerGlobalH2Color || '#ffffff'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Pliegue de Texto</strong></label>
            <input type="color" id="gamerHeaderTopColor" class="panel-input" value="${settings.gamerHeaderTopColor || '#ffffff'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Línea Animada (linea1)</strong></label>
            <input type="color" id="gamerLinea1Color" class="panel-input" value="${settings.gamerLinea1Color || '#00ffa6'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Texto Ubicación</strong></label>
            <input type="color" id="gamerUbicacionColor" class="panel-input" value="${settings.gamerUbicacionColor || '#ffffff'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Título Redes Sociales</strong></label>
            <input type="color" id="gamerRedesTitleColor" class="panel-input" value="${settings.gamerRedesTitleColor || '#b026ff'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Botón Ver Cuotas</strong></label>
            <input type="color" id="gamerBtnVerCuotasColor" class="panel-input" value="${settings.gamerBtnVerCuotasColor || '#d8b4fe'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Botón Volver al Cat.</strong></label>
            <input type="color" id="gamerBtnVolverColor" class="panel-input" value="${settings.gamerBtnVolverColor || '#e5ccff'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <!-- Botón Menú de Productos (Gamer) -->
        <div class="panel-section" style="margin-top:15px;border-top:1px solid rgba(255,255,255,0.05);padding-top:12px;">
          <div style="background:rgba(176,38,255,0.18);border-left:4px solid #b026ff;border-radius:7px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:9px;">
            <span style="font-size:16px;">🍔</span>
            <span style="color:#e0b8ff;font-weight:800;font-size:14px;letter-spacing:.3px;">Botón Menú de Productos</span>
          </div>
          <div style="margin-bottom:8px;">
            <label class="panel-label"><strong>Tipografía</strong></label>
            <select id="gamerMenuBtnFontFamily" class="panel-input">${fontOptions}</select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Color Letras</strong></label>
              <input type="color" id="gamerMenuBtnColor" class="panel-input" value="${settings.gamerMenuBtnColor || '#ffffff'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Tamaño Letras</strong></label>
              <input type="text" id="gamerMenuBtnSize" class="panel-input" value="${settings.gamerMenuBtnSize || '14px'}" placeholder="14px">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Color del Borde RGB</strong></label>
              <select id="gamerMenuBtnBorderColor" class="panel-input">
                <option value="rainbow" ${(settings.gamerMenuBtnBorderColor || 'rainbow') === 'rainbow' ? 'selected' : ''}>🌈 Arcoíris RGB</option>
                <option value="#ff0000" ${settings.gamerMenuBtnBorderColor === '#ff0000' ? 'selected' : ''}>❤️ Rojo</option>
                <option value="#00ffff" ${settings.gamerMenuBtnBorderColor === '#00ffff' ? 'selected' : ''}>🌐 Cyan</option>
                <option value="#b026ff" ${settings.gamerMenuBtnBorderColor === '#b026ff' ? 'selected' : ''}>💜 Violeta</option>
                <option value="#00ff00" ${settings.gamerMenuBtnBorderColor === '#00ff00' ? 'selected' : ''}>💚 Verde Neón</option>
                <option value="#ffaa00" ${settings.gamerMenuBtnBorderColor === '#ffaa00' ? 'selected' : ''}>🧡 Naranja</option>
                <option value="gold" ${settings.gamerMenuBtnBorderColor === 'gold' ? 'selected' : ''}>✨ Dorado</option>
                <option value="#ffffff" ${settings.gamerMenuBtnBorderColor === '#ffffff' ? 'selected' : ''}>⬜ Blanco</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center;">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="gamerMenuBtnRgb" ${settings.gamerMenuBtnRgbEnabled !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#b026ff;cursor:pointer;">
              <label for="gamerMenuBtnRgb" style="cursor:pointer;font-size:12px;font-weight:bold;">Borde RGB</label>
            </div>
            <div>
              <label class="panel-label"><strong>Grosor Borde (px)</strong></label>
              <input type="number" id="gamerMenuBtnRgbThickness" class="panel-input" value="${parseInt(settings.catPanelRgbThickness) || 2}" min="1" max="10" style="background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:6px;padding:6px;font-size:13px;">
            </div>
          </div>
        </div>

        <!-- Menú Lateral de Productos (Móvil) (Gamer) -->
        <div class="panel-section" style="margin-top:15px;border-top:1px solid rgba(255,255,255,0.05);padding-top:12px;">
          <div style="background:rgba(176,38,255,0.18);border-left:4px solid #b026ff;border-radius:7px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:9px;">
            <span style="font-size:16px;">📱</span>
            <span style="color:#e0b8ff;font-weight:800;font-size:14px;letter-spacing:.3px;">Menú Lateral de Productos (Móvil)</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Fondo Panel</strong></label>
              <input type="color" id="gamerCatPanelBgColor" class="panel-input" value="${settings.gamerCatPanelBgColor || '#0e0016'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Título & Icono</strong></label>
              <input type="color" id="gamerCatPanelTitleColor" class="panel-input" value="${settings.gamerCatPanelTitleColor || '#b026ff'}" style="padding:2px;height:32px;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Botón Cierre (✕)</strong></label>
              <input type="color" id="gamerCatPanelCloseColor" class="panel-input" value="${settings.gamerCatPanelCloseColor || '#b026ff'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Fondo Items</strong></label>
              <input type="color" id="gamerCatItemBgColor" class="panel-input" value="${settings.gamerCatItemBgColor || 'transparent'}" style="padding:2px;height:32px;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Texto/Icono Items</strong></label>
              <input type="color" id="gamerCatItemTextColor" class="panel-input" value="${settings.gamerCatItemTextColor || '#ffffff'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Borde Inferior Item</strong></label>
              <input type="color" id="gamerCatItemBorderColor" class="panel-input" value="${settings.gamerCatItemBorderColor || '#b026ff'}" style="padding:2px;height:32px;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Fondo Item Activo</strong></label>
              <input type="color" id="gamerCatItemActiveBgColor" class="panel-input" value="${settings.gamerCatItemActiveBgColor || 'rgba(176,38,255,0.25)'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Texto Item Activo</strong></label>
              <input type="color" id="gamerCatItemActiveTextColor" class="panel-input" value="${settings.gamerCatItemActiveTextColor || '#ffffff'}" style="padding:2px;height:32px;">
            </div>
          </div>
        </div>
      </div>

      <!-- COLUMNA MODO OFICINA -->
      <div>
        <h3 style="color:#00e5ff;border-bottom:1px solid #00e5ff;padding-bottom:5px;margin-bottom:15px;display:flex;align-items:center;gap:8px;">💼 Modo Oficina (Claro)</h3>
        
        <!-- Borde Cards/Banners -->
        <div class="panel-section" style="margin-bottom:15px;">
          <div style="background:rgba(0,229,255,0.15);border-left:4px solid #00e5ff;border-radius:7px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🖼️</span><span style="color:#b0faff;font-weight:800;font-size:15px;letter-spacing:.3px;">Color de bordes (Cards / Banners)</span></div>
          <select id="borderOficinaSelect" class="panel-input" style="margin-top:5px;">
            <option value="none" ${settings.borderColorOficina === 'none' ? 'selected' : ''}>🚫 Ninguno (Sin Borde)</option>
            <option value="rainbow" ${settings.borderColorOficina === 'rainbow' ? 'selected' : ''}>🌈 Arcoíris RGB</option>
            <option value="gold" ${settings.borderColorOficina === 'gold' ? 'selected' : ''}>✨ Dorado Metálico (Oro)</option>
            <option value="#3b82f6" ${settings.borderColorOficina === '#3b82f6' ? 'selected' : ''}>💙 Azul Empresarial</option>
            <option value="#10b981" ${settings.borderColorOficina === '#10b981' ? 'selected' : ''}>💚 Verde Esmeralda</option>
            <option value="#64748b" ${settings.borderColorOficina === '#64748b' ? 'selected' : ''}>🖤 Gris Pálido</option>
            <option value="#ef4444" ${settings.borderColorOficina === '#ef4444' ? 'selected' : ''}>❤️ Rojo Suave</option>
            <option value="#db2777" ${settings.borderColorOficina === '#db2777' ? 'selected' : ''}>💖 Rosa Dulce</option>
          </select>
        </div>

        <!-- Lienzo (Fondo) -->
        <div class="panel-section" style="margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:15px;">
          <div style="background:rgba(0,229,255,0.15);border-left:4px solid #00e5ff;border-radius:7px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🌄</span><span style="color:#b0faff;font-weight:800;font-size:15px;letter-spacing:.3px;">Lienzo / Fondo del Sitio</span></div>
          <select id="bgTypeOficinaSelect" class="panel-input" style="margin-top:5px;margin-bottom:10px;">
            <option value="default" ${settings.backgroundTypeOficina === 'default' ? 'selected' : ''}>Original (Blanco oficina)</option>
            <option value="solid" ${settings.backgroundTypeOficina === 'solid' ? 'selected' : ''}>🎨 Color Sólido (Gama amplia)</option>
            <option value="image" ${settings.backgroundTypeOficina === 'image' ? 'selected' : ''}>🖼️ Imagen Personalizada (Cargar/URL)</option>
          </select>
          <div id="bgValOficinaContainer"></div>
        </div>

        <!-- Fondo del Header (Oficina) -->
        <div class="panel-section" style="margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:15px;">
          <div style="background:rgba(0,229,255,0.15);border-left:4px solid #00e5ff;border-radius:7px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">💼</span><span style="color:#b0faff;font-weight:800;font-size:15px;letter-spacing:.3px;">Fondo del Header (Oficina)</span></div>
          <select id="headerBgTypeOficinaSelect" class="panel-input" style="margin-top:5px;margin-bottom:10px;">
            <option value="default" ${settings.headerBgTypeOficina === 'default' ? 'selected' : ''}>Original (Imagen de cabecera Pixis)</option>
            <option value="solid" ${settings.headerBgTypeOficina === 'solid' ? 'selected' : ''}>🎨 Color Sólido (Gama amplia)</option>
            <option value="image" ${settings.headerBgTypeOficina === 'image' ? 'selected' : ''}>🖼️ Imagen Personalizada (Cargar/URL)</option>
          </select>
          <div id="headerBgValOficinaContainer"></div>
        </div>

        <!-- Retroiluminación en Categorías -->
        <div class="panel-section" style="margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:15px;">
          <div style="background:rgba(0,229,255,0.15);border-left:4px solid #00e5ff;border-radius:7px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">✨</span><span style="color:#b0faff;font-weight:800;font-size:15px;letter-spacing:.3px;">Retroiluminación de Categorías</span></div>
          <select id="categoryGlowTypeOficina" class="panel-input" style="margin-top:5px;margin-bottom:10px;">
            <option value="original" ${settings.categoryGlowTypeOficina === 'original' || !settings.categoryGlowTypeOficina ? 'selected' : ''}>Original (Blanco / Sencillo)</option>
            <option value="rainbow" ${settings.categoryGlowTypeOficina === 'rainbow' ? 'selected' : ''}>🌈 Arcoíris RGB</option>
            <option value="gold" ${settings.categoryGlowTypeOficina === 'gold' ? 'selected' : ''}>✨ Dorado Metálico</option>
            <option value="cyan" ${settings.categoryGlowTypeOficina === 'cyan' ? 'selected' : ''}>🌐 Celeste / Cyan</option>
            <option value="off" ${settings.categoryGlowTypeOficina === 'off' ? 'selected' : ''}>🛑 Apagado (Detener)</option>
          </select>
          <div style="margin-top:10px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="categoryGlowActiveOficina" ${settings.categoryGlowActiveOficina !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#00e5ff;cursor:pointer;">
            <label for="categoryGlowActiveOficina" style="cursor:pointer;font-size:12px;font-weight:bold;">Habilitar efecto de palpitación</label>
          </div>
          <div id="categoryGlowSpeedOficinaContainer" style="margin-top:5px;${settings.categoryGlowActiveOficina === false || settings.categoryGlowTypeOficina === 'off' ? 'opacity:0.5;pointer-events:none;' : ''}">
            <label class="panel-label" style="font-size:11px;">Velocidad de palpitación (s por ciclo):</label>
            <div style="display:flex;align-items:center;gap:10px;margin-top:5px;">
              <input type="range" id="categoryGlowSpeedOficina" min="0.5" max="4.0" step="0.1" value="${settings.categoryGlowSpeedOficina || 1.5}" style="flex:1;accent-color:#00e5ff;">
              <span id="categoryGlowSpeedOficinaVal" style="font-weight:bold;font-size:13px;min-width:30px;text-align:right;">${settings.categoryGlowSpeedOficina || 1.5}s</span>
            </div>
          </div>
        </div>



        <!-- Tipografías y Colores de Cards Oficina -->
        <div style="background:rgba(0,229,255,0.15);border-left:4px solid #00e5ff;border-radius:7px;padding:10px 14px;margin:18px 0 12px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🎨</span><span style="color:#b0faff;font-weight:800;font-size:15px;letter-spacing:.3px;">Estilo de Cards</span></div>
        
        <div class="panel-section" style="margin-bottom:10px;">
          <label class="panel-label"><strong>Tipografía (Letra)</strong></label>
          <select id="oficinaFontFamily" class="panel-input">${fontOptions}</select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Color Título</strong></label>
            <input type="color" id="oficinaCardTitleColor" class="panel-input" value="${settings.oficinaCardTitleColor}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Tamaño Título</strong></label>
            <input type="text" id="oficinaCardTitleSize" class="panel-input" value="${settings.oficinaCardTitleSize}" placeholder="18px">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Color Descripción</strong></label>
            <input type="color" id="oficinaCardDescColor" class="panel-input" value="${settings.oficinaCardDescColor}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Tamaño Desc.</strong></label>
            <input type="text" id="oficinaCardDescSize" class="panel-input" value="${settings.oficinaCardDescSize}" placeholder="14px">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Color Precio</strong></label>
            <input type="color" id="oficinaCardPriceColor" class="panel-input" value="${settings.oficinaCardPriceColor}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Tamaño Precio</strong></label>
            <input type="text" id="oficinaCardPriceSize" class="panel-input" value="${settings.oficinaCardPriceSize}" placeholder="20px">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Fondo de las Cards</strong></label>
            <input type="color" id="oficinaCardBgColor" class="panel-input" value="${settings.oficinaCardBgColor || '#ffffff'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Fondo del Modal</strong></label>
            <input type="color" id="oficinaModalBgColor" class="panel-input" value="${settings.oficinaModalBgColor || '#ffffff'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Texto General Modal</strong></label>
            <input type="color" id="oficinaModalTextColor" class="panel-input" value="${settings.oficinaModalTextColor || '#333333'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Precios del Modal</strong></label>
            <input type="color" id="oficinaModalPriceColor" class="panel-input" value="${settings.oficinaModalPriceColor || '#008a3d'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <!-- Textos Globales del Sitio Oficina -->
        <div style="background:rgba(0,229,255,0.15);border-left:4px solid #00e5ff;border-radius:7px;padding:10px 14px;margin:18px 0 12px;display:flex;align-items:center;gap:9px;"><span style="font-size:17px;">🌐</span><span style="color:#b0faff;font-weight:800;font-size:15px;letter-spacing:.3px;">Textos Globales del Sitio</span></div>
        <p style="font-size:11px;color:#888;margin-bottom:10px;">Colores para h1, h2, pliegue, ubicación, redes — guardados por modo.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Color H1 del Sitio</strong></label>
            <input type="color" id="oficinaGlobalH1Color" class="panel-input" value="${settings.oficinaGlobalH1Color || '#111111'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Color H2 del Sitio</strong></label>
            <input type="color" id="oficinaGlobalH2Color" class="panel-input" value="${settings.oficinaGlobalH2Color || '#222222'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Pliegue de Texto</strong></label>
            <input type="color" id="oficinaHeaderTopColor" class="panel-input" value="${settings.oficinaHeaderTopColor || '#111111'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Línea Animada (linea1)</strong></label>
            <input type="color" id="oficinaLinea1Color" class="panel-input" value="${settings.oficinaLinea1Color || '#10b981'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Texto Ubicación</strong></label>
            <input type="color" id="oficinaUbicacionColor" class="panel-input" value="${settings.oficinaUbicacionColor || '#333333'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Título Redes Sociales</strong></label>
            <input type="color" id="oficinaRedesTitleColor" class="panel-input" value="${settings.oficinaRedesTitleColor || '#0066cc'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="panel-label"><strong>Botón Ver Cuotas</strong></label>
            <input type="color" id="oficinaBtnVerCuotasColor" class="panel-input" value="${settings.oficinaBtnVerCuotasColor || '#7c3aed'}" style="padding:2px;height:32px;">
          </div>
          <div>
            <label class="panel-label"><strong>Botón Volver al Cat.</strong></label>
            <input type="color" id="oficinaBtnVolverColor" class="panel-input" value="${settings.oficinaBtnVolverColor || '#6d28d9'}" style="padding:2px;height:32px;">
          </div>
        </div>

        <!-- Botón Menú de Productos (Oficina) -->
        <div class="panel-section" style="margin-top:15px;border-top:1px solid rgba(255,255,255,0.05);padding-top:12px;">
          <div style="background:rgba(0,229,255,0.15);border-left:4px solid #00e5ff;border-radius:7px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:9px;">
            <span style="font-size:16px;">🍔</span>
            <span style="color:#b0faff;font-weight:800;font-size:14px;letter-spacing:.3px;">Botón Menú de Productos</span>
          </div>
          <div style="margin-bottom:8px;">
            <label class="panel-label"><strong>Tipografía</strong></label>
            <select id="oficinaMenuBtnFontFamily" class="panel-input">${fontOptions}</select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Color Letras</strong></label>
              <input type="color" id="oficinaMenuBtnColor" class="panel-input" value="${settings.oficinaMenuBtnColor || '#1e0050'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Tamaño Letras</strong></label>
              <input type="text" id="oficinaMenuBtnSize" class="panel-input" value="${settings.oficinaMenuBtnSize || '14px'}" placeholder="14px">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Color del Borde RGB</strong></label>
              <select id="oficinaMenuBtnBorderColor" class="panel-input">
                <option value="rainbow" ${(settings.oficinaMenuBtnBorderColor || 'rainbow') === 'rainbow' ? 'selected' : ''}>🌈 Arcoíris RGB</option>
                <option value="#3b82f6" ${settings.oficinaMenuBtnBorderColor === '#3b82f6' ? 'selected' : ''}>💙 Azul</option>
                <option value="#10b981" ${settings.oficinaMenuBtnBorderColor === '#10b981' ? 'selected' : ''}>💚 Verde</option>
                <option value="#b026ff" ${settings.oficinaMenuBtnBorderColor === '#b026ff' ? 'selected' : ''}>💜 Violeta</option>
                <option value="#ef4444" ${settings.oficinaMenuBtnBorderColor === '#ef4444' ? 'selected' : ''}>❤️ Rojo</option>
                <option value="gold" ${settings.oficinaMenuBtnBorderColor === 'gold' ? 'selected' : ''}>✨ Dorado</option>
                <option value="#ffffff" ${settings.oficinaMenuBtnBorderColor === '#ffffff' ? 'selected' : ''}>⬜ Blanco</option>
                <option value="#000000" ${settings.oficinaMenuBtnBorderColor === '#000000' ? 'selected' : ''}>⬛ Negro</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center;">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="oficinaMenuBtnRgb" ${settings.oficinaMenuBtnRgbEnabled !== false ? 'checked' : ''} style="width:16px;height:16px;accent-color:#00e5ff;cursor:pointer;">
              <label for="oficinaMenuBtnRgb" style="cursor:pointer;font-size:12px;font-weight:bold;">Borde RGB</label>
            </div>
            <div>
              <label class="panel-label"><strong>Grosor Borde (px)</strong></label>
              <input type="number" id="oficinaMenuBtnRgbThickness" class="panel-input" value="${parseInt(settings.catPanelRgbThickness) || 2}" min="1" max="10" style="background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:6px;padding:6px;font-size:13px;">
            </div>
          </div>
        </div>

        <!-- Menú Lateral de Productos (Móvil) (Oficina) -->
        <div class="panel-section" style="margin-top:15px;border-top:1px solid rgba(255,255,255,0.05);padding-top:12px;">
          <div style="background:rgba(0,229,255,0.15);border-left:4px solid #00e5ff;border-radius:7px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:9px;">
            <span style="font-size:16px;">📱</span>
            <span style="color:#b0faff;font-weight:800;font-size:14px;letter-spacing:.3px;">Menú Lateral de Productos (Móvil)</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Fondo Panel</strong></label>
              <input type="color" id="oficinaCatPanelBgColor" class="panel-input" value="${settings.oficinaCatPanelBgColor || '#ffffff'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Título & Icono</strong></label>
              <input type="color" id="oficinaCatPanelTitleColor" class="panel-input" value="${settings.oficinaCatPanelTitleColor || '#4338ca'}" style="padding:2px;height:32px;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Botón Cierre (✕)</strong></label>
              <input type="color" id="oficinaCatPanelCloseColor" class="panel-input" value="${settings.oficinaCatPanelCloseColor || '#4338ca'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Fondo Items</strong></label>
              <input type="color" id="oficinaCatItemBgColor" class="panel-input" value="${settings.oficinaCatItemBgColor || '#f1f5f9'}" style="padding:2px;height:32px;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Texto/Icono Items</strong></label>
              <input type="color" id="oficinaCatItemTextColor" class="panel-input" value="${settings.oficinaCatItemTextColor || '#334155'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Borde Inferior Item</strong></label>
              <input type="color" id="oficinaCatItemBorderColor" class="panel-input" value="${settings.oficinaCatItemBorderColor || '#cbd5e1'}" style="padding:2px;height:32px;">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label class="panel-label"><strong>Fondo Item Activo</strong></label>
              <input type="color" id="oficinaCatItemActiveBgColor" class="panel-input" value="${settings.oficinaCatItemActiveBgColor || '#1e293b'}" style="padding:2px;height:32px;">
            </div>
            <div>
              <label class="panel-label"><strong>Texto Item Activo</strong></label>
              <input type="color" id="oficinaCatItemActiveTextColor" class="panel-input" value="${settings.oficinaCatItemActiveTextColor || '#ffffff'}" style="padding:2px;height:32px;">
            </div>
          </div>
        </div>
      </div>

    </div>
  `;

  const footerHTML = `
    <button class="panel-btn panel-btn-primary" id="saveDisenoSettingsBtn">💾 Aplicar Diseño Personalizado</button>
  `;

  window.PixisOverlay.openModal('🎨 Personalización de Bordes y Lienzos', bodyHTML, footerHTML);

  // Seleccionar fuentes en drop-down
  const selGamerFont = document.getElementById('gamerFontFamily');
  if (selGamerFont) selGamerFont.value = settings.gamerFontFamily;
  const selOfiFont = document.getElementById('oficinaFontFamily');
  if (selOfiFont) selOfiFont.value = settings.oficinaFontFamily;

  const selGamerMenuFont = document.getElementById('gamerMenuBtnFontFamily');
  if (selGamerMenuFont) selGamerMenuFont.value = settings.gamerMenuBtnFontFamily || 'Orbitron';
  const selOfiMenuFont = document.getElementById('oficinaMenuBtnFontFamily');
  if (selOfiMenuFont) selOfiMenuFont.value = settings.oficinaMenuBtnFontFamily || "'Segoe UI', sans-serif";

  const bgTypeGamer = document.getElementById('bgTypeGamerSelect');
  const bgValGamerContainer = document.getElementById('bgValGamerContainer');
  const bgTypeOficina = document.getElementById('bgTypeOficinaSelect');
  const bgValOficinaContainer = document.getElementById('bgValOficinaContainer');

  const headerBgTypeGamer = document.getElementById('headerBgTypeGamerSelect');
  const headerBgValGamerContainer = document.getElementById('headerBgValGamerContainer');
  const headerBgTypeOficina = document.getElementById('headerBgTypeOficinaSelect');
  const headerBgValOficinaContainer = document.getElementById('headerBgValOficinaContainer');

  // Guardar rutas subidas temporalmente para eliminarlas si no se aplican, o borrar anteriores al aplicar.
  let uploadedGamerFile = '';
  let uploadedOficinaFile = '';

  const handleFileUpload = async (fileInput, targetContainer, textInputId, tempVarSetter) => {
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    targetContainer.style.opacity = '0.5';
    targetContainer.style.pointerEvents = 'none';
    window.PixisOverlay.showToast('Subiendo fondo...', 'info');

    try {
      const filename = `fondo_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
      const res = await fetch(`/api/upload-image?filename=${filename}&folder=img/uploads`, {
        method: 'POST',
        body: file
      });
      const data = await res.json();
      if (data.ok && data.url) {
        document.getElementById(textInputId).value = data.url;
        tempVarSetter(data.url);
        window.PixisOverlay.showToast('✅ Imagen de fondo subida con éxito', 'success');
      } else {
        window.PixisOverlay.showToast('❌ Error al subir fondo', 'error');
      }
    } catch (e) {
      window.PixisOverlay.showToast('❌ Error de conexión', 'error');
    } finally {
      targetContainer.style.opacity = '1';
      targetContainer.style.pointerEvents = 'auto';
    }
  };

  const updateGamerBgInput = () => {
    const type = bgTypeGamer.value;
    if (type === 'solid') {
      bgValGamerContainer.innerHTML = `
        <label class="panel-label" style="font-size:11px;">Elegí el color sólido:</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:5px;">
          <input type="color" id="bgValGamer" value="${settings.backgroundValueGamer && settings.backgroundValueGamer.startsWith('#') ? settings.backgroundValueGamer : '#0b0010'}" style="width:40px;height:32px;border:none;border-radius:6px;cursor:pointer;">
          <input type="text" id="bgValGamerTxt" class="panel-input" value="${settings.backgroundValueGamer && settings.backgroundValueGamer.startsWith('#') ? settings.backgroundValueGamer : '#0b0010'}" style="flex:1;">
        </div>
      `;
      const cp = document.getElementById('bgValGamer');
      const tx = document.getElementById('bgValGamerTxt');
      cp?.addEventListener('input', (e) => { if (tx) tx.value = e.target.value; });
      tx?.addEventListener('input', (e) => { if (cp) cp.value = e.target.value; });
    } else if (type === 'image') {
      bgValGamerContainer.innerHTML = `
        <label class="panel-label" style="font-size:11px;">Subir archivo o pegar URL de imagen:</label>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <input type="file" id="bgValGamerFile" accept="image/*" class="panel-input" style="padding:4px;">
          <input type="text" id="bgValGamer" class="panel-input" placeholder="https://ejemplo.com/fondo.jpg" value="${settings.backgroundTypeGamer === 'image' ? settings.backgroundValueGamer : ''}">
        </div>
      `;
      document.getElementById('bgValGamerFile')?.addEventListener('change', function() {
        handleFileUpload(this, bgValGamerContainer, 'bgValGamer', (val) => {
          uploadedGamerFile = val;
        });
      });
    } else {
      bgValGamerContainer.innerHTML = '';
    }
  };

  const updateOficinaBgInput = () => {
    const type = bgTypeOficina.value;
    if (type === 'solid') {
      bgValOficinaContainer.innerHTML = `
        <label class="panel-label" style="font-size:11px;">Elegí el color sólido:</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:5px;">
          <input type="color" id="bgValOficina" value="${settings.backgroundValueOficina && settings.backgroundValueOficina.startsWith('#') ? settings.backgroundValueOficina : '#f4f7fb'}" style="width:40px;height:32px;border:none;border-radius:6px;cursor:pointer;">
          <input type="text" id="bgValOficinaTxt" class="panel-input" value="${settings.backgroundValueOficina && settings.backgroundValueOficina.startsWith('#') ? settings.backgroundValueOficina : '#f4f7fb'}" style="flex:1;">
        </div>
      `;
      const cp = document.getElementById('bgValOficina');
      const tx = document.getElementById('bgValOficinaTxt');
      cp?.addEventListener('input', (e) => { if (tx) tx.value = e.target.value; });
      tx?.addEventListener('input', (e) => { if (cp) cp.value = e.target.value; });
    } else if (type === 'image') {
      bgValOficinaContainer.innerHTML = `
        <label class="panel-label" style="font-size:11px;">Subir archivo o pegar URL de imagen:</label>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <input type="file" id="bgValOficinaFile" accept="image/*" class="panel-input" style="padding:4px;">
          <input type="text" id="bgValOficina" class="panel-input" placeholder="https://ejemplo.com/fondo-claro.jpg" value="${settings.backgroundTypeOficina === 'image' ? settings.backgroundValueOficina : ''}">
        </div>
      `;
      document.getElementById('bgValOficinaFile')?.addEventListener('change', function() {
        handleFileUpload(this, bgValOficinaContainer, 'bgValOficina', (val) => {
          uploadedOficinaFile = val;
        });
      });
    } else {
      bgValOficinaContainer.innerHTML = '';
    }
  };

  // Temporary variables for uploaded header images
  let uploadedHeaderGamerFile = '';
  let uploadedHeaderOficinaFile = '';

  const updateGamerHeaderBgInput = () => {
    const type = headerBgTypeGamer.value;
    if (type === 'solid') {
      headerBgValGamerContainer.innerHTML = `
        <label class="panel-label" style="font-size:11px;">Elegí el color sólido para el Header:</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:5px;">
          <input type="color" id="headerBgValGamer" value="${settings.headerBgValueGamer && settings.headerBgValueGamer.startsWith('#') ? settings.headerBgValueGamer : '#0e0016'}" style="width:40px;height:32px;border:none;border-radius:6px;cursor:pointer;">
          <input type="text" id="headerBgValGamerTxt" class="panel-input" value="${settings.headerBgValueGamer && settings.headerBgValueGamer.startsWith('#') ? settings.headerBgValueGamer : '#0e0016'}" style="flex:1;">
        </div>
      `;
      const cp = document.getElementById('headerBgValGamer');
      const tx = document.getElementById('headerBgValGamerTxt');
      cp?.addEventListener('input', (e) => { if (tx) tx.value = e.target.value; });
      tx?.addEventListener('input', (e) => { if (cp) cp.value = e.target.value; });
    } else if (type === 'image') {
      headerBgValGamerContainer.innerHTML = `
        <label class="panel-label" style="font-size:11px;">Subir archivo o pegar URL de imagen para el Header:</label>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <input type="file" id="headerBgValGamerFile" accept="image/*" class="panel-input" style="padding:4px;">
          <input type="text" id="headerBgValGamer" class="panel-input" placeholder="https://ejemplo.com/header-gamer.jpg" value="${settings.headerBgTypeGamer === 'image' ? settings.headerBgValueGamer : ''}">
        </div>
      `;
      document.getElementById('headerBgValGamerFile')?.addEventListener('change', function() {
        handleFileUpload(this, headerBgValGamerContainer, 'headerBgValGamer', (val) => {
          uploadedHeaderGamerFile = val;
        });
      });
    } else {
      headerBgValGamerContainer.innerHTML = '';
    }
  };

  const updateOficinaHeaderBgInput = () => {
    const type = headerBgTypeOficina.value;
    if (type === 'solid') {
      headerBgValOficinaContainer.innerHTML = `
        <label class="panel-label" style="font-size:11px;">Elegí el color sólido para el Header:</label>
        <div style="display:flex;align-items:center;gap:10px;margin-top:5px;">
          <input type="color" id="headerBgValOficina" value="${settings.headerBgValueOficina && settings.headerBgValueOficina.startsWith('#') ? settings.headerBgValueOficina : '#ffffff'}" style="width:40px;height:32px;border:none;border-radius:6px;cursor:pointer;">
          <input type="text" id="headerBgValOficinaTxt" class="panel-input" value="${settings.headerBgValueOficina && settings.headerBgValueOficina.startsWith('#') ? settings.headerBgValueOficina : '#ffffff'}" style="flex:1;">
        </div>
      `;
      const cp = document.getElementById('headerBgValOficina');
      const tx = document.getElementById('headerBgValOficinaTxt');
      cp?.addEventListener('input', (e) => { if (tx) tx.value = e.target.value; });
      tx?.addEventListener('input', (e) => { if (cp) cp.value = e.target.value; });
    } else if (type === 'image') {
      headerBgValOficinaContainer.innerHTML = `
        <label class="panel-label" style="font-size:11px;">Subir archivo o pegar URL de imagen para el Header:</label>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <input type="file" id="headerBgValOficinaFile" accept="image/*" class="panel-input" style="padding:4px;">
          <input type="text" id="headerBgValOficina" class="panel-input" placeholder="https://ejemplo.com/header-oficina.jpg" value="${settings.headerBgTypeOficina === 'image' ? settings.headerBgValueOficina : ''}">
        </div>
      `;
      document.getElementById('headerBgValOficinaFile')?.addEventListener('change', function() {
        handleFileUpload(this, headerBgValOficinaContainer, 'headerBgValOficina', (val) => {
          uploadedHeaderOficinaFile = val;
        });
      });
    } else {
      headerBgValOficinaContainer.innerHTML = '';
    }
  };

  bgTypeGamer?.addEventListener('change', updateGamerBgInput);
  bgTypeOficina?.addEventListener('change', updateOficinaBgInput);
  headerBgTypeGamer?.addEventListener('change', updateGamerHeaderBgInput);
  headerBgTypeOficina?.addEventListener('change', updateOficinaHeaderBgInput);

  // Inicializar inputs de header
  updateGamerHeaderBgInput();
  updateOficinaHeaderBgInput();

  const glowGamerSelect = document.getElementById('categoryGlowTypeGamer');
  const glowGamerActive = document.getElementById('categoryGlowActiveGamer');
  const glowGamerContainer = document.getElementById('categoryGlowSpeedGamerContainer');
  const glowGamerRange = document.getElementById('categoryGlowSpeedGamer');
  const glowGamerVal = document.getElementById('categoryGlowSpeedGamerVal');

  const updateGamerGlowUI = () => {
    const isOff = glowGamerSelect.value === 'off' || !glowGamerActive.checked;
    if (glowGamerContainer) {
      glowGamerContainer.style.opacity = isOff ? '0.5' : '1';
      glowGamerContainer.style.pointerEvents = isOff ? 'none' : 'auto';
    }
  };
  glowGamerSelect?.addEventListener('change', updateGamerGlowUI);
  glowGamerActive?.addEventListener('change', updateGamerGlowUI);
  glowGamerRange?.addEventListener('input', (e) => {
    if (glowGamerVal) glowGamerVal.textContent = e.target.value + 's';
  });

  const glowOficinaSelect = document.getElementById('categoryGlowTypeOficina');
  const glowOficinaActive = document.getElementById('categoryGlowActiveOficina');
  const glowOficinaContainer = document.getElementById('categoryGlowSpeedOficinaContainer');
  const glowOficinaRange = document.getElementById('categoryGlowSpeedOficina');
  const glowOficinaVal = document.getElementById('categoryGlowSpeedOficinaVal');

  const updateOficinaGlowUI = () => {
    const isOff = glowOficinaSelect.value === 'off' || !glowOficinaActive.checked;
    if (glowOficinaContainer) {
      glowOficinaContainer.style.opacity = isOff ? '0.5' : '1';
      glowOficinaContainer.style.pointerEvents = isOff ? 'none' : 'auto';
    }
  };
  glowOficinaSelect?.addEventListener('change', updateOficinaGlowUI);
  glowOficinaActive?.addEventListener('change', updateOficinaGlowUI);
  glowOficinaRange?.addEventListener('input', (e) => {
    if (glowOficinaVal) glowOficinaVal.textContent = e.target.value + 's';
  });


  updateGamerBgInput();
  updateOficinaBgInput();
  updateGamerGlowUI();
  updateOficinaGlowUI();


  document.getElementById('saveDisenoSettingsBtn')?.addEventListener('click', async () => {
    // ── Lógica de Borrado de Imagen Anterior (Gamer) ──
    const newGamerType = bgTypeGamer.value;
    const oldGamerVal = settings.backgroundValueGamer;
    const gamerEl = document.getElementById('bgValGamerTxt') || document.getElementById('bgValGamer');
    const newGamerVal = gamerEl ? gamerEl.value.trim() : '';

    if (settings.backgroundTypeGamer === 'image' && oldGamerVal && oldGamerVal.startsWith('img/uploads/') && oldGamerVal !== newGamerVal) {
      // Borrar la anterior
      await fetch('/api/remove-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: oldGamerVal })
      }).catch(() => {});
    }

    // ── Lógica de Borrado de Imagen Anterior (Oficina) ──
    const newOficinaType = bgTypeOficina.value;
    const oldOficinaVal = settings.backgroundValueOficina;
    const oficinaEl = document.getElementById('bgValOficinaTxt') || document.getElementById('bgValOficina');
    const newOficinaVal = oficinaEl ? oficinaEl.value.trim() : '';

    if (settings.backgroundTypeOficina === 'image' && oldOficinaVal && oldOficinaVal.startsWith('img/uploads/') && oldOficinaVal !== newOficinaVal) {
      // Borrar la anterior
      await fetch('/api/remove-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: oldOficinaVal })
      }).catch(() => {});
    }

    // Guardar
    settings.borderColorGamer = document.getElementById('borderGamerSelect').value;
    settings.borderColorOficina = document.getElementById('borderOficinaSelect').value;

    settings.categoryGlowTypeGamer = document.getElementById('categoryGlowTypeGamer').value;
    settings.categoryGlowActiveGamer = document.getElementById('categoryGlowActiveGamer').checked;
    settings.categoryGlowSpeedGamer = parseFloat(document.getElementById('categoryGlowSpeedGamer').value) || 1.5;
    settings.categoryGlowTypeOficina = document.getElementById('categoryGlowTypeOficina').value;
    settings.categoryGlowActiveOficina = document.getElementById('categoryGlowActiveOficina').checked;
    settings.categoryGlowSpeedOficina = parseFloat(document.getElementById('categoryGlowSpeedOficina').value) || 1.5;



    // Borrado de imagen anterior de header (Gamer)
    const newGamerHeaderType = headerBgTypeGamer.value;
    const gamerHeaderEl = document.getElementById('headerBgValGamerTxt') || document.getElementById('headerBgValGamer');
    const newGamerHeaderVal = gamerHeaderEl ? gamerHeaderEl.value.trim() : '';

    if (settings.headerBgTypeGamer === 'image' && settings.headerBgValueGamer && settings.headerBgValueGamer.startsWith('img/uploads/') && settings.headerBgValueGamer !== newGamerHeaderVal) {
      await fetch('/api/remove-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: settings.headerBgValueGamer })
      }).catch(() => {});
    }

    // Borrado de imagen anterior de header (Oficina)
    const newOficinaHeaderType = headerBgTypeOficina.value;
    const oficinaHeaderEl = document.getElementById('headerBgValOficinaTxt') || document.getElementById('headerBgValOficina');
    const newOficinaHeaderVal = oficinaHeaderEl ? oficinaHeaderEl.value.trim() : '';

    if (settings.headerBgTypeOficina === 'image' && settings.headerBgValueOficina && settings.headerBgValueOficina.startsWith('img/uploads/') && settings.headerBgValueOficina !== newOficinaHeaderVal) {
      await fetch('/api/remove-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: settings.headerBgValueOficina })
      }).catch(() => {});
    }

    settings.backgroundTypeGamer = newGamerType;
    settings.backgroundValueGamer = newGamerType !== 'default' ? newGamerVal : '';
    settings.backgroundTypeOficina = newOficinaType;
    settings.backgroundValueOficina = newOficinaType !== 'default' ? newOficinaVal : '';

    settings.headerBgTypeGamer = newGamerHeaderType;
    settings.headerBgValueGamer = newGamerHeaderType !== 'default' ? newGamerHeaderVal : '';
    settings.headerBgTypeOficina = newOficinaHeaderType;
    settings.headerBgValueOficina = newOficinaHeaderType !== 'default' ? newOficinaHeaderVal : '';

    // Guardar fuentes, tamaños y colores
    settings.gamerFontFamily = document.getElementById('gamerFontFamily').value;
    settings.gamerCardTitleColor = document.getElementById('gamerCardTitleColor').value;
    settings.gamerCardTitleSize = document.getElementById('gamerCardTitleSize').value.trim() || '18px';
    settings.gamerCardDescColor = document.getElementById('gamerCardDescColor').value;
    settings.gamerCardDescSize = document.getElementById('gamerCardDescSize').value.trim() || '14px';
    settings.gamerCardPriceColor = document.getElementById('gamerCardPriceColor').value;
    settings.gamerCardPriceSize = document.getElementById('gamerCardPriceSize').value.trim() || '20px';
    settings.gamerCardBgColor = document.getElementById('gamerCardBgColor').value;
    settings.gamerModalBgColor = document.getElementById('gamerModalBgColor').value;
    settings.gamerModalTextColor = document.getElementById('gamerModalTextColor').value;
    settings.gamerModalPriceColor = document.getElementById('gamerModalPriceColor').value;

    // Guardar textos globales gamer
    settings.gamerGlobalH1Color = document.getElementById('gamerGlobalH1Color').value;
    settings.gamerGlobalH2Color = document.getElementById('gamerGlobalH2Color').value;
    settings.gamerHeaderTopColor = document.getElementById('gamerHeaderTopColor').value;
    settings.gamerLinea1Color = document.getElementById('gamerLinea1Color').value;
    settings.gamerUbicacionColor = document.getElementById('gamerUbicacionColor').value;
    settings.gamerRedesTitleColor = document.getElementById('gamerRedesTitleColor').value;
    settings.gamerBtnVerCuotasColor = document.getElementById('gamerBtnVerCuotasColor').value;
    settings.gamerBtnVolverColor = document.getElementById('gamerBtnVolverColor').value;

    settings.gamerMenuBtnFontFamily = document.getElementById('gamerMenuBtnFontFamily').value;
    settings.gamerMenuBtnColor = document.getElementById('gamerMenuBtnColor').value;
    settings.gamerMenuBtnSize = document.getElementById('gamerMenuBtnSize').value.trim() || '14px';
    settings.gamerMenuBtnRgbEnabled = document.getElementById('gamerMenuBtnRgb').checked;
    settings.gamerMenuBtnRgbThickness = String(parseInt(document.getElementById('gamerMenuBtnRgbThickness').value) || 2);
    settings.gamerMenuBtnBorderColor = document.getElementById('gamerMenuBtnBorderColor').value;
    settings.catPanelRgbDisabled = !settings.gamerMenuBtnRgbEnabled;
    settings.catPanelRgbThickness = parseInt(settings.gamerMenuBtnRgbThickness) || 2;

    settings.gamerCatPanelBgColor = document.getElementById('gamerCatPanelBgColor').value;
    settings.gamerCatPanelTitleColor = document.getElementById('gamerCatPanelTitleColor').value;
    settings.gamerCatPanelCloseColor = document.getElementById('gamerCatPanelCloseColor').value;
    settings.gamerCatItemBgColor = document.getElementById('gamerCatItemBgColor').value;
    settings.gamerCatItemTextColor = document.getElementById('gamerCatItemTextColor').value;
    settings.gamerCatItemBorderColor = document.getElementById('gamerCatItemBorderColor').value;
    settings.gamerCatItemActiveBgColor = document.getElementById('gamerCatItemActiveBgColor').value;
    settings.gamerCatItemActiveTextColor = document.getElementById('gamerCatItemActiveTextColor').value;

    settings.oficinaFontFamily = document.getElementById('oficinaFontFamily').value;
    settings.oficinaCardTitleColor = document.getElementById('oficinaCardTitleColor').value;
    settings.oficinaCardTitleSize = document.getElementById('oficinaCardTitleSize').value.trim() || '18px';
    settings.oficinaCardDescColor = document.getElementById('oficinaCardDescColor').value;
    settings.oficinaCardDescSize = document.getElementById('oficinaCardDescSize').value.trim() || '14px';
    settings.oficinaCardPriceColor = document.getElementById('oficinaCardPriceColor').value;
    settings.oficinaCardPriceSize = document.getElementById('oficinaCardPriceSize').value.trim() || '20px';
    settings.oficinaCardBgColor = document.getElementById('oficinaCardBgColor').value;
    settings.oficinaModalBgColor = settings.oficinaCardBgColor;
    settings.oficinaProductPageBgColor = settings.oficinaCardBgColor;
    settings.oficinaModalTextColor = document.getElementById('oficinaModalTextColor').value;
    settings.oficinaModalPriceColor = document.getElementById('oficinaModalPriceColor').value;

    // Guardar textos globales oficina
    settings.oficinaGlobalH1Color = document.getElementById('oficinaGlobalH1Color').value;
    settings.oficinaGlobalH2Color = document.getElementById('oficinaGlobalH2Color').value;
    settings.oficinaHeaderTopColor = document.getElementById('oficinaHeaderTopColor').value;
    settings.oficinaLinea1Color = document.getElementById('oficinaLinea1Color').value;
    settings.oficinaUbicacionColor = document.getElementById('oficinaUbicacionColor').value;
    settings.oficinaRedesTitleColor = document.getElementById('oficinaRedesTitleColor').value;
    settings.oficinaBtnVerCuotasColor = document.getElementById('oficinaBtnVerCuotasColor').value;
    settings.oficinaBtnVolverColor = document.getElementById('oficinaBtnVolverColor').value;

    settings.oficinaMenuBtnFontFamily = document.getElementById('oficinaMenuBtnFontFamily').value;
    settings.oficinaMenuBtnColor = document.getElementById('oficinaMenuBtnColor').value;
    settings.oficinaMenuBtnSize = document.getElementById('oficinaMenuBtnSize').value.trim() || '14px';
    settings.oficinaMenuBtnRgbEnabled = document.getElementById('oficinaMenuBtnRgb').checked;
    settings.oficinaMenuBtnRgbThickness = String(parseInt(document.getElementById('oficinaMenuBtnRgbThickness').value) || 2);
    settings.oficinaMenuBtnBorderColor = document.getElementById('oficinaMenuBtnBorderColor').value;
    settings.catPanelRgbDisabled = !settings.oficinaMenuBtnRgbEnabled;
    settings.catPanelRgbThickness = parseInt(settings.oficinaMenuBtnRgbThickness) || 2;

    settings.oficinaCatPanelBgColor = document.getElementById('oficinaCatPanelBgColor').value;
    settings.oficinaCatPanelTitleColor = document.getElementById('oficinaCatPanelTitleColor').value;
    settings.oficinaCatPanelCloseColor = document.getElementById('oficinaCatPanelCloseColor').value;
    settings.oficinaCatItemBgColor = document.getElementById('oficinaCatItemBgColor').value;
    settings.oficinaCatItemTextColor = document.getElementById('oficinaCatItemTextColor').value;
    settings.oficinaCatItemBorderColor = document.getElementById('oficinaCatItemBorderColor').value;
    settings.oficinaCatItemActiveBgColor = document.getElementById('oficinaCatItemActiveBgColor').value;
    settings.oficinaCatItemActiveTextColor = document.getElementById('oficinaCatItemActiveTextColor').value;

    PixisEditor.state.unsaved = true;
    saveAllData().then(() => {
      if (window.PixisState) {
        window.PixisState.applyStateToDOM();
      }
      window.PixisOverlay.showToast('✅ Diseño aplicado correctamente', 'success', 2000);
    });
  });
}

function populateColorPresets() {
  const solidsGrid = document.getElementById('popoverGridSolids');
  const gradientsGrid = document.getElementById('popoverGridGradients');
  if (!solidsGrid || !gradientsGrid) return;
  
  solidsGrid.innerHTML = '';
  gradientsGrid.innerHTML = '';
  
  const solids = [
    // Escala de grises
    '#ffffff', '#f8f9fa', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#6c757d', '#495057', '#343a40', '#212529', '#121212', '#000000',
    // Rojos y Rosas
    '#ff0055', '#ff00aa', '#ff3366', '#ff5a79', '#ff8da1', '#ffeef2', '#ff3d71', '#d32f2f', '#c62828', '#b71c1c',
    // Naranjas y Amarillos
    '#ff5500', '#ffaa00', '#ff7700', '#ff9900', '#ffcc00', '#ffff00', '#ffea00', '#ffd600', '#fff3e0', '#ffe0b2',
    // Verdes
    '#00ff88', '#00ff00', '#2ed573', '#20bf6b', '#10b981', '#059669', '#047857', '#065f46', '#064e3b', '#e8f5e9',
    // Cyans y Celestes
    '#00ffff', '#00d4ff', '#00e5ff', '#2bcbba', '#0fb9b1', '#00a8ff', '#00aaff', '#26c6da', '#00bcd4', '#0097a7',
    // Azules
    '#0055ff', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#3f51b5', '#303f9f', '#1a237e', '#e8eaf6',
    // Violetas y Purpuras
    '#7b00ff', '#aa00ff', '#b026ff', '#d500f9', '#a55eea', '#8854d0', '#9c27b0', '#7b1fa2', '#4a148c', '#f3e5f5'
  ];
  
  const gradients = [
    // Neones & Futuristas
    'linear-gradient(45deg, #ff0055, #00d4ff)',
    'linear-gradient(45deg, #b026ff, #00e5ff)',
    'linear-gradient(45deg, #00f2fe, #4facfe)',
    'linear-gradient(45deg, #00ff87, #60efff)',
    'linear-gradient(45deg, #b026ff, #ff0055)',
    'linear-gradient(45deg, #00c6ff, #0072ff)',
    'linear-gradient(45deg, #f093fb, #f5576c)',
    'linear-gradient(45deg, #f857a6, #ff5858)',
    // Cálidos / Atardeceres
    'linear-gradient(45deg, #fa709a, #fee140)',
    'linear-gradient(45deg, #ff0844, #ffb199)',
    'linear-gradient(45deg, #ffd700, #ff8c00)',
    'linear-gradient(45deg, #f6d365, #fda085)',
    'linear-gradient(45deg, #ff9a9e, #fecfef)',
    'linear-gradient(45deg, #ff9a9e, #fecfef, #fecfef)',
    'linear-gradient(45deg, #ff758c, #ff7eb3)',
    // Naturaleza / Frescos
    'linear-gradient(45deg, #43e97b, #38f9d7)',
    'linear-gradient(135deg, #d4fc79, #96e6a1)',
    'linear-gradient(135deg, #84fab0, #8fd3f4)',
    'linear-gradient(45deg, #11998e, #38ef7d)',
    'linear-gradient(45deg, #0ba360, #3cba92)',
    // Océanos & Azules
    'linear-gradient(135deg, #a1c4fd, #c2e9fb)',
    'linear-gradient(45deg, #4facfe, #00f2fe)',
    'linear-gradient(45deg, #182848, #4b6cb7)',
    'linear-gradient(45deg, #2193b0, #6dd5ed)',
    // Magentas & Púrpuras
    'linear-gradient(135deg, #667eea, #764ba2)',
    'linear-gradient(135deg, #fccb90, #d57eeb)',
    'linear-gradient(135deg, #e0c3fc, #8ec5fc)',
    'linear-gradient(45deg, #6a11cb, #2575fc)',
    'linear-gradient(45deg, #30cfd0, #330867)',
    'linear-gradient(45deg, #ea62f7, #6600cc)',
    // Metálicos / Elegantes
    'linear-gradient(135deg, #f5f7fa, #c3cfe2)',
    'linear-gradient(135deg, #fdfbfb, #ebedee)',
    'linear-gradient(135deg, #cfd9df, #e2ebf0)',
    'linear-gradient(45deg, #e6e9f0, #eef1f5)',
    'linear-gradient(45deg, #2c3e50, #000000)',
    'linear-gradient(45deg, #141e30, #243b55)',
    // Multicolores / Arcoíris
    'linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff)',
    'linear-gradient(45deg, #ff00cc, #333399, #00ffcc)',
    'linear-gradient(45deg, #f54291, #f9f871, #00c9a7)',
    'linear-gradient(45deg, #d3cbb8, #6d6b63)',
    'linear-gradient(45deg, #89f7fe, #66a6ff)',
    'linear-gradient(45deg, #130cb7, #52e5e7)',
    'linear-gradient(45deg, #f9d423, #ff4e50)',
    'linear-gradient(45deg, #f35588, #05dfd7)',
    'linear-gradient(45deg, #96fbc4, #f9f586)',
    'linear-gradient(45deg, #f5f7fa, #b8c6db)',
    'linear-gradient(45deg, #a18cd1, #fbc2eb)',
    'linear-gradient(45deg, #30cfd0, #330867)',
    'linear-gradient(45deg, #16a085, #f4d03f)',
    'linear-gradient(45deg, #8e44ad, #f1c40f)'
  ];
  
  solids.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'popover-color-swatch';
    swatch.style.backgroundColor = color;
    swatch.title = color;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      applyColorToSelected(color, false);
    });
    solidsGrid.appendChild(swatch);
  });
  
  gradients.forEach(grad => {
    const swatch = document.createElement('div');
    swatch.className = 'popover-color-swatch';
    swatch.style.background = grad;
    swatch.title = grad;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      applyColorToSelected(grad, true);
    });
    gradientsGrid.appendChild(swatch);
  });
}

function applyColorToSelected(colorOrGradient, isGradient) {
  const el = PixisEditor.state.selectedElement;
  if (!el || el.dataset.pixisType !== 'texts') return;
  
  if (isGradient) {
    el.style.setProperty('background', colorOrGradient, 'important');
    el.style.setProperty('background-clip', 'text', 'important');
    el.style.setProperty('-webkit-background-clip', 'text', 'important');
    el.style.setProperty('webkit-text-fill-color', 'transparent', 'important');
    el.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    el.style.setProperty('display', 'inline-block', 'important');
    el.style.removeProperty('color');
  } else {
    // Remover propiedades de gradiente de forma segura
    el.style.removeProperty('background');
    el.style.removeProperty('background-clip');
    el.style.removeProperty('-webkit-background-clip');
    el.style.removeProperty('webkit-text-fill-color');
    el.style.removeProperty('-webkit-text-fill-color');
    el.style.removeProperty('display');
    
    // Aplicar color sólido con important
    el.style.setProperty('color', colorOrGradient, 'important');
  }
  
  saveElementStyles(el);
  window.PixisOverlay.showToast('🎨 Color aplicado', 'success', 1000);
}

/* ────────────────────────────────────────────────────────
   PANEL: BANNERS LATERALES Y MÓDULO DE REELS (DESKTOP PC)
──────────────────────────────────────────────────────── */
function openBannersLateralesPanel() {
  const site = PixisEditor.data.site || {};
  if (!site.lateralBanners) {
    site.lateralBanners = { enabled: false, count: 2, items: [] };
  }
  if (!site.lateralReels) {
    site.lateralReels = { enabled: false, count: 1, items: [] };
  }
  if (!site.fanpageBanners) {
    site.fanpageBanners = { enabled: false, left: { img: '', title: '', tipo: 'categoria', target: '' }, right: { img: '', title: '', tipo: 'categoria', target: '' } };
  }
  if (!site.showcaseBanners) {
    site.showcaseBanners = {
      destacados: { img: '', title: 'Destacados' },
      nuevos: { img: '', title: 'Nuevos Ingresos' },
      reels: { img: '', title: 'Pixis Reels' },
      aprende: { img: '', title: 'Aprende con Nosotros' }
    };
  }

  const latBanners = site.lateralBanners;
  const latReels = site.lateralReels;
  const fanpageBanners = site.fanpageBanners;
  const showcaseBanners = site.showcaseBanners;

  // Obtener categorías disponibles para vincular
  const cats = [];
  if (window.PixisState && window.PixisState.state && Array.isArray(window.PixisState.state.categories)) {
    window.PixisState.state.categories.forEach(c => {
      if (c && c.id) cats.push({ id: c.id, name: c.name || c.id });
    });
  }
  if (cats.length === 0) {
    document.querySelectorAll('#catalogo-completo h3.categoria').forEach(h3 => {
      if (h3.id) cats.push({ id: h3.id, name: h3.textContent.trim() || h3.id });
    });
  }

  // Obtener banners promocionales disponibles
  const promoBanners = [];
  const bData = window._bannerData || (window.PixisState?.state?.site?.banners) || {};
  Object.entries(bData).forEach(([id, b]) => {
    promoBanners.push({ id, title: b.t || id });
  });

  const getGuideText = (cnt) => {
    const c = parseInt(cnt, 10) || 2;
    switch (c) {
      case 1: return '📐 Medida recomendada: <strong>240 × 1080 px</strong> (Formato vertical completo)';
      case 2: return '📐 Medida recomendada: <strong>240 × 530 px</strong> cada uno (2 banners apilados)';
      case 3: return '📐 Medida recomendada: <strong>240 × 350 px</strong> cada uno (3 banners apilados)';
      case 4: return '📐 Medida recomendada: <strong>240 × 260 px</strong> cada uno (4 banners apilados)';
      default: return '📐 Medida recomendada: <strong>240 × 530 px</strong> cada uno';
    }
  };

  const renderBannerSlot = (idx) => {
    const item = (latBanners.items && latBanners.items[idx]) ? latBanners.items[idx] : { img: '', title: '', tipo: 'categoria', target: '' };
    const isVisible = idx < (parseInt(latBanners.count, 10) || 2);
    return `
      <div class="panel-section lat-banner-slot" id="latBannerSlot_${idx}" style="display:${isVisible ? 'block' : 'none'};background:rgba(255,255,255,0.02);border:1px solid rgba(168,85,247,0.2);padding:12px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#b0faff;font-size:12px;">🎯 Banner #${idx + 1}</strong>
          <span style="font-size:11px;color:#888;">Posición ${idx + 1}</span>
        </div>
        
        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Imagen del Banner</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" class="panel-input" id="latBannerImg_${idx}" value="${escHtml(item.img || '')}" placeholder="img/uploads/... o URL" style="flex:1;font-size:12px;">
            <label class="panel-btn" style="padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap;margin:0;">
              📁 Subir
              <input type="file" accept="image/*" class="lat-banner-file-input" data-idx="${idx}" style="display:none;">
            </label>
          </div>
        </div>

        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Título / Texto Alternativo</label>
          <input type="text" class="panel-input" id="latBannerTitle_${idx}" value="${escHtml(item.title || '')}" placeholder="Ej: Sección Herramientas" style="font-size:12px;">
        </div>

        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Acción al hacer clic</label>
          <select class="panel-select lat-banner-tipo-select" id="latBannerTipo_${idx}" data-idx="${idx}" style="font-size:12px;">
            <option value="categoria" ${item.tipo === 'categoria' ? 'selected' : ''}>📂 Vincular a Categoría del Menú</option>
            <option value="banner_promocional" ${item.tipo === 'banner_promocional' ? 'selected' : ''}>🏷️ Vincular a Banner Promocional / Colección</option>
            <option value="url" ${item.tipo === 'url' ? 'selected' : ''}>🔗 Enlace URL personalizada</option>
            <option value="none" ${item.tipo === 'none' ? 'selected' : ''}>⛔ Sin enlace (Solo informativo)</option>
          </select>
        </div>

        <!-- Opciones dinámicas de acción -->
        <div id="latBannerActionCat_${idx}" class="panel-field" style="display:${item.tipo === 'categoria' ? 'block' : 'none'};margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Elegir Categoría de Destino</label>
          <select class="panel-select" id="latBannerCat_${idx}" style="font-size:12px;">
            ${cats.map(c => `<option value="${escHtml(c.id)}" ${item.target === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
          </select>
        </div>

        <div id="latBannerActionPromo_${idx}" class="panel-field" style="display:${item.tipo === 'banner_promocional' ? 'block' : 'none'};margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Elegir Banner Promocional</label>
          <select class="panel-select" id="latBannerPromo_${idx}" style="font-size:12px;">
            ${promoBanners.length > 0 
              ? promoBanners.map(b => `<option value="${escHtml(b.id)}" ${item.target === b.id ? 'selected' : ''}>${escHtml(b.title)} (?banner=${escHtml(b.id)})</option>`).join('') 
              : '<option value="">(No hay banners promocionales creados)</option>'}
          </select>
        </div>

        <div id="latBannerActionUrl_${idx}" class="panel-field" style="display:${item.tipo === 'url' ? 'block' : 'none'};margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">URL de destino</label>
          <input type="text" class="panel-input" id="latBannerUrl_${idx}" value="${escHtml(item.target || '')}" placeholder="https://..." style="font-size:12px;">
        </div>
      </div>
    `;
  };

  const renderFanpageSide = (side, title, defaultItem) => {
    const item = defaultItem || { img: '', title: '', tipo: 'categoria', target: '' };
    return `
      <div class="panel-section" style="background:rgba(255,255,255,0.02);border:1px solid rgba(0,255,213,0.2);padding:12px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#00ffd5;font-size:12px;">${title}</strong>
          <span style="font-size:10px;color:#888;">Medida: 240 × 440 px</span>
        </div>
        
        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Imagen del Banner</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" class="panel-input" id="fanpageBannerImg_${side}" value="${escHtml(item.img || '')}" placeholder="img/uploads/... o URL" style="flex:1;font-size:12px;">
            <label class="panel-btn" style="padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap;margin:0;">
              📁 Subir
              <input type="file" accept="image/*" class="fanpage-banner-file-input" data-side="${side}" style="display:none;">
            </label>
          </div>
        </div>

        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Título / Texto Alternativo</label>
          <input type="text" class="panel-input" id="fanpageBannerTitle_${side}" value="${escHtml(item.title || '')}" placeholder="Ej: Ofertas Semanales" style="font-size:12px;">
        </div>

        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Acción al hacer clic</label>
          <select class="panel-select fanpage-banner-tipo-select" id="fanpageBannerTipo_${side}" data-side="${side}" style="font-size:12px;">
            <option value="categoria" ${item.tipo === 'categoria' ? 'selected' : ''}>📂 Vincular a Categoría del Menú</option>
            <option value="banner_promocional" ${item.tipo === 'banner_promocional' ? 'selected' : ''}>🏷️ Vincular a Banner Promocional / Colección</option>
            <option value="url" ${item.tipo === 'url' ? 'selected' : ''}>🔗 Enlace URL personalizada</option>
            <option value="none" ${item.tipo === 'none' ? 'selected' : ''}>⛔ Sin enlace (Solo informativo)</option>
          </select>
        </div>

        <div id="fanpageBannerActionCat_${side}" class="panel-field" style="display:${item.tipo === 'categoria' ? 'block' : 'none'};margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Elegir Categoría de Destino</label>
          <select class="panel-select" id="fanpageBannerCat_${side}" style="font-size:12px;">
            ${cats.map(c => `<option value="${escHtml(c.id)}" ${item.target === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}
          </select>
        </div>

        <div id="fanpageBannerActionPromo_${side}" class="panel-field" style="display:${item.tipo === 'banner_promocional' ? 'block' : 'none'};margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Elegir Banner Promocional</label>
          <select class="panel-select" id="fanpageBannerPromo_${side}" style="font-size:12px;">
            ${promoBanners.length > 0 
              ? promoBanners.map(b => `<option value="${escHtml(b.id)}" ${item.target === b.id ? 'selected' : ''}>${escHtml(b.title)} (?banner=${escHtml(b.id)})</option>`).join('') 
              : '<option value="">(No hay banners promocionales creados)</option>'}
          </select>
        </div>

        <div id="fanpageBannerActionUrl_${side}" class="panel-field" style="display:${item.tipo === 'url' ? 'block' : 'none'};margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">URL de destino</label>
          <input type="text" class="panel-input" id="fanpageBannerUrl_${side}" value="${escHtml(item.target || '')}" placeholder="https://..." style="font-size:12px;">
        </div>
      </div>
    `;
  };

  const renderReelSlot = (idx) => {
    const item = (latReels.items && latReels.items[idx]) ? latReels.items[idx] : { title: '', platform: 'youtube', url: '' };
    const isVisible = idx < (parseInt(latReels.count, 10) || 1);
    return `
      <div class="panel-section lat-reel-slot" id="latReelSlot_${idx}" style="display:${isVisible ? 'block' : 'none'};background:rgba(255,255,255,0.02);border:1px solid rgba(0,255,213,0.2);padding:12px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#00ffd5;font-size:12px;">🎬 Reel / Video #${idx + 1}</strong>
          <span style="font-size:11px;color:#888;">Posición ${idx + 1}</span>
        </div>

        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Título del Video / Producto</label>
          <input type="text" class="panel-input" id="latReelTitle_${idx}" value="${escHtml(item.title || '')}" placeholder="Ej: Teclado Mecánico RGB Review" style="font-size:12px;">
        </div>

        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Plataforma</label>
          <select class="panel-select" id="latReelPlatform_${idx}" style="font-size:12px;">
            <option value="youtube" ${item.platform === 'youtube' ? 'selected' : ''}>🔴 YouTube Shorts / Video</option>
            <option value="instagram" ${item.platform === 'instagram' ? 'selected' : ''}>📸 Instagram Reel</option>
            <option value="tiktok" ${item.platform === 'tiktok' ? 'selected' : ''}>🎵 TikTok Video</option>
            <option value="facebook" ${item.platform === 'facebook' ? 'selected' : ''}>🔵 Facebook Reel</option>
            <option value="mp4" ${item.platform === 'mp4' ? 'selected' : ''}>🎥 Video Directo MP4 / WebM</option>
          </select>
        </div>

        <div class="panel-field" style="margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Enlace / URL del Video</label>
          <input type="text" class="panel-input" id="latReelUrl_${idx}" value="${escHtml(item.url || '')}" placeholder="Pegá el link del Reel / Short aquí" style="font-size:12px;">
        </div>
      </div>
    `;
  };

  const html = `
    <div class="panel-tabs" style="margin-bottom:15px;display:flex;gap:6px;">
      <button class="panel-tab active" id="tabBtnShowcaseBanners" style="flex:1;padding:8px 4px;font-size:11px;font-weight:bold;">🔥 Banners Showcase</button>
      <button class="panel-tab" id="tabBtnFanpageBanners" style="flex:1;padding:8px 4px;font-size:11px;font-weight:bold;">🎯 Portada / Nuevos</button>
      <button class="panel-tab" id="tabBtnLatBanners" style="flex:1;padding:8px 4px;font-size:11px;font-weight:bold;">📂 Banners Catálogo</button>
      <button class="panel-tab" id="tabBtnLatReels" style="flex:1;padding:8px 4px;font-size:11px;font-weight:bold;">🎬 Reels / Videos</button>
    </div>

    <!-- TAB 0: BANNERS SHOWCASE (DESTACADOS Y NUEVOS INGRESOS) -->
    <div id="tabShowcaseBannersContent">
      <div style="background:rgba(255, 75, 43, 0.1);border:1px dashed #ff4b2b;border-radius:6px;padding:10px;margin-bottom:14px;color:#ff8a73;font-size:11px;line-height:1.5;">
        📐 <strong>Medida quirúrgica recomendada:</strong> <strong>260 × 900 px</strong> (o <strong>520 × 1800 px @2x</strong> para máxima nitidez HD).<br>
        💡 Estos banners acompañan a la grilla de 10 productos (2 filas de 5). Al cliquearlos en la web, llevan directamente al catálogo completo de su colección.
      </div>

      <!-- BANNER DESTACADOS -->
      <div class="panel-section" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,75,43,0.3);padding:12px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#ff4b2b;font-size:12px;">🔥 Banner Lateral Showcase — DESTACADOS</strong>
          <span style="font-size:10px;color:#888;">Medida: 260 × 900 px</span>
        </div>
        
        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Imagen del Banner</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" class="panel-input" id="showcaseBannerImg_destacados" value="${escHtml(showcaseBanners.destacados?.img || '')}" placeholder="img/uploads/... o URL" style="flex:1;font-size:12px;">
            <label class="panel-btn" style="padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap;margin:0;">
              📁 Subir
              <input type="file" accept="image/*" class="showcase-banner-file-input" data-type="destacados" style="display:none;">
            </label>
          </div>
        </div>

        <div class="panel-field" style="margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Título / Texto Alternativo</label>
          <input type="text" class="panel-input" id="showcaseBannerTitle_destacados" value="${escHtml(showcaseBanners.destacados?.title || 'Destacados')}" placeholder="Ej: Top Ventas Pixis" style="font-size:12px;">
        </div>
      </div>

      <!-- BANNER NUEVOS INGRESOS -->
      <div class="panel-section" style="background:rgba(255,255,255,0.02);border:1px solid rgba(254,81,150,0.3);padding:12px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#fe5196;font-size:12px;">✨ Banner Lateral Showcase — NUEVOS INGRESOS</strong>
          <span style="font-size:10px;color:#888;">Medida: 260 × 900 px</span>
        </div>
        
        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Imagen del Banner</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" class="panel-input" id="showcaseBannerImg_nuevos" value="${escHtml(showcaseBanners.nuevos?.img || '')}" placeholder="img/uploads/... o URL" style="flex:1;font-size:12px;">
            <label class="panel-btn" style="padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap;margin:0;">
              📁 Subir
              <input type="file" accept="image/*" class="showcase-banner-file-input" data-type="nuevos" style="display:none;">
            </label>
          </div>
        </div>

        <div class="panel-field" style="margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Título / Texto Alternativo</label>
          <input type="text" class="panel-input" id="showcaseBannerTitle_nuevos" value="${escHtml(showcaseBanners.nuevos?.title || 'Nuevos Ingresos')}" placeholder="Ej: Novedades Tecnológicas" style="font-size:12px;">
        </div>
      </div>

      <!-- BANNER REELS -->
      <div class="panel-section" style="background:rgba(255,255,255,0.02);border:1px solid rgba(216,70,239,0.3);padding:12px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#f0abfc;font-size:12px;">⚡ Banner Lateral Showcase — PIXIS REELS</strong>
          <span style="font-size:10px;color:#888;">Medida: 260 × 900 px</span>
        </div>
        
        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Imagen del Banner</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" class="panel-input" id="showcaseBannerImg_reels" value="${escHtml(showcaseBanners.reels?.img || '')}" placeholder="img/uploads/... o URL" style="flex:1;font-size:12px;">
            <label class="panel-btn" style="padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap;margin:0;">
              📁 Subir
              <input type="file" accept="image/*" class="showcase-banner-file-input" data-type="reels" style="display:none;">
            </label>
          </div>
        </div>

        <div class="panel-field" style="margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Título / Texto Alternativo</label>
          <input type="text" class="panel-input" id="showcaseBannerTitle_reels" value="${escHtml(showcaseBanners.reels?.title || 'Pixis Reels')}" placeholder="Ej: Shorts y Reviews" style="font-size:12px;">
        </div>
      </div>

      <!-- BANNER APRENDE CON NOSOTROS -->
      <div class="panel-section" style="background:rgba(255,255,255,0.02);border:1px solid rgba(0,255,213,0.3);padding:12px;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#67e8f9;font-size:12px;">🎓 Banner Lateral Showcase — APRENDE CON NOSOTROS</strong>
          <span style="font-size:10px;color:#888;">Medida: 260 × 900 px</span>
        </div>
        
        <div class="panel-field" style="margin-bottom:8px;">
          <label class="panel-label" style="font-size:11px;">Imagen del Banner</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" class="panel-input" id="showcaseBannerImg_aprende" value="${escHtml(showcaseBanners.aprende?.img || '')}" placeholder="img/uploads/... o URL" style="flex:1;font-size:12px;">
            <label class="panel-btn" style="padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap;margin:0;">
              📁 Subir
              <input type="file" accept="image/*" class="showcase-banner-file-input" data-type="aprende" style="display:none;">
            </label>
          </div>
        </div>

        <div class="panel-field" style="margin-bottom:4px;">
          <label class="panel-label" style="font-size:11px;">Título / Texto Alternativo</label>
          <input type="text" class="panel-input" id="showcaseBannerTitle_aprende" value="${escHtml(showcaseBanners.aprende?.title || 'Aprende con Nosotros')}" placeholder="Ej: Pixis Academy" style="font-size:12px;">
        </div>
      </div>
    </div>

    <!-- TAB 1: PORTADA / NUEVOS INGRESOS (IMAGEN 2) -->
    <div id="tabFanpageBannersContent" style="display:none;">
      <div class="panel-section" style="background:rgba(0,255,213,0.08);border-left:4px solid #00ffd5;padding:10px;border-radius:6px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <label for="fanpageBannersEnabled" style="font-weight:bold;color:#fff;font-size:12px;cursor:pointer;">
            🎯 Activar Banners en Nuevos Ingresos (Desktop)
          </label>
          <input type="checkbox" id="fanpageBannersEnabled" ${fanpageBanners.enabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:#00ffd5;cursor:pointer;">
        </div>
      </div>

      <div style="background:rgba(0,255,213,0.1);border:1px dashed #00ffd5;border-radius:6px;padding:8px 10px;margin-bottom:12px;color:#00ffd5;font-size:11px;line-height:1.4;">
        📐 <strong>Medida recomendada:</strong> 240 × 440 px cada uno (Altura fija alineada al carrusel central).
      </div>

      ${renderFanpageSide('left', '🎯 Banner Lateral Izquierdo', fanpageBanners.left)}
      ${renderFanpageSide('right', '🎯 Banner Lateral Derecho', fanpageBanners.right)}
    </div>

    <!-- TAB 2: BANNERS LATERALES (CATÁLOGO) -->
    <div id="tabLatBannersContent" style="display:none;">
      <div class="panel-section" style="background:rgba(168,85,247,0.08);border-left:4px solid #a855f7;padding:10px;border-radius:6px;margin-bottom:15px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <label for="latBannersEnabled" style="font-weight:bold;color:#fff;font-size:13px;cursor:pointer;">
            🎯 Activar Banners Laterales (Catálogo)
          </label>
          <input type="checkbox" id="latBannersEnabled" ${latBanners.enabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:#a855f7;cursor:pointer;">
        </div>
      </div>

      <div class="panel-field" style="margin-bottom:12px;">
        <label class="panel-label" style="font-size:12px;"><strong>Cantidad de Banners a Mostrar:</strong></label>
        <select class="panel-select" id="latBannersCount" style="font-size:13px;font-weight:bold;">
          <option value="1" ${parseInt(latBanners.count, 10) === 1 ? 'selected' : ''}>1 Banner (Vertical completo)</option>
          <option value="2" ${parseInt(latBanners.count, 10) === 2 || !latBanners.count ? 'selected' : ''}>2 Banners (Recomendado)</option>
          <option value="3" ${parseInt(latBanners.count, 10) === 3 ? 'selected' : ''}>3 Banners</option>
          <option value="4" ${parseInt(latBanners.count, 10) === 4 ? 'selected' : ''}>4 Banners</option>
        </select>
      </div>

      <!-- GUÍA DINÁMICA DE MEDIDAS -->
      <div id="latBannersGuide" style="background:rgba(168,85,247,0.1);border:1px dashed #a855f7;border-radius:6px;padding:10px;margin-bottom:15px;color:#d8b4fe;font-size:12px;line-height:1.4;">
        ${getGuideText(latBanners.count || 2)}
      </div>

      <div id="latBannersSlotsContainer">
        ${[0, 1, 2, 3].map(i => renderBannerSlot(i)).join('')}
      </div>
    </div>

    <!-- TAB 3: REELS & VIDEOS (DERECHA) -->
    <div id="tabLatReelsContent" style="display:none;">
      <div class="panel-section" style="background:rgba(0,255,213,0.08);border-left:4px solid #00ffd5;padding:10px;border-radius:6px;margin-bottom:15px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <label for="latReelsEnabled" style="font-weight:bold;color:#fff;font-size:13px;cursor:pointer;">
            🎬 Activar Módulo de Reels (Derecha)
          </label>
          <input type="checkbox" id="latReelsEnabled" ${latReels.enabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:#00ffd5;cursor:pointer;">
        </div>
      </div>

      <div class="panel-field" style="margin-bottom:12px;">
        <label class="panel-label" style="font-size:12px;"><strong>Cantidad de Videos a Mostrar:</strong></label>
        <select class="panel-select" id="latReelsCount" style="font-size:13px;font-weight:bold;">
          <option value="1" ${parseInt(latReels.count, 10) === 1 || !latReels.count ? 'selected' : ''}>1 Video Reel</option>
          <option value="2" ${parseInt(latReels.count, 10) === 2 ? 'selected' : ''}>2 Videos Reels</option>
          <option value="3" ${parseInt(latReels.count, 10) === 3 ? 'selected' : ''}>3 Videos Reels</option>
        </select>
      </div>

      <div style="font-size:11px;color:#888;margin-bottom:15px;line-height:1.4;">
        💡 Los videos se muestran en formato vertical 9:16 al costado derecho del catálogo.
      </div>

      <div id="latReelsSlotsContainer">
        ${[0, 1, 2].map(i => renderReelSlot(i)).join('')}
      </div>
    </div>

    <div style="margin-top:20px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.1);">
      <button class="panel-btn panel-btn-primary" id="saveBannersLateralesBtn" style="width:100%;padding:10px;font-size:13px;font-weight:bold;background:linear-gradient(135deg, #a855f7, #00ffd5);color:#000;">
        💾 Guardar Banners y Reels
      </button>
    </div>
  `;

  window.PixisOverlay.openPanel('🎯 Banners Laterales & Reels', html);

  // Tab switching (4 pestañas)
  const tabBtnShowcase = document.getElementById('tabBtnShowcaseBanners');
  const tabBtnFanpage = document.getElementById('tabBtnFanpageBanners');
  const tabBtnBanners = document.getElementById('tabBtnLatBanners');
  const tabBtnReels = document.getElementById('tabBtnLatReels');
  const tabContentShowcase = document.getElementById('tabShowcaseBannersContent');
  const tabContentFanpage = document.getElementById('tabFanpageBannersContent');
  const tabContentBanners = document.getElementById('tabLatBannersContent');
  const tabContentReels = document.getElementById('tabLatReelsContent');

  const switchTab = (activeBtn, activeContent) => {
    [tabBtnShowcase, tabBtnFanpage, tabBtnBanners, tabBtnReels].forEach(b => b?.classList.remove('active'));
    [tabContentShowcase, tabContentFanpage, tabContentBanners, tabContentReels].forEach(c => { if (c) c.style.display = 'none'; });
    activeBtn?.classList.add('active');
    if (activeContent) activeContent.style.display = 'block';
  };

  tabBtnShowcase?.addEventListener('click', () => switchTab(tabBtnShowcase, tabContentShowcase));
  tabBtnFanpage?.addEventListener('click', () => switchTab(tabBtnFanpage, tabContentFanpage));
  tabBtnBanners?.addEventListener('click', () => switchTab(tabBtnBanners, tabContentBanners));
  tabBtnReels?.addEventListener('click', () => switchTab(tabBtnReels, tabContentReels));

  // Dynamic measure guide & slot toggle on count change
  const countSelect = document.getElementById('latBannersCount');
  const guideEl = document.getElementById('latBannersGuide');
  countSelect?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10) || 2;
    if (guideEl) guideEl.innerHTML = getGuideText(val);
    for (let i = 0; i < 4; i++) {
      const slot = document.getElementById(`latBannerSlot_${i}`);
      if (slot) slot.style.display = i < val ? 'block' : 'none';
    }
  });

  // Reels slot toggle on count change
  const reelsCountSelect = document.getElementById('latReelsCount');
  reelsCountSelect?.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10) || 1;
    for (let i = 0; i < 3; i++) {
      const slot = document.getElementById(`latReelSlot_${i}`);
      if (slot) slot.style.display = i < val ? 'block' : 'none';
    }
  });

  // Dynamic action selector toggles (Catálogo)
  document.querySelectorAll('.lat-banner-tipo-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = e.target.dataset.idx;
      const tipo = e.target.value;
      const catBox = document.getElementById(`latBannerActionCat_${idx}`);
      const promoBox = document.getElementById(`latBannerActionPromo_${idx}`);
      const urlBox = document.getElementById(`latBannerActionUrl_${idx}`);

      if (catBox) catBox.style.display = tipo === 'categoria' ? 'block' : 'none';
      if (promoBox) promoBox.style.display = tipo === 'banner_promocional' ? 'block' : 'none';
      if (urlBox) urlBox.style.display = tipo === 'url' ? 'block' : 'none';
    });
  });

  // Dynamic action selector toggles (Fanpage)
  document.querySelectorAll('.fanpage-banner-tipo-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const side = e.target.dataset.side;
      const tipo = e.target.value;
      const catBox = document.getElementById(`fanpageBannerActionCat_${side}`);
      const promoBox = document.getElementById(`fanpageBannerActionPromo_${side}`);
      const urlBox = document.getElementById(`fanpageBannerActionUrl_${side}`);

      if (catBox) catBox.style.display = tipo === 'categoria' ? 'block' : 'none';
      if (promoBox) promoBox.style.display = tipo === 'banner_promocional' ? 'block' : 'none';
      if (urlBox) urlBox.style.display = tipo === 'url' ? 'block' : 'none';
    });
  });

  // Image file uploads (Catálogo)
  document.querySelectorAll('.lat-banner-file-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const idx = e.target.dataset.idx;
      const textInput = document.getElementById(`latBannerImg_${idx}`);
      window.PixisOverlay.showToast('Subiendo banner lateral en calidad original...', 'info');

      try {
        const filename = `latbanner_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const res = await fetch(`/api/upload-image?filename=${filename}&folder=img/uploads`, {
          method: 'POST',
          body: file
        });
        const data = await res.json();
        if (data.ok && data.url) {
          if (textInput) textInput.value = data.url;
          window.PixisOverlay.showToast(`✅ Imagen de Banner #${parseInt(idx, 10) + 1} subida`, 'success');
        } else {
          window.PixisOverlay.showToast('❌ Error al subir imagen', 'error');
        }
      } catch (err) {
        window.PixisOverlay.showToast('❌ Error de conexión al subir imagen', 'error');
      }
    });
  });

  // Image file uploads (Fanpage)
  document.querySelectorAll('.fanpage-banner-file-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const side = e.target.dataset.side;
      const textInput = document.getElementById(`fanpageBannerImg_${side}`);
      window.PixisOverlay.showToast('Subiendo banner de Nuevos Ingresos...', 'info');

      try {
        const filename = `fanpage_lat_${side}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const res = await fetch(`/api/upload-image?filename=${filename}&folder=img/uploads`, {
          method: 'POST',
          body: file
        });
        const data = await res.json();
        if (data.ok && data.url) {
          if (textInput) textInput.value = data.url;
          window.PixisOverlay.showToast(`✅ Banner Lateral ${side === 'left' ? 'Izquierdo' : 'Derecho'} subido`, 'success');
        } else {
          window.PixisOverlay.showToast('❌ Error al subir imagen', 'error');
        }
      } catch (err) {
        window.PixisOverlay.showToast('❌ Error de conexión al subir imagen', 'error');
      }
    });
  });

  // Image file uploads (Showcase Banners: Destacados y Nuevos)
  document.querySelectorAll('.showcase-banner-file-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const type = e.target.dataset.type;
      const textInput = document.getElementById(`showcaseBannerImg_${type}`);
      window.PixisOverlay.showToast(`Subiendo banner showcase (${type})...`, 'info');

      try {
        const filename = `showcase_${type}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const res = await fetch(`/api/upload-image?filename=${filename}&folder=img/uploads`, {
          method: 'POST',
          body: file
        });
        const data = await res.json();
        if (data.ok && data.url) {
          if (textInput) textInput.value = data.url;
          window.PixisOverlay.showToast(`✅ Banner Showcase (${type}) subido con éxito`, 'success');
        } else {
          window.PixisOverlay.showToast('❌ Error al subir imagen', 'error');
        }
      } catch (err) {
        window.PixisOverlay.showToast('❌ Error de conexión al subir imagen', 'error');
      }
    });
  });

  // Save handler
  document.getElementById('saveBannersLateralesBtn')?.addEventListener('click', async () => {
    // 0. Showcase Banners (Destacados, Nuevos Ingresos, Reels y Aprende)
    const newShowcaseBanners = {
      destacados: {
        img: document.getElementById('showcaseBannerImg_destacados')?.value.trim() || '',
        title: document.getElementById('showcaseBannerTitle_destacados')?.value.trim() || 'Destacados'
      },
      nuevos: {
        img: document.getElementById('showcaseBannerImg_nuevos')?.value.trim() || '',
        title: document.getElementById('showcaseBannerTitle_nuevos')?.value.trim() || 'Nuevos Ingresos'
      },
      reels: {
        img: document.getElementById('showcaseBannerImg_reels')?.value.trim() || '',
        title: document.getElementById('showcaseBannerTitle_reels')?.value.trim() || 'Pixis Reels'
      },
      aprende: {
        img: document.getElementById('showcaseBannerImg_aprende')?.value.trim() || '',
        title: document.getElementById('showcaseBannerTitle_aprende')?.value.trim() || 'Aprende con Nosotros'
      }
    };

    // 1. Catálogo Banners
    const bannersEnabled = Boolean(document.getElementById('latBannersEnabled')?.checked);
    const bannersCount = parseInt(document.getElementById('latBannersCount')?.value, 10) || 2;
    const bannerItems = [];

    for (let i = 0; i < bannersCount; i++) {
      const img = document.getElementById(`latBannerImg_${i}`)?.value.trim() || '';
      const title = document.getElementById(`latBannerTitle_${i}`)?.value.trim() || '';
      const tipo = document.getElementById(`latBannerTipo_${i}`)?.value || 'categoria';
      let target = '';

      if (tipo === 'categoria') {
        target = document.getElementById(`latBannerCat_${i}`)?.value || '';
      } else if (tipo === 'banner_promocional') {
        target = document.getElementById(`latBannerPromo_${i}`)?.value || '';
      } else if (tipo === 'url') {
        target = document.getElementById(`latBannerUrl_${i}`)?.value.trim() || '';
      }

      bannerItems.push({ img, title, tipo, target });
    }

    // 2. Catálogo Reels
    const reelsEnabled = Boolean(document.getElementById('latReelsEnabled')?.checked);
    const reelsCount = parseInt(document.getElementById('latReelsCount')?.value, 10) || 1;
    const reelItems = [];

    for (let i = 0; i < reelsCount; i++) {
      const title = document.getElementById(`latReelTitle_${i}`)?.value.trim() || '';
      const platform = document.getElementById(`latReelPlatform_${i}`)?.value || 'youtube';
      const url = document.getElementById(`latReelUrl_${i}`)?.value.trim() || '';
      reelItems.push({ title, platform, url });
    }

    // 3. Fanpage / Nuevos Ingresos Banners
    const fanpageEnabled = Boolean(document.getElementById('fanpageBannersEnabled')?.checked);
    const getSideData = (side) => {
      const img = document.getElementById(`fanpageBannerImg_${side}`)?.value.trim() || '';
      const title = document.getElementById(`fanpageBannerTitle_${side}`)?.value.trim() || '';
      const tipo = document.getElementById(`fanpageBannerTipo_${side}`)?.value || 'categoria';
      let target = '';
      if (tipo === 'categoria') {
        target = document.getElementById(`fanpageBannerCat_${side}`)?.value || '';
      } else if (tipo === 'banner_promocional') {
        target = document.getElementById(`fanpageBannerPromo_${side}`)?.value || '';
      } else if (tipo === 'url') {
        target = document.getElementById(`fanpageBannerUrl_${side}`)?.value.trim() || '';
      }
      return { img, title, tipo, target };
    };

    const newFanpageBanners = {
      enabled: fanpageEnabled,
      left: getSideData('left'),
      right: getSideData('right')
    };

    // Autolimpieza segura Set-Difference de imágenes reemplazadas/borradas
    const oldLatItems = site.lateralBanners?.items || [];
    const oldFanpageItems = [site.fanpageBanners?.left, site.fanpageBanners?.right].filter(Boolean);
    const oldAll = [...oldLatItems, ...oldFanpageItems];
    const newAll = [...bannerItems, newFanpageBanners.left, newFanpageBanners.right];

    if (window.PixisEditorAPI && window.PixisEditorAPI._safeCleanupImages) {
      window.PixisEditorAPI._safeCleanupImages(oldAll, newAll, 'laterals');
    }

    // Actualizar datos del editor y de PixisState
    PixisEditor.data.site.showcaseBanners = newShowcaseBanners;
    PixisEditor.data.site.lateralBanners = {
      enabled: bannersEnabled,
      count: bannersCount,
      items: bannerItems
    };

    PixisEditor.data.site.lateralReels = {
      enabled: reelsEnabled,
      count: reelsCount,
      items: reelItems
    };

    PixisEditor.data.site.fanpageBanners = newFanpageBanners;

    if (window.PixisState && window.PixisState.state && window.PixisState.state.site) {
      window.PixisState.state.site.showcaseBanners = newShowcaseBanners;
      window.PixisState.state.site.lateralBanners = PixisEditor.data.site.lateralBanners;
      window.PixisState.state.site.lateralReels = PixisEditor.data.site.lateralReels;
      window.PixisState.state.site.fanpageBanners = PixisEditor.data.site.fanpageBanners;
    }

    // Actualización inmediata en el DOM del Showcase
    const destBanner = document.getElementById('showcaseBannerDestacados');
    if (destBanner) {
      if (newShowcaseBanners.destacados.img) {
        destBanner.classList.add('has-custom-img');
        destBanner.innerHTML = `<img src="${newShowcaseBanners.destacados.img}" alt="${newShowcaseBanners.destacados.title}" class="showcase-custom-banner-img">`;
      } else {
        destBanner.classList.remove('has-custom-img');
      }
    }
    const nuevosBanner = document.getElementById('showcaseBannerNuevos');
    if (nuevosBanner) {
      if (newShowcaseBanners.nuevos.img) {
        nuevosBanner.classList.add('has-custom-img');
        nuevosBanner.innerHTML = `<img src="${newShowcaseBanners.nuevos.img}" alt="${newShowcaseBanners.nuevos.title}" class="showcase-custom-banner-img">`;
      } else {
        nuevosBanner.classList.remove('has-custom-img');
      }
    }
    const reelsBanner = document.getElementById('showcaseBannerReels');
    if (reelsBanner) {
      if (newShowcaseBanners.reels.img) {
        reelsBanner.classList.add('has-custom-img');
        reelsBanner.innerHTML = `<img src="${newShowcaseBanners.reels.img}" alt="${newShowcaseBanners.reels.title}" class="showcase-custom-banner-img">`;
      } else {
        reelsBanner.classList.remove('has-custom-img');
      }
    }
    const aprendeBanner = document.getElementById('showcaseBannerAprende');
    if (aprendeBanner) {
      if (newShowcaseBanners.aprende.img) {
        aprendeBanner.classList.add('has-custom-img');
        aprendeBanner.innerHTML = `<img src="${newShowcaseBanners.aprende.img}" alt="${newShowcaseBanners.aprende.title}" class="showcase-custom-banner-img">`;
      } else {
        aprendeBanner.classList.remove('has-custom-img');
      }
    }

    window.PixisOverlay.markUnsaved();
    if (typeof saveAllData === 'function') {
      await saveAllData();
    }

    if (typeof window.renderLateralBannersAndReels === 'function') {
      window.renderLateralBannersAndReels();
    }
    if (typeof window.renderFanpageLaterals === 'function') {
      window.renderFanpageLaterals();
    }

    window.PixisOverlay.showToast('✅ Banners y Reels guardados con éxito', 'success');
  });
}
