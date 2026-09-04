function onPixisDOMReady(cb) {
  if (document.readyState !== 'loading') {
    cb();
  } else {
    document.addEventListener('DOMContentLoaded', cb);
  }
}

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   PIXIS STATE — js/state.js                                  ║
 * ║   Single Source of Truth: JSON → DOM                         ║
 * ║   TODO cambio pasa por PixisState.updateState()              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

window.PixisState = {
  state: {
    site: {},
    products: [],
    categories: [],
    ui: {}
  },
  history: [],
  maxHistory: 50,

  /* ─── OPTIMIZACIÓN DE IMÁGENES ───────────────────────────── */
  optimizeImageUrl(url, width) {
    const config = this.state.site?.imageOptimization;
    if (!config || !config.enabled) return url;
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;

    // EXCEPCIÓN: No optimizar banners ni imágenes del carrusel para mantener máxima nitidez
    const isBanner = url.toLowerCase().includes('carrusel') ||
      url.toLowerCase().includes('banner') ||
      url.toLowerCase().includes('img/des/');
    if (isBanner) return url;

    // Evitar optimizar en localhost o entornos locales (el proxy no puede acceder a estos archivos)
    if (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.')) {
      return url;
    }

    // Si ya está optimizada, no re-procesar
    if (url.includes('images.weserv.nl')) return url;

    // Asegurar que la URL sea absoluta para que el proxy pueda descargar la imagen
    let absoluteUrl = url;
    try {
      if (!url.startsWith('http') && !url.startsWith('//')) {
        absoluteUrl = new URL(url, window.location.origin + window.location.pathname).href;
      }
    } catch (e) {
      return url;
    }

    const proxy = config.proxyUrl || 'https://images.weserv.nl/?url=';
    let optUrl = `${proxy}${encodeURIComponent(absoluteUrl)}&output=webp`;
    if (width) optUrl += `&w=${width}`;
    return optUrl;
  },

  /* ─── CARGA ──────────────────────────────────────────────── */
  async loadState() {
    const nocache = { cache: 'no-store', headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' } };
    const ts = Date.now();
    const [site, products, categories, ui] = await Promise.all([
      fetch('/data/site.json?_=' + ts, nocache).then(r => r.json()).catch(() => ({})),
      fetch('/data/products.json?_=' + ts, nocache).then(r => r.json()).catch(() => ([])),
      fetch('/data/categories.json?_=' + ts, nocache).then(r => r.json()).catch(() => ([])),
      fetch('/data/ui.json?_=' + ts, nocache).then(r => r.json()).catch(() => ({}))
    ]);
    this.state = { site, products, categories, ui };

    // Asegurar que existan las estructuras básicas
    if (!this.state.site.carouselTop) this.state.site.carouselTop = this.state.site.carousel || [];
    if (!this.state.site.carouselBottom) this.state.site.carouselBottom = [];

    console.log('[PixisState] Estado cargado ✓', {
      products: products.length,
      categories: categories.length,
      uiKeys: Object.keys(ui)
    });
  },

  /* ─── GUARDADO ATÓMICO ───────────────────────────────────── */
  async saveState() {
    // Incrementar cacheVersion para forzar recarga de scripts en navegadores
    if (this.state.site && typeof this.state.site.cacheVersion === 'number') {
      this.state.site.cacheVersion += 1;
    } else if (this.state.site) {
      this.state.site.cacheVersion = (this.state.site.cacheVersion || 0) + 1;
    }

    const files = [
      { name: 'site.json', data: this.state.site },
      { name: 'products.json', data: this.state.products },
      { name: 'categories.json', data: this.state.categories },
      { name: 'ui.json', data: this.state.ui }
    ];

    const results = await Promise.allSettled(
      files.map(({ name, data }) => {
        const jsonString = JSON.stringify(data, null, 2);
        const base64Payload = btoa(unescape(encodeURIComponent(jsonString)));

        return fetch(`/api/sync?file=data/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ payload: base64Payload })
        }).then(async r => {
          const text = await r.text();
          let responseData;
          try { responseData = JSON.parse(text); } catch(e){}

          if (!r.ok || !responseData || responseData.ok === false) {
            const errMsg = (responseData && responseData.error) || r.statusText || 'Error de red o firewall';
            console.error(`[PixisState] Error guardando ${name}:`, errMsg);
            window.PixisOverlay?.showToast?.(`Error al guardar ${name}: ${errMsg}`, 'danger', 10000);
            return false;
          }
          return true;
        });
      })
    );

    const allOk = results.every(r => r.status === 'fulfilled' && r.value);
    if (!allOk) {
      console.warn('[PixisState] Algunos archivos no se guardaron. site-version.json NO se actualiza.');
    }

    // Actualizar site-version.json SOLO si TODOS los archivos principales se guardaron
    if (allOk) try {
      const ver = (this.state.site && this.state.site.cacheVersion) || Date.now();
      const versionString = JSON.stringify({ v: String(ver), ts: Date.now() });
      const versionBase64 = btoa(unescape(encodeURIComponent(versionString)));

      await fetch('/api/sync?file=data/site-version.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ payload: versionBase64 })
      });
    } catch (e) { /* silenciar si no hay servidor */ }

    return allOk;
  },


  /* ─── ACTUALIZACIÓN PRINCIPAL ────────────────────────────── */
  async updateState(change) {
    this.pushHistory();
    this.applyChange(change);
    const saved = await this.saveState();
    this.applyStateToDOM();
    return saved;
  },

  pushHistory() {
    this.history.push(JSON.parse(JSON.stringify(this.state)));
    if (this.history.length > this.maxHistory) this.history.shift();
    if (window.PixisOverlay?.updateUndoButton) window.PixisOverlay.updateUndoButton(true);
  },

  async undo() {
    if (this.history.length === 0) return false;
    const prevState = this.history.pop();

    // Actualizamos el contenido manteniendo la referencia para que PixisEditor.data no se desincronice
    this.state.site = prevState.site;
    this.state.products = prevState.products;
    this.state.categories = prevState.categories;
    this.state.ui = prevState.ui;

    this.applyStateToDOM();
    const saved = await this.saveState();
    if (window.PixisOverlay?.updateUndoButton) window.PixisOverlay.updateUndoButton(this.history.length > 0);
    return saved;
  },

  /* ─── APLICAR CAMBIO AL STATE ────────────────────────────── */
  applyChange({ type, path, value }) {
    if (!path || path.length === 0) {
      this.state[type] = value;
      return;
    }

    // Para arrays (products, categories): path[0] es el índice numérico
    let target = this.state[type];

    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (target[key] === undefined || target[key] === null) {
        target[key] = (typeof path[i + 1] === 'number') ? [] : {};
      }
      target = target[key];
    }

    target[path[path.length - 1]] = value;
  },

  /* ─── PUNTOS DE RESTAURACIÓN ────────────────────────────── */
  async getCheckpoints() {
    try {
      const res = await fetch('/data/backups/manifest.json?_=' + Date.now());
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  async createCheckpoint(name = 'Punto de restauración') {
    const manifest = await this.getCheckpoints();
    const id = Date.now();
    const timestamp = new Date().toLocaleString();
    const fileName = `checkpoint_${id}.json`;

    const checkpointData = {
      id,
      name,
      timestamp,
      state: JSON.parse(JSON.stringify(this.state))
    };

    // Guardar archivo del punto
    const checkpointStr = JSON.stringify(checkpointData, null, 2);
    const checkpointBase64 = btoa(unescape(encodeURIComponent(checkpointStr)));

    const saveOk = await fetch(`/api/sync?file=data/backups/${fileName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ payload: checkpointBase64 })
    }).then(async r => {
      try {
        const resData = await r.json();
        return r.ok && resData.ok !== false;
      } catch(e) {
        return false;
      }
    });

    if (!saveOk) return false;

    // Actualizar manifiesto
    manifest.unshift({ id, name, timestamp, fileName });
    const manifestStr = JSON.stringify(manifest, null, 2);
    const manifestBase64 = btoa(unescape(encodeURIComponent(manifestStr)));

    await fetch(`/api/sync?file=data/backups/manifest.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ payload: manifestBase64 })
    });

    return true;
  },

  async restoreCheckpoint(id) {
    const manifest = await this.getCheckpoints();
    // Usamos == para permitir comparación entre string y number
    const entry = manifest.find(m => m.id == id);
    if (!entry) return false;

    try {
      const res = await fetch(`/data/backups/${entry.fileName}?_=` + Date.now());
      const checkpoint = await res.json();
      if (!checkpoint || !checkpoint.state) return false;

      // Guardamos el estado actual en el historial antes de restaurar por si queremos volver atrás
      this.pushHistory();

      // Aplicar estado manteniendo la referencia del objeto principal
      const newState = JSON.parse(JSON.stringify(checkpoint.state));
      this.state.site = newState.site;
      this.state.products = newState.products;
      this.state.categories = newState.categories;
      this.state.ui = newState.ui;

      this.applyStateToDOM();
      await this.saveState(); // Persistir a los archivos principales
      return true;
    } catch (e) {
      console.error('[PixisState] Error restaurando:', e);
      return false;
    }
  },

  async deleteCheckpoint(id) {
    let manifest = await this.getCheckpoints();
    const entry = manifest.find(m => m.id == id);
    if (!entry) return false;

    manifest = manifest.filter(m => m.id != id);

    // Actualizar manifiesto
    const manifestStr = JSON.stringify(manifest, null, 2);
    const manifestBase64 = btoa(unescape(encodeURIComponent(manifestStr)));

    await fetch(`/api/sync?file=data/backups/manifest.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ payload: manifestBase64 })
    });

    // Nota: El archivo físico se queda en el disco a menos que el backend lo borre, 
    // pero ya no aparecerá en la UI.
    return true;
  },

  /* ─── RENDERIZAR TEXTOS DINÁMICOS DEL USUARIO ─────────────── */
  renderCreatedTexts() {
    const ui = this.state.ui || {};
    document.querySelectorAll('.pixis-created-text').forEach(el => el.remove());
    if (ui.createdTexts) {
      Object.entries(ui.createdTexts).forEach(([id, data]) => {
        if (ui.deleted && ui.deleted.includes(id)) return;

        if (data.productId) {
          const isModalActive = document.getElementById('modalProduct')?.classList.contains('active');
          const currentProdId = window.productoActual ? window.productoActual.id : null;
          if (!isModalActive || !currentProdId || currentProdId !== data.productId) {
            return;
          }
        }

        const textEl = document.createElement('div');
        textEl.className = 'pixis-created-text';
        textEl.dataset.pixisId = id;
        
        if (window.location.search.includes('edit=true')) {
          textEl.classList.add('pixis-editable', 'pixis-editable-text');
          textEl.dataset.pixisType = 'texts';
          textEl.style.border = '1px dashed #b026ff';
        } else {
          textEl.style.border = 'none';
        }

        if (data.html !== undefined) {
          textEl.innerHTML = data.html;
        } else {
          textEl.textContent = data.text || 'Nuevo texto';
        }

        if (data.style) {
          Object.entries(data.style).forEach(([key, val]) => {
            if (val !== undefined && val !== null) {
              let kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
              if (kebabKey.startsWith('webkit-')) {
                kebabKey = '-' + kebabKey;
              }
              textEl.style.setProperty(kebabKey, val, 'important');
            }
          });
        }

        let parentEl = document.body;
        if (data.parentSelector && data.parentSelector !== 'body') {
          try {
            const found = document.querySelector(data.parentSelector);
            if (found) parentEl = found;
          } catch (e) {}
        }
        parentEl.appendChild(textEl);
      });
    }
  },

  /* ─── APLICAR STATE AL DOM ───────────────────────────────── */
  applyStateToDOM() {
    // ── MOBILE GUARD ──────────────────────────────────────────
    // Propiedades que el editor desktop ajusta con transform/width
    // y que NO deben aplicarse en mobile (rompen el layout)
    const _isMobile = window.innerWidth <= 768;
    const _desktopOnlyProps = ['transform', 'width', 'height', 'font-size', 'line-height', 'position', 'z-index', 'zindex'];
    const savedScrollY = window.scrollY;
    const { ui, site } = this.state;

    // Inyectar o actualizar estilos de personalización (Diseño, Bordes, Fondos, Retroiluminación)
    if (site.designSettings) {
      const settings = site.designSettings;
      let css = '';

      // ─── COMPENSACIÓN DE CABECERA EN DETALLE DE PRODUCTO ───
      const compDesktop = settings.productHeaderCompensationDesktop !== undefined ? settings.productHeaderCompensationDesktop : 100;
      const compMobile = settings.productHeaderCompensationMobile !== undefined ? settings.productHeaderCompensationMobile : 135;
      css += `
        @media (min-width: 769px) {
          body.product-page-active {
            padding-top: ${compDesktop}px !important;
          }
        }
        @media (max-width: 768px) {
          body.product-page-active {
            padding-top: ${compMobile}px !important;
          }
        }
      \n`;

      // ─── CANVAS (LIENZO / FONDO) ───
      // Gamer (Oscuro)
      if (settings.backgroundTypeGamer === 'solid' && settings.backgroundValueGamer) {
        css += `body:not(.light-mode) { background: ${settings.backgroundValueGamer} !important; background-image: none !important; }\n`;
      } else if (settings.backgroundTypeGamer === 'image' && settings.backgroundValueGamer) {
        css += `body:not(.light-mode) { background-image: url('${settings.backgroundValueGamer}') !important; background-size: cover !important; background-attachment: fixed !important; background-position: center !important; }\n`;
      }
      // Oficina (Claro)
      if (settings.backgroundTypeOficina === 'solid' && settings.backgroundValueOficina) {
        css += `body.light-mode { background: ${settings.backgroundValueOficina} !important; background-image: none !important; }\n`;
      } else if (settings.backgroundTypeOficina === 'image' && settings.backgroundValueOficina) {
        css += `body.light-mode { background-image: url('${settings.backgroundValueOficina}') !important; background-size: cover !important; background-attachment: fixed !important; background-position: center !important; }\n`;
      }

      // ─── FONDO DEL HEADER ───
      // Gamer (Oscuro)
      if (settings.headerBgTypeGamer === 'solid' && settings.headerBgValueGamer) {
        css += `body:not(.light-mode) .main-header { background: ${settings.headerBgValueGamer} !important; background-image: none !important; }\n`;
      } else if (settings.headerBgTypeGamer === 'image' && settings.headerBgValueGamer) {
        css += `body:not(.light-mode) .main-header { background-image: url('${settings.headerBgValueGamer}') !important; background-size: cover !important; background-position: center !important; }\n`;
      }
      // Oficina (Claro)
      if (settings.headerBgTypeOficina === 'solid' && settings.headerBgValueOficina) {
        css += `body.light-mode .main-header { background: ${settings.headerBgValueOficina} !important; background-image: none !important; }\n`;
      } else if (settings.headerBgTypeOficina === 'image' && settings.headerBgValueOficina) {
        css += `body.light-mode .main-header { background-image: url('${settings.headerBgValueOficina}') !important; background-size: cover !important; background-position: center !important; }\n`;
      }


      // ─── FUENTES Y COLORES DE TEXTO DE LAS CARDS ───
      // Gamer Mode Cards
      css += `body:not(.light-mode) .card, body:not(.light-mode) .short-card, body:not(.light-mode) .video-card {\n`;
      if (settings.gamerFontFamily) css += `  font-family: ${settings.gamerFontFamily}, sans-serif !important;\n`;
      css += `}\n`;
      if (settings.gamerCardTitleColor || settings.gamerCardTitleSize) {
        css += `body:not(.light-mode) .card h3, body:not(.light-mode) .short-card h3, body:not(.light-mode) .video-card h3 {\n`;
        if (settings.gamerCardTitleColor) css += `  color: ${settings.gamerCardTitleColor} !important;\n`;
        if (settings.gamerCardTitleSize) css += `  font-size: ${settings.gamerCardTitleSize} !important;\n`;
        css += `}\n`;
      }
      if (settings.gamerCardDescColor || settings.gamerCardDescSize) {
        css += `body:not(.light-mode) .card p, body:not(.light-mode) .short-card p, body:not(.light-mode) .video-card p {\n`;
        if (settings.gamerCardDescColor) css += `  color: ${settings.gamerCardDescColor} !important;\n`;
        if (settings.gamerCardDescSize) css += `  font-size: ${settings.gamerCardDescSize} !important;\n`;
        css += `}\n`;
      }
      if (settings.gamerCardPriceColor || settings.gamerCardPriceSize) {
        css += `body:not(.light-mode) .card .precio, body:not(.light-mode) .card .precio-especial {\n`;
        if (settings.gamerCardPriceColor) css += `  color: ${settings.gamerCardPriceColor} !important;\n`;
        if (settings.gamerCardPriceSize) css += `  font-size: ${settings.gamerCardPriceSize} !important;\n`;
        css += `}\n`;
      }

      // Oficina Mode Cards
      css += `body.light-mode .card, body.light-mode .short-card, body.light-mode .video-card {\n`;
      if (settings.oficinaFontFamily) css += `  font-family: ${settings.oficinaFontFamily}, sans-serif !important;\n`;
      css += `}\n`;
      if (settings.oficinaCardTitleColor || settings.oficinaCardTitleSize) {
        css += `body.light-mode .card h3, body.light-mode .short-card h3, body.light-mode .video-card h3 {\n`;
        if (settings.oficinaCardTitleColor) css += `  color: ${settings.oficinaCardTitleColor} !important;\n`;
        if (settings.oficinaCardTitleSize) css += `  font-size: ${settings.oficinaCardTitleSize} !important;\n`;
        css += `}\n`;
      }
      if (settings.oficinaCardDescColor || settings.oficinaCardDescSize) {
        css += `body.light-mode .card p, body.light-mode .short-card p, body.light-mode .video-card p {\n`;
        if (settings.oficinaCardDescColor) css += `  color: ${settings.oficinaCardDescColor} !important;\n`;
        if (settings.oficinaCardDescSize) css += `  font-size: ${settings.oficinaCardDescSize} !important;\n`;
        css += `}\n`;
      }
      if (settings.oficinaCardPriceColor || settings.oficinaCardPriceSize) {
        css += `body.light-mode .card .precio, body.light-mode .card .precio-especial {\n`;
        if (settings.oficinaCardPriceColor) css += `  color: ${settings.oficinaCardPriceColor} !important;\n`;
        if (settings.oficinaCardPriceSize) css += `  font-size: ${settings.oficinaCardPriceSize} !important;\n`;
        css += `}\n`;
      }

      // ─── BORDES DE CARDS AL 100% ───
      // Si RGB está habilitado, tiene prioridad de 100%
      const isRgbCards = !settings.rgbCardsDisabled;
      const speedCards = settings.rgbCardsSpeed || 6;
      
      // Selectores para aplicar el borde (excluyendo preventas / próximo ingreso)
      const cardsSelectorGamer = `body:not(.light-mode) .card:not(.proximo-ingreso), body:not(.light-mode) .short-card:not(.proximo-ingreso), body:not(.light-mode) .video-card:not(.proximo-ingreso)`;
      const cardsSelectorOficina = `body.light-mode .card:not(.proximo-ingreso), body.light-mode .short-card:not(.proximo-ingreso), body.light-mode .video-card:not(.proximo-ingreso)`;

      const gamerCardBg = settings.gamerCardBgColor || '#0e0016';
      const oficinaCardBg = settings.oficinaCardBgColor || '#ffffff';

      // Borde para Gamer
      css += `${cardsSelectorGamer} { background-color: ${gamerCardBg} !important; }\n`;
      if (isRgbCards || settings.borderColorGamer === 'rainbow') {
        css += `
          ${cardsSelectorGamer} {
            border: 2px solid transparent !important;
            background-image: linear-gradient(${gamerCardBg}, ${gamerCardBg}),
                              linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff, #ff0000) !important;
            background-clip: padding-box, border-box !important;
            background-size: 100% 100%, 300% 100% !important;
            background-origin: padding-box, border-box !important;
            animation: rgbSlide ${speedCards}s linear infinite !important;
            box-shadow: 0 0 15px rgba(176, 38, 255, 0.4) !important;
          }
        `;
      } else if (settings.borderColorGamer === 'gold') {
        css += `
          ${cardsSelectorGamer} {
            background-color: ${gamerCardBg} !important;
            background-image: none !important;
            border: 2px solid #ffd700 !important;
            box-shadow: 0 0 15px rgba(212, 175, 55, 0.4) !important;
            animation: none !important;
          }
        `;
      } else if (settings.borderColorGamer === 'none') {
        css += `
          ${cardsSelectorGamer} {
            border: none !important;
            box-shadow: none !important;
            animation: none !important;
            background-color: ${gamerCardBg} !important;
            background-image: none !important;
          }
        `;
      } else if (settings.borderColorGamer) {
        css += `
          ${cardsSelectorGamer} {
            border: 2px solid ${settings.borderColorGamer} !important;
            box-shadow: 0 0 15px ${settings.borderColorGamer}40 !important;
            animation: none !important;
            background-color: ${gamerCardBg} !important;
            background-image: none !important;
          }
        `;
      }

      // Borde para Oficina
      css += `${cardsSelectorOficina} { background-color: ${oficinaCardBg} !important; }\n`;
      if (isRgbCards || settings.borderColorOficina === 'rainbow') {
        css += `
          ${cardsSelectorOficina} {
            border: 2px solid transparent !important;
            background-image: linear-gradient(${oficinaCardBg}, ${oficinaCardBg}),
                              linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff, #ff0000) !important;
            background-clip: padding-box, border-box !important;
            background-size: 100% 100%, 300% 100% !important;
            background-origin: padding-box, border-box !important;
            animation: rgbSlide ${speedCards}s linear infinite !important;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1) !important;
          }
        `;
      } else if (settings.borderColorOficina === 'gold') {
        css += `
          ${cardsSelectorOficina} {
            background-color: ${oficinaCardBg} !important;
            background-image: none !important;
            border: 2px solid #ffd700 !important;
            box-shadow: 0 0 15px rgba(212, 175, 55, 0.4) !important;
            animation: none !important;
          }
        `;
      } else if (settings.borderColorOficina === 'none') {
        css += `
          ${cardsSelectorOficina} {
            border: none !important;
            box-shadow: none !important;
            animation: none !important;
            background-color: ${oficinaCardBg} !important;
            background-image: none !important;
          }
        `;
      } else if (settings.borderColorOficina) {
        css += `
          ${cardsSelectorOficina} {
            border: 2px solid ${settings.borderColorOficina} !important;
            box-shadow: 0 0 10px ${settings.borderColorOficina}30 !important;
            animation: none !important;
            background-color: ${oficinaCardBg} !important;
            background-image: none !important;
          }
        `;
      }

      // ─── BANNERS DE LA WEB ───
      const isRgbBanners = !settings.rgbBannersDisabled;
      const speedBanners = settings.rgbBannersSpeed || 6;
      if (isRgbBanners) {
        css += `
          .banner-carousel {
            border: 2px solid transparent !important;
            background-image: linear-gradient(#0e0016, #0e0016),
                              linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff, #ff0000) !important;
            background-clip: padding-box, border-box !important;
            background-size: 100% 100%, 300% 100% !important;
            background-origin: padding-box, border-box !important;
            animation: rgbSlide ${speedBanners}s linear infinite !important;
            box-shadow: 0 0 20px rgba(176, 38, 255, 0.3) !important;
          }
        `;
      } else {
        const borderGamer = settings.borderColorGamer === 'rainbow' ? 'transparent' : settings.borderColorGamer;
        css += `
          body:not(.light-mode) .banner-carousel {
            border: 2px solid ${borderGamer === 'gold' ? '#ffd700' : (borderGamer || 'transparent')} !important;
            animation: ${borderGamer === 'gold' ? 'goldPulse 3s infinite ease-in-out' : 'none'} !important;
            background: #0e0016 !important;
            box-shadow: ${borderGamer === 'gold' ? '0 0 20px rgba(212, 175, 55, 0.4)' : '0 20px 40px rgba(0, 0, 0, 0.4)'} !important;
          }
        `;
        const borderOficina = settings.borderColorOficina === 'rainbow' ? 'transparent' : settings.borderColorOficina;
        css += `
          body.light-mode .banner-carousel {
            border: 2px solid ${borderOficina === 'gold' ? '#ffd700' : (borderOficina || 'transparent')} !important;
            animation: ${borderOficina === 'gold' ? 'goldPulse 3s infinite ease-in-out' : 'none'} !important;
            background: #ffffff !important;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1) !important;
          }
        `;
      }

      // ─── RETROILUMINACIÓN / PALPITACIONES DE CATEGORÍAS ───
      // Gamer Mode
      const glowGamer = settings.categoryGlowTypeGamer || 'original';
      const glowGamerSpeed = settings.categoryGlowSpeedGamer || 1.5;
      const glowGamerActive = settings.categoryGlowActiveGamer !== false;
      if (glowGamer !== 'original') {
        if (glowGamer === 'off') {
          css += `
            body:not(.light-mode) .pulsante,
            body:not(.light-mode) .pulsante2 {
              animation: none !important;
              box-shadow: none !important;
              text-shadow: none !important;
            }
          `;
        } else if (glowGamer === 'rainbow') {
          css += `
            body:not(.light-mode) .pulsante2 {
              animation: ${glowGamerActive ? `rgbBorderGlow ${glowGamerSpeed}s infinite linear !important` : 'none !important'};
            }
            body:not(.light-mode) .pulsante {
              animation: ${glowGamerActive ? `rgbTextGlow ${glowGamerSpeed}s infinite linear !important` : 'none !important'};
            }
          `;
        } else if (glowGamer === 'gold') {
          css += `
            body:not(.light-mode) .pulsante2 {
              animation: ${glowGamerActive ? `goldPulse ${glowGamerSpeed}s infinite ease-in-out !important` : 'none !important'};
            }
            body:not(.light-mode) .pulsante {
              animation: ${glowGamerActive ? `goldTextPulse ${glowGamerSpeed}s infinite ease-in-out !important` : 'none !important'};
              color: #ffd700 !important;
            }
          `;
        } else if (glowGamer === 'cyan') {
          css += `
            body:not(.light-mode) .pulsante2 {
              animation: ${glowGamerActive ? `cyanPulse ${glowGamerSpeed}s infinite ease-in-out !important` : 'none !important'};
            }
            body:not(.light-mode) .pulsante {
              animation: ${glowGamerActive ? `cyanTextPulse ${glowGamerSpeed}s infinite ease-in-out !important` : 'none !important'};
              color: #00ffd5 !important;
            }
          `;
        }
      } else if (!glowGamerActive) {
        css += `
          body:not(.light-mode) .pulsante,
          body:not(.light-mode) .pulsante2 {
            animation: none !important;
          }
        `;
      }

      // Oficina Mode
      const glowOficina = settings.categoryGlowTypeOficina || 'original';
      const glowOficinaSpeed = settings.categoryGlowSpeedOficina || 1.5;
      const glowOficinaActive = settings.categoryGlowActiveOficina !== false;
      if (glowOficina !== 'original') {
        if (glowOficina === 'off') {
          css += `
            body.light-mode .pulsante,
            body.light-mode .pulsante2 {
              animation: none !important;
              box-shadow: none !important;
              text-shadow: none !important;
            }
          `;
        } else if (glowOficina === 'rainbow') {
          css += `
            body.light-mode .pulsante2 {
              animation: ${glowOficinaActive ? `rgbBorderGlow ${glowOficinaSpeed}s infinite linear !important` : 'none !important'};
            }
            body.light-mode .pulsante {
              animation: ${glowOficinaActive ? `rgbTextGlow ${glowOficinaSpeed}s infinite linear !important` : 'none !important'};
            }
          `;
        } else if (glowOficina === 'gold') {
          css += `
            body.light-mode .pulsante2 {
              animation: ${glowOficinaActive ? `goldPulse ${glowOficinaSpeed}s infinite ease-in-out !important` : 'none !important'};
            }
            body.light-mode .pulsante {
              animation: ${glowOficinaActive ? `goldTextPulse ${glowOficinaSpeed}s infinite ease-in-out !important` : 'none !important'};
              color: #ffd700 !important;
            }
          `;
        } else if (glowOficina === 'cyan') {
          css += `
            body.light-mode .pulsante2 {
              animation: ${glowOficinaActive ? `cyanPulse ${glowOficinaSpeed}s infinite ease-in-out !important` : 'none !important'};
            }
            body.light-mode .pulsante {
              animation: ${glowOficinaActive ? `cyanTextPulse ${glowOficinaSpeed}s infinite ease-in-out !important` : 'none !important'};
              color: #00a8ff !important;
            }
          `;
        }
      } else if (!glowOficinaActive) {
        css += `
          body.light-mode .pulsante,
          body.light-mode .pulsante2 {
            animation: none !important;
          }
        `;
      }

      // Keyframes para palpitaciones personalizadas
      css += `
        @keyframes cyanPulse {
          0%, 100% { box-shadow: 0 0 10px rgba(0, 255, 213, 0.4); }
          50% { box-shadow: 0 0 30px rgba(0, 255, 213, 0.9); }
        }
        @keyframes cyanTextPulse {
          0%, 100% { text-shadow: 0 0 10px rgba(0, 255, 213, 0.5); }
          50% { text-shadow: 0 0 25px rgba(0, 255, 213, 1); }
        }
        @keyframes goldPulse {
          0%, 100% { box-shadow: 0 0 10px rgba(212, 175, 55, 0.4); }
          50% { box-shadow: 0 0 30px rgba(212, 175, 55, 0.9); }
        }
        @keyframes goldTextPulse {
          0%, 100% { text-shadow: 0 0 10px rgba(212, 175, 55, 0.5); }
          50% { text-shadow: 0 0 25px rgba(212, 175, 55, 1); }
        }
        @keyframes rgbSlide {
          0%   { background-position: 0% 0%, 0% 50%; }
          100% { background-position: 0% 0%, 300% 50%; }
        }
        @keyframes rgbBorderAnim {
          0%   { background-position: 0% 50%; }
          100% { background-position: 400% 50%; }
        }
      `;

      // ─── FONDOS Y TEXTOS DE MODALES PERSONALIZADOS ───
      if (settings.gamerCardBgColor) {
        css += `body:not(.light-mode) .modal-content { background: ${settings.gamerCardBgColor} !important; }\n`;
        css += `body.product-page-active:not(.light-mode) .modal-content { background: ${settings.gamerCardBgColor} !important; }\n`;
        css += `@media (min-width: 901px) { body.product-page-active:not(.light-mode) .modal-thumbs img, body.product-page-active:not(.light-mode) .modal-thumbs .pixis-video-thumb { background: ${settings.gamerCardBgColor} !important; } }\n`;
        css += `body:not(.light-mode) .modal-thumbs img, body:not(.light-mode) .modal-thumbs .pixis-video-thumb { background: ${settings.gamerCardBgColor} !important; }\n`;
      }

      if (settings.gamerModalTextColor) {
        css += `
          body:not(.light-mode) .modal-content, 
          body:not(.light-mode) .modal-content p, 
          body:not(.light-mode) .modal-content span, 
          body:not(.light-mode) .modal-content li, 
          body:not(.light-mode) .modal-desc,
          body:not(.light-mode) #bloquePrecionSinIva span {
            color: ${settings.gamerModalTextColor} !important;
          }
          body:not(.light-mode) .modal-content h1, 
          body:not(.light-mode) .modal-content h2, 
          body:not(.light-mode) .modal-content h3 {
            color: ${settings.gamerModalTextColor} !important;
          }
        `;
      }
      if (settings.gamerModalPriceColor) {
        css += `
          body:not(.light-mode) .modal-price, 
          body:not(.light-mode) .modal-content strong, 
          body:not(.light-mode) .precio-sin-iva-valor {
            color: ${settings.gamerModalPriceColor} !important;
          }
        `;
      }

      if (settings.oficinaCardBgColor) {
        css += `body.light-mode .modal-content { background: ${settings.oficinaCardBgColor} !important; }\n`;
        css += `body.product-page-active.light-mode .modal-content { background: ${settings.oficinaCardBgColor} !important; }\n`;
        css += `@media (min-width: 901px) { body.product-page-active.light-mode .modal-thumbs img, body.product-page-active.light-mode .modal-thumbs .pixis-video-thumb { background: ${settings.oficinaCardBgColor} !important; } }\n`;
        css += `body.light-mode .modal-thumbs img, body.light-mode .modal-thumbs .pixis-video-thumb { background: ${settings.oficinaCardBgColor} !important; }\n`;
      }
      if (settings.oficinaModalTextColor) {
        css += `
          body.light-mode .modal-content, 
          body.light-mode .modal-content p, 
          body.light-mode .modal-content span, 
          body.light-mode .modal-content li, 
          body.light-mode .modal-desc,
          body.light-mode #bloquePrecionSinIva span {
            color: ${settings.oficinaModalTextColor} !important;
          }
          body.light-mode .modal-content h1, 
          body.light-mode .modal-content h2, 
          body.light-mode .modal-content h3 {
            color: ${settings.oficinaModalTextColor} !important;
          }
        `;
      }
      if (settings.oficinaModalPriceColor) {
        css += `
          body.light-mode .modal-price, 
          body.light-mode .modal-content strong, 
          body.light-mode .precio-sin-iva-valor {
            color: ${settings.oficinaModalPriceColor} !important;
          }
        `;
      }
      // ─── TEXTOS GLOBALES DEL SITIO POR MODO ───
      // MODO GAMER
      if (settings.gamerGlobalH1Color) {
        css += `body:not(.light-mode) h1, body:not(.light-mode) h1 span { color: ${settings.gamerGlobalH1Color} !important; }\n`;
      }
      if (settings.gamerGlobalH2Color) {
        css += `body:not(.light-mode) h2, body:not(.light-mode) h3:not(.card h3):not(.modal-content h3), body:not(.light-mode) h3:not(.card h3):not(.modal-content h3) span { color: ${settings.gamerGlobalH2Color} !important; }\n`;
      }
      if (settings.gamerHeaderTopColor) {
        css += `body:not(.light-mode) .header-top-text span { color: ${settings.gamerHeaderTopColor} !important; }\n`;
      }
      if (settings.gamerLinea1Color) {
        css += `body:not(.light-mode) .linea1 { color: ${settings.gamerLinea1Color} !important; }\n`;
      }
      if (settings.gamerUbicacionColor) {
        css += `body:not(.light-mode) .ubicacion, body:not(.light-mode) .ubicacion-title, body:not(.light-mode) .ubicacion small { color: ${settings.gamerUbicacionColor} !important; }\n`;
      }
      if (settings.gamerRedesTitleColor) {
        css += `body:not(.light-mode) .redes-title { color: ${settings.gamerRedesTitleColor} !important; }\n`;
      }
      // Botones en modo Gamer
      if (settings.gamerBtnVerCuotasColor) {
        css += `body:not(.light-mode) .precio-lista .btn-ver-cuotas { color: ${settings.gamerBtnVerCuotasColor} !important; border-color: ${settings.gamerBtnVerCuotasColor} !important; }\n`;
        css += `body:not(.light-mode) .precio-lista .btn-ver-cuotas:hover { background: ${settings.gamerBtnVerCuotasColor} !important; color: #000 !important; }\n`;
      }
      if (settings.gamerBtnVolverColor) {
        css += `body:not(.light-mode) .product-page-back-container .modal-close { color: ${settings.gamerBtnVolverColor} !important; border-color: ${settings.gamerBtnVolverColor}88 !important; }\n`;
      }

      // MODO OFICINA
      if (settings.oficinaGlobalH1Color) {
        css += `body.light-mode h1, body.light-mode h1 span { color: ${settings.oficinaGlobalH1Color} !important; }\n`;
      }
      if (settings.oficinaGlobalH2Color) {
        css += `body.light-mode h2, body.light-mode h3:not(.card h3):not(.modal-content h3), body.light-mode h3:not(.card h3):not(.modal-content h3) span { color: ${settings.oficinaGlobalH2Color} !important; }\n`;
      }
      if (settings.oficinaHeaderTopColor) {
        css += `body.light-mode .header-top-text span { color: ${settings.oficinaHeaderTopColor} !important; }\n`;
      }
      if (settings.oficinaLinea1Color) {
        css += `body.light-mode .linea1 { color: ${settings.oficinaLinea1Color} !important; }\n`;
      }
      if (settings.oficinaUbicacionColor) {
        css += `body.light-mode .ubicacion, body.light-mode .ubicacion-title, body.light-mode .ubicacion small { color: ${settings.oficinaUbicacionColor} !important; }\n`;
      }
      if (settings.oficinaRedesTitleColor) {
        css += `body.light-mode .redes-title { color: ${settings.oficinaRedesTitleColor} !important; }\n`;
      }
      // Botones en modo Oficina
      if (settings.oficinaBtnVerCuotasColor) {
        css += `body.light-mode .precio-lista .btn-ver-cuotas { color: ${settings.oficinaBtnVerCuotasColor} !important; border-color: ${settings.oficinaBtnVerCuotasColor} !important; }\n`;
        css += `body.light-mode .precio-lista .btn-ver-cuotas:hover { background: ${settings.oficinaBtnVerCuotasColor} !important; color: #fff !important; }\n`;
      }
      if (settings.oficinaBtnVolverColor) {
        css += `body.light-mode .product-page-back-container .modal-close { color: ${settings.oficinaBtnVolverColor} !important; border-color: ${settings.oficinaBtnVolverColor}88 !important; }\n`;
      }

      // ─── BOTÓN MENÚ DE PRODUCTOS (btnCategorias) ───
      // ─── BOTÓN MENÚ DE PRODUCTOS (btnCategorias) ───
      const catPanelRgbDisabled = settings.catPanelRgbDisabled === true;
      const catPanelRgbSpeed = settings.catPanelRgbSpeed || 6;
      const catPanelRgbThickness = settings.catPanelRgbThickness !== undefined ? settings.catPanelRgbThickness : 2;

      const isRgbMenuGamer = settings.gamerMenuBtnRgbEnabled !== false && !catPanelRgbDisabled;
      const gamerMenuBtnColor = settings.gamerMenuBtnColor || '#ffffff';
      const gamerMenuBtnSize = settings.gamerMenuBtnSize || '15px';
      const gamerMenuBtnFont = settings.gamerMenuBtnFontFamily || 'Orbitron';
      const gamerMenuBg = settings.gamerCardBgColor || '#0e0016';
      const gamerMenuBtnBorderColor = settings.gamerMenuBtnBorderColor || 'rainbow';
      
      css += `
        body:not(.light-mode) .btnCategorias, body:not(.light-mode) #btnCategorias {
          font-family: ${gamerMenuBtnFont}, sans-serif !important;
        }
        body:not(.light-mode) .btnCategorias span, body:not(.light-mode) #btnCategorias span {
          font-family: ${gamerMenuBtnFont}, sans-serif !important;
          font-size: ${gamerMenuBtnSize} !important;
          color: ${gamerMenuBtnColor} !important;
          background: none !important;
          -webkit-text-fill-color: ${gamerMenuBtnColor} !important;
        }
        body:not(.light-mode) .btnCategorias::before, body:not(.light-mode) #btnCategorias::before,
        body:not(.light-mode) .btnCategorias::after, body:not(.light-mode) #btnCategorias::after {
          display: none !important;
          content: none !important;
        }
      `;
      
      if (isRgbMenuGamer) {
        if (gamerMenuBtnBorderColor === 'rainbow') {
          css += `
            body:not(.light-mode) .btnCategorias, body:not(.light-mode) #btnCategorias {
              border: ${catPanelRgbThickness}px solid transparent !important;
              background-image: linear-gradient(${gamerMenuBg}, ${gamerMenuBg}),
                                linear-gradient(90deg, #ff0000, #00ff00, #0000ff, #ff00ff, #00ffff, #ff0000) !important;
              background-clip: padding-box, border-box !important;
              background-size: 100% 100%, 300% 100% !important;
              background-origin: padding-box, border-box !important;
              animation: rgbSlide ${catPanelRgbSpeed}s linear infinite !important;
              box-shadow: 0 0 15px rgba(176, 38, 255, 0.25) !important;
            }
          `;
        } else {
          css += `
            body:not(.light-mode) .btnCategorias, body:not(.light-mode) #btnCategorias {
              border: ${catPanelRgbThickness}px solid ${gamerMenuBtnBorderColor} !important;
              background: ${gamerMenuBg} !important;
              animation: none !important;
              box-shadow: none !important;
            }
          `;
        }
      } else {
        css += `
          body:not(.light-mode) .btnCategorias, body:not(.light-mode) #btnCategorias {
            border: 1px solid rgba(255,255,255,0.15) !important;
            background: ${gamerMenuBg} !important;
            animation: none !important;
            box-shadow: none !important;
          }
        `;
      }

      const isRgbMenuOficina = settings.oficinaMenuBtnRgbEnabled !== false && !catPanelRgbDisabled;
      const oficinaMenuBtnColor = settings.oficinaMenuBtnColor || '#1e0050';
      const oficinaMenuBtnSize = settings.oficinaMenuBtnSize || '15px';
      const oficinaMenuBtnFont = settings.oficinaMenuBtnFontFamily || "'Segoe UI', sans-serif";
      const oficinaMenuBg = settings.oficinaCardBgColor || '#ffffff';
      const oficinaMenuBtnBorderColor = settings.oficinaMenuBtnBorderColor || 'rainbow';
      
      css += `
        body.light-mode .btnCategorias, body.light-mode #btnCategorias {
          font-family: ${oficinaMenuBtnFont}, sans-serif !important;
        }
        body.light-mode .btnCategorias span, body.light-mode #btnCategorias span {
          font-family: ${oficinaMenuBtnFont}, sans-serif !important;
          font-size: ${oficinaMenuBtnSize} !important;
          color: ${oficinaMenuBtnColor} !important;
          background: none !important;
          -webkit-text-fill-color: ${oficinaMenuBtnColor} !important;
        }
        body.light-mode .btnCategorias::before, body.light-mode #btnCategorias::before,
        body.light-mode .btnCategorias::after, body.light-mode #btnCategorias::after {
          display: none !important;
          content: none !important;
        }
      `;
      
      if (isRgbMenuOficina) {
        if (oficinaMenuBtnBorderColor === 'rainbow') {
          css += `
            body.light-mode .btnCategorias, body.light-mode #btnCategorias {
              border: ${catPanelRgbThickness}px solid transparent !important;
              background-image: linear-gradient(${oficinaMenuBg}, ${oficinaMenuBg}),
                                linear-gradient(90deg, #ff0000, #00ff00, #0000ff, #ff00ff, #00ffff, #ff0000) !important;
              background-clip: padding-box, border-box !important;
              background-size: 100% 100%, 300% 100% !important;
              background-origin: padding-box, border-box !important;
              animation: rgbSlide ${catPanelRgbSpeed}s linear infinite !important;
              box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05) !important;
            }
          `;
        } else {
          css += `
            body.light-mode .btnCategorias, body.light-mode #btnCategorias {
              border: ${catPanelRgbThickness}px solid ${oficinaMenuBtnBorderColor} !important;
              background: ${oficinaMenuBg} !important;
              animation: none !important;
              box-shadow: none !important;
            }
          `;
        }
      } else {
        css += `
          body.light-mode .btnCategorias, body.light-mode #btnCategorias {
            border: 1px solid rgba(0,0,0,0.15) !important;
            background: ${oficinaMenuBg} !important;
            animation: none !important;
            box-shadow: none !important;
          }
        `;
      }

      // ─── PANEL MENÚ DE PRODUCTOS (categorias-nav / móvil) ───
      const gamerCatPanelBgColor = settings.gamerCatPanelBgColor || '#0e0016';
      const gamerCatPanelTitleColor = settings.gamerCatPanelTitleColor || '#b026ff';
      const gamerCatPanelCloseColor = settings.gamerCatPanelCloseColor || '#b026ff';
      const gamerCatItemBgColor = settings.gamerCatItemBgColor || 'transparent';
      const gamerCatItemTextColor = settings.gamerCatItemTextColor || '#ffffff';
      const gamerCatItemBorderColor = settings.gamerCatItemBorderColor || '#b026ff';
      const gamerCatItemActiveBgColor = settings.gamerCatItemActiveBgColor || 'rgba(176,38,255,0.25)';
      const gamerCatItemActiveTextColor = settings.gamerCatItemActiveTextColor || '#ffffff';

      const oficinaCatPanelBgColor = settings.oficinaCatPanelBgColor || '#ffffff';
      const oficinaCatPanelTitleColor = settings.oficinaCatPanelTitleColor || '#4338ca';
      const oficinaCatPanelCloseColor = settings.oficinaCatPanelCloseColor || '#4338ca';
      const oficinaCatItemBgColor = settings.oficinaCatItemBgColor || '#f1f5f9';
      const oficinaCatItemTextColor = settings.oficinaCatItemTextColor || '#334155';
      const oficinaCatItemBorderColor = settings.oficinaCatItemBorderColor || '#cbd5e1';
      const oficinaCatItemActiveBgColor = settings.oficinaCatItemActiveBgColor || '#1e293b';
      const oficinaCatItemActiveTextColor = settings.oficinaCatItemActiveTextColor || '#ffffff';

      // catPanelRgbDisabled, catPanelRgbSpeed y catPanelRgbThickness ya declarados arriba

      // Reglas para modo Gamer (oscuro)
      css += `
        body:not(.light-mode) .categorias-nav {
          background: ${gamerCatPanelBgColor} !important;
          backdrop-filter: blur(10px) !important;
        }
        body:not(.light-mode) .categorias-titulo,
        body:not(.light-mode) .categorias-titulo-icon {
          color: ${gamerCatPanelTitleColor} !important;
        }
        body:not(.light-mode) .menu-close-btn {
          color: ${gamerCatPanelCloseColor} !important;
        }
        body:not(.light-mode) .categorias-nav a {
          background: ${gamerCatItemBgColor} !important;
          color: ${gamerCatItemTextColor} !important;
          border-bottom-color: ${gamerCatItemBorderColor} !important;
        }
        body:not(.light-mode) .categorias-nav a .cat-name,
        body:not(.light-mode) .categorias-nav a .cat-icon-frame {
          color: ${gamerCatItemTextColor} !important;
        }
        body:not(.light-mode) .categorias-nav a.cat-activa {
          background: ${gamerCatItemActiveBgColor} !important;
          color: ${gamerCatItemActiveTextColor} !important;
        }
        body:not(.light-mode) .categorias-nav a.cat-activa .cat-name,
        body:not(.light-mode) .categorias-nav a.cat-activa .cat-icon-frame {
          color: ${gamerCatItemActiveTextColor} !important;
        }
      `;

      // Reglas para modo Oficina (claro)
      css += `
        body.light-mode .categorias-nav {
          background: ${oficinaCatPanelBgColor} !important;
          backdrop-filter: blur(10px) !important;
        }
        body.light-mode .categorias-titulo,
        body.light-mode .categorias-titulo-icon {
          color: ${oficinaCatPanelTitleColor} !important;
        }
        body.light-mode .menu-close-btn {
          color: ${oficinaCatPanelCloseColor} !important;
        }
        body.light-mode .categorias-nav a {
          background: ${oficinaCatItemBgColor} !important;
          color: ${oficinaCatItemTextColor} !important;
          border-bottom-color: ${oficinaCatItemBorderColor} !important;
        }
        body.light-mode .categorias-nav a .cat-name,
        body.light-mode .categorias-nav a .cat-icon-frame {
          color: ${oficinaCatItemTextColor} !important;
        }
        body.light-mode .categorias-nav a.cat-activa {
          background: ${oficinaCatItemActiveBgColor} !important;
          color: ${oficinaCatItemActiveTextColor} !important;
        }
        body.light-mode .categorias-nav a.cat-activa .cat-name,
        body.light-mode .categorias-nav a.cat-activa .cat-icon-frame {
          color: ${oficinaCatItemActiveTextColor} !important;
        }
      `;

      // Reglas para el borde RGB de .categorias-nav::before (ambos modos)
      css += `
        body:not(.light-mode) .categorias-nav::before {
          padding: ${catPanelRgbThickness}px !important;
          ${!catPanelRgbDisabled 
            ? `background: linear-gradient(270deg, red, orange, yellow, lime, cyan, blue, violet, red) !important;
               background-size: 400% 400% !important;
               animation: rgbBorder ${catPanelRgbSpeed}s linear infinite !important;`
            : `background: ${gamerCatPanelBgColor} !important;
               animation: none !important;`
          }
        }
        body.light-mode .categorias-nav::before {
          padding: ${catPanelRgbThickness}px !important;
          ${!catPanelRgbDisabled 
            ? `background: linear-gradient(270deg, red, orange, yellow, lime, cyan, blue, violet, red) !important;
               background-size: 400% 400% !important;
               animation: rgbBorder ${catPanelRgbSpeed}s linear infinite !important;`
            : `background: ${oficinaCatPanelBgColor} !important;
               animation: none !important;`
          }
        }
        @media (max-width: 768px) {
          body:not(.light-mode) .categorias-nav::before {
            padding: ${catPanelRgbThickness}px !important;
            ${!catPanelRgbDisabled 
              ? `background: linear-gradient(270deg, red, orange, yellow, lime, cyan, blue, violet, red) !important;
                 animation: rgbBorder ${catPanelRgbSpeed}s linear infinite !important;`
              : `background: ${gamerCatPanelBgColor} !important;
                 animation: none !important;`
            }
          }
          body.light-mode .categorias-nav::before {
            padding: ${catPanelRgbThickness}px !important;
            ${!catPanelRgbDisabled 
              ? `background: linear-gradient(270deg, red, orange, yellow, lime, cyan, blue, violet, red) !important;
                 animation: rgbBorder ${catPanelRgbSpeed}s linear infinite !important;`
              : `background: ${oficinaCatPanelBgColor} !important;
                 animation: none !important;`
            }
          }
        }
      `;

      // Inyectar/actualizar elemento de estilos
      let styleEl = document.getElementById('pixis-design-styles');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'pixis-design-styles';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = css;
    }

    // Recrear textos creados dinámicamente por el usuario
    this.renderCreatedTexts();

    // 1. Textos guardados
    if (ui.texts) {
      Object.entries(ui.texts).forEach(([dataId, data]) => {
        let el = document.querySelector(`[data-pixis-id="${dataId}"]`);
        if (!el) {
          try { el = document.querySelector(dataId); } catch (e) { }
        }
        if (el) {
          // Evitar sobrescribir elementos funcionales (como el botón de modo gamer)
          if (el.closest('.theme-toggle')) return;

          // MOBILE GUARD: botones de la página de producto tienen transforms/widths de desktop
          const _mobileSkipTextIds = ['product-btn-back', 'product-btn-menu'];
          const _skipStylesOnMobile = _isMobile && _mobileSkipTextIds.includes(dataId);
          if (_isMobile && _mobileSkipTextIds.includes(dataId)) {
            el.style.removeProperty('width');
            el.style.removeProperty('transform');
            el.style.removeProperty('font-size');
            el.style.removeProperty('position');
            el.style.removeProperty('display');
          }

          if (typeof data === 'object' && data !== null) {
            if (data.text !== undefined) el.textContent = data.text;
            if (data.html !== undefined) el.innerHTML = data.html;
            if (data.style && !_skipStylesOnMobile) {
              Object.entries(data.style).forEach(([key, val]) => {
                if (val !== undefined && val !== null) {
                  // Convertir camelCase a kebab-case para setProperty (ej: webkitTextFillColor -> -webkit-text-fill-color)
                  let kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                  if (kebabKey.startsWith('webkit-')) {
                    kebabKey = '-' + kebabKey;
                  }
                  // MOBILE GUARD: omitir transform/width/position en mobile
                  if (_isMobile && _desktopOnlyProps.includes(kebabKey)) return;
                  el.style.setProperty(kebabKey, val, 'important');
                }
              });
            } else if (data.style && _skipStylesOnMobile) {
              // En mobile solo aplicar color y fontFamily, no layout
              const _mobileAllowedProps = ['color', 'font-family', 'text-align', 'background', '-webkit-background-clip', '-webkit-text-fill-color'];
              Object.entries(data.style).forEach(([key, val]) => {
                if (val !== undefined && val !== null) {
                  let kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                  if (kebabKey.startsWith('webkit-')) kebabKey = '-' + kebabKey;
                  if (_mobileAllowedProps.includes(kebabKey)) {
                    el.style.setProperty(kebabKey, val, 'important');
                  }
                }
              });
            }
          } else {
            el.textContent = data;
          }
        }
      });
    }

    // 2. Imágenes guardadas
    if (ui.images) {
      Object.entries(ui.images).forEach(([dataId, val]) => {
        let el = document.querySelector(`[data-pixis-id="${dataId}"]`);
        if (!el) {
          try { el = document.querySelector(dataId); } catch (e) { }
        }
        if (el && el.tagName === 'IMG') {
          const src = val.src || val;
          // No aplicar base64 (solo rutas reales o URLs externas)
          if (src && src.startsWith('data:')) return;

          el.src = window.optimizeImageUrl(src, el.offsetWidth || 800);
          if (val.alt) el.alt = val.alt;
          if (val.style) {
            Object.entries(val.style).forEach(([key, sVal]) => {
              if (sVal !== undefined && sVal !== null) {
                let kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                if (kebabKey.startsWith('webkit-')) {
                  kebabKey = '-' + kebabKey;
                }
                // MOBILE GUARD: omitir transform/width/position en mobile
                if (_isMobile && _desktopOnlyProps.includes(kebabKey)) return;
                el.style.setProperty(kebabKey, sVal, 'important');
              }
            });
          }

          if (val.href) {
            let aParent = el.closest('a');
            if (!aParent) {
              aParent = document.createElement('a');
              el.parentNode.insertBefore(aParent, el);
              aParent.appendChild(el);
            }
            aParent.href = val.href;
            aParent.removeAttribute('onclick'); // Remover comportamientos viejos
          } else if (val.href === '') {
            let aParent = el.closest('a');
            if (aParent) aParent.removeAttribute('href');
          }
        }
      });
    }

    // 3. Cards (overrides de productos existentes en HTML)
    if (ui.cards) {
      // 3.a. Auto-asignar IDs a las tarjetas HTML que no lo tienen (igual que hace el editor)
      let count = 0;
      document.querySelectorAll('.card:not(.yt-card)').forEach((card) => {
        if (card.dataset.id || card.dataset.pixisId) return;

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
        card.dataset.pixisId = slug;
        count++;
      });

      // 3.b. Aplicar los datos a las tarjetas
      Object.entries(ui.cards).forEach(([cardId, data]) => {
        document.querySelectorAll(`.card[data-id="${cardId}"], [data-pixis-id="${cardId}"]`).forEach(card => {
          if (data.title !== undefined) {
            card.dataset.title = data.title;
            const h3 = card.querySelector('h3');
            if (h3) h3.textContent = data.title;
          }
          if (data.price !== undefined) {
            card.dataset.price = data.price;
          }
          if (data.priceNum !== undefined) {
            const btn = card.querySelector('.btn-add-cart');
            if (btn) btn.dataset.price = data.priceNum;
          }
          if (data.priceLocal !== undefined || data.cashPrice !== undefined) {
            const val = data.priceLocal || data.cashPrice;
            const btn = card.querySelector('.btn-add-cart');
            if (btn) { btn.dataset.priceLocal = val; btn.dataset.priceOnline = val; }
            card.dataset.cashPrice = val;
          }

          // Actualización visual del precio (Prioridad Precio Especial)
          const finalVisiblePrice = data.cashPrice || data.priceLocal || (data.priceNum ? data.priceNum : (data.price ? data.price.replace(/[$. ]/g, '') : null));
          if (finalVisiblePrice) {
            const numFinal = Number(finalVisiblePrice);
            const hasDecFinal = (numFinal % 1) !== 0;
            const formatted = `$${numFinal.toLocaleString('es-AR', {minimumFractionDigits: hasDecFinal ? 2 : 0, maximumFractionDigits: 2})}`;
            const sp = card.querySelector('.precio');
            if (sp) {
              sp.textContent = formatted;
              // Asegurar que tenga el label de PRECIO ESPECIAL si no lo tiene
              if (!card.querySelector('.precio-label')) {
                const label = document.createElement('span');
                label.textContent = 'PRECIO ESPECIAL';
                label.className = 'precio-label';
                sp.before(label);
                if (sp.parentElement && !sp.parentElement.classList.contains('precio-box')) {
                  sp.parentElement.classList.add('precio-box');
                }
              }
            }
          }
          if (data.img !== undefined && data.img) {
            card.dataset.img = data.img;
            const im = card.querySelector('img:not(.fly-product)');
            if (im) im.src = window.optimizeImageUrl(data.img, im.offsetWidth || 400);
          }
          if (data.desc !== undefined) card.dataset.desc = data.desc;
          if (data.banners !== undefined) card.dataset.banners = JSON.stringify(data.banners);
          if (data.category !== undefined) card.dataset.category = data.category;
          if (data.category2 !== undefined) card.dataset.category2 = data.category2;
          if (data.category3 !== undefined) card.dataset.category3 = data.category3;

          // cashPrice ya se manejó arriba en la lógica unificada de precio visual
          if (data.cashPrice !== undefined) {
            card.dataset.cashPrice = data.cashPrice;
          }

          // Stock
          const esSinStock = (data.inStock === false) || (data.stock !== undefined && data.stock !== null && data.stock !== '' && Number(data.stock) === 0);
          if (esSinStock) {
            card.classList.add('sin-stock');
          } else {
            card.classList.remove('sin-stock');
          }
          if (data.stock !== undefined) card.dataset.stock = data.stock;
          if (data.iva !== undefined) card.dataset.iva = data.iva;

          // Próximo Ingreso
          if (data.proximoIngreso === true) {
            card.classList.add('proximo-ingreso');
            card.dataset.proximoIngreso = 'true';
            card.setAttribute('href', 'javascript:void(0);');
            const topBar = card.querySelector('.card-top-bar');
            if (topBar) {
              let pill = topBar.querySelector('.card-pill');
              if (pill) {
                pill.className = 'card-pill badge-proximo';
                pill.textContent = '⏳ Próximamente';
              }
              let stockPill = topBar.querySelector('.card-stock-pill');
              if (stockPill) {
                stockPill.className = 'card-stock-pill stock-proximo';
                stockPill.textContent = '● Próximo';
              }
            }
          } else if (data.proximoIngreso === false) {
            card.classList.remove('proximo-ingreso');
            card.dataset.proximoIngreso = 'false';
            const topBar = card.querySelector('.card-top-bar');
            if (topBar) {
              let pill = topBar.querySelector('.card-pill');
              if (pill) {
                pill.className = 'card-pill badge-destacado';
                pill.textContent = '★ Destacado';
              }
              let stockPill = topBar.querySelector('.card-stock-pill');
              if (stockPill) {
                stockPill.className = 'card-stock-pill stock-disponible';
                stockPill.textContent = '● En stock';
              }
            }
          }

          // Botones personalizados
          if (data.customButtons) {
            card.dataset.customButtons = JSON.stringify(data.customButtons);
            // Ya no los inyectamos en la card (irían al modal)
            card.querySelectorAll('.btn-custom-pixis').forEach(b => b.remove());
          }
          // [VIDEO SUPPORT] Aplicar videoUrl al dataset de la card (overrides HTML)
          if (data.videoUrl !== undefined || data.video !== undefined) {
            const v = data.videoUrl || data.video;
            card.dataset.videoUrl = v;
            card.dataset.video = v;
          }
        });
      });
    }


    // 4. Secciones
    if (ui.sections) {
      Object.entries(ui.sections).forEach(([id, secData]) => {
        const sec = document.getElementById(id) || document.querySelector(`[data-pixis-id="${id}"]`);
        if (!sec) return;

        // MOBILE GUARD: estos elementos de layout de producto tienen valores
        // pensados para desktop (widths enormes, transforms) que rompen mobile
        const _mobileSkipIds = ['product-back-bar', 'product-page-content', 'product-categories-nav'];
        if (_isMobile && _mobileSkipIds.includes(id)) {
          sec.style.removeProperty('width');
          sec.style.removeProperty('max-width');
          sec.style.removeProperty('transform');
          sec.style.removeProperty('height');
          sec.style.removeProperty('font-size');
          sec.style.removeProperty('line-height');
          sec.style.removeProperty('position');
          sec.style.removeProperty('left');
          sec.style.removeProperty('top');
          sec.style.removeProperty('display');
          return;
        }
        
        // Si tiene la propiedad style (objeto completo), usarla. Si no, usar el objeto raíz para compatibilidad.
        const styles = secData.style || secData;
        Object.entries(styles).forEach(([prop, val]) => {
          if (val !== undefined && val !== null && val !== '') {
            // Traducir camelCase a kebab-case para setProperty
            let kebabProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
            if (kebabProp.startsWith("webkit-")) {
              kebabProp = "-" + kebabProp;
            }
            // MOBILE GUARD: omitir transform/width/position en mobile
            if (_isMobile && _desktopOnlyProps.includes(kebabProp)) return;
            sec.style.setProperty(kebabProp, val, 'important');
          }
        });
        
        // Mantener compatibilidad con campos viejos en la raíz
        if (secData.paddingTop) sec.style.setProperty('padding-top', secData.paddingTop, 'important');
        if (secData.paddingBottom) sec.style.setProperty('padding-bottom', secData.paddingBottom, 'important');
        if (secData.backgroundColor) {
          const ds = this.state.site && this.state.site.designSettings ? this.state.site.designSettings : {};
          const isLightMode = document.body.classList.contains('light-mode');
          const designColor = isLightMode ? ds.oficinaCardBgColor : ds.gamerCardBgColor;
          const isProductSection = id === 'product-page-content' || 
                                   id === 'product-page-content' ||
                                   sec.classList.contains('modal-content') ||
                                   sec.classList.contains('modal-grid') ||
                                   sec.classList.contains('modal-info');
          if (!(isProductSection && designColor)) {
            sec.style.setProperty('background-color', secData.backgroundColor, 'important');
          } else if (isProductSection && designColor) {
            sec.style.setProperty('background-color', designColor, 'important');
          }
        }
        if (secData.display !== undefined) sec.style.setProperty('display', secData.display, 'important');
      });
    }

    // 5. Datos del sitio
    if (site.topBannerText) {
      const banner = document.querySelector('.header-top-text span');
      if (banner) banner.textContent = site.topBannerText;
    }
    if (site.address) {
      const addr = document.querySelector('.ubicacion small');
      if (addr) addr.textContent = site.address;
    }

    // Redes Sociales y Links
    if (site.instagram) {
      document.querySelectorAll('.red.instagram').forEach(el => el.href = site.instagram);
    }
    if (site.facebook) {
      document.querySelectorAll('.red.facebook').forEach(el => el.href = site.facebook);
    }
    if (site.tiktok) {
      document.querySelectorAll('.red.tiktok').forEach(el => el.href = site.tiktok);
    }
    if (site.youtube) {
      document.querySelectorAll('.red.Youtube, .red.youtube').forEach(el => el.href = site.youtube);
    }
    if (site.whatsappLink) {
      // Actualiza todos los href que apuntan a wa.me o son de contacto directo
      document.querySelectorAll('a[href*="wa.me"], a.btn-wsp').forEach(el => {
        // Evita pisar enlaces si tienen customButtons, solo los genéricos
        if (!el.classList.contains('btn-custom-pixis')) el.href = site.whatsappLink;
      });
    }

    // Botón principal de aplicar cambios
    const applyBtn = document.querySelector('.btn-apply-state');
    if (applyBtn) {
      // Si ya tiene el tooltip lo ignoramos, si no lo agregamos
      if (!applyBtn.querySelector('.apply-legend')) {
        const legend = document.createElement('div');
        legend.className = 'apply-legend';
        legend.style.cssText = 'position:absolute; bottom:-12px; right:0; font-size:9px; color:#aaa; width:max-content; pointer-events:none; opacity:0.7;';
        legend.innerHTML = 'Presiona aquí para subir todos tus cambios a la web pública.';
        applyBtn.style.position = 'relative';
        applyBtn.appendChild(legend);
      }
    }

    // 5. Banners Promocionales Dinámicos
    if (site.banners) {
      window._bannerData = { ...window._bannerData, ...site.banners };
    }

    // 5b. Carrusel Dinámico (Fase B: Inyección)
    let hasDynamicCarousel = false;
    // Carrusel Superior
    if (site.carouselTop && site.carouselTop.length > 0) {
      renderDynamicCarousel(site.carouselTop, '.banner-carousel');
      hasDynamicCarousel = true;
    }
    // Carrusel Inferior
    if (site.carouselBottom && site.carouselBottom.length > 0) {
      renderDynamicCarousel(site.carouselBottom, '.nuevos-ingresos .banner-carousel');
      hasDynamicCarousel = true;
    }

    // Re-inicializar lógica de movimiento una sola vez al final
    if (hasDynamicCarousel && window.initPixisBanners) {
      window.initPixisBanners();
    }

  // 5d. Banners Showcase Personalizados Duales (Destacados, Nuevos Ingresos, Reels y Aprende)
  window.applyShowcaseBannerMedia = function(cardId, bannerData) {
    const card = document.getElementById(cardId);
    if (!card) return;

    const pcMedia = (bannerData?.img || bannerData?.imgPc || '').trim();
    const mobileMedia = (bannerData?.imgMobile || '').trim() || pcMedia;
    const title = (bannerData?.title || '').trim();

    const isVideo = (url) => {
      if (!url) return false;
      const clean = url.split('?')[0].toLowerCase();
      return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.ogg') || clean.endsWith('.mov') || clean.includes('/video/');
    };

    let mediaBg = card.querySelector('.showcase-banner-media-bg');

    if (!pcMedia && !mobileMedia) {
      if (mediaBg) mediaBg.remove();
      card.classList.remove('has-custom-bg', 'has-custom-img', 'has-custom-video');
      card.style.removeProperty('--banner-bg-pc');
      card.style.removeProperty('--banner-bg-mobile');
      card.style.backgroundImage = '';
      return;
    }

    card.classList.add('has-custom-bg');
    if (isVideo(pcMedia) || isVideo(mobileMedia)) {
      card.classList.add('has-custom-video');
    } else {
      card.classList.remove('has-custom-video');
    }

    if (!mediaBg) {
      mediaBg = document.createElement('div');
      mediaBg.className = 'showcase-banner-media-bg';
      const content = card.querySelector('.showcase-banner-content');
      if (content) {
        card.insertBefore(mediaBg, content);
      } else {
        card.appendChild(mediaBg);
      }
    }

    const isPcVideo = isVideo(pcMedia);
    const hasMobileAlt = Boolean(mobileMedia && mobileMedia !== pcMedia);
    const isMobVideo = isVideo(mobileMedia);
    let html = '';

    if (isPcVideo) {
      html += `<video class="showcase-bg-media showcase-media-pc${hasMobileAlt ? ' has-mobile-alt' : ''}" autoplay loop muted playsinline src="${pcMedia}"></video>`;
    } else if (pcMedia) {
      html += `<img class="showcase-bg-media showcase-media-pc${hasMobileAlt ? ' has-mobile-alt' : ''}" src="${pcMedia}" alt="${title || 'Banner'}" loading="lazy" />`;
    }

    if (hasMobileAlt) {
      if (isMobVideo) {
        html += `<video class="showcase-bg-media showcase-media-mobile" autoplay loop muted playsinline src="${mobileMedia}"></video>`;
      } else {
        html += `<img class="showcase-bg-media showcase-media-mobile" src="${mobileMedia}" alt="${title || 'Banner'}" loading="lazy" />`;
      }
    }

    html += `<div class="showcase-banner-media-overlay"></div>`;
    mediaBg.innerHTML = html;

    // Actualización reactiva de textos, etiquetas, emojis, descripciones y botones
    if (bannerData) {
      if (bannerData.tag && bannerData.tag.trim()) {
        const tagEl = card.querySelector('.showcase-banner-tag');
        if (tagEl) tagEl.textContent = bannerData.tag.trim();
      }
      if (bannerData.title && bannerData.title.trim()) {
        const titleEl = card.querySelector('.showcase-banner-title');
        if (titleEl) titleEl.textContent = bannerData.title.trim();
      }
      if (bannerData.emoji && bannerData.emoji.trim()) {
        const iconEl = card.querySelector('.showcase-banner-icon');
        if (iconEl) {
          const em = bannerData.emoji.trim();
          if (em.startsWith('fa-') || em.startsWith('fas ') || em.startsWith('far ') || em.startsWith('fab ')) {
            const faCls = em.includes('fa ') || em.includes('fas ') || em.includes('far ') || em.includes('fab ') ? em : 'fas ' + em;
            iconEl.innerHTML = `<i class="${faCls}"></i>`;
          } else {
            iconEl.innerHTML = `<span style="font-size: 26px; line-height: 1;">${em}</span>`;
          }
        }
      }
      if (bannerData.desc && bannerData.desc.trim()) {
        const descEl = card.querySelector('.showcase-banner-desc');
        if (descEl) descEl.textContent = bannerData.desc.trim();
      }
      if (bannerData.btnText && bannerData.btnText.trim()) {
        const btnEl = card.querySelector('.showcase-banner-action-btn');
        if (btnEl) btnEl.textContent = bannerData.btnText.trim();
      }
      if (bannerData.headerTitle && bannerData.headerTitle.trim()) {
        let headerBtn = null;
        if (cardId === 'showcaseBannerDestacados') headerBtn = document.querySelector('.destacados-title-btn');
        else if (cardId === 'showcaseBannerNuevos') headerBtn = document.querySelector('.nuevos-title-btn');
        if (headerBtn) {
          headerBtn.innerHTML = `${bannerData.headerTitle.trim()} <span class="title-btn-arrow">›</span>`;
        }
      }
    }
  };

  if (site.showcaseBanners) {
    window.applyShowcaseBannerMedia('showcaseBannerDestacados', site.showcaseBanners.destacados);
    window.applyShowcaseBannerMedia('showcaseBannerNuevos', site.showcaseBanners.nuevos);
    window.applyShowcaseBannerMedia('showcaseBannerReels', site.showcaseBanners.reels);
    window.applyShowcaseBannerMedia('showcaseBannerAprende', site.showcaseBanners.aprende);
  }

    // 5c. Menú Lateral de Categorías (Dinámico y con auto-ocultado)
    if (this.state.categories && this.state.categories.length > 0) {
      const menuLista = document.querySelector('.categorias-lista');
      if (menuLista) {
        let htmlMenu = '';
        const isEditor = window.location.search.includes('edit=true');

        // Mapeo de iconos Line-Art
        const iconMap = {
          'Notebook': '<i class="fas fa-laptop"></i>',
          'Placas de video': '<i class="fas fa-microchip"></i>',
          'Procesadores': '<i class="fas fa-cpu"></i>',
          'gabinetes': '<i class="fas fa-desktop"></i>',
          'monitores': '<i class="fas fa-tv"></i>',
          'fuentes': '<i class="fas fa-bolt"></i>',
          'red': '<i class="fas fa-wifi"></i>',
          'Memorias Ram': '<i class="fas fa-memory"></i>',
          'Camara de Seguridad': '<i class="fas fa-camera"></i>',
          'Cargadores': '<i class="fas fa-plug"></i>',
          'Periféricos': '<i class="fas fa-keyboard"></i>',
          'Placas madres': '<i class="fas fa-hard-drive"></i>',
          'Herramientas': '<i class="fas fa-tools"></i>',
          'almacenamiento': '<i class="fas fa-database"></i>',
          'refrigeracion': '<i class="fas fa-fan"></i>',
          'Cables': '<i class="fas fa-link"></i>',
          'Sillas y Escritorios Gamer': '<i class="fas fa-chair"></i>'
        };


        // Agregar las categorías dinámicas
        this.state.categories.forEach(cat => {
          if (cat.id !== 'destacados' && cat.id !== 'nuevos' && cat.active !== false) {
            let iconHtml = '';
            const mobileIcon = cat.icon || '📁';

            // Prioridad para DESKTOP: 1. PNG Custom, 2. Icono mapeado, 3. Emoji original
            if (cat.customIcon) {
              const iconVersion = isEditor ? Date.now() : (window.PIXIS_VERSION || Date.now());
              const iconUrl = cat.customIcon.includes('?') ? `${cat.customIcon}&v=${iconVersion}` : `${cat.customIcon}?v=${iconVersion}`;
              iconHtml = `<img src="${iconUrl}" class="cat-icon-img" data-cat-id="${escStateHtml(cat.id)}" alt="${cat.name}">`;
            } else if (iconMap[cat.id]) {
              iconHtml = iconMap[cat.id];
            } else {
              iconHtml = mobileIcon;
            }

            htmlMenu += `
              <a href="#${escStateHtml(cat.id)}" onclick="if(!(event.button===1 || event.ctrlKey || event.metaKey)){ event.preventDefault(); if(window.abrirCategoria) window.abrirCategoria('${escStateHtml(cat.id)}'); }">
                <span class="cat-icon-mobile">${mobileIcon}</span>
                <div class="cat-icon-frame">${iconHtml}</div>
                <span class="cat-name">${escStateHtml(cat.name)}</span>
                ${isEditor ? `<button class="pixis-edit-cat-btn" onclick="event.stopPropagation(); window.PixisEditorAPI.editCategoryIcon('${escStateHtml(cat.id)}')">✏️</button>` : ''}
              </a>`;
          }
        });


        menuLista.innerHTML = htmlMenu;

        // Sincronizar resaltado después de renderizar dinámicamente
        if (typeof window.actualizarEnlaceActivo === 'function') window.actualizarEnlaceActivo();
      }
    }


    // 6. Elementos eliminados
    if (ui.deleted && ui.deleted.length > 0) {
      ui.deleted.forEach(id => {
        const el = document.querySelector(`[data-pixis-id="${id}"]`);
        if (el) el.remove();
      });
    }

    // 8. Productos del JSON (cards dinámicas inyectadas)
    if (this.state.products && this.state.products.length > 0) {
      renderDynamicProducts(this.state.products);
    }

    // 9. Re-inicializar carruseles y banners para asegurar que los botones funcionen
    if (window.initPixisCarousels) window.initPixisCarousels();
    if (window.initPixisBanners) window.initPixisBanners();

    // 10. Notificar que el estado está listo
    document.dispatchEvent(new CustomEvent('pixis:state-ready'));

    // Renderizar módulos laterales (Banners & Reels) si están configurados
    if (typeof window.renderLateralBannersAndReels === 'function') {
      window.renderLateralBannersAndReels();
    }
    if (typeof window.renderFanpageLaterals === 'function') {
      window.renderFanpageLaterals();
    }

    // Restaurar scroll de forma segura e instantánea ante colapsos de layout temporales
    if (window.scrollY !== savedScrollY) {
      window.scrollTo(window.scrollX, savedScrollY);
    }
    // Fallback con microtarea / setTimeout por si el navegador realiza un reflow asíncrono
    setTimeout(() => {
      if (window.scrollY !== savedScrollY) {
        window.scrollTo(window.scrollX, savedScrollY);
      }
    }, 0);
  }
};

window.optimizeImageUrl = (url, width) => window.PixisState.optimizeImageUrl(url, width);

/* ─── HELPER: renderizar carrusel dinámico ─────────────────── */
function renderDynamicCarousel(slides, carouselSelector) {
  const carousel = document.querySelector(carouselSelector);
  if (!carousel) return;

  const container = carousel.closest('.banner-carousel-outer') || carousel;
  const track = carousel.querySelector('.banner-track');
  const dotsContainer = container.querySelector('.banner-dots');
  if (!track) return;

  const html = slides.map(s => `
    <a href="?banner=${escStateHtml(s.bannerId)}" class="banner-slide dynamic-slide" style="cursor: pointer;" 
       onclick="if(!(event.button===1 || event.ctrlKey || event.metaKey)){ event.preventDefault(); window.abrirBannerLink('${escStateHtml(s.bannerId)}'); }">
      <picture>
        ${s.imgMobile ? `<source media="(max-width: 768px)" srcset="${window.optimizeImageUrl(s.imgMobile, 768)}">` : ''}
        <img src="${window.optimizeImageUrl(s.imgPc || s.imgMobile, 1200)}" alt="Promo">
      </picture>
    </a>
  `).join('');

  // Limpiar previos dinámicos
  track.querySelectorAll('.dynamic-slide').forEach(el => el.remove());

  // En Fase B, los ponemos ANTES de los estáticos
  track.insertAdjacentHTML('afterbegin', html);

  // Limpiar dots para que se regeneren en initPixisBanners
  if (dotsContainer) dotsContainer.innerHTML = '';

  // IMPORTANTE: Resetear el estado de inicialización para que initPixisBanners pueda re-vincular los eventos
  delete carousel.dataset.init;
}

/* ─── HELPER: renderizar productos del JSON (no los del HTML) ── */
function renderDynamicProducts(products) {
  const container = document.getElementById('dynamic-catalog-container');
  if (!container) return;

  // 1. Asegurar que el contenedor dinámico esté DENTRO del catálogo completo
  const catalogoCompleto = document.querySelector('#catalogo-completo .Gabinetes');
  if (catalogoCompleto && container.parentNode !== catalogoCompleto) {
    catalogoCompleto.appendChild(container);
  }

  // 2. Limpiar productos dinámicos anteriores
  container.innerHTML = '';
  // 1. Construir un Set de IDs de categorías válidas actualmente activas
  const activeCatIds = new Set(
    (window.PixisState && window.PixisState.state.categories)
      ? window.PixisState.state.categories
        .filter(c => c.active !== false)
        .map(c => c.id)
      : []
  );

  const generateSlug = (text) => {
    return text.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  };

  // 2. Limpiar tarjetas dinámicas anteriores
  document.querySelectorAll('.card.dynamic-injected').forEach(el => el.remove());

  // 2b. Limpiar los carruseles especiales si existen
  const destacadosTrack = document.getElementById('destacadosTrack');
  if (destacadosTrack) destacadosTrack.innerHTML = '';

  const nuevosIngresosTrack = document.getElementById('nuevosIngresosTrack');
  if (nuevosIngresosTrack) nuevosIngresosTrack.innerHTML = '';

  // 2c. Limpiar todos los contenedores de productos existentes en el HTML (Migración JSON)
  // Esto asegura que no queden tarjetas estáticas duplicadas, pero PROTEGEMOS las secciones de Reels y Videos.
  document.querySelectorAll('.productos').forEach(p => {
    const isDynamicContainer = p.id === 'dynamic-catalog-container';
    const isSpecialSection = p.closest('.reels-section') || p.closest('.videos-section');

    if (!isDynamicContainer && !isSpecialSection) {
      p.innerHTML = '';
    }
  });

  // 3. PRE-CREAR CONTENEDORES PARA TODAS LAS CATEGORÍAS ACTIVAS
  // Asegura que cada opción del Menú de Productos tenga su propio lugar físico.
  if (container) {
    activeCatIds.forEach(catId => {
      // 1. Ver si ya existe en el HTML estático (Case-Insensitive)
      let targetH3 = null;
      const allH3 = document.querySelectorAll('h3.categoria');
      for (const h3 of allH3) {
        if (h3.id.toLowerCase() === catId.toLowerCase()) {
          targetH3 = h3;
          break;
        }
      }

      // 2. Si no existe, lo creamos en el contenedor dinámico
      if (!targetH3 && !container.querySelector(`.dynamic-cat-wrapper[data-cat="${catId}"]`)) {
        const newCatWrapper = document.createElement('div');
        newCatWrapper.className = 'dynamic-cat-wrapper Gabinetes';
        newCatWrapper.dataset.cat = catId;

        let catName = catId.toUpperCase();
        const found = (window.PixisState && window.PixisState.state.categories)
          ? window.PixisState.state.categories.find(c => c.id === catId)
          : null;
        if (found) catName = found.name.toUpperCase();

        newCatWrapper.innerHTML = `
          <h3 id="${catId}" class="categoria pulsante">${catName}</h3>
          <div class="categoria-ui">
            <div class="filtros-panel">
              <button class="btn-view-toggle" title="Cambiar vista" aria-label="Cambiar vista">
                <svg class="icon-grid" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                <svg class="icon-list" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="18" height="3"/><rect x="3" y="10.5" width="18" height="3"/><rect x="3" y="17" width="18" height="3"/></svg>
                <span class="btn-view-label">Vista cuadrícula</span>
              </button>
              <span class="filtro-titulo">Ordenar por:</span>
              <label class="switch-precio">
                <input type="checkbox" class="toggle-precio">
                <span class="slider"></span>
                <span class="switch-text">Precio menor a mayor</span>
              </label>
              <div class="filtros-categoria"></div>
            </div>
          </div>
          <div class="productos"></div>
          <br><br>
        `;
        container.appendChild(newCatWrapper);
      }
    });
  }

  // 4. INYECTAR PRODUCTOS
  let destacadosShowcaseCount = 0;
  let nuevosShowcaseCount = 0;

  products.forEach(prod => {
    const assignedCats = [];
    if (prod.category) assignedCats.push(prod.category.trim());
    if (prod.category2) assignedCats.push(prod.category2.trim());
    if (prod.category3) assignedCats.push(prod.category3.trim());

    const validCats = [...new Set(assignedCats)].filter(catId => {
      return catId && (activeCatIds.size === 0 || activeCatIds.has(catId));
    });

    if (validCats.length === 0) return;

    // Fuente de verdad canónica: slug guardado en JSON → slug generado del título
    const slug = prod.slug || generateSlug(prod.title || 'producto');
    const displayPrice = prod.priceLocal || prod.price || 0;
    const numDisplay = Number(displayPrice);
    const hasDecDisp = (numDisplay % 1) !== 0;
    const priceFormatted = `$${numDisplay.toLocaleString('es-AR', {minimumFractionDigits: hasDecDisp ? 2 : 0, maximumFractionDigits: 2})}`;

    const numTransfer = Number(prod.price || 0);
    const hasDecTrans = (numTransfer % 1) !== 0;
    const transferPriceFormatted = `$${numTransfer.toLocaleString('es-AR', {minimumFractionDigits: hasDecTrans ? 2 : 0, maximumFractionDigits: 2})}`;
    // Imagen de portada: siempre el campo img (una sola)
    const coverImg = (prod.img || '').trim().split(',')[0].trim();
    // Galería: usamos prod.gallery (todas las imágenes), o prod.img si contiene varias separadas por coma
    const galleryStr = (prod.gallery || prod.img || '').trim();

    validCats.forEach(catId => {
      const card = document.createElement('a');

      const isProximo = prod.proximoIngreso === true;
      card.className = `card pulsante2 dynamic-injected${isProximo ? ' proximo-ingreso' : ''}`;
      card.href = prod.id ? `/${slug}--id-${prod.id}` : `/${slug}`;

      card.dataset.title = prod.title || '';
      card.dataset.price = transferPriceFormatted;
      card.dataset.img = coverImg;
      card.dataset.category = catId;
      // Siempre asignar gallery (aunque sea una sola imagen) para que cart.js la use
      if (galleryStr) card.dataset.gallery = galleryStr;
      card.dataset.desc = prod.desc || '';
      const subcat = prod.subcategoria || '';
      card.dataset.subcategoria = subcat;
      card.setAttribute('data-subcategoria', subcat);
      card.dataset.pixisId = prod.id || '';
      card.dataset.pixisSlug = slug;
      card.dataset.proximoIngreso = isProximo ? 'true' : 'false';
      if (isProximo) card.classList.add('proximo-ingreso');
      if (prod.customButtons) card.dataset.customButtons = JSON.stringify(prod.customButtons);
      if (prod.banners) card.dataset.banners = JSON.stringify(prod.banners);
      const esSinStock = (prod.inStock === false) || (prod.stock !== undefined && prod.stock !== null && prod.stock !== '' && Number(prod.stock) === 0);
      if (esSinStock) card.classList.add('sin-stock');
      if (prod.stock !== undefined && prod.stock !== null) card.dataset.stock = prod.stock;
      if (prod.iva !== undefined && prod.iva !== null) card.dataset.iva = prod.iva;
      // [VIDEO SUPPORT] Aplicar videoUrl y video al dataset de la card para que cart.js lo lea
      if (prod.videoUrl || prod.video) {
        const v = prod.videoUrl || prod.video;
        card.dataset.videoUrl = v;
        card.dataset.video = v;
      }

      card.innerHTML = `
        <div class="card-top-bar">
          ${isProximo 
            ? '<span class="card-pill badge-proximo">⏳ Próximamente</span>' 
            : (catId === 'nuevos' ? '<span class="card-pill badge-nuevo">★ Nuevo</span>' : '<span class="card-pill badge-destacado">★ Destacado</span>')}
          <span class="card-stock-pill ${isProximo ? 'stock-proximo' : (esSinStock ? 'stock-agotado' : 'stock-disponible')}">
            ${isProximo ? '● Próximo' : (esSinStock ? '● Sin stock' : '● En stock')}
          </span>
        </div>
        <div class="card-img-wrap">
          <img src="${window.optimizeImageUrl(coverImg, 400)}" alt="${escStateHtml(prod.title)}" loading="lazy">
        </div>
        <div class="card-subcat">${escStateHtml(prod.subcategoria || 'Hardware')}</div>
        <h3 class="card-title">${escStateHtml(prod.title)}</h3>
        <div class="precio-box">
          <span class="precio-label">PRECIO ESPECIAL WEB</span>
          <span class="precio">${priceFormatted}</span>
        </div>
        <div class="card-actions">
          <div class="card-qty-stepper" onclick="event.preventDefault(); event.stopPropagation();">
            <button type="button" class="card-qty-btn qty-minus" onclick="event.preventDefault(); event.stopPropagation();" aria-label="Restar">−</button>
            <input type="number" class="card-qty-input" value="0" min="0" max="${prod.stock || 99}" aria-label="Cantidad" onclick="event.preventDefault(); event.stopPropagation();" onmousedown="event.stopPropagation();">
            <button type="button" class="card-qty-btn qty-plus" onclick="event.preventDefault(); event.stopPropagation();" aria-label="Sumar">+</button>
          </div>
          <button type="button" class="btn-add-cart ${isProximo ? 'btn-reservar' : ''}"
                  data-name="${escStateHtml(prod.title)}"
                  data-price="${prod.price}"
                  data-price-local="${prod.priceLocal || prod.price}">
            ${isProximo ? '🛒 Reservar' : '<i class="fas fa-shopping-cart"></i> Agregar'}
          </button>
        </div>
      `;

      if (catId === 'destacados') {
        const destacadosTrack = document.getElementById('destacadosTrack');
        // Limitar a los primeros 10 productos (2 filas de 5) en el inicio
        if (destacadosTrack && destacadosShowcaseCount < 10) {
          destacadosTrack.appendChild(card);
          destacadosShowcaseCount++;
        }

        // Inyección Dual: Agregar TODOS los productos al catálogo completo para la vista de colección
        const catH3 = document.getElementById('destacados');
        if (catH3) {
          const wrapper = catH3.closest('.dynamic-cat-wrapper');
          const catContainer = wrapper ? wrapper.querySelector('.productos') : null;
          if (catContainer) {
            catContainer.appendChild(card.cloneNode(true));
          }
        }
      } else if (catId === 'nuevos') {
        const nuevosTrack = document.getElementById('nuevosIngresosTrack');
        // Limitar a los primeros 10 productos (2 filas de 5) en el inicio
        if (nuevosTrack && nuevosShowcaseCount < 10) {
          nuevosTrack.appendChild(card);
          nuevosShowcaseCount++;
        }

        // Inyección Dual: Agregar TODOS los productos al catálogo completo para la vista de colección
        const catH3 = document.getElementById('nuevos');
        if (catH3) {
          const wrapper = catH3.closest('.dynamic-cat-wrapper');
          const catContainer = wrapper ? wrapper.querySelector('.productos') : null;
          if (catContainer) {
            catContainer.appendChild(card.cloneNode(true));
          }
        }
      } else {
        let targetSection = null;
        const catH3 = document.getElementById(catId);
        if (catH3) {
          let nextEl = catH3.nextElementSibling;
          while (nextEl && !nextEl.matches('h3.categoria, h2')) {
            if (nextEl.classList.contains('productos')) {
              targetSection = nextEl;
              break;
            }
            nextEl = nextEl.nextElementSibling;
          }
        }
        if (targetSection) {
          targetSection.appendChild(card);
        }
      }
    });
  });

  // 3. Sincronizar el orden original para el sistema de filtrado/ordenado
  // Esto evita que al desactivar el "Ordenar por precio" los productos dinámicos desaparezcan
  document.querySelectorAll('.productos').forEach(p => {
    p.dataset.originalOrder = p.innerHTML;
  });

  // PASO 1: Generar filtros dinámicos desde las subcategorías reales del JSON
  generarFiltrosDinamicos();

  // PASO 3: Notificar a cart.js que los productos fueron renderizados
  document.dispatchEvent(new CustomEvent('pixis:productos-renderizados'));
  window._productosListos = true; // 🚩 Bandera de seguridad para Deep Linking
}

/* ─── HELPER: generar filtros dinámicos desde subcategorías reales ── */
function generarFiltrosDinamicos() {

  // 1. Procesar secciones estáticas del HTML (con h3 ya existentes)
  document.querySelectorAll('#catalogo-completo h3.categoria').forEach(h3 => {
    const catId = h3.id;
    if (!catId) return;

    let filtrosCat = null;
    let productosEl = null;
    let nextEl = h3.nextElementSibling;

    while (nextEl && !nextEl.matches('h3.categoria, h2')) {
      if (!filtrosCat) {
        const fc = nextEl.querySelector('.filtros-categoria[data-static-placeholder]');
        if (fc) filtrosCat = fc;
      }
      if (!productosEl && nextEl.classList.contains('productos')) {
        productosEl = nextEl;
      }
      nextEl = nextEl.nextElementSibling;
    }

    if (!filtrosCat || !productosEl) return;

    // Recopilar subcategorías únicas de las cards inyectadas
    const subcats = new Set();
    productosEl.querySelectorAll('.card').forEach(card => {
      const sub = (card.getAttribute('data-subcategoria') || card.dataset.subcategoria || '').trim();
      if (sub) subcats.add(sub);
    });

    // Generar botones: Todos + uno por subcategoría
    let html = '<button class="btn-filtro activo" data-filter="all">Todos</button>';
    subcats.forEach(sub => {
      html += `<button class="btn-filtro" data-filter="${escStateHtml(sub)}">${escStateHtml(sub)}</button>`;
    });

    filtrosCat.innerHTML = html;
    filtrosCat.dataset.dynamicGenerated = 'true'; // marcar como generado dinámicamente
  });

  // 2. Procesar secciones dinámicas creadas por renderDynamicProducts (sin h3 estático)
  document.querySelectorAll('.dynamic-cat-wrapper').forEach(wrapper => {
    const catId = wrapper.dataset.cat;
    if (!catId) return;

    const productosEl = wrapper.querySelector('.productos');
    if (!productosEl) return;

    // Crear panel de filtros si no existe
    let categoriaUI = wrapper.querySelector('.categoria-ui');
    if (!categoriaUI) {
      categoriaUI = document.createElement('div');
      categoriaUI.className = 'categoria-ui';
      categoriaUI.innerHTML = `
        <div class="filtros-panel">
          <button class="btn-view-toggle" title="Cambiar vista" aria-label="Cambiar vista">
            <svg class="icon-grid" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            <svg class="icon-list" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="18" height="3"/><rect x="3" y="10.5" width="18" height="3"/><rect x="3" y="17" width="18" height="3"/></svg>
            <span class="btn-view-label">Vista cuadrícula</span>
          </button>
          <span class="filtro-titulo">Ordenar por:</span>
          <label class="switch-precio">
            <input type="checkbox" class="toggle-precio">
            <span class="slider"></span>
            <span class="switch-text">Precio menor a mayor</span>
          </label>
          <div class="filtros-categoria"></div>
        </div>`;
      productosEl.before(categoriaUI);
    }

    const filtrosCat = categoriaUI.querySelector('.filtros-categoria');
    if (!filtrosCat) return;

    const subcats = new Set();
    productosEl.querySelectorAll('.card').forEach(card => {
      const sub = (card.dataset.subcategoria || '').trim();
      if (sub) subcats.add(sub);
    });

    let html = '<button class="btn-filtro activo" data-filter="all">Todos</button>';
    subcats.forEach(sub => {
      html += `<button class="btn-filtro" data-filter="${escStateHtml(sub)}">${escStateHtml(sub)}</button>`;
    });
    filtrosCat.innerHTML = html;
  });

  // CRÍTICO: Atar los event listeners a los nuevos filtros inyectados
  if (window.reinicializarFiltrosYToggles) {
    window.reinicializarFiltrosYToggles();
  }
}

/* ─── HELPER: botones personalizados ──────────────────────── */
function applyCustomButtons(card, buttons) {
  // Solo guardamos en dataset para que cart.js lo use en el modal
  if (buttons) {
    card.dataset.customButtons = JSON.stringify(buttons);
  }
  // Limpiar si existieran en el DOM de la card
  card.querySelectorAll('.btn-custom-pixis').forEach(b => b.remove());
}

/* ─── HELPER: escape HTML ──────────────────────────────────── */
function escStateHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─── INIT AUTOMÁTICO (solo en modo público, no editor) ──────── */
window.addEventListener('load', async () => {
  // Si el editor está activo, él gestiona la carga y aplicación del estado
  if (window.location.search.includes('edit=true')) return;
  await window.PixisState.loadState();
  window.PixisState.applyStateToDOM();
});

/* ─── ACTUALIZACIÓN REACTIVA DE STOCK EN CARDS SIN RECARGAR ───── */
window.refrescarStockEnCards = function(productoId, nuevoStock, inStock) {
  if (!window.PixisState || !window.PixisState.state || !Array.isArray(window.PixisState.state.products)) return;

  const prod = window.PixisState.state.products.find(p => p.id === productoId || p.title === productoId);
  if (prod) {
    prod.stock = nuevoStock;
    prod.inStock = inStock;

    // Buscar las cards asociadas en el DOM mediante identificadores robustos
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
      const match = (card.dataset.id === prod.id || 
                     card.dataset.pixisId === prod.id || 
                     card.dataset.title === prod.title ||
                     card.querySelector('.btn-add-cart, .btn-reservar')?.dataset?.name === prod.title);
      if (match) {
        card.dataset.stock = nuevoStock;
        card.dataset.inStock = inStock ? 'true' : 'false';

        const stepperInput = card.querySelector('.card-qty-input, input.qty-input, .input-qty');
        const btnAccion = card.querySelector('.btn-add-cart, .btn-reservar, .btn-add-to-cart');
        const btnMinus = card.querySelector('.btn-qty-minus, .qty-btn.minus');
        const btnPlus = card.querySelector('.btn-qty-plus, .qty-btn.plus');

        if (stepperInput) {
          stepperInput.disabled = !inStock;
          if (inStock) {
            if (parseInt(stepperInput.value, 10) === 0 || !stepperInput.value) {
              stepperInput.value = '1';
            }
          } else {
            stepperInput.value = '0';
          }
        }
        if (btnMinus) btnMinus.disabled = !inStock;
        if (btnPlus) btnPlus.disabled = !inStock;
        if (btnAccion) {
          btnAccion.disabled = !inStock;
          btnAccion.classList.toggle('disabled', !inStock);
        }
      }
    });
  }
};