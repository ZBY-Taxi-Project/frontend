const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api';
const PROXY_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('zby_token') || null;
    this.user = JSON.parse(localStorage.getItem('zby_user') || 'null');
  }

  setAuth(token, user) {
    this.token = token;
    this.user = user;
    if (token) {
      localStorage.setItem('zby_token', token);
      localStorage.setItem('zby_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('zby_token');
      localStorage.removeItem('zby_user');
    }
  }

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...(options.headers || {}),
    };

    let response;
    // 1. Try local proxy first (/api/...)
    try {
      response = await fetch(`${PROXY_BASE}${endpoint}`, {
        ...options,
        headers,
      });
      // If proxy returns 404 for an API endpoint, fallback to direct backend
      if (response.status === 404 && endpoint.startsWith('/auth')) {
        throw new Error('Proxy 404');
      }
    } catch (proxyErr) {
      // 2. Direct backend fallback (http://127.0.0.1:8000/api/...)
      try {
        response = await fetch(`${API_BASE}${endpoint}`, {
          ...options,
          headers,
        });
      } catch (directErr) {
        console.error(`API Connection Failure [${endpoint}]:`, proxyErr, directErr);
        throw new Error('Unable to connect to backend server. Make sure php artisan serve is running on port 8000.');
      }
    }

    if (response.status === 401) {
      this.setAuth(null, null);
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      data = { message: `Server returned ${response.status} ${response.statusText}` };
    }

    if (!response.ok) {
      const errorMsg = data.errors 
        ? Object.values(data.errors).flat().join('; ')
        : (data.message || data.error || `HTTP error ${response.status}`);
      throw new Error(errorMsg);
    }

    return data;
  }

  // Auth
  async login(loginIdentifier, password) {
    const res = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: loginIdentifier, password }),
    });
    this.setAuth(res.token, res.user);
    return res;
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.setAuth(null, null);
    }
  }

  async getMe() {
    return this.request('/auth/me');
  }

  // Dispatcher Orders
  async getOrders(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/dispatcher/orders?${query}`);
  }

  async getOrder(id) {
    return this.request(`/dispatcher/orders/${id}`);
  }

  async createOrder(orderData) {
    return this.request('/dispatcher/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  }

  async updateOrder(id, orderData) {
    return this.request(`/dispatcher/orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(orderData),
    });
  }

  async assignDriver(orderId, driverId) {
    return this.request(`/dispatcher/orders/${orderId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ driver_id: driverId }),
    });
  }

  async reassignDriver(orderId, driverId, reason) {
    return this.request(`/dispatcher/orders/${orderId}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ driver_id: driverId, reason }),
    });
  }

  async cancelAssignment(orderId, reason) {
    return this.request(`/dispatcher/orders/${orderId}/cancel-assignment`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async cancelOrder(orderId, reason = 'Cancelled by dispatcher') {
    return this.request(`/dispatcher/orders/${orderId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Drivers
  async getDrivers(status = null) {
    const endpoint = status ? `/dispatcher/drivers?status=${status}` : '/dispatcher/drivers';
    return this.request(endpoint);
  }

  async getAvailableDrivers() {
    return this.request('/dispatcher/drivers/available');
  }

  async createDriver(driverData) {
    return this.request('/dispatcher/drivers', {
      method: 'POST',
      body: JSON.stringify(driverData),
    });
  }

  async updateDriver(driverId, driverData) {
    return this.request(`/dispatcher/drivers/${driverId}`, {
      method: 'PUT',
      body: JSON.stringify(driverData),
    });
  }

  async deleteDriver(driverId) {
    return this.request(`/dispatcher/drivers/${driverId}`, {
      method: 'DELETE',
    });
  }

  // Realtime Polling Sync
  async syncDispatcher(sinceTimestamp = null) {
    const query = sinceTimestamp ? `?since=${encodeURIComponent(sinceTimestamp)}` : '';
    return this.request(`/dispatcher/sync${query}`);
  }

  // Wallet Top-up Requests & Verification (Permission Protected)
  async getTopupRequests(status = null) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/dispatcher/wallet/topup-requests${query}`);
  }

  async approveTopupRequest(id) {
    return this.request(`/dispatcher/wallet/topup-requests/${id}/approve`, {
      method: 'POST',
    });
  }

  async rejectTopupRequest(id, reason = null) {
    return this.request(`/dispatcher/wallet/topup-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async directDelivery(deliveryData) {
    return this.request('/dispatcher/wallet/direct-delivery', {
      method: 'POST',
      body: JSON.stringify(deliveryData),
    });
  }

  async topupDriver(driverId, amount, notes = '') {
    return this.request(`/dispatcher/drivers/${driverId}/wallet/topup`, {
      method: 'POST',
      body: JSON.stringify({ amount, notes }),
    });
  }

  // Permissions Management
  async getPermissions() {
    return this.request('/dispatcher/permissions');
  }

  async updateUserPermissions(userId, permissions) {
    return this.request(`/dispatcher/users/${userId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ permissions }),
    });
  }

  async updateUserRole(userId, role) {
    return this.request(`/dispatcher/users/${userId}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  }

  // Telegram Bot Integration
  async getTelegramBotInfo() {
    return this.request('/telegram/bot-info');
  }

  async simulateTelegramCheck(data = {}) {
    return this.request('/telegram/simulate-incoming-check', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

export const api = new ApiClient();

// Audio Alert Synthesizer via Web Audio API (Zero audio assets required)
export function playAlertSound(type = 'new_order') {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'new_order') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.35);
    } else if (type === 'rejected') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      osc.frequency.setValueAtTime(220, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.4);
    }
  } catch (e) {
    console.warn('Audio play restricted by browser policy:', e);
  }
}
