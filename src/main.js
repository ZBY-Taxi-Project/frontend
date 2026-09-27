import { api, playAlertSound } from './api.js';
import {
  initMap,
  updateDriverMarkers,
  focusDriver,
  centerAllDrivers,
  drawOrderRoute,
  clearOrderRoute,
  setTileProvider,
  invalidateMapSize,
} from './map.js';

const ORDER_STATUS_LABELS = {
  new: 'Yangi chaqiruv',
  pending_dispatch: 'Haydovchi kutilmoqda',
  assigned: 'Haydovchiga yuborildi',
  driver_accepted: 'Haydovchi yo‘lda (Mijozga)',
  picked_up: 'Yo‘lovchi mindi',
  in_transit: 'Safar davom etmoqda',
  delivered: 'Safar yakunlandi',
  cancelled: 'Bekor qilindi',
};

const DRIVER_STATUS_LABELS = {
  available: "Bo'sh",
  busy: 'Band (Safarda)',
  offline: 'Oflayn',
};

function formatOrderTitle(orderNumber) {
  if (!orderNumber) return 'Buyurtma';
  if (orderNumber.startsWith('Order ')) {
    return orderNumber.replace('Order ', 'Buyurtma ');
  }
  if (orderNumber.startsWith('ORD-')) {
    return orderNumber.replace('ORD-', 'Buyurtma #');
  }
  return orderNumber;
}

function hasPermission(code) {
  if (!state.user) return false;
  if (state.user.role === 'admin') return true;
  const perms = state.user.permissions || [];
  return perms.includes(code);
}

let state = {
  user: api.user,
  activeTab: 'map', // 'map' | 'orders' | 'fleet' | 'permissions'
  isSidebarCollapsed: false,
  isFleetDrawerOpen: true,
  currentTileProvider: 'dark',
  orders: [],
  selectedOrder: null,
  drivers: [],
  availableDrivers: [],
  // Wallet and permission system state
  topupRequests: [],
  topupCounts: { total: 0, pending: 0, approved: 0, rejected: 0 },
  topupFilterStatus: 'all',
  isTopupModalOpen: false,
  selectedDriverForTopup: null,
  previewReceiptUrl: null,
  systemPermissionsData: null,
  counts: {
    all: 0,
    pending_dispatch: 0,
    assigned: 0,
    active: 0,
    delivered: 0,
    cancelled: 0,
  },
  filterStatus: 'all',
  searchQuery: '',
  driverSearchQuery: '',
  // Instagram-style infinite scroll & pagination
  ordersPage: 1,
  ordersPerPage: 15,
  ordersLastPage: 1,
  ordersTotal: 0,
  ordersLoadingMore: false,
  ordersHasMore: true,
  isNewOrderModalOpen: false,
  isNewDriverModalOpen: false,
  isEditDriverModalOpen: false,
  editingDriver: null,
  isEditOrderModalOpen: false,
  editingOrder: null,
  syncInterval: null,
  lastSyncTimestamp: null,
  errorMsg: null,
};

function render() {
  const app = document.getElementById('app');
  if (!state.user) {
    app.innerHTML = renderLogin();
    bindLoginEvents();
    return;
  }

  // If user is not admin, only 'map' and 'orders' tabs are allowed
  if (state.user.role !== 'admin' && !['map', 'orders'].includes(state.activeTab)) {
    state.activeTab = 'map';
  }
  if (state.activeTab === 'wallet') {
    state.activeTab = 'fleet';
  }

  // Preserve scroll position of orders list if currently open
  const prevOrdersList = document.querySelector('.orders-list');
  const savedScrollTop = prevOrdersList ? prevOrdersList.scrollTop : null;

  app.innerHTML = `
    <div class="app-layout">
      ${renderSidebar()}
      <div class="app-main">
        ${renderTopBar()}
        ${state.activeTab === 'map' ? renderMapView() : state.activeTab === 'orders' ? renderOrdersView() : state.user.role === 'admin' && state.activeTab === 'fleet' ? renderFleetView() : state.user.role === 'admin' && state.activeTab === 'permissions' ? renderPermissionsView() : renderMapView()}
        ${state.isNewOrderModalOpen ? renderNewOrderModal() : ''}
        ${state.user.role === 'admin' && state.isNewDriverModalOpen ? renderNewDriverModal() : ''}
        ${state.user.role === 'admin' && state.isEditDriverModalOpen ? renderEditDriverModal() : ''}
        ${state.user.role === 'admin' && state.isEditOrderModalOpen ? renderEditOrderModal() : ''}
        ${state.user.role === 'admin' && state.isTopupModalOpen ? renderTopupModal() : ''}
        ${state.previewReceiptUrl ? renderReceiptPreviewModal() : ''}
        <div id="toast-container" class="toast-container"></div>
      </div>
    </div>
  `;

  if (savedScrollTop !== null) {
    const newOrdersList = document.querySelector('.orders-list');
    if (newOrdersList) {
      newOrdersList.scrollTop = savedScrollTop;
    }
  }

  bindEvents();

  if (state.activeTab === 'map') {
    setTimeout(async () => {
      await initMap('dispatch-map');
      updateDriverMarkers(state.drivers, (driver) => {
        showToast(`Taksi: ${driver.name} (${DRIVER_STATUS_LABELS[driver.status] || driver.status})`);
      });
      invalidateMapSize();
    }, 60);
  }
}

function renderLogin() {
  return `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;padding:20px;width:100vw;background:var(--bg-primary);">
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-xl);padding:40px;width:100%;max-width:440px;box-shadow:0 20px 40px rgba(0,0,0,0.6);backdrop-filter:blur(20px);">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:28px;">
          <div class="sidebar-logo">🚖</div>
          <div>
            <h2 style="font-size:1.3rem;font-weight:800;letter-spacing:-0.4px;">ZBY Taksi Dispetcher</h2>
            <p style="font-size:0.8rem;color:var(--text-dim);">Taksi Chaqiruvlari va Dispetcherlik Portali</p>
          </div>
        </div>

        ${state.errorMsg ? `<div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:10px 14px;border-radius:var(--radius-sm);font-size:0.82rem;margin-bottom:16px;">${state.errorMsg}</div>` : ''}

        <form id="login-form">
          <div class="form-group">
            <label>Administrator Foydalanuvchi Nomi yoki Email</label>
            <input type="text" id="login-username" class="form-input" value="admin" placeholder="admin" required />
          </div>
          <div class="form-group" style="margin-bottom:24px;">
            <label>Parol</label>
            <input type="password" id="login-password" class="form-input" value="password" required />
          </div>
          <button type="submit" class="btn-new-order" style="width:100%;justify-content:center;padding:12px;font-size:0.95rem;">
            👑 Tizimga Kirish (Administrator)
          </button>
        </form>

        <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:8px;">
          <p style="font-size:0.78rem;color:var(--text-dim);text-align:center;margin-bottom:4px;">1-Bosishda Tezkor Kirish (Test uchun):</p>
          <button type="button" class="btn-preset-login btn-secondary" data-login="admin" style="width:100%;text-align:left;padding:10px 14px;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;background:rgba(99,102,241,0.12);border-color:rgba(99,102,241,0.4);">
            <span style="font-weight:700;">👑 Tizim Administratori (To'liq Huquq)</span>
            <span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--accent-primary);font-weight:700;">admin</span>
          </button>
          <button type="button" class="btn-preset-login btn-secondary" data-login="dispatcher" style="width:100%;text-align:left;padding:10px 14px;font-size:0.85rem;display:flex;justify-content:space-between;align-items:center;background:rgba(59,130,246,0.12);border-color:rgba(59,130,246,0.4);">
            <span style="font-weight:700;">🎧 Dispetcher (Faqat Chaqiruv & Xarita)</span>
            <span style="font-family:var(--font-mono);font-size:0.75rem;color:#93c5fd;font-weight:700;">dispatcher</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderSidebar() {
  const isCollapsed = state.isSidebarCollapsed;

  return `
    <aside class="app-sidebar ${isCollapsed ? 'collapsed' : ''}">
      <div>
        <div class="sidebar-header">
          <div class="sidebar-brand-group">
            <div class="sidebar-logo">🚖</div>
            <div class="sidebar-title">
              <h2>ZBY Taksi</h2>
              <p>Dispetcher Markazi</p>
            </div>
          </div>
          <button id="btn-collapse-sidebar" class="btn-sidebar-toggle" title="Yon panelni yig'ish">
            ◀
          </button>
        </div>

        <nav class="sidebar-nav">
          <span class="nav-section-label">Operatsiyalar</span>

          <button class="nav-item ${state.activeTab === 'map' ? 'active' : ''}" data-tab="map">
            <div class="nav-item-content">
              <span class="nav-icon">🗺️</span>
              <span>Jonli Taksi Xaritasi</span>
            </div>
            <span class="nav-badge live-pulse">${state.drivers.length}</span>
          </button>

          <button class="nav-item ${state.activeTab === 'orders' ? 'active' : ''}" data-tab="orders">
            <div class="nav-item-content">
              <span class="nav-icon">📋</span>
              <span>Taksi Chaqiruvlari</span>
            </div>
            <span class="nav-badge">${state.counts.all}</span>
          </button>

          ${state.user?.role === 'admin' ? `
            <span class="nav-section-label" style="margin-top:14px;">Boshqaruv (Admin)</span>

            <button class="nav-item ${state.activeTab === 'fleet' ? 'active' : ''}" data-tab="fleet">
              <div class="nav-item-content">
                <span class="nav-icon">🚕</span>
                <span>Taksi Haydovchilari</span>
              </div>
              <span class="nav-badge">${state.availableDrivers.length} Bo'sh</span>
            </button>

            <button class="nav-item ${state.activeTab === 'permissions' ? 'active' : ''}" data-tab="permissions">
              <div class="nav-item-content">
                <span class="nav-icon">🛡️</span>
                <span>Ruxsatlar & Rollar</span>
              </div>
            </button>
          ` : ''}
        </nav>
      </div>

      <div class="sidebar-footer">
        <div class="user-card">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;background:#334155;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;">
              ${state.user.name.charAt(0)}
            </div>
            <div style="display:flex;flex-direction:column;">
              <span style="font-size:0.8rem;font-weight:700;">${state.user.name}</span>
              <span style="font-size:0.68rem;color:var(--text-dim);text-transform:uppercase;">${state.user.role}</span>
            </div>
          </div>
          <button id="btn-logout" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;padding:4px;" title="Tizimdan chiqish">
            ✕
          </button>
        </div>
      </div>
    </aside>
  `;
}

function renderTopBar() {
  const titles = {
    map: 'Jonli Taksi Floti Radari va Xaritasi',
    orders: 'Taksi Chaqiruvlari va Safarlar Boshqaruvi',
    fleet: "Ro'yxatdan O'tgan Taksi Haydovchilari",
    permissions: "Tizim Ruxsatlari (Permissions Management)",
  };

  return `
    <header class="top-bar">
      <div class="top-bar-left">
        <button id="btn-toggle-sidebar" class="btn-sidebar-toggle" title="${state.isSidebarCollapsed ? 'Yon panelni kengaytirish' : 'Yon panelni yashirish'}">
          ☰
        </button>
        <h1 class="view-title">${titles[state.activeTab] || 'ZBY Dispetcher'}</h1>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="live-indicator"><span class="pulse-dot"></span> Jonli Sinxron</span>
          <button id="btn-manual-sync" class="hud-btn" style="padding:4px 8px;font-size:0.75rem;" title="Server bilan sinxronlash">↻</button>
        </div>
      </div>

      <div class="top-bar-actions">
        <button id="btn-open-create-order" class="btn-new-order">
          <span>📞 + Yangi Taksi Chaqiruvi</span>
        </button>
      </div>
    </header>
  `;
}

// 1. JONLI XARITA KO'RINISHI (To'liq ekran va yig'iluvchi panel)
function renderMapView() {
  return `
    <div class="map-view-container">
      <div id="dispatch-map"></div>

      <!-- Yuqori-Chap HUD: Hisoblagichlar & Xarita turi -->
      <div class="map-hud-top">
        <div class="hud-pill">
          <span style="color:#10b981;">●</span>
          <span>Onlayn:</span>
          <span class="hud-count" id="hud-online-count" style="color:#34d399;">${state.availableDrivers.length}</span>
        </div>
        <div class="hud-pill">
          <span style="color:#a855f7;">●</span>
          <span>Yo'lda:</span>
          <span class="hud-count" id="hud-active-count" style="color:#c084fc;">${state.counts.active}</span>
        </div>
        <div class="hud-pill">
          <span style="color:#f59e0b;">●</span>
          <span>Kutilmoqda:</span>
          <span class="hud-count" id="hud-pending-count" style="color:#facc15;">${state.counts.pending_dispatch}</span>
        </div>

        <!-- Xarita Provayderini Tanlash -->
        <select id="select-tile-provider" style="background:rgba(17,23,38,0.9);color:var(--text-main);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:8px 12px;font-size:0.78rem;font-weight:700;outline:none;cursor:pointer;backdrop-filter:blur(14px);">
          <option value="dark" ${state.currentTileProvider === 'dark' ? 'selected' : ''}>🌙 Tungi Xarita (Toza)</option>
          <option value="osm" ${state.currentTileProvider === 'osm' ? 'selected' : ''}>🗺️ OpenStreetMap Standart</option>
          <option value="satellite" ${state.currentTileProvider === 'satellite' ? 'selected' : ''}>🛰️ Sun‘iy Yo‘ldosh Gibrid</option>
        </select>
      </div>

      <!-- Pastki HUD: Boshqaruv tugmalari -->
      <div class="map-hud-bottom">
        <button id="btn-center-drivers" class="hud-btn">
          <span>🎯</span> Barcha Haydovchilar
        </button>

        <button id="btn-toggle-fleet-drawer" class="hud-btn">
          <span>🚗</span> ${state.isFleetDrawerOpen ? "Haydovchilarni Yashirish" : `Haydovchilarni Ko'rsatish (${state.drivers.length})`}
        </button>
      </div>

      <!-- O'ng Suzuvchi HUD: Jonli Haydovchilar Ro'yxati -->
      <div class="map-hud-right ${state.isFleetDrawerOpen ? '' : 'collapsed'}">
        <div class="hud-header">
          <div style="display:flex;align-items:center;gap:6px;">
            <strong style="font-size:0.88rem;">Jonli Haydovchilar (${state.drivers.length})</strong>
          </div>
          <button id="btn-close-fleet-drawer" class="hud-btn-icon" title="Panelni yopish">✕</button>
        </div>

        <div class="hud-driver-list">
          ${state.drivers.map(driver => {
            const hasGps = driver.current_lat != null && driver.current_lng != null;
            const lat = hasGps ? Number(driver.current_lat) : null;
            const lng = hasGps ? Number(driver.current_lng) : null;
            const gmapsUrl = hasGps ? `https://www.google.com/maps?q=${lat},${lng}` : null;

            return `
              <div class="hud-driver-card" data-driver-id="${driver.id}">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                  <strong style="font-size:0.85rem;">${driver.name}</strong>
                  ${renderDriverStatusBadge(driver)}
                </div>
                <p style="font-size:0.75rem;color:var(--text-muted);">${driver.vehicle_type || 'Mashina'} • ${driver.license_plate || 'Raqamsiz'}</p>
                <div style="font-size:0.68rem;color:var(--text-dim);font-family:var(--font-mono);margin-top:2px;">
                  ${hasGps ? `📍 GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : '⚠️ GPS signali yo‘q'}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                  ${hasGps ? `
                    <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" style="font-size:0.7rem;color:#60a5fa;text-decoration:none;display:inline-flex;align-items:center;gap:3px;" title="Google Xaritada ochish">
                      <span>Google Xarita</span> ↗
                    </a>
                    <button class="btn-focus-driver" data-driver-id="${driver.id}" style="background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;padding:3px 10px;border-radius:4px;font-size:0.72rem;font-weight:700;cursor:pointer;">
                      Ko'rish
                    </button>
                  ` : `
                    <span style="font-size:0.7rem;color:var(--text-dim);">Oflayn</span>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

// Order Card Component
function renderOrderCardHtml(order) {
  const isSelected = state.selectedOrder && state.selectedOrder.id === order.id;
  const isPending = ['new', 'pending_dispatch'].includes(order.status);
  const assignedDriver = order.current_driver || (order.latest_assignment && order.latest_assignment.driver);
  const driverUser = assignedDriver ? (assignedDriver.user || assignedDriver) : null;

  return `
    <div class="order-card ${isSelected ? 'selected' : ''}" data-order-id="${order.id}">
      <div class="order-card-header">
        <span class="order-number">🚖 ${formatOrderTitle(order.order_number)}</span>
        <span class="status-badge status-${order.status}">${ORDER_STATUS_LABELS[order.status] || order.status.replace('_', ' ')}</span>
      </div>

      <div class="route-preview">
        <div class="route-point">
          <div class="route-dot dot-pickup"></div>
          <div><strong>Chiqish:</strong> ${order.pickup_address}</div>
        </div>
        <div class="route-point">
          <div class="route-dot dot-delivery"></div>
          <div><strong>Borish:</strong> ${order.delivery_address}</div>
        </div>
      </div>

      <div class="order-card-footer">
        <span>👤 <strong>${order.customer_name}</strong></span>
        <span style="font-family:var(--font-mono);font-size:0.74rem;color:var(--text-muted);">${order.customer_phone || ''}</span>
      </div>

      <!-- Haydovchi holati / Biriktirish belgisi -->
      <div class="order-card-driver-bar">
        ${isPending ? `
          <span style="color:#facc15;font-weight:700;display:flex;align-items:center;gap:4px;">
            ⚠️ Kutilmoqda
          </span>
          <span class="badge-assign-hint">
            Biriktirish ➔
          </span>
        ` : driverUser ? `
          <span style="color:#93c5fd;display:flex;align-items:center;gap:4px;">
            🚗 <strong>${driverUser.name}</strong>
          </span>
          <span style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem;">
            ${assignedDriver.license_plate || ''}
          </span>
        ` : `
          <span style="color:var(--text-dim);">Taksi biriktirilmagan</span>
        `}
      </div>
    </div>
  `;
}

// 2. TAKSI BUYURTMALARI VA CHAQIRUVLAR DOSKASI
function renderOrdersView() {
  // Agar hech qanday buyurtma tanlanmagan bo'lsa yoki tanlangan buyurtma ro'yxatda bo'lmasa, birinchi buyurtmani tanlash
  if ((!state.selectedOrder || !state.orders.some(o => o.id === state.selectedOrder.id)) && state.orders.length > 0) {
    const pendingOrder = state.orders.find(o => ['new', 'pending_dispatch'].includes(o.status));
    state.selectedOrder = pendingOrder || state.orders[0];
  }

  return `
    <div class="main-workspace">
      <div class="orders-pane">
        <div class="toolbar">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="text" id="orders-search" class="search-input" placeholder="Buyurtma (Buyurtma 1, Buyurtma 2...), yo'lovchi yoki manzil..." value="${state.searchQuery}" />
          </div>

          <div class="filter-tabs">
            <button class="filter-tab ${state.filterStatus === 'all' ? 'active' : ''}" data-status="all">Barchasi (${state.counts.all})</button>
            <button class="filter-tab ${state.filterStatus === 'pending' ? 'active' : ''}" data-status="pending">Kutilmoqda (${state.counts.pending_dispatch})</button>
            <button class="filter-tab ${state.filterStatus === 'assigned' ? 'active' : ''}" data-status="assigned">Haydovchi Yo'lda (${state.counts.assigned})</button>
            <button class="filter-tab ${state.filterStatus === 'active' ? 'active' : ''}" data-status="active">Safarda (${state.counts.active})</button>
            <button class="filter-tab ${state.filterStatus === 'delivered' ? 'active' : ''}" data-status="delivered">Yakunlangan (${state.counts.delivered})</button>
          </div>
        </div>

        <div class="orders-list">
          ${state.orders.length === 0 ? `
            <div style="text-align:center;padding:40px;color:var(--text-dim);font-size:0.85rem;">
              Filtrga mos keladigan taksi buyurtmalari topilmadi.
            </div>
          ` : state.orders.map(order => renderOrderCardHtml(order)).join('')}

          ${state.ordersLoadingMore ? `
            <div id="infinite-scroll-loader" class="infinite-scroll-loader">
              <div class="infinite-spinner"></div>
              <span>Ko'proq buyurtmalar yuklanmoqda...</span>
            </div>
          ` : ''}

          ${!state.ordersHasMore && state.orders.length > 0 ? `
            <div class="infinite-scroll-end">
              <span>✨ Barcha buyurtmalar yuklandi (${state.ordersTotal || state.orders.length})</span>
            </div>
          ` : ''}

          <div id="orders-scroll-sentinel" style="height: 1px; width: 100%; pointer-events: none;"></div>
        </div>
      </div>

      <!-- O'ng Tafsilotlar Paneli -->
      ${renderDetailPane()}
    </div>
  `;
}

function renderDetailPane() {
  const order = state.selectedOrder;

  if (!order) {
    return `
      <div class="detail-pane">
        <div class="empty-selection">
          <div style="font-size:3rem;opacity:0.3;">🚖</div>
          <h3>Taksi Safari Tanlanmagan</h3>
          <p>Taksi biriktirish yoki marshrut tafsilotlarini ko'rish uchun chap tarafdan buyurtmani tanlang.</p>
        </div>
      </div>
    `;
  }

  const isPending = ['new', 'pending_dispatch'].includes(order.status);
  const isAssigned = order.status === 'assigned';
  const assignedDriver = order.current_driver || (order.latest_assignment && order.latest_assignment.driver);
  const driverUser = assignedDriver ? (assignedDriver.user || assignedDriver) : null;
  const driverName = driverUser ? driverUser.name : 'Haydovchi';
  const driverPhone = driverUser ? (driverUser.phone || assignedDriver.phone || '') : '';
  const driverVehicle = assignedDriver ? (assignedDriver.vehicle_type || 'Mashina') : 'Mashina';
  const driverPlate = assignedDriver ? (assignedDriver.license_plate || '') : '';

  return `
    <div class="detail-pane">
      <!-- 1. ASOSIY SARLAVHA -->
      <div class="detail-card" style="margin-bottom:8px;padding:10px 14px;">
        <div class="detail-title" style="margin-bottom:0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.05rem;font-weight:800;color:#fff;">🚖 ${formatOrderTitle(order.order_number)}</span>
            <span class="status-badge status-${order.status}">${ORDER_STATUS_LABELS[order.status] || order.status.replace('_', ' ')}</span>
          </div>
          <button id="btn-view-on-map" class="hud-btn" style="padding:4px 10px;font-size:0.72rem;">
            🗺️ Xaritada Ko'rish
          </button>
        </div>
      </div>

      <!-- 2. HAYDOVCHINI BIRIKTIRISH (ENG BIRINCHI VA ASOSIY BLOK) -->
      <div class="dispatch-action-box" style="margin-bottom:8px;padding:10px 14px;">
        <div class="section-heading" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span>🎯</span>
            <strong style="font-size:0.88rem;">Taksi Haydovchisini Biriktirish</strong>
          </div>
          ${isPending ? `
            <span class="hud-pill" style="padding:2px 8px;font-size:0.7rem;background:rgba(16,185,129,0.15);color:#34d399;border-color:rgba(16,185,129,0.3);">
              ● ${state.availableDrivers.length} ta bo'sh
            </span>
          ` : ''}
        </div>

        ${isPending ? `
          <div class="driver-selection-list">
            ${state.availableDrivers.length === 0 ? `
              <div style="padding:10px 12px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.25);border-radius:var(--radius-sm);color:#fde047;font-size:0.78rem;display:flex;align-items:center;gap:8px;">
                <span>⚠️</span>
                <span>Hozirda bo'sh taksi haydovchilari yo'q (ilovaga kirish kutilmoqda)</span>
              </div>
            ` : state.availableDrivers.map(d => `
              <div class="driver-picker-item">
                <div style="display:flex;align-items:center;gap:8px;">
                  <div style="width:28px;height:28px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:0.8rem;">
                    ${d.name.charAt(0)}
                  </div>
                  <div class="driver-meta">
                    <span class="driver-name">${d.name} <span style="font-size:0.7rem;color:var(--text-dim);font-weight:normal;">(${d.phone})</span></span>
                    <span class="driver-vehicle" style="color:#93c5fd;font-family:var(--font-mono);">${d.vehicle_type || 'Mashina'} • ${d.license_plate || 'Raqamsiz'}</span>
                  </div>
                </div>
                <button class="btn-assign btn-assign-action" data-driver-id="${d.id}" data-order-id="${order.id}" style="padding:5px 12px;font-size:0.76rem;font-weight:700;">
                  🚖 Biriktirish
                </button>
              </div>
            `).join('')}
          </div>
        ` : isAssigned ? `
          <div style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.35);padding:10px 12px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:32px;height:32px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:0.88rem;">
                ${driverName.charAt(0)}
              </div>
              <div>
                <strong style="font-size:0.88rem;color:#93c5fd;">Biriktirildi: ${driverName}</strong>
                <div style="font-size:0.72rem;color:var(--text-muted);">
                  ${driverVehicle} • <span style="font-family:var(--font-mono);color:#93c5fd;">${driverPlate}</span> • Tel: <span style="font-family:var(--font-mono);">${driverPhone}</span>
                </div>
                <div style="font-size:0.7rem;color:#fbbf24;margin-top:2px;">
                  ⏳ Haydovchi tasdig'i kutilmoqda (mobil ilovada)...
                </div>
              </div>
            </div>
            <button id="btn-cancel-assignment" class="btn-cancel-assign" data-order-id="${order.id}" style="padding:5px 10px;font-size:0.74rem;">
              ✕ Bekor Qilish
            </button>
          </div>
        ` : `
          <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);padding:10px 12px;border-radius:var(--radius-md);display:flex;align-items:center;gap:8px;">
            <div style="width:32px;height:32px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:0.88rem;">
              ${driverName.charAt(0)}
            </div>
            <div>
              <strong style="font-size:0.88rem;color:#34d399;">Safar Jarayonda: ${driverName}</strong>
              <div style="font-size:0.72rem;color:var(--text-muted);">
                ${driverVehicle} • <span style="font-family:var(--font-mono);color:#93c5fd;">${driverPlate}</span> • Tel: <span style="font-family:var(--font-mono);">${driverPhone}</span>
              </div>
            </div>
          </div>
        `}
      </div>

      <!-- 3. MARSHRUT VA BUYURTMA TAFSILOTLARI -->
      <div class="detail-card" style="margin-bottom:8px;padding:12px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <h4 style="font-size:0.8rem;font-weight:700;margin:0;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">
            👤 Marshrut va Mijoz Ma'lumotlari
          </h4>
          ${!['delivered', 'cancelled'].includes(order.status) ? `
            ${hasPermission('orders.edit') ? `
              <button id="btn-edit-order-client" class="btn-edit-client-action" data-order-id="${order.id}" style="display:inline-flex;align-items:center;gap:4px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.35);color:#a5b4fc;padding:4px 10px;border-radius:var(--radius-sm);font-size:0.74rem;font-weight:700;cursor:pointer;transition:all 0.2s;">
                ✏️ Tahrirlash
              </button>
            ` : `
              <span style="font-size:0.7rem;color:var(--text-dim);background:rgba(255,255,255,0.03);padding:2px 8px;border-radius:4px;border:1px solid var(--border-subtle);" title="Faqat Administrator tahrirlashi mumkin">
                🔒 Tahrirlash (Admin)
              </span>
            `}
          ` : ''}
        </div>

        <div class="route-preview" style="margin-bottom:8px;">
          <div class="route-point" style="background:rgba(255,255,255,0.02);padding:6px 10px;border-radius:var(--radius-sm);">
            <div class="route-dot dot-pickup"></div>
            <div>
              <strong style="color:#60a5fa;font-size:0.72rem;">CHIQISH (YO'LOVCHINI OLISH)</strong>
              <p style="color:var(--text-main);font-weight:600;margin-top:1px;font-size:0.82rem;">${order.pickup_address}</p>
            </div>
          </div>
          <div class="route-point" style="background:rgba(255,255,255,0.02);padding:6px 10px;border-radius:var(--radius-sm);">
            <div class="route-dot dot-delivery"></div>
            <div>
              <strong style="color:#34d399;font-size:0.72rem;">BORISH (TUSHISH JOYI)</strong>
              <p style="color:var(--text-main);font-weight:600;margin-top:1px;font-size:0.82rem;">${order.delivery_address}</p>
            </div>
          </div>
        </div>

        <div class="customer-info-box" style="margin-bottom:0;">
          <div class="info-item">
            <label>Yo'lovchi</label>
            <p>${order.customer_name}</p>
          </div>
          <div class="info-item">
            <label>Telefon</label>
            <p style="font-family:var(--font-mono);">${order.customer_phone}</p>
          </div>
        </div>

        ${order.notes ? `
          <div style="margin-top:8px;padding:6px 10px;background:rgba(255,255,255,0.02);border:1px dashed var(--border-subtle);border-radius:var(--radius-sm);font-size:0.75rem;color:var(--text-dim);">
            💬 <strong>Izoh / Eslatma:</strong> ${order.notes}
          </div>
        ` : ''}

        ${!['delivered', 'cancelled'].includes(order.status) ? `
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);display:flex;justify-content:flex-end;">
            ${hasPermission('orders.cancel') ? `
              <button class="btn-cancel-order" data-order-id="${order.id}" style="background:transparent;border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:4px 10px;border-radius:var(--radius-sm);font-size:0.72rem;cursor:pointer;">
                ✕ Chaqiruvni Bekor Qilish
              </button>
            ` : `
              <span style="font-size:0.7rem;color:var(--text-dim);" title="Buyurtmani bekor qilish faqat Administratorga ruxsat etilgan">
                🔒 Bekor qilish (Faqat Admin)
              </span>
            `}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Helper: Haydovchi Holati (Dispetcher tomonidan xaritada va ro'yxatda o'zgartiriladi)
function renderDriverStatusBadge(driver) {
  const statusKey = driver.status || 'offline';
  const label = DRIVER_STATUS_LABELS[statusKey] || statusKey.toUpperCase();

  return `
    <div class="driver-status-dropdown-wrap" data-driver-id="${driver.id}">
      <button type="button" class="driver-status-badge-btn status-badge status-${statusKey}" title="Dispetcher: Haydovchi holatini o'zgartirish uchun bosing">
        <span class="status-indicator-dot dot-${statusKey}"></span>
        <span class="status-badge-text">${label.toUpperCase()}</span>
        <span class="status-chevron">▾</span>
      </button>
      <div class="driver-status-menu">
        <div class="status-menu-header">Dispetcher: Holatni tanlang</div>
        <button type="button" class="status-menu-item ${statusKey === 'available' ? 'selected' : ''}" data-status="available" data-driver-id="${driver.id}">
          <span class="status-indicator-dot dot-available"></span>
          <div class="status-menu-info">
            <strong>Bo'sh (Tayyor)</strong>
            <small>Yangi chaqiruvlarni qabul qiladi</small>
          </div>
        </button>
        <button type="button" class="status-menu-item ${statusKey === 'busy' ? 'selected' : ''}" data-status="busy" data-driver-id="${driver.id}">
          <span class="status-indicator-dot dot-busy"></span>
          <div class="status-menu-info">
            <strong>Band</strong>
            <small>Safarda yoki band</small>
          </div>
        </button>
        <button type="button" class="status-menu-item ${statusKey === 'offline' ? 'selected' : ''}" data-status="offline" data-driver-id="${driver.id}">
          <span class="status-indicator-dot dot-offline"></span>
          <div class="status-menu-info">
            <strong>Oflayn</strong>
            <small>Tizimdan chiqqan</small>
          </div>
        </button>
      </div>
    </div>
  `;
}

// 3. HAYDOVCHILAR RO'YXATI
function renderFleetView() {
  const query = (state.driverSearchQuery || '').toLowerCase().trim();

  const filteredDrivers = state.drivers.filter(driver => {
    if (!query) return true;
    const nameMatch = (driver.name || '').toLowerCase().includes(query);
    const phoneMatch = (driver.phone || '').toLowerCase().includes(query);
    const plateMatch = (driver.license_plate || '').toLowerCase().includes(query);
    const vehicleMatch = (driver.vehicle_type || '').toLowerCase().includes(query);
    const idMatch = String(driver.id).includes(query);
    return nameMatch || phoneMatch || plateMatch || vehicleMatch || idMatch;
  });

  return `
    <div class="fleet-view-container">
      <div class="fleet-content-wrapper">
        <div class="fleet-header-sticky">
          <div>
            <h2 style="font-size:1.15rem;font-weight:800;">Tizimdagi Taksi Haydovchilari (${state.drivers.length})</h2>
            <p style="font-size:0.78rem;color:var(--text-dim);">Tizim bazasidagi taksilar, ularning jonli GPS koordinatalari va holati</p>
          </div>

          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div class="search-box" style="width:260px;">
              <span class="search-icon">🔍</span>
              <input type="text" id="fleet-search-input" class="search-input" placeholder="Haydovchi, raqam yoki tel..." value="${state.driverSearchQuery || ''}" />
            </div>

            ${hasPermission('drivers.create') ? `
              <button id="btn-open-create-driver" class="btn-new-order" style="padding:9px 16px;font-size:0.85rem;">
                <span>+ Yangi Taksi Haydovchisi Qo'shish</span>
              </button>
            ` : `
              <span style="font-size:0.75rem;color:var(--text-dim);background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);display:flex;align-items:center;gap:6px;" title="Haydovchi qo'shish faqat Administratorga ruxsat etilgan">
                🔒 Yangi Haydovchi (Faqat Admin)
              </span>
            `}
          </div>
        </div>

        ${filteredDrivers.length === 0 ? `
          <div style="text-align:center;padding:60px 20px;background:var(--bg-surface);border-radius:var(--radius-lg);border:1px dashed var(--border-subtle);color:var(--text-dim);">
            <div style="font-size:2.2rem;margin-bottom:8px;">🚖</div>
            <strong style="font-size:1rem;color:var(--text-main);">Hech qanday taksi haydovchisi topilmadi</strong>
            <p style="font-size:0.8rem;margin-top:4px;color:var(--text-dim);">Qidiruv so'zini o'zgartiring yoki yuqoridagi tugma orqali yangi haydovchi qo'shing.</p>
          </div>
        ` : `
          <div class="fleet-grid">
            ${filteredDrivers.map(driver => {
              const hasGps = driver.current_lat != null && driver.current_lng != null;
              const lat = hasGps ? Number(driver.current_lat) : null;
              const lng = hasGps ? Number(driver.current_lng) : null;
              const gmapsUrl = hasGps ? `https://www.google.com/maps?q=${lat},${lng}` : null;
              const avatarBg = driver.status === 'available' ? '#10b981' : driver.status === 'busy' ? '#f59e0b' : '#64748b';

              return `
                <div class="fleet-card">
                  <div style="display:flex;align-items:center;justify-content:space-between;position:relative;">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <div style="width:40px;height:40px;border-radius:50%;background:${avatarBg};display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.1rem;box-shadow:0 2px 10px rgba(0,0,0,0.3);">
                        ${driver.name.charAt(0)}
                      </div>
                      <div>
                        <strong style="font-size:0.95rem;">${driver.name}</strong>
                        <div style="display:flex;gap:6px;align-items:center;margin-top:2px;">
                          <span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim);background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:4px;">ID #${driver.id}</span>
                          <span style="font-size:0.75rem;color:var(--text-dim);">${driver.phone ? `${driver.phone}` : driver.email}</span>
                        </div>
                      </div>
                    </div>
                    ${renderDriverStatusBadge(driver)}
                  </div>

                  <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:12px;font-size:0.8rem;display:flex;flex-direction:column;gap:6px;">
                    <div><span style="color:var(--text-dim);">Mashina Rusumi:</span> <strong>${driver.vehicle_type || 'Mashina'}</strong></div>
                    <div><span style="color:var(--text-dim);">Davlat Raqami:</span> <strong style="font-family:var(--font-mono);color:#93c5fd;">${driver.license_plate || "Ro'yxatdan o'tmagan"}</strong></div>
                    <div><span style="color:var(--text-dim);">Telefon:</span> <strong style="font-family:var(--font-mono);">${driver.phone || 'Mavjud emas'}</strong></div>
                    <div><span style="color:var(--text-dim);">Hamyon Balansi:</span> <strong style="color:#34d399;font-family:var(--font-mono);">${Number(driver.balance || 0).toLocaleString()} so'm</strong></div>
                    <div><span style="color:var(--text-dim);">Jonli GPS:</span> ${hasGps ? `<strong style="font-family:var(--font-mono);color:#34d399;">${lat.toFixed(4)}, ${lng.toFixed(4)}</strong>` : "<span style=\"color:var(--text-dim);\">Signal yo'q</span>"}</div>
                    <div><span style="color:var(--text-dim);">Oxirgi Faollik:</span> <span style="font-size:0.72rem;color:var(--text-muted);">${driver.last_active_at ? new Date(driver.last_active_at).toLocaleString() : 'Mavjud emas'}</span></div>
                  </div>

                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${hasPermission('wallet.topup') ? `
                      <button class="btn-topup-driver-fleet hud-btn" data-driver-id="${driver.id}" style="color:#34d399;border-color:rgba(16,185,129,0.35);padding:8px 12px;" title="Haydovchi hisobiga pul yetkazish">
                        <span>💳 Balans To'ldirish</span>
                      </button>
                    ` : ''}
                    ${hasPermission('drivers.edit') ? `
                      <button class="btn-edit-driver-fleet hud-btn" data-driver-id="${driver.id}" style="color:#a5b4fc;border-color:rgba(99,102,241,0.35);padding:8px 12px;" title="Haydovchi ma'lumotlarini tahrirlash">
                        <span>✏️ Tahrirlash</span>
                      </button>
                    ` : ''}
                    ${hasPermission('drivers.delete') ? `
                      <button class="btn-delete-driver-fleet hud-btn" data-driver-id="${driver.id}" data-driver-name="${(driver.name || 'Haydovchi').replace(/"/g, '&quot;')}" style="color:#f87171;border-color:rgba(239,68,68,0.35);padding:8px 12px;" title="Haydovchini tizimdan butunlay o'chirish (Faqat Admin)">
                        <span>🗑️ O'chirish</span>
                      </button>
                    ` : ''}
                    ${hasGps ? `
                      <button class="btn-focus-driver-fleet hud-btn" data-driver-id="${driver.id}" style="flex:1;justify-content:center;">
                        <span>🗺️ Radar</span>
                      </button>
                      <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="hud-btn" style="text-decoration:none;padding:8px 12px;" title="Google Xaritada ochish">
                        <span>Google Xarita</span> ↗
                      </a>
                    ` : `
                      <button class="hud-btn" disabled style="flex:1;justify-content:center;opacity:0.5;">
                        <span>Oflayn (GPS yo'q)</span>
                      </button>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

function renderNewDriverModal() {
  return `
    <div class="modal-overlay" id="driver-modal-overlay">
      <div class="modal-content" style="max-width:520px;">
        <div class="modal-header">
          <div>
            <h3 style="font-size:1.15rem;font-weight:800;">Yangi Taksi Haydovchisini Ro'yxatdan O'tkazish</h3>
            <p style="font-size:0.75rem;color:var(--text-dim);">Tizim ma'lumotlar bazasiga yangi taksi haydovchisini kiritish</p>
          </div>
          <button id="btn-close-driver-modal" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:1.2rem;">✕</button>
        </div>

        <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);padding:10px 14px;border-radius:var(--radius-sm);margin:16px 24px 0;font-size:0.78rem;color:#93c5fd;">
          📱 <strong>Haydovchi Ilovasiga Kirish:</strong> Haydovchi mobil ilovaga quyida kiritilgan <strong>Telefon raqami</strong> va <strong>Parol</strong> orqali kiradi.
        </div>

        <form id="new-driver-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label>To'liq Ism (F.I.SH)</label>
              <input type="text" id="driver-name" class="form-input" placeholder="masalan: Jasur Karimov" required />
            </div>
            <div class="form-group">
              <label>Haydovchi Telefoni (Kirish Logini)</label>
              <input type="text" id="driver-phone" class="form-input" placeholder="+998 90 999 8877" required />
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label>Haydovchi Ilovasi Paroli</label>
              <input type="password" id="driver-password" class="form-input" value="password" required />
            </div>
            <div class="form-group">
              <label>Email Manzili (Ixtiyoriy)</label>
              <input type="email" id="driver-email" class="form-input" placeholder="Ixtiyoriy (bo'sh bo'lsa avtomatik yaratiladi)" />
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:12px;">
            <div class="form-group">
              <label>Mashina Rusumi va Modeli</label>
              <input type="text" id="driver-vehicle" class="form-input" placeholder="masalan: Chevrolet Spark, Nexia, Cobalt" required />
            </div>
            <div class="form-group">
              <label>Davlat Raqami</label>
              <input type="text" id="driver-plate" class="form-input" placeholder="01 A 789 AA" required />
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
            <div class="form-group">
              <label>Boshlang'ich Holat</label>
              <select id="driver-status" class="form-input">
                <option value="available">🟢 Bo'sh (Tayyor)</option>
                <option value="busy">🟡 Band (Safarda)</option>
                <option value="offline">⚪ Oflayn</option>
              </select>
            </div>
            <div class="form-group">
              <label>GPS Kenglik (Latitude)</label>
              <input type="number" id="driver-lat" class="form-input" step="0.0001" value="41.3111" required />
            </div>
            <div class="form-group">
              <label>GPS Uzunlik (Longitude)</label>
              <input type="number" id="driver-lng" class="form-input" step="0.0001" value="69.2405" required />
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" id="btn-cancel-driver-modal" class="btn-secondary">Bekor qilish</button>
            <button type="submit" class="btn-new-order">Haydovchini Saqlash</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEditDriverModal() {
  if (!state.isEditDriverModalOpen || !state.editingDriver) return '';
  const d = state.editingDriver;
  const statusKey = d.status || 'offline';
  const statusLabel = DRIVER_STATUS_LABELS[statusKey] || statusKey.toUpperCase();

  return `
    <div class="modal-overlay" id="edit-driver-modal-overlay">
      <div class="modal-content" style="max-width:520px;">
        <div class="modal-header">
          <div>
            <h3 style="font-size:1.15rem;font-weight:800;">Taksi Haydovchisi Ma'lumotlarini Tahrirlash</h3>
            <p style="font-size:0.75rem;color:var(--text-dim);">Haydovchining shaxsiy va avtomobil ma'lumotlarini yangilash</p>
          </div>
          <button id="btn-close-edit-driver-modal" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:1.2rem;">✕</button>
        </div>

        <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);padding:10px 14px;border-radius:var(--radius-sm);margin:16px 24px 0;display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:0.78rem;color:#a5b4fc;">
            📱 <strong>Jonli Holat:</strong> Haydovchi holati faqat <strong>Flutter ilovasi</strong> orqali o'zgaradi.
          </div>
          <span class="driver-status-badge-readonly status-badge status-${statusKey}">
            <span class="status-indicator-dot dot-${statusKey}"></span>
            <span>${statusLabel.toUpperCase()}</span>
          </span>
        </div>

        <form id="edit-driver-form">
          <input type="hidden" id="edit-driver-id" value="${d.id}" />

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label>Haydovchi Ismi-Sharifi</label>
              <input type="text" id="edit-driver-name" class="form-input" value="${d.name || ''}" placeholder="Masalan: Jasur Karimov" required />
            </div>
            <div class="form-group">
              <label>Haydovchi Telefoni (Kirish Logini)</label>
              <input type="text" id="edit-driver-phone" class="form-input" value="${d.phone || ''}" placeholder="+998 90 123 4567" required />
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:12px;">
            <div class="form-group">
              <label>Mashina Rusumi va Modeli</label>
              <input type="text" id="edit-driver-vehicle" class="form-input" value="${d.vehicle_type || ''}" placeholder="Masalan: Chevrolet Cobalt" required />
            </div>
            <div class="form-group">
              <label>Davlat Raqami</label>
              <input type="text" id="edit-driver-plate" class="form-input" value="${d.license_plate || ''}" placeholder="01 A 789 AA" required />
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" id="btn-cancel-edit-driver-modal" class="btn-secondary">Bekor qilish</button>
            <button type="submit" id="btn-save-edit-driver" class="btn-new-order">💾 O'zgarishlarni Saqlash</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEditOrderModal() {
  if (!state.isEditOrderModalOpen || !state.editingOrder) return '';
  const order = state.editingOrder;
  const isAssigned = ['assigned', 'driver_accepted', 'picked_up', 'in_transit'].includes(order.status);
  const assignedDriver = order.current_driver || (order.latest_assignment && order.latest_assignment.driver);
  const driverUser = assignedDriver ? (assignedDriver.user || assignedDriver) : null;
  const driverName = driverUser ? driverUser.name : null;
  const driverPlate = assignedDriver ? (assignedDriver.license_plate || '') : '';

  return `
    <div class="modal-overlay" id="edit-order-modal-overlay">
      <div class="modal-content" style="max-width:560px;">
        <div class="modal-header">
          <div>
            <h3 style="font-size:1.15rem;font-weight:800;">✏️ ${formatOrderTitle(order.order_number)} - Mijoz Ma'lumotlarini Tahrirlash</h3>
            <p style="font-size:0.75rem;color:var(--text-dim);margin-top:2px;">Yo'lovchi va manzil ma'lumotlarini o'zgartirish</p>
          </div>
          <button id="btn-close-edit-order-modal" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:1.2rem;">✕</button>
        </div>

        ${isAssigned && driverName ? `
          <div style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.35);padding:10px 14px;border-radius:var(--radius-sm);margin:16px 24px 0;display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.3rem;">🚗</span>
            <div style="font-size:0.78rem;color:#93c5fd;line-height:1.4;">
              <strong>Taksi biriktirilgan: ${driverName}</strong> ${driverPlate ? `(${driverPlate})` : ''}<br>
              Mijoz yoki manzil o'zgartirilsa, ma'lumotlar haydovchi mobil ilovasida ham darhol yangilanadi.
            </div>
          </div>
        ` : ''}

        <form id="edit-order-form">
          <input type="hidden" id="edit-order-id" value="${order.id}" />

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label>Yo'lovchi Ismi</label>
              <input type="text" id="edit-order-customer-name" class="form-input" value="${order.customer_name || ''}" placeholder="Masalan: Alisher Navoiy" required />
            </div>
            <div class="form-group">
              <label>Telefon Raqami</label>
              <input type="text" id="edit-order-customer-phone" class="form-input" value="${order.customer_phone || ''}" placeholder="+998 90 123 4567" required />
            </div>
          </div>

          <div class="form-group">
            <label>Chiqish Manzili (Yo'lovchini olish joyi)</label>
            <input type="text" id="edit-order-pickup-address" class="form-input" value="${order.pickup_address || ''}" placeholder="Masalan: Amir Temur ko'chasi 42, Toshkent" required />
          </div>

          <div class="form-group">
            <label>Borish Manzili (Tushirish joyi)</label>
            <input type="text" id="edit-order-delivery-address" class="form-input" value="${order.delivery_address || ''}" placeholder="Masalan: Chilonzor 9-mavze, Toshkent" required />
          </div>

          <div class="form-group">
            <label>Haydovchi uchun Izoh / Eslatma</label>
            <input type="text" id="edit-order-notes" class="form-input" value="${order.notes || ''}" placeholder="Masalan: 3-podyezd oldida kutadi" />
          </div>

          <div class="modal-footer">
            <button type="button" id="btn-cancel-edit-order-modal" class="btn-secondary">Bekor qilish</button>
            <button type="submit" id="btn-save-edit-order" class="btn-new-order">💾 O'zgarishlarni Saqlash</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderNewOrderModal() {
  return `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-content">
        <div class="modal-header">
          <div>
            <h3 style="font-size:1.15rem;font-weight:800;">📞 Yangi Taksi Chaqiruvi (Qo'ng'iroq)</h3>
            <p style="font-size:0.75rem;color:var(--text-dim);margin-top:2px;">Yo'lovchi qo'ng'irog'i asosida taksi buyurtmasini yaratish va haydovchiga yuborish</p>
          </div>
          <button id="btn-close-modal" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:1.2rem;">✕</button>
        </div>

        <form id="new-order-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label>Yo'lovchi Ismi (Mijoz)</label>
              <input type="text" id="cust-name" class="form-input" placeholder="masalan: Alisher Navoiy" required />
            </div>
            <div class="form-group">
              <label>Yo'lovchi Telefon Raqami</label>
              <input type="text" id="cust-phone" class="form-input" placeholder="+998 90 123 4567" required />
            </div>
          </div>

          <div class="form-group">
            <label>Chiqish Manzili (Mijoz turgan joy)</label>
            <input type="text" id="pickup-addr" class="form-input" placeholder="masalan: Amir Temur ko'chasi 14, Toshkent" required />
          </div>

          <div class="form-group">
            <label>Borish Manzili (Tushish joyi)</label>
            <input type="text" id="delivery-addr" class="form-input" placeholder="masalan: Chilonzor tumani, 5-mavze" required />
          </div>

          <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:0.78rem;color:#a5b4fc;">⚡ <strong>Taksi Tarifi:</strong> 1 km = 2 000 so'm</span>
            <span style="font-size:0.7rem;color:var(--text-dim);">Taksimetr orqali avtomatik</span>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label>1 km uchun Tarif (so'm)</label>
              <input type="number" id="order-rate" class="form-input" value="2000" step="500" required />
            </div>
            <div class="form-group">
              <label>Boshlang'ich Haq / Belgilangan Narx (ixtiyoriy)</label>
              <input type="number" id="order-amount" class="form-input" placeholder="Avto (masofa × tarif)" step="500" />
            </div>
          </div>

          <div class="form-group">
            <label>Izoh va Qo'shimcha Ma'lumotlar</label>
            <textarea id="order-notes" class="form-input" style="height:60px;resize:none;" placeholder="Masalan: chaqaloq bilan, orqa yukxona kerak, naqd to'lov..."></textarea>
          </div>

          <div class="modal-footer">
            <button type="button" id="btn-cancel-modal" class="btn-secondary">Bekor qilish</button>
            <button type="submit" class="btn-new-order">🚖 Taksi Chaqiruvini Yaratish</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderWalletView() {
  const canApprove = hasPermission('wallet.approve') || state.user?.role === 'admin';
  const canReject = hasPermission('wallet.reject') || hasPermission('wallet.approve') || state.user?.role === 'admin';
  const canTopup = hasPermission('wallet.topup') || state.user?.role === 'admin';

  const filterStatus = state.topupFilterStatus || 'all';
  const filteredRequests = (state.topupRequests || []).filter(req => {
    if (filterStatus === 'all') return true;
    return req.status === filterStatus;
  });

  return `
    <div class="wallet-view-container">
      <div class="wallet-header-row">
        <div>
          <h2 style="font-size:1.25rem;font-weight:800;letter-spacing:-0.3px;">💳 Haydovchilar Balansi & To'lov Cheklari</h2>
          <p style="font-size:0.8rem;color:var(--text-dim);margin-top:2px;">
            Haydovchi kartaga pul o'tkazib skrinshot yuborganda, dispetcher tasdiqlaydi va pul yetkaziladi.
          </p>
        </div>

        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button id="btn-simulate-telegram-check" class="hud-btn" style="color:#38bdf8;border-color:rgba(14,165,233,0.35);padding:9px 14px;background:rgba(14,165,233,0.1);" title="Telegram bot orqali yangi to'lov cheki kelishini sinash">
            <span>✈️ + Telegram Chekini Sinash</span>
          </button>

          ${canTopup ? `
            <button id="btn-open-direct-topup-wallet" class="btn-new-order" style="background:linear-gradient(135deg, #10b981, #059669);box-shadow:0 4px 14px rgba(16,185,129,0.35);">
              <span>💳 + To'g'ridan-To'g'ri Pul Yetkazish</span>
            </button>
          ` : `
            <span class="permission-pill denied" title="Dispetcherda wallet.topup ruxsati yo'q">
              🔒 Pul yetkazish ruxsati cheklangan
            </span>
          `}
        </div>
      </div>

      <!-- Telegram Bot Integratsiyasi Banneri -->
      <div style="background:rgba(14,165,233,0.06);border:1px solid rgba(14,165,233,0.25);border-radius:var(--radius-md);padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:40px;height:40px;border-radius:50%;background:#0284c7;display:flex;align-items:center;justify-content:center;font-size:1.3rem;box-shadow:0 2px 10px rgba(2,132,199,0.4);">
            ✈️
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <strong style="font-size:0.95rem;color:#38bdf8;">Telegram Bot Orqali To'lov Cheki Qabul Qilish</strong>
              <span class="permission-pill granted" style="font-size:0.68rem;">FAOL (WEBHOOK)</span>
            </div>
            <p style="font-size:0.75rem;color:var(--text-dim);margin-top:2px;">
              Haydovchilar Telegram botga to'lov skrinshotini yuborishi bilan tizim chekni avtomatik qabul qilib, shu yerga chiqaradi. Dispetcher tasdiqlashi bilan bot haydovchiga balansi to'ldirilganligi haqida bildirishnoma yuboradi.
            </p>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;font-family:var(--font-mono);font-size:0.75rem;flex-wrap:wrap;">
          <div style="background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:6px;border:1px solid var(--border-subtle);">
            <span style="color:var(--text-dim);">Admin Karta:</span> <strong style="color:#fbbf24;">8600 1234 5678 9012</strong>
          </div>
          <div style="background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:6px;border:1px solid var(--border-subtle);">
            <span style="color:var(--text-dim);">Webhook:</span> <code style="color:#a5b4fc;">/api/telegram/webhook</code>
          </div>
        </div>
      </div>

      <!-- Stat Kartalari -->
      <div class="wallet-stats-grid">
        <div class="wallet-stat-card">
          <div class="stat-label"><span>📊</span> Jami Chek So'rovlari</div>
          <div class="stat-value" style="color:#93c5fd;">${state.topupCounts?.total || 0} ta</div>
        </div>
        <div class="wallet-stat-card" style="border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.04);">
          <div class="stat-label"><span style="color:#f59e0b;">⏳</span> Kutilmoqda (Tasdiqlash)</div>
          <div class="stat-value" style="color:#fbbf24;">${state.topupCounts?.pending || 0} ta</div>
        </div>
        <div class="wallet-stat-card" style="border-color:rgba(16,185,129,0.3);background:rgba(16,185,129,0.04);">
          <div class="stat-label"><span style="color:#10b981;">✅</span> Pul Yetkazildi (Tasdiqlangan)</div>
          <div class="stat-value" style="color:#34d399;">${state.topupCounts?.approved || 0} ta</div>
        </div>
        <div class="wallet-stat-card" style="border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.04);">
          <div class="stat-label"><span style="color:#ef4444;">❌</span> Bekor Qilingan</div>
          <div class="stat-value" style="color:#f87171;">${state.topupCounts?.rejected || 0} ta</div>
        </div>
      </div>

      <!-- Filter Tugmalari -->
      <div style="display:flex;gap:8px;border-bottom:1px solid var(--border-subtle);padding-bottom:12px;margin-top:6px;flex-wrap:wrap;">
        <button class="filter-tab btn-filter-topup ${filterStatus === 'all' ? 'active' : ''}" data-topup-status="all">
          Barcha Cheklar (${state.topupCounts?.total || 0})
        </button>
        <button class="filter-tab btn-filter-topup ${filterStatus === 'pending' ? 'active' : ''}" data-topup-status="pending">
          ⏳ Tasdiqlash Kutilmoqda (${state.topupCounts?.pending || 0})
        </button>
        <button class="filter-tab btn-filter-topup ${filterStatus === 'approved' ? 'active' : ''}" data-topup-status="approved">
          ✅ Yetkazilganlar (${state.topupCounts?.approved || 0})
        </button>
        <button class="filter-tab btn-filter-topup ${filterStatus === 'rejected' ? 'active' : ''}" data-topup-status="rejected">
          ❌ Bekor Qilinganlar (${state.topupCounts?.rejected || 0})
        </button>
      </div>

      <!-- Cheklar Ro'yxati / Gridi -->
      ${filteredRequests.length === 0 ? `
        <div style="text-align:center;padding:60px 20px;background:var(--bg-surface);border-radius:var(--radius-lg);border:1px dashed var(--border-subtle);color:var(--text-dim);margin-top:12px;">
          <div style="font-size:2.4rem;margin-bottom:10px;">🧾</div>
          <strong style="font-size:1.05rem;color:var(--text-main);">Hozircha to'lov cheki so'rovlari mavjud emas</strong>
          <p style="font-size:0.8rem;margin-top:6px;color:var(--text-dim);">
            Haydovchilar Telegram bot orqali adminga karta orqali pul o'tkazib skrinshot yuborganida, bu yerda darhol aks etadi.
          </p>
        </div>
      ` : `
        <div class="receipts-grid">
          ${filteredRequests.map(req => {
            const driverName = req.driver_name || req.driver?.user?.name || req.driver?.name || 'Noma\'lum Haydovchi';
            const driverPhone = req.driver_phone || req.driver?.user?.phone || req.driver?.phone || '—';
            const vehicle = req.driver_vehicle || req.driver?.vehicle_type || 'Taksi';

            const statusBadges = {
              pending: '<span class="status-badge" style="background:rgba(245,158,11,0.15);color:#fbbf24;border:1px solid rgba(245,158,11,0.35);">⏳ Kutilmoqda</span>',
              approved: '<span class="status-badge" style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.35);">✅ Yetkazildi</span>',
              rejected: '<span class="status-badge" style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.35);">❌ Rad Etildi</span>',
            };

            const screenshotUrl = req.screenshot_url || (req.screenshot_path ? (req.screenshot_path.startsWith('/') ? req.screenshot_path : '/' + req.screenshot_path) : null);
            const isTelegram = req.source === 'telegram';

            return `
              <div class="receipt-card" data-request-id="${req.id}" style="${isTelegram ? 'border-color:rgba(14,165,233,0.35);' : ''}">
                <div class="receipt-header">
                  <div class="receipt-driver-info">
                    <div class="receipt-avatar" style="${isTelegram ? 'background:#0284c7;color:#fff;' : ''}">
                      ${isTelegram ? '✈️' : driverName.charAt(0)}
                    </div>
                    <div>
                      <div style="display:flex;align-items:center;gap:6px;">
                        <strong style="font-size:0.92rem;color:var(--text-main);">${driverName}</strong>
                        ${isTelegram ? `
                          <span class="permission-pill" style="background:rgba(14,165,233,0.15);color:#38bdf8;border-color:rgba(14,165,233,0.3);padding:1px 6px;font-size:0.68rem;">
                            ✈️ Telegram ${req.telegram_username ? `(@${req.telegram_username})` : ''}
                          </span>
                        ` : ''}
                      </div>
                      <div style="font-size:0.75rem;color:var(--text-dim);display:flex;gap:6px;align-items:center;margin-top:2px;">
                        <span>${driverPhone}</span>
                        ${vehicle ? `• <span>${vehicle}</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div>
                    ${statusBadges[req.status] || req.status}
                  </div>
                </div>

                <div class="receipt-details-box">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--text-dim);">Yetkaziladigan Summa:</span>
                    <strong style="font-size:1.15rem;color:#34d399;font-family:var(--font-mono);">
                      +${Number(req.amount).toLocaleString()} so'm
                    </strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--text-dim);">Karta Raqami:</span>
                    <strong style="font-family:var(--font-mono);font-size:0.8rem;color:#93c5fd;">
                      ${req.card_number || 'Karta o\'tkazmasi'}
                    </strong>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:var(--text-dim);">Yuborilgan Vaqt:</span>
                    <span style="font-size:0.75rem;color:var(--text-muted);">
                      ${req.created_at || 'Yaqinda'}
                    </span>
                  </div>
                  ${req.notes ? `
                    <div style="padding-top:4px;border-top:1px dashed var(--border-subtle);font-size:0.78rem;color:var(--text-dim);">
                      <strong>Izoh:</strong> ${req.notes}
                    </div>
                  ` : ''}
                  ${req.status === 'approved' && (req.processed_by || req.processed_at) ? `
                    <div style="padding:6px 8px;background:rgba(16,185,129,0.08);border-radius:4px;font-size:0.73rem;color:#34d399;">
                      ✓ Yetkazdi: <strong>${req.processed_by || 'Dispetcher'}</strong> ${req.processed_at ? `(${req.processed_at})` : ''}
                    </div>
                  ` : ''}
                  ${req.status === 'rejected' ? `
                    <div style="padding:6px 8px;background:rgba(239,68,68,0.08);border-radius:4px;font-size:0.73rem;color:#f87171;">
                      ✗ Rad etildi: <strong>${req.rejection_reason || 'Sabab ko\'rsatilmadi'}</strong>
                    </div>
                  ` : ''}
                </div>

                <!-- Skrinshot Chek Rasmi -->
                ${screenshotUrl ? `
                  <div style="display:flex;flex-direction:column;gap:4px;">
                    <span style="font-size:0.72rem;color:var(--text-dim);font-weight:700;">📸 KARTA TO'LOV CHEKI SKRINSHOTI (Ko'rish uchun bosing):</span>
                    <img src="${screenshotUrl}" class="receipt-img-thumbnail" data-img-url="${screenshotUrl}" alt="To'lov cheki skrinshoti" />
                  </div>
                ` : `
                  <div style="padding:14px;background:rgba(255,255,255,0.02);border:1px dashed var(--border-subtle);border-radius:var(--radius-sm);text-align:center;font-size:0.75rem;color:var(--text-dim);">
                    📷 Skrinshot biriktirilmagan
                  </div>
                `}

                <!-- Amal Tugmalari -->
                <div class="receipt-actions-row">
                  ${req.status === 'pending' ? `
                    ${canApprove ? `
                      <button class="btn-approve-topup btn-new-order" data-id="${req.id}" data-amount="${req.amount}" data-driver="${driverName}" style="flex:1;justify-content:center;background:linear-gradient(135deg, #10b981, #059669);padding:9px;">
                        <span>✅ Pulni Yetkazish (Tasdiqlash)</span>
                      </button>
                    ` : `
                      <div style="flex:1;text-align:center;font-size:0.72rem;color:#f87171;padding:6px;background:rgba(239,68,68,0.1);border-radius:4px;">
                        🔒 Tasdiqlash ruxsati yo'q (wallet.approve kerak)
                      </div>
                    `}
                    ${canReject ? `
                      <button class="btn-reject-topup btn-secondary" data-id="${req.id}" style="padding:9px 14px;color:#f87171;border-color:rgba(239,68,68,0.3);" title="Chekni rad qilish">
                        <span>Rad Etish</span>
                      </button>
                    ` : ''}
                  ` : req.status === 'approved' ? `
                    <div style="width:100%;text-align:center;padding:6px;color:#34d399;font-size:0.8rem;font-weight:700;">
                      ✨ Haydovchi balansiga yetkazilgan
                    </div>
                  ` : `
                    <div style="width:100%;text-align:center;padding:6px;color:#f87171;font-size:0.8rem;font-weight:700;">
                      ⚠️ So'rov bekor qilingan
                    </div>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

function renderPermissionsView() {
  const isAdmin = state.user?.role === 'admin';
  const data = state.systemPermissionsData || {};
  const users = data.users || data.dispatchers || [];

  return `
    <div class="permissions-view-container">
      <div class="wallet-header-row">
        <div>
          <h2 style="font-size:1.25rem;font-weight:800;letter-spacing:-0.3px;">🛡️ Foydalanuvchi Rollari & Ruxsatlar Tizimi</h2>
          <p style="font-size:0.8rem;color:var(--text-dim);margin-top:2px;">
            Foydalanuvchilarning "role" maydoni (admin / dispatcher) orqali dispetcher panelidagi qo'shimcha imkoniyatlar avtomatik boshqariladi.
          </p>
        </div>
      </div>

      <!-- Current User Status Card -->
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:48px;height:48px;border-radius:50%;background:${isAdmin ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'linear-gradient(135deg, #3b82f6, #1d4ed8)'};display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.3rem;box-shadow:0 4px 14px rgba(0,0,0,0.3);">
            ${isAdmin ? '👑' : '🎧'}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <strong style="font-size:1.05rem;color:var(--text-main);">${state.user?.name || 'Foydalanuvchi'}</strong>
              <span class="permission-pill ${isAdmin ? 'granted' : ''}" style="text-transform:uppercase;font-size:0.72rem;letter-spacing:0.5px;">
                ${isAdmin ? '👑 Administrator' : '🎧 Dispetcher'}
              </span>
            </div>
            <p style="font-size:0.78rem;color:var(--text-dim);margin-top:2px;">
              ${isAdmin 
                ? "Siz tizimda to'liq administrator huquqiga egasiz: buyurtmalarni tahrirlash/bekor qilish, haydovchilarni qo'shish/tahrirlash, cheklarni tasdiqlash va pul yetkazish."
                : "Siz operatsion dispetcher hisobidasiz: chaqiruvlarni qabul qilish, haydovchiga biriktirish, jonli radar va to'lov holatlarini kuzatish."}
            </p>
          </div>
        </div>
        <div>
          <span style="font-size:0.75rem;padding:6px 12px;border-radius:20px;background:${isAdmin ? 'rgba(99,102,241,0.15)' : 'rgba(59,130,246,0.15)'};color:${isAdmin ? '#a5b4fc' : '#93c5fd'};border:1px solid ${isAdmin ? 'rgba(99,102,241,0.3)' : 'rgba(59,130,246,0.3)'};font-weight:700;">
            ${isAdmin ? '✨ Barcha Qo\'shimcha Funksiyalar Ochiq' : '🔒 Administrator Funksiyalari Cheklangan'}
          </span>
        </div>
      </div>

      <!-- Rollar Taqqoslama Kartalari (Admin vs Dispatcher) -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px;">
        <!-- Administrator Card -->
        <div style="background:var(--bg-surface);border:1px solid rgba(99,102,241,0.35);border-radius:var(--radius-md);padding:20px;display:flex;flex-direction:column;gap:14px;box-shadow:0 4px 20px rgba(0,0,0,0.2);">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:1.4rem;">👑</span>
              <div>
                <strong style="font-size:1rem;color:#a5b4fc;">Administrator (admin)</strong>
                <div style="font-size:0.72rem;color:var(--text-dim);">To'liq boshqaruv huquqi</div>
              </div>
            </div>
            <span class="permission-pill granted" style="font-size:0.68rem;">FULL ACCESS</span>
          </div>

          <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5;">
            Administrator foydalanuvchilar tizimdagi barcha ma'lumotlar va moliyaviy operatsiyalarni to'liq boshqarish huquqiga ega:
          </div>

          <div style="display:flex;flex-direction:column;gap:8px;font-size:0.78rem;">
            <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(255,255,255,0.02);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
              <span>🚖</span>
              <div>
                <strong style="color:#e2e8f0;">Buyurtmalarni To'liq Boshqarish:</strong>
                <p style="color:var(--text-dim);margin-top:2px;">Buyurtma yaratish, haydovchiga biriktirish, mijoz ma'lumotlarini tahrirlash (<code>orders.edit</code>), butunlay bekor qilish (<code>orders.cancel</code>).</p>
              </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(255,255,255,0.02);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
              <span>🚕</span>
              <div>
                <strong style="color:#e2e8f0;">Haydovchilar Bazasini Boshqarish:</strong>
                <p style="color:var(--text-dim);margin-top:2px;">Yangi haydovchi qo'shish (<code>drivers.create</code>), profil va mashina ma'lumotlarini tahrirlash (<code>drivers.edit</code>).</p>
              </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(255,255,255,0.02);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
              <span>💳</span>
              <div>
                <strong style="color:#e2e8f0;">To'lovlar & Balans Yetkazish:</strong>
                <p style="color:var(--text-dim);margin-top:2px;">Telegram cheklarini tasdiqlash & hisobga pul o'tkazish (<code>wallet.approve</code>), to'g'ridan-to'g'ri pul yetkazish (<code>wallet.topup</code>), rad etish (<code>wallet.reject</code>).</p>
              </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(255,255,255,0.02);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
              <span>👥</span>
              <div>
                <strong style="color:#e2e8f0;">Rollar Boshqaruvi:</strong>
                <p style="color:var(--text-dim);margin-top:2px;">Xodimlarni Dispetcher yoki Admin roliga o'tkazish.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Dispetcher Card -->
        <div style="background:var(--bg-surface);border:1px solid rgba(59,130,246,0.35);border-radius:var(--radius-md);padding:20px;display:flex;flex-direction:column;gap:14px;box-shadow:0 4px 20px rgba(0,0,0,0.2);">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:1.4rem;">🎧</span>
              <div>
                <strong style="font-size:1rem;color:#93c5fd;">Dispetcher (dispatcher)</strong>
                <div style="font-size:0.72rem;color:var(--text-dim);">Operatsion xodim huquqi</div>
              </div>
            </div>
            <span class="permission-pill" style="font-size:0.68rem;background:rgba(59,130,246,0.15);color:#93c5fd;border-color:rgba(59,130,246,0.3);">OPERATOR</span>
          </div>

          <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5;">
            Dispetcherlar buyurtmalarni qabul qilish va haydovchilarni marshrutga yo'naltirish operatsiyalarini bajaradilar:
          </div>

          <div style="display:flex;flex-direction:column;gap:8px;font-size:0.78rem;">
            <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(255,255,255,0.02);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
              <span>✅</span>
              <div>
                <strong style="color:#34d399;">Ruxsat Etilgan Imkoniyatlar:</strong>
                <ul style="margin:4px 0 0 16px;padding:0;color:var(--text-dim);line-height:1.4;">
                  <li>Chaqiruvlarni qabul qilish va yangi buyurtma ochish (<code>orders.create</code>)</li>
                  <li>Taksi haydovchilariga buyurtmani biriktirish (<code>orders.assign</code>)</li>
                  <li>Jonli GPS radar va xaritada taksilarni kuzatish (<code>map.view</code>)</li>
                  <li>Haydovchilar ro'yxatini ko'rish (<code>drivers.view</code>)</li>
                  <li>Kelgan to'lov cheklarini ko'rish (<code>wallet.view</code>)</li>
                </ul>
              </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(239,68,68,0.04);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid rgba(239,68,68,0.25);">
              <span>🔒</span>
              <div>
                <strong style="color:#f87171;">Cheklangan (Faqat Admin Bajarishi Mumkin):</strong>
                <ul style="margin:4px 0 0 16px;padding:0;color:var(--text-dim);line-height:1.4;">
                  <li>Chekni tasdiqlash va haydovchiga pul yetkazish</li>
                  <li>Haydovchi balansini to'g'ridan-to'g'ri to'ldirish</li>
                  <li>Yangi taksi haydovchisi qo'shish yoki tahrirlash</li>
                  <li>Mijoz ma'lumotlarini tahrirlash yoki buyurtmani bekor qilish</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Xodimlar Ro'yxati va Ularning Rolini Boshqarish -->
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:20px;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div>
            <h3 style="font-size:1.05rem;font-weight:800;color:var(--text-main);">
              👥 Tizim Xodimlari va Rollari (${users.length})
            </h3>
            <p style="font-size:0.78rem;color:var(--text-dim);margin-top:2px;">
              Foydalanuvchilarning "users" jadvalidagi <code>role</code> maydoni orqali ruxsatlar boshqariladi.
            </p>
          </div>
          ${!isAdmin ? `
            <span style="font-size:0.75rem;color:#fbbf24;background:rgba(245,158,11,0.1);padding:4px 10px;border-radius:4px;border:1px solid rgba(245,158,11,0.3);">
              ℹ️ Rollarni o'zgartirish faqat Administratorga ruxsat etilgan
            </span>
          ` : ''}
        </div>

        <div style="display:flex;flex-direction:column;gap:12px;">
          ${users.map(u => {
            const isUserAdmin = u.role === 'admin' || u.is_admin;
            return `
              <div class="user-perms-card" data-user-id="${u.id}" style="background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;">
                <div style="display:flex;align-items:center;gap:12px;">
                  <div style="width:40px;height:40px;border-radius:50%;background:${isUserAdmin ? '#6366f1' : '#3b82f6'};display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.05rem;">
                    ${u.name.charAt(0)}
                  </div>
                  <div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <strong style="font-size:0.95rem;color:var(--text-main);">${u.name}</strong>
                      <span class="permission-pill ${isUserAdmin ? 'granted' : ''}" style="text-transform:uppercase;font-size:0.7rem;">
                        ${isUserAdmin ? '👑 ADMIN' : '🎧 DISPETCHER'}
                      </span>
                      ${u.id === state.user?.id ? `
                        <span style="font-size:0.68rem;background:rgba(16,185,129,0.15);color:#34d399;padding:1px 6px;border-radius:4px;border:1px solid rgba(16,185,129,0.3);">SIZ</span>
                      ` : ''}
                    </div>
                    <div style="font-size:0.75rem;color:var(--text-dim);font-family:var(--font-mono);margin-top:2px;">
                      login: ${u.username} • Tel: ${u.phone || '—'} • ID #${u.id}
                    </div>
                  </div>
                </div>

                <!-- Role Selector or Info -->
                <div style="display:flex;align-items:center;gap:10px;">
                  ${isAdmin ? `
                    <div style="display:flex;align-items:center;gap:8px;">
                      <select class="select-user-role form-control" data-user-id="${u.id}" style="padding:6px 12px;font-size:0.8rem;background:var(--bg-main);border:1px solid var(--border-subtle);color:var(--text-main);border-radius:var(--radius-sm);">
                        <option value="dispatcher" ${!isUserAdmin ? 'selected' : ''}>🎧 Dispetcher (Operator)</option>
                        <option value="admin" ${isUserAdmin ? 'selected' : ''}>👑 Administrator (Full)</option>
                      </select>
                      <button class="btn-change-user-role hud-btn" data-user-id="${u.id}" style="padding:6px 12px;font-size:0.8rem;color:#38bdf8;border-color:rgba(14,165,233,0.35);">
                        <span>💾 Rolni Saqlash</span>
                      </button>
                    </div>
                  ` : `
                    <span style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono);">
                      Rol: <strong>${u.role}</strong>
                    </span>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderTopupModal() {
  if (!state.isTopupModalOpen) return '';
  const selectedDriverId = state.selectedDriverForTopup;
  const selectedDriver = state.drivers.find(d => d.id === selectedDriverId) || (state.drivers.length > 0 ? state.drivers[0] : null);

  return `
    <div class="modal-overlay" id="topup-modal-overlay">
      <div class="modal-content" style="max-width:480px;">
        <div class="modal-header">
          <div>
            <h3 style="font-size:1.15rem;font-weight:800;">💳 Haydovchi Balansini To'ldirish</h3>
            <p style="font-size:0.75rem;color:var(--text-dim);margin-top:2px;">
              Taksi haydovchisi hisobiga to'g'ridan-to'g'ri pul mablag'i qo'shish
            </p>
          </div>
          <button id="btn-close-topup-modal" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:1.2rem;">✕</button>
        </div>

        <form id="form-direct-topup">
          ${selectedDriver ? `
            <input type="hidden" id="topup-driver-id" value="${selectedDriver.id}" />
            <div class="form-group">
              <label>Tanlangan Taksi Haydovchisi</label>
              <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="width:38px;height:38px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1rem;box-shadow:0 2px 10px rgba(16,185,129,0.3);">
                    ${selectedDriver.name.charAt(0)}
                  </div>
                  <div>
                    <strong style="font-size:0.95rem;color:var(--text-main);">${selectedDriver.name}</strong>
                    <div style="font-size:0.72rem;color:var(--text-dim);margin-top:2px;">
                      ${selectedDriver.vehicle_type || 'Mashina'} • <span style="font-family:var(--font-mono);color:#93c5fd;">${selectedDriver.license_plate || "Raqamsiz"}</span> • Tel: <span style="font-family:var(--font-mono);">${selectedDriver.phone || '—'}</span>
                    </div>
                  </div>
                </div>
                <div style="text-align:right;">
                  <span style="font-size:0.7rem;color:var(--text-dim);display:block;">Joriy Balans:</span>
                  <strong style="font-size:0.95rem;color:#34d399;font-family:var(--font-mono);">
                    ${Number(selectedDriver.balance || 0).toLocaleString()} so'm
                  </strong>
                </div>
              </div>
            </div>
          ` : `
            <div style="padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm);color:#f87171;font-size:0.8rem;margin-bottom:12px;">
              Haydovchi topilmadi.
            </div>
          `}

          <div class="form-group">
            <label>To'ldiriladigan Summa (so'm)</label>
            <input type="number" id="topup-amount" class="form-input" min="1000" step="5000" placeholder="50 000" value="50000" required />
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
              <button type="button" class="btn-preset-amount hud-btn" data-amt="20000" style="padding:4px 8px;font-size:0.72rem;">+20 000</button>
              <button type="button" class="btn-preset-amount hud-btn" data-amt="50000" style="padding:4px 8px;font-size:0.72rem;">+50 000</button>
              <button type="button" class="btn-preset-amount hud-btn" data-amt="100000" style="padding:4px 8px;font-size:0.72rem;">+100 000</button>
              <button type="button" class="btn-preset-amount hud-btn" data-amt="200000" style="padding:4px 8px;font-size:0.72rem;">+200 000</button>
              <button type="button" class="btn-preset-amount hud-btn" data-amt="500000" style="padding:4px 8px;font-size:0.72rem;">+500 000</button>
            </div>
          </div>

          <div class="modal-footer" style="margin-top:20px;">
            <button type="button" id="btn-cancel-topup-modal" class="btn-secondary">Bekor qilish</button>
            <button type="submit" id="btn-submit-direct-topup" class="btn-new-order" style="background:linear-gradient(135deg, #10b981, #059669);">
              💳 Balansni To'ldirish
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderReceiptPreviewModal() {
  if (!state.previewReceiptUrl) return '';

  return `
    <div class="modal-overlay" id="receipt-preview-overlay" style="z-index:9999;">
      <div class="modal-content" style="max-width:700px;background:rgba(15,23,42,0.95);backdrop-filter:blur(24px);padding:20px;">
        <div class="modal-header" style="padding:0 0 12px 0;margin-bottom:12px;">
          <div>
            <h3 style="font-size:1.15rem;font-weight:800;color:var(--text-main);">🧾 To'lov Cheki Skrinshoti</h3>
            <p style="font-size:0.75rem;color:var(--text-dim);">Haydovchi tomonidan yuklangan karta to'lovi skrinshoti</p>
          </div>
          <button id="btn-close-receipt-modal" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:1.3rem;">✕</button>
        </div>

        <div style="display:flex;justify-content:center;align-items:center;background:rgba(0,0,0,0.4);border-radius:var(--radius-md);padding:14px;border:1px solid var(--border-subtle);min-height:360px;">
          <img src="${state.previewReceiptUrl}" alt="Chek skrinshoti" style="max-width:100%;max-height:65vh;object-fit:contain;border-radius:var(--radius-sm);box-shadow:0 10px 30px rgba(0,0,0,0.5);" />
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;">
          <a href="${state.previewReceiptUrl}" target="_blank" rel="noopener noreferrer" class="hud-btn" style="text-decoration:none;">
            <span>Yangi Oynada Ochish ↗</span>
          </a>
          <button id="btn-close-receipt-modal-bottom" class="btn-secondary">Yopish</button>
        </div>
      </div>
    </div>
  `;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${type === 'alert' ? '⚠️' : '🔔'}</span> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function bindLoginEvents() {
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const login = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await api.login(login, password);
      state.user = res.user;
      state.errorMsg = null;
      render();
      initDashboard();
    } catch (err) {
      state.errorMsg = err.message || 'Login failed. Please check credentials.';
      render();
    }
  });

  document.querySelectorAll('.btn-preset-login').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const login = e.currentTarget.dataset.login;
      const userInput = document.getElementById('login-username');
      const passInput = document.getElementById('login-password');
      if (userInput && passInput) {
        userInput.value = login;
        passInput.value = 'password';
      }
      try {
        const res = await api.login(login, 'password');
        state.user = res.user;
        state.errorMsg = null;
        render();
        initDashboard();
      } catch (err) {
        state.errorMsg = err.message || 'Login failed.';
        render();
      }
    });
  });
}

function bindEvents() {
  // Sidebar Toggle (Collapse / Expand)
  const collapseBtn = document.getElementById('btn-collapse-sidebar');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      state.isSidebarCollapsed = true;
      render();
      invalidateMapSize();
    });
  }

  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      state.isSidebarCollapsed = !state.isSidebarCollapsed;
      render();
      invalidateMapSize();
    });
  }

  // Navigation Tabs in Sidebar
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      const targetTab = e.currentTarget.dataset.tab;
      if (targetTab) {
        if (state.user?.role !== 'admin' && !['map', 'orders'].includes(targetTab)) {
          return;
        }
        state.activeTab = targetTab;
        render();
        if (targetTab === 'permissions') {
          await loadDashboardData(true);
          render();
        }
      }
    });
  });

  // Logout
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await api.logout();
      state.user = null;
      clearInterval(state.syncInterval);
      render();
    });
  }

  // Open Create Order Modal
  const openModalBtn = document.getElementById('btn-open-create-order');
  if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
      state.isNewOrderModalOpen = true;
      render();
    });
  }

  // Close Modal
  const closeModalBtn = document.getElementById('btn-close-modal');
  const cancelModalBtn = document.getElementById('btn-cancel-modal');
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      state.isNewOrderModalOpen = false;
      render();
    });
  }
  if (cancelModalBtn) {
    cancelModalBtn.addEventListener('click', () => {
      state.isNewOrderModalOpen = false;
      render();
    });
  }

  // Submit New Order
  const newOrderForm = document.getElementById('new-order-form');
  if (newOrderForm) {
    newOrderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = newOrderForm.querySelector('button[type="submit"]');
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.dataset.originalText = submitBtn.innerText;
          submitBtn.innerText = 'Yaratilmoqda...';
        }

        const orderData = {
          customer_name: document.getElementById('cust-name').value,
          customer_phone: document.getElementById('cust-phone').value,
          pickup_address: document.getElementById('pickup-addr').value,
          delivery_address: document.getElementById('delivery-addr').value,
          total_amount: document.getElementById('order-amount').value ? parseFloat(document.getElementById('order-amount').value) : null,
          rate_per_km: document.getElementById('order-rate') ? parseFloat(document.getElementById('order-rate').value) : 2000,
          notes: document.getElementById('order-notes').value,
          pickup_lat: Number((41.3110 + (Math.random() - 0.5) * 0.04).toFixed(6)),
          pickup_lng: Number((69.2405 + (Math.random() - 0.5) * 0.04).toFixed(6)),
          delivery_lat: Number((41.3110 + (Math.random() - 0.5) * 0.04).toFixed(6)),
          delivery_lng: Number((69.2405 + (Math.random() - 0.5) * 0.04).toFixed(6)),
        };

        const res = await api.createOrder(orderData);
        state.isNewOrderModalOpen = false;
        playAlertSound('new_order');
        showToast(`${formatOrderTitle(res.order.order_number)} muvaffaqiyatli yaratildi!`);
        await loadDashboardData();
        state.selectedOrder = res.order;
        render();
      } catch (err) {
        alert(err.message || 'Buyurtma yaratishda xatolik yuz berdi');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = submitBtn.dataset.originalText || 'Buyurtma Yaratish';
        }
      }
    });
  }

  // Open Create Driver Modal
  const openDriverModalBtn = document.getElementById('btn-open-create-driver');
  if (openDriverModalBtn) {
    openDriverModalBtn.addEventListener('click', () => {
      state.isNewDriverModalOpen = true;
      render();
    });
  }

  // Close Driver Modal
  const closeDriverModalBtn = document.getElementById('btn-close-driver-modal');
  const cancelDriverModalBtn = document.getElementById('btn-cancel-driver-modal');
  if (closeDriverModalBtn) {
    closeDriverModalBtn.addEventListener('click', () => {
      state.isNewDriverModalOpen = false;
      render();
    });
  }
  if (cancelDriverModalBtn) {
    cancelDriverModalBtn.addEventListener('click', () => {
      state.isNewDriverModalOpen = false;
      render();
    });
  }

  // Submit New Driver Form
  const newDriverForm = document.getElementById('new-driver-form');
  if (newDriverForm) {
    newDriverForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = newDriverForm.querySelector('button[type="submit"]');
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.dataset.originalText = submitBtn.innerText;
          submitBtn.innerText = 'Qo\'shilmoqda...';
        }

        const emailVal = document.getElementById('driver-email').value.trim();
        const driverData = {
          name: document.getElementById('driver-name').value,
          phone: document.getElementById('driver-phone').value,
          email: emailVal ? emailVal : undefined,
          password: document.getElementById('driver-password').value || 'password',
          vehicle_type: document.getElementById('driver-vehicle').value,
          license_plate: document.getElementById('driver-plate').value,
          status: document.getElementById('driver-status').value,
          current_lat: parseFloat(document.getElementById('driver-lat').value),
          current_lng: parseFloat(document.getElementById('driver-lng').value),
        };

        const res = await api.createDriver(driverData);
        state.isNewDriverModalOpen = false;
        showToast(`Haydovchi ${res.driver.name} qo'shildi! Mobil ilovaga kirish: ${res.driver.phone}`);
        await loadDashboardData();
        render();
      } catch (err) {
        alert(err.message || "Haydovchini ro'yxatdan o'tkazishda xatolik");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = submitBtn.dataset.originalText || "Haydovchi Qo'shish";
        }
      }
    });
  }

  // Open Edit Driver Modal
  document.querySelectorAll('.btn-edit-driver-fleet').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const driverId = Number(e.currentTarget.dataset.driverId);
      const targetDriver = state.drivers.find(d => d.id === driverId);
      if (targetDriver) {
        state.editingDriver = targetDriver;
        state.isEditDriverModalOpen = true;
        render();
      }
    });
  });

  // Delete Driver from Fleet (Admin only)
  document.querySelectorAll('.btn-delete-driver-fleet').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!hasPermission('drivers.delete') && state.user?.role !== 'admin') {
        alert("Sizda haydovchini o'chirish huquqi (drivers.delete) mavjud emas!");
        return;
      }
      const driverId = Number(e.currentTarget.dataset.driverId);
      const driverName = e.currentTarget.dataset.driverName || 'Haydovchi';

      const confirmed = window.confirm(
        `Haqiqatan ham "${driverName}" haydovchisini tizimdan butunlay o'chirib tashlamoqchimisiz?\n\nOgohlantirish: Ushbu amal qaytarilmaydi!`
      );
      if (!confirmed) {
        return;
      }

      const originalHtml = btn.innerHTML;
      try {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ O\'chirilmoqda...</span>';
        const res = await api.deleteDriver(driverId);
        showToast(res.message || "Haydovchi muvaffaqiyatli o'chirildi");
        await loadDashboardData(true);
        render();
      } catch (err) {
        alert(err.message || "Haydovchini o'chirishda xatolik yuz berdi");
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    });
  });

  // Close Edit Driver Modal
  const closeEditModalBtn = document.getElementById('btn-close-edit-driver-modal');
  const cancelEditModalBtn = document.getElementById('btn-cancel-edit-driver-modal');
  if (closeEditModalBtn) {
    closeEditModalBtn.addEventListener('click', () => {
      state.isEditDriverModalOpen = false;
      state.editingDriver = null;
      render();
    });
  }
  if (cancelEditModalBtn) {
    cancelEditModalBtn.addEventListener('click', () => {
      state.isEditDriverModalOpen = false;
      state.editingDriver = null;
      render();
    });
  }

  // Submit Edit Driver Form
  const editDriverForm = document.getElementById('edit-driver-form');
  if (editDriverForm) {
    editDriverForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const driverId = document.getElementById('edit-driver-id').value;
      const updateData = {
        name: document.getElementById('edit-driver-name').value.trim(),
        phone: document.getElementById('edit-driver-phone').value.trim(),
        vehicle_type: document.getElementById('edit-driver-vehicle').value.trim(),
        license_plate: document.getElementById('edit-driver-plate').value.trim(),
      };

      try {
        const saveBtn = document.getElementById('btn-save-edit-driver');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerText = 'Saqlanmoqda...';
        }

        const res = await api.updateDriver(driverId, updateData);
        state.isEditDriverModalOpen = false;
        state.editingDriver = null;
        showToast(`Haydovchi ${res.driver.name} ma'lumotlari muvaffaqiyatli yangilandi!`);
        await loadDashboardData();
        render();
      } catch (err) {
        alert(err.message || "Haydovchi ma'lumotlarini yangilashda xatolik yuz berdi");
        const saveBtn = document.getElementById('btn-save-edit-driver');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerText = "💾 O'zgarishlarni Saqlash";
        }
      }
    });
  }

  // Close Edit Order Modal
  const closeEditOrderModalBtn = document.getElementById('btn-close-edit-order-modal');
  const cancelEditOrderModalBtn = document.getElementById('btn-cancel-edit-order-modal');
  const editOrderModalOverlay = document.getElementById('edit-order-modal-overlay');

  const closeEditOrderModal = () => {
    state.isEditOrderModalOpen = false;
    state.editingOrder = null;
    render();
  };

  if (closeEditOrderModalBtn) closeEditOrderModalBtn.addEventListener('click', closeEditOrderModal);
  if (cancelEditOrderModalBtn) cancelEditOrderModalBtn.addEventListener('click', closeEditOrderModal);
  if (editOrderModalOverlay) {
    editOrderModalOverlay.addEventListener('click', (e) => {
      if (e.target === editOrderModalOverlay) closeEditOrderModal();
    });
  }

  // Submit Edit Order Form
  const editOrderForm = document.getElementById('edit-order-form');
  if (editOrderForm) {
    editOrderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-edit-order');
      const orderId = document.getElementById('edit-order-id').value;
      const customerName = document.getElementById('edit-order-customer-name').value.trim();
      const customerPhone = document.getElementById('edit-order-customer-phone').value.trim();
      const pickupAddress = document.getElementById('edit-order-pickup-address').value.trim();
      const deliveryAddress = document.getElementById('edit-order-delivery-address').value.trim();
      const totalAmountVal = document.getElementById('edit-order-total-amount')?.value;
      const notes = document.getElementById('edit-order-notes').value.trim();

      const payload = {
        customer_name: customerName,
        customer_phone: customerPhone,
        pickup_address: pickupAddress,
        delivery_address: deliveryAddress,
        notes: notes || null,
      };

      if (totalAmountVal && totalAmountVal !== '') {
        payload.total_amount = Number(totalAmountVal);
      }

      try {
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerText = 'Saqlanmoqda...';
        }

        const res = await api.updateOrder(orderId, payload);
        const updated = res.order;

        showToast("Mijoz ma'lumotlari muvaffaqiyatli saqlandi!");

        state.selectedOrder = updated;

        const idx = state.orders.findIndex(o => o.id == orderId);
        if (idx !== -1) {
          state.orders[idx] = updated;
        }

        state.isEditOrderModalOpen = false;
        state.editingOrder = null;
        render();

        const targetCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
        if (targetCard) {
          const temp = document.createElement('div');
          temp.innerHTML = renderOrderCardHtml(updated).trim();
          const newCard = temp.firstElementChild;
          targetCard.replaceWith(newCard);
          bindSingleOrderCard(newCard);
        }
      } catch (err) {
        alert(err.message || "Mijoz ma'lumotlarini saqlashda xatolik yuz berdi");
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerText = "💾 O'zgarishlarni Saqlash";
        }
      }
    });
  }

  // Map Controls
  const centerBtn = document.getElementById('btn-center-drivers');
  if (centerBtn) {
    centerBtn.addEventListener('click', () => centerAllDrivers());
  }

  // Toggle Fleet Drawer on Map
  const toggleFleetBtn = document.getElementById('btn-toggle-fleet-drawer');
  if (toggleFleetBtn) {
    toggleFleetBtn.addEventListener('click', () => {
      state.isFleetDrawerOpen = !state.isFleetDrawerOpen;
      render();
      invalidateMapSize();
    });
  }

  const closeFleetBtn = document.getElementById('btn-close-fleet-drawer');
  if (closeFleetBtn) {
    closeFleetBtn.addEventListener('click', () => {
      state.isFleetDrawerOpen = false;
      render();
      invalidateMapSize();
    });
  }

  // Tile Provider Selector
  const tileSelect = document.getElementById('select-tile-provider');
  if (tileSelect) {
    tileSelect.addEventListener('change', (e) => {
      state.currentTileProvider = e.target.value;
      setTileProvider(e.target.value);
    });
  }

  // Focus Driver on Map
  document.querySelectorAll('.btn-focus-driver').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const driverId = Number(e.currentTarget.dataset.driverId);
      focusDriver(driverId);
    });
  });

  // Track Driver from Fleet View
  document.querySelectorAll('.btn-focus-driver-fleet').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const driverId = Number(e.currentTarget.dataset.driverId);
      state.activeTab = 'map';
      render();
      setTimeout(() => focusDriver(driverId), 300);
    });
  });

  // Bind detail pane actions for current render
  bindDetailPaneEvents();

  // Search Input (Orders) - Debounced server search
  let ordersSearchTimer = null;
  const searchInput = document.getElementById('orders-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      clearTimeout(ordersSearchTimer);
      ordersSearchTimer = setTimeout(async () => {
        state.ordersPage = 1;
        state.ordersHasMore = true;
        await loadDashboardData(true);
        render();
        const updatedSearch = document.getElementById('orders-search');
        if (updatedSearch) {
          updatedSearch.focus();
          updatedSearch.selectionStart = updatedSearch.selectionEnd = updatedSearch.value.length;
        }
      }, 350);
    });
  }

  // Search Input (Fleet)
  const fleetSearchInput = document.getElementById('fleet-search-input');
  if (fleetSearchInput) {
    fleetSearchInput.addEventListener('input', (e) => {
      state.driverSearchQuery = e.target.value;
      render();
      const updatedFleetSearch = document.getElementById('fleet-search-input');
      if (updatedFleetSearch) {
        updatedFleetSearch.focus();
        updatedFleetSearch.selectionStart = updatedFleetSearch.selectionEnd = updatedFleetSearch.value.length;
      }
    });
  }

  // Filter Tabs - Server-side filter
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', async (e) => {
      const newStatus = e.currentTarget.dataset.status;
      if (state.filterStatus === newStatus) return;
      state.filterStatus = newStatus;
      state.ordersPage = 1;
      state.ordersHasMore = true;
      await loadDashboardData(true);
      render();
      const ol = document.querySelector('.orders-list');
      if (ol) ol.scrollTop = 0;
    });
  });

  // Select Order Card
  document.querySelectorAll('.order-card').forEach(card => {
    bindSingleOrderCard(card);
  });

  // Instagram-style Infinite Scroll down for Orders List
  const ordersListEl = document.querySelector('.orders-list');
  if (ordersListEl) {
    ordersListEl.addEventListener('scroll', () => {
      if (ordersListEl.scrollTop + ordersListEl.clientHeight >= ordersListEl.scrollHeight - 140) {
        loadMoreOrders();
      }
    }, { passive: true });

    // Fallback/Enhancement: IntersectionObserver on Sentinel
    const sentinel = document.getElementById('orders-scroll-sentinel');
    if (sentinel && window.IntersectionObserver) {
      const observer = new IntersectionObserver((entries) => {
        if (entries[0] && entries[0].isIntersecting) {
          loadMoreOrders();
        }
      }, { root: ordersListEl, rootMargin: '120px' });
      observer.observe(sentinel);
    }
  }

    // Manual Sync Button
  const manualSyncBtn = document.getElementById('btn-manual-sync');
  if (manualSyncBtn) {
    manualSyncBtn.addEventListener('click', async () => {
      manualSyncBtn.innerText = '⌛';
      try {
        await loadDashboardData(true);
        render();
        showToast('Operatsiyalar ro\'yxati serverdan yangilandi.');
      } catch (e) {
        showToast('Sinxronlashda xatolik: ' + e.message, 'alert');
      }
    });
  }

  // --- WALLET & TOP-UP REQUESTS EVENTS ---
  // Top-up status filter buttons
  document.querySelectorAll('.btn-filter-topup').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const status = e.currentTarget.dataset.topupStatus;
      state.topupFilterStatus = status;
      await loadDashboardData(true);
      render();
    });
  });

  // Simulate Telegram Incoming Check
  const simulateTelegramBtn = document.getElementById('btn-simulate-telegram-check');
  if (simulateTelegramBtn) {
    simulateTelegramBtn.addEventListener('click', async () => {
      try {
        simulateTelegramBtn.disabled = true;
        simulateTelegramBtn.innerText = 'Yuklanmoqda...';
        await api.simulateTelegramCheck({
          amount: 100000,
          caption: "Telegram bot orqali 100 000 so'm to'lov cheki (Payme)",
          telegram_username: "haydovchi_bot",
        });
        showToast("✈️ Telegram orqali yangi to'lov cheki kelib tushdi! (+100 000 so'm)");
        await loadDashboardData(true);
        render();
      } catch (err) {
        alert(err.message || 'Telegram chekini sinashda xatolik');
        simulateTelegramBtn.disabled = false;
        simulateTelegramBtn.innerText = '✈️ + Telegram Chekini Sinash';
      }
    });
  }

  // Approve Top-up receipt
  document.querySelectorAll('.btn-approve-topup').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reqId = e.currentTarget.dataset.id;
      const driverName = e.currentTarget.dataset.driver;
      const amount = Number(e.currentTarget.dataset.amount).toLocaleString();

      if (!confirm(`Haqiqatan ham ${driverName} uchun ${amount} so'm to'lov chekini tasdiqlab, balansiga yetkazmoqchimisiz?`)) {
        return;
      }

      try {
        btn.disabled = true;
        btn.innerText = 'Yetkazilmoqda...';
        await api.approveTopupRequest(reqId);
        showToast(`Balans muvaffaqiyatli yetkazildi! +${amount} so'm`);
        await loadDashboardData(true);
        render();
      } catch (err) {
        alert(err.message || 'Mablag\'ni yetkazishda xatolik yuz berdi');
        btn.disabled = false;
        btn.innerText = '✅ Pulni Yetkazish (Tasdiqlash)';
      }
    });
  });

  // Reject Top-up receipt
  document.querySelectorAll('.btn-reject-topup').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reqId = e.currentTarget.dataset.id;
      const reason = prompt('Iltimos, rad etish sababini kiriting (masalan: Chek tasdiqlanmadi, summa kelib tushmadi):');
      if (reason === null) return;

      try {
        btn.disabled = true;
        await api.rejectTopupRequest(reqId, reason.trim() || undefined);
        showToast('To\'lov cheki so\'rovi rad etildi.');
        await loadDashboardData(true);
        render();
      } catch (err) {
        alert(err.message || 'Rad etishda xatolik yuz berdi');
        btn.disabled = false;
      }
    });
  });

  // Receipt image click for full preview
  document.querySelectorAll('.receipt-img-thumbnail').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      state.previewReceiptUrl = e.currentTarget.dataset.imgUrl || e.currentTarget.src;
      render();
    });
  });

  // Close receipt preview modal
  const closeReceiptBtn = document.getElementById('btn-close-receipt-modal');
  const closeReceiptBottomBtn = document.getElementById('btn-close-receipt-modal-bottom');
  const receiptOverlay = document.getElementById('receipt-preview-overlay');

  const closeReceiptModal = () => {
    state.previewReceiptUrl = null;
    render();
  };

  if (closeReceiptBtn) closeReceiptBtn.addEventListener('click', closeReceiptModal);
  if (closeReceiptBottomBtn) closeReceiptBottomBtn.addEventListener('click', closeReceiptModal);
  if (receiptOverlay) {
    receiptOverlay.addEventListener('click', (e) => {
      if (e.target === receiptOverlay) closeReceiptModal();
    });
  }

  // Open Direct Top-up modal
  const openDirectTopupTopbar = document.getElementById('btn-open-direct-topup-topbar');
  if (openDirectTopupTopbar) {
    openDirectTopupTopbar.addEventListener('click', () => {
      state.selectedDriverForTopup = null;
      state.isTopupModalOpen = true;
      render();
    });
  }

  const openDirectTopupWallet = document.getElementById('btn-open-direct-topup-wallet');
  if (openDirectTopupWallet) {
    openDirectTopupWallet.addEventListener('click', () => {
      state.selectedDriverForTopup = null;
      state.isTopupModalOpen = true;
      render();
    });
  }

  document.querySelectorAll('.btn-topup-driver-fleet').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!hasPermission('wallet.topup') && state.user?.role !== 'admin') {
        alert('Sizda balans to\'ldirish ruxsati (wallet.topup) mavjud emas!');
        return;
      }
      const driverId = Number(e.currentTarget.dataset.driverId);
      state.selectedDriverForTopup = driverId;
      state.isTopupModalOpen = true;
      render();
    });
  });

  // Close Direct Top-up modal
  const closeTopupBtn = document.getElementById('btn-close-topup-modal');
  const cancelTopupBtn = document.getElementById('btn-cancel-topup-modal');
  const topupOverlay = document.getElementById('topup-modal-overlay');

  const closeTopupModal = () => {
    state.isTopupModalOpen = false;
    state.selectedDriverForTopup = null;
    render();
  };

  if (closeTopupBtn) closeTopupBtn.addEventListener('click', closeTopupModal);
  if (cancelTopupBtn) cancelTopupBtn.addEventListener('click', closeTopupModal);
  if (topupOverlay) {
    topupOverlay.addEventListener('click', (e) => {
      if (e.target === topupOverlay) closeTopupModal();
    });
  }

  // Preset amount buttons in topup modal
  document.querySelectorAll('.btn-preset-amount').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const amt = e.currentTarget.dataset.amt;
      const input = document.getElementById('topup-amount');
      if (input) {
        input.value = amt;
      }
    });
  });

  // Submit Direct Top-up form (Directly add money to driver balance)
  const formDirectTopup = document.getElementById('form-direct-topup');
  if (formDirectTopup) {
    formDirectTopup.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-direct-topup');
      const driverId = document.getElementById('topup-driver-id').value;
      const amount = parseFloat(document.getElementById('topup-amount').value);

      if (!driverId) {
        alert('Iltimos, haydovchini tanlang');
        return;
      }
      if (!amount || amount <= 0) {
        alert("Iltimos, to'g'ri summani kiriting");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerText = "To'ldirilmoqda...";
        }

        await api.topupDriver(driverId, amount, "Administrator tomonidan balans to'ldirildi");

        showToast(`Muvaffaqiyatli! Haydovchi balansiga ${amount.toLocaleString()} so'm qo'shildi.`);
        state.isTopupModalOpen = false;
        state.selectedDriverForTopup = null;
        await loadDashboardData(true);
        render();
      } catch (err) {
        alert(err.message || "Balansni to'ldirishda xatolik yuz berdi");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "💳 Balansni To'ldirish";
        }
      }
    });
  }

  // --- ROLE MANAGEMENT EVENTS (Admin only) ---
  document.querySelectorAll('.btn-change-user-role').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userId = e.currentTarget.dataset.userId;
      const select = document.querySelector(`.select-user-role[data-user-id="${userId}"]`);
      if (!select) return;
      const newRole = select.value;

      try {
        btn.disabled = true;
        btn.innerText = 'Saqlanmoqda...';
        const res = await api.updateUserRole(userId, newRole);
        showToast(res.message || "Foydalanuvchi roli muvaffaqiyatli yangilandi!");

        if (state.user && state.user.id == userId) {
          state.user.role = res.user.role;
          state.user.permissions = res.user.permissions;
        }

        await loadDashboardData(true);
        render();
      } catch (err) {
        alert(err.message || "Rolni o'zgartirishda xatolik yuz berdi");
        btn.disabled = false;
        btn.innerText = '💾 Rolni Saqlash';
      }
    });
  });

  // --- PERMISSIONS MANAGEMENT EVENTS (Admin only) ---
  document.querySelectorAll('.btn-save-user-perms').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userId = e.currentTarget.dataset.userId;
      const card = document.querySelector(`.user-perms-card[data-user-id="${userId}"]`);
      if (!card) return;

      const checkedInputs = card.querySelectorAll('input[type="checkbox"]:checked');
      const selectedCodes = Array.from(checkedInputs).map(cb => cb.value);

      try {
        btn.disabled = true;
        btn.innerText = 'Saqlanmoqda...';
        const res = await api.updateUserPermissions(userId, selectedCodes);
        showToast(`Ruxsatlar muvaffaqiyatli saqlandi! (${res.permissions.length} ta ruxsat)`);

        if (state.user && state.user.id == userId) {
          state.user.permissions = res.permissions;
        }

        await loadDashboardData(true);
        render();
      } catch (err) {
        alert(err.message || 'Ruxsatlarni saqlashda xatolik yuz berdi');
        btn.disabled = false;
        btn.innerText = '💾 Ruxsatlarni Saqlash';
      }
    });
  });
}

// Single Order Card Binding (Module scope)
function bindSingleOrderCard(card) {
  if (!card) return;
  card.addEventListener('click', async () => {
    const orderId = card.dataset.orderId;
    document.querySelectorAll('.order-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    try {
      const res = await api.getOrder(orderId);
      state.selectedOrder = res.order;
      const detailPaneEl = document.querySelector('.detail-pane');
      if (detailPaneEl) {
        detailPaneEl.outerHTML = renderDetailPane();
        bindDetailPaneEvents();
      }
    } catch (err) {
      console.error('Buyurtma tafsilotini yuklashda xatolik:', err);
    }
  });
}

// Detail Pane Actions Binding (Module scope)
function bindDetailPaneEvents() {
  // Show Selected Order on Map
  const viewOnMapBtn = document.getElementById('btn-view-on-map');
  if (viewOnMapBtn) {
    viewOnMapBtn.addEventListener('click', () => {
      state.activeTab = 'map';
      render();
    });
  }

  // Edit Client Data Action (Mijoz ma'lumotlarini tahrirlash)
  const editClientBtn = document.getElementById('btn-edit-order-client');
  if (editClientBtn) {
    editClientBtn.addEventListener('click', () => {
      state.editingOrder = state.selectedOrder;
      state.isEditOrderModalOpen = true;
      render();
    });
  }

  // Assign Driver Action
  document.querySelectorAll('.btn-assign-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const driverId = e.currentTarget.dataset.driverId;
      const orderId = e.currentTarget.dataset.orderId;

      try {
        btn.disabled = true;
        btn.innerText = 'Biriktirilmoqda...';
        await api.assignDriver(orderId, driverId);
        showToast('Buyurtma haydovchiga biriktirildi! Taklif yuborildi.');

        const updated = await api.getOrder(orderId);
        state.selectedOrder = updated.order;

        const idx = state.orders.findIndex(o => o.id == orderId);
        if (idx !== -1) {
          state.orders[idx] = updated.order;
        }

        const availableRes = await api.getAvailableDrivers();
        state.availableDrivers = availableRes.available_drivers || [];

        const countsRes = await api.getOrders({ per_page: 1 });
        if (countsRes.counts) state.counts = countsRes.counts;

        const detailPaneEl = document.querySelector('.detail-pane');
        if (detailPaneEl) {
          detailPaneEl.outerHTML = renderDetailPane();
          bindDetailPaneEvents();
        }

        const targetCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
        if (targetCard) {
          const temp = document.createElement('div');
          temp.innerHTML = renderOrderCardHtml(updated.order).trim();
          const newCard = temp.firstElementChild;
          targetCard.replaceWith(newCard);
          bindSingleOrderCard(newCard);
        }
      } catch (err) {
        alert(err.message || 'Haydovchini biriktirishda xatolik');
        btn.disabled = false;
        btn.innerText = 'Haydovchini Biriktirish';
      }
    });
  });

  // Cancel Assignment Action
  const cancelAssignBtn = document.getElementById('btn-cancel-assignment');
  if (cancelAssignBtn) {
    cancelAssignBtn.addEventListener('click', async (e) => {
      const orderId = e.currentTarget.dataset.orderId;
      try {
        await api.cancelAssignment(orderId, 'Dispetcher tomonidan bekor qilindi');
        showToast('Biriktirish bekor qilindi. Buyurtma navbatga qaytarildi.');

        const updated = await api.getOrder(orderId);
        state.selectedOrder = updated.order;

        const idx = state.orders.findIndex(o => o.id == orderId);
        if (idx !== -1) {
          state.orders[idx] = updated.order;
        }

        const availableRes = await api.getAvailableDrivers();
        state.availableDrivers = availableRes.available_drivers || [];

        const countsRes = await api.getOrders({ per_page: 1 });
        if (countsRes.counts) state.counts = countsRes.counts;

        const detailPaneEl = document.querySelector('.detail-pane');
        if (detailPaneEl) {
          detailPaneEl.outerHTML = renderDetailPane();
          bindDetailPaneEvents();
        }

        const targetCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
        if (targetCard) {
          const temp = document.createElement('div');
          temp.innerHTML = renderOrderCardHtml(updated.order).trim();
          const newCard = temp.firstElementChild;
          targetCard.replaceWith(newCard);
          bindSingleOrderCard(newCard);
        }
      } catch (err) {
        alert(err.message || 'Biriktirishni bekor qilishda xatolik');
      }
    });
  }

  // Cancel Order Action
  document.querySelectorAll('.btn-cancel-order').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const orderId = e.currentTarget.dataset.orderId;
      if (!confirm(`Haqiqatan ham #${orderId} sonli buyurtmani bekor qilmoqchimisiz?`)) return;
      try {
        await api.cancelOrder(orderId, 'Dispetcher tomonidan bekor qilindi');
        showToast('Buyurtma bekor qilindi.');

        const updated = await api.getOrder(orderId);
        state.selectedOrder = updated.order;

        const idx = state.orders.findIndex(o => o.id == orderId);
        if (idx !== -1) {
          state.orders[idx] = updated.order;
        }

        const countsRes = await api.getOrders({ per_page: 1 });
        if (countsRes.counts) state.counts = countsRes.counts;

        const detailPaneEl = document.querySelector('.detail-pane');
        if (detailPaneEl) {
          detailPaneEl.outerHTML = renderDetailPane();
          bindDetailPaneEvents();
        }

        const targetCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
        if (targetCard) {
          const temp = document.createElement('div');
          temp.innerHTML = renderOrderCardHtml(updated.order).trim();
          const newCard = temp.firstElementChild;
          targetCard.replaceWith(newCard);
          bindSingleOrderCard(newCard);
        }
      } catch (err) {
        alert(err.message || 'Buyurtmani bekor qilishda xatolik');
      }
    });
  });
}

async function loadDashboardData(resetOrders = false) {
  try {
    const params = {
      page: resetOrders ? 1 : state.ordersPage,
      per_page: state.ordersPerPage,
    };
    if (state.filterStatus && state.filterStatus !== 'all') {
      params.status = state.filterStatus;
    }
    if (state.searchQuery && state.searchQuery.trim()) {
      params.search = state.searchQuery.trim();
    }

    const ordersRes = await api.getOrders(params);
    const prevOrderCount = state.orders.length;

    if (resetOrders || state.ordersPage === 1) {
      state.orders = (ordersRes.orders && ordersRes.orders.data) ? ordersRes.orders.data : (ordersRes.orders || []);
    } else {
      const freshData = (ordersRes.orders && ordersRes.orders.data) ? ordersRes.orders.data : [];
      const freshMap = new Map(freshData.map(o => [o.id, o]));
      state.orders = state.orders.map(o => freshMap.get(o.id) || o);
    }

    if (ordersRes.orders && ordersRes.orders.current_page !== undefined) {
      state.ordersPage = ordersRes.orders.current_page;
      state.ordersLastPage = ordersRes.orders.last_page;
      state.ordersTotal = ordersRes.orders.total;
      state.ordersHasMore = state.ordersPage < state.ordersLastPage;
    }

    state.counts = ordersRes.counts || state.counts;

    if (prevOrderCount > 0 && state.orders.length > prevOrderCount) {
      playAlertSound('new_order');
      showToast('Yangi kiruvchi buyurtma navbatga qo\'shildi!');
    }

    const driversRes = await api.getDrivers();
    state.drivers = driversRes.drivers || [];

    const availableRes = await api.getAvailableDrivers();
    state.availableDrivers = availableRes.available_drivers || [];

    if (state.selectedOrder) {
      const refreshed = state.orders.find(o => o.id === state.selectedOrder.id);
      if (refreshed) {
        state.selectedOrder = { ...state.selectedOrder, ...refreshed };
      }
    }

    // Load Wallet Top-up requests & counts if user has permission
    if (hasPermission('wallet.view') || hasPermission('wallet.topup') || hasPermission('wallet.approve') || state.user?.role === 'admin') {
      try {
        const topupFilter = (state.topupFilterStatus && state.topupFilterStatus !== 'all') ? state.topupFilterStatus : null;
        const topupRes = await api.getTopupRequests(topupFilter);
        state.topupRequests = topupRes.data || topupRes.requests || [];
        state.topupCounts = topupRes.counts || state.topupCounts;
      } catch (err) {
        console.warn('Failed to load wallet requests:', err);
      }
    }

    // Load Permissions Matrix if permissions tab is open or user is admin
    if (state.activeTab === 'permissions' || state.user?.role === 'admin') {
      try {
        const permsRes = await api.getPermissions();
        state.systemPermissionsData = permsRes;
      } catch (err) {
        console.warn('Failed to load permissions matrix:', err);
      }
    }

    // Refresh markers on map if map is open
    if (state.activeTab === 'map') {
      updateDriverMarkers(state.drivers);
    }
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
  }
}

async function loadMoreOrders() {
  if (state.ordersLoadingMore || !state.ordersHasMore) return;
  state.ordersLoadingMore = true;

  const ordersListEl = document.querySelector('.orders-list');
  let loaderEl = document.getElementById('infinite-scroll-loader');
  if (!loaderEl && ordersListEl) {
    loaderEl = document.createElement('div');
    loaderEl.id = 'infinite-scroll-loader';
    loaderEl.className = 'infinite-scroll-loader';
    loaderEl.innerHTML = `
      <div class="infinite-spinner"></div>
      <span>Ko'proq buyurtmalar yuklanmoqda...</span>
    `;
    const sentinel = document.getElementById('orders-scroll-sentinel');
    if (sentinel) {
      ordersListEl.insertBefore(loaderEl, sentinel);
    } else {
      ordersListEl.appendChild(loaderEl);
    }
  }

  try {
    const nextPage = state.ordersPage + 1;
    const params = {
      page: nextPage,
      per_page: state.ordersPerPage,
    };
    if (state.filterStatus && state.filterStatus !== 'all') {
      params.status = state.filterStatus;
    }
    if (state.searchQuery && state.searchQuery.trim()) {
      params.search = state.searchQuery.trim();
    }

    const ordersRes = await api.getOrders(params);
    const newOrders = (ordersRes.orders && ordersRes.orders.data) ? ordersRes.orders.data : [];

    state.ordersPage = (ordersRes.orders && ordersRes.orders.current_page) || nextPage;
    state.ordersLastPage = (ordersRes.orders && ordersRes.orders.last_page) || state.ordersLastPage;
    state.ordersTotal = (ordersRes.orders && ordersRes.orders.total) || state.ordersTotal;
    state.ordersHasMore = state.ordersPage < state.ordersLastPage;
    if (ordersRes.counts) state.counts = ordersRes.counts;

    // Remove loader
    const currentLoader = document.getElementById('infinite-scroll-loader');
    if (currentLoader) currentLoader.remove();

    if (newOrders.length > 0) {
      const existingIds = new Set(state.orders.map(o => o.id));
      const newlyFetched = newOrders.filter(o => !existingIds.has(o.id));
      state.orders = [...state.orders, ...newlyFetched];

      if (ordersListEl) {
        const sentinel = document.getElementById('orders-scroll-sentinel');
        newlyFetched.forEach(order => {
          const cardHtml = renderOrderCardHtml(order);
          const temp = document.createElement('div');
          temp.innerHTML = cardHtml.trim();
          const cardEl = temp.firstElementChild;
          if (sentinel) {
            ordersListEl.insertBefore(cardEl, sentinel);
          } else {
            ordersListEl.appendChild(cardEl);
          }
          bindSingleOrderCard(cardEl);
        });
      }
    }

    // If reached end, append end badge
    if (!state.ordersHasMore && ordersListEl && !ordersListEl.querySelector('.infinite-scroll-end')) {
      const endEl = document.createElement('div');
      endEl.className = 'infinite-scroll-end';
      endEl.innerHTML = `<span>✨ Barcha buyurtmalar yuklandi (${state.ordersTotal || state.orders.length})</span>`;
      const sentinel = document.getElementById('orders-scroll-sentinel');
      if (sentinel) {
        ordersListEl.insertBefore(endEl, sentinel);
      } else {
        ordersListEl.appendChild(endEl);
      }
    }
  } catch (err) {
    console.error('Failed to load more orders:', err);
    const currentLoader = document.getElementById('infinite-scroll-loader');
    if (currentLoader) currentLoader.remove();
  } finally {
    state.ordersLoadingMore = false;
  }
}

function startRealtimeSync() {
  clearInterval(state.syncInterval);
  state.syncInterval = setInterval(async () => {
    if (!state.user) return;
    try {
      const syncRes = await api.syncDispatcher(state.lastSyncTimestamp);
      state.lastSyncTimestamp = syncRes.timestamp;
      state.counts = syncRes.counts || state.counts;

      if (syncRes.counts?.pending_topups !== undefined) {
        state.topupCounts = {
          ...state.topupCounts,
          pending: syncRes.counts.pending_topups,
        };
      }

      // Real-time GPS movement and driver status updates
      if (syncRes.drivers && syncRes.drivers.length > 0) {
        state.drivers = syncRes.drivers;
        state.availableDrivers = syncRes.drivers.filter(d => d.status === 'available');
        if (state.activeTab === 'map') {
          updateDriverMarkers(state.drivers);
        }
      }

      if (syncRes.updated_orders && syncRes.updated_orders.length > 0) {
        if (state.activeTab === 'orders') {
          let hasNewOrder = false;
          syncRes.updated_orders.forEach(updatedOrder => {
            const idx = state.orders.findIndex(o => o.id === updatedOrder.id);
            if (idx !== -1) {
              state.orders[idx] = updatedOrder;
              const targetCard = document.querySelector(`.order-card[data-order-id="${updatedOrder.id}"]`);
              if (targetCard) {
                const temp = document.createElement('div');
                temp.innerHTML = renderOrderCardHtml(updatedOrder).trim();
                const newCard = temp.firstElementChild;
                targetCard.replaceWith(newCard);
                bindSingleOrderCard(newCard);
              }
            } else {
              hasNewOrder = true;
            }
          });

          if (state.selectedOrder) {
            const refreshed = syncRes.updated_orders.find(o => o.id === state.selectedOrder.id);
            if (refreshed) {
              state.selectedOrder = { ...state.selectedOrder, ...refreshed };
              const detailPaneEl = document.querySelector('.detail-pane');
              if (detailPaneEl) {
                detailPaneEl.outerHTML = renderDetailPane();
                bindDetailPaneEvents();
              }
            }
          }

          if (hasNewOrder) {
            playAlertSound('new_order');
            showToast('Yangi chaqiruv kelib tushdi!');
            if (state.ordersPage === 1 && !state.searchQuery) {
              await loadDashboardData(true);
              render();
            }
          }
        } else if (state.activeTab === 'map') {
          // Keep Leaflet map alive without destructive full re-render
          const onlineEl = document.getElementById('hud-online-count');
          if (onlineEl) onlineEl.textContent = state.drivers.filter(d => d.status !== 'offline').length;
          const activeEl = document.getElementById('hud-active-count');
          if (activeEl) activeEl.textContent = state.counts?.in_progress ?? 0;
          const pendingEl = document.getElementById('hud-pending-count');
          if (pendingEl) pendingEl.textContent = state.counts?.pending ?? 0;
        } else {
          await loadDashboardData();
          render();
        }
      }
    } catch (e) {
      // Ignore background sync errors
    }
  }, 3000);
}

async function initDashboard() {
  try {
    const meRes = await api.getMe();
    if (meRes && meRes.user) {
      state.user = meRes.user;
    }
  } catch (err) {
    console.warn('Session verification failed, resetting auth:', err);
    api.setAuth(null, null);
    state.user = null;
    render();
    return;
  }

  await loadDashboardData();
  if (state.orders.length > 0 && !state.selectedOrder) {
    state.selectedOrder = state.orders[0];
  }
  startRealtimeSync();
  render();
}

// Global listener for session expiry
window.addEventListener('auth:expired', () => {
  state.user = null;
  state.errorMsg = 'Sessiya muddati tugadi. Iltimos, tizimga qayta kiring.';
  clearInterval(state.syncInterval);
  render();
});

// Driver status change handler (from Map HUD, Map Pin Popup, or Fleet View)
async function handleDriverStatusChange(driverId, newStatus) {
  const numId = Number(driverId);
  const driver = state.drivers.find(d => d.id === numId);
  if (!driver) return;
  if (driver.status === newStatus) return;

  const oldStatus = driver.status;
  const statusLabels = {
    available: "Bo'sh (Tayyor)",
    busy: "Band (Safarda)",
    offline: "Oflayn"
  };

  try {
    // 1. Optimistic state update
    driver.status = newStatus;
    state.availableDrivers = state.drivers.filter(d => d.status === 'available');

    // 2. Update map markers (updates icon color, class, and popup content)
    updateDriverMarkers(state.drivers, (d) => focusDriver(d.id));

    // 3. Update HUD pills on top of map
    const onlineEl = document.getElementById('hud-online-count');
    if (onlineEl) onlineEl.textContent = state.availableDrivers.length;

    // 4. Update dropdown badges in DOM immediately
    document.querySelectorAll(`.driver-status-dropdown-wrap[data-driver-id="${numId}"]`).forEach(wrap => {
      const btn = wrap.querySelector('.driver-status-badge-btn');
      if (btn) {
        btn.className = `driver-status-badge-btn status-badge status-${newStatus}`;
        const dot = btn.querySelector('.status-indicator-dot');
        if (dot) dot.className = `status-indicator-dot dot-${newStatus}`;
        const text = btn.querySelector('.status-badge-text');
        if (text) text.textContent = (DRIVER_STATUS_LABELS[newStatus] || newStatus).toUpperCase();
      }
      wrap.querySelectorAll('.status-menu-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.status === newStatus);
      });
    });

    // 5. Update sidebar fleet badge count
    const fleetBadge = document.querySelector('.nav-item[data-tab="fleet"] .nav-badge');
    if (fleetBadge) fleetBadge.textContent = `${state.availableDrivers.length} Bo'sh`;

    showToast(`Taksi "${driver.name}" holati "${statusLabels[newStatus] || newStatus}" ga o'zgartirildi!`);

    // 6. Send update request to server
    await api.updateDriver(numId, { status: newStatus });
  } catch (err) {
    // Revert state on failure
    driver.status = oldStatus;
    state.availableDrivers = state.drivers.filter(d => d.status === 'available');
    updateDriverMarkers(state.drivers, (d) => focusDriver(d.id));
    alert(err.message || "Haydovchi holatini o'zgartirishda xatolik yuz berdi");
    render();
  }
}

// Global delegated click handler for Driver Status dropdowns and Map Popup buttons
document.addEventListener('click', (e) => {
  // 1. Popup status button click (Leaflet popup)
  const popupBtn = e.target.closest('.btn-popup-change-status');
  if (popupBtn) {
    e.stopPropagation();
    const driverId = popupBtn.dataset.driverId;
    const newStatus = popupBtn.dataset.status;
    handleDriverStatusChange(driverId, newStatus);
    return;
  }

  // 2. Status badge button toggle (Card dropdown)
  const badgeBtn = e.target.closest('.driver-status-badge-btn');
  if (badgeBtn) {
    e.stopPropagation();
    const wrap = badgeBtn.closest('.driver-status-dropdown-wrap');
    if (wrap) {
      const wasOpen = wrap.classList.contains('open');
      document.querySelectorAll('.driver-status-dropdown-wrap.open').forEach(w => w.classList.remove('open'));
      wrap.classList.toggle('open', !wasOpen);
    }
    return;
  }

  // 3. Status menu item click
  const menuItem = e.target.closest('.status-menu-item');
  if (menuItem) {
    e.stopPropagation();
    const driverId = menuItem.dataset.driverId;
    const newStatus = menuItem.dataset.status;
    const wrap = menuItem.closest('.driver-status-dropdown-wrap');
    if (wrap) wrap.classList.remove('open');
    handleDriverStatusChange(driverId, newStatus);
    return;
  }

  // 4. Click outside dropdown to close
  if (!e.target.closest('.driver-status-dropdown-wrap')) {
    document.querySelectorAll('.driver-status-dropdown-wrap.open').forEach(w => w.classList.remove('open'));
  }
});


// Initial Boot
render();
if (state.user) {
  initDashboard();
}
