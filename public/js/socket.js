// ============================================================
// socket.js — WebSocket Client Wrapper
// ============================================================

const SocketClient = (() => {
  let ws = null;
  let handlers = {};
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;
  const RECONNECT_DELAY = 2000;

  function connect(role) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.error('[WS] Connection failed:', e);
      scheduleReconnect(role);
      return;
    }

    ws.onopen = () => {
      console.log('[WS] Connected');
      reconnectAttempts = 0;
      // Register role
      ws.send(JSON.stringify({ type: `REGISTER_${role.toUpperCase()}` }));
      if (handlers.open) handlers.open();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (handlers[data.type]) {
          handlers[data.type](data);
        }
        if (handlers.message) {
          handlers.message(data);
        }
      } catch (e) {
        console.warn('[WS] Parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      if (handlers.close) handlers.close();
      scheduleReconnect(role);
    };

    ws.onerror = (err) => {
      console.warn('[WS] Error:', err);
      if (handlers.error) handlers.error(err);
    };
  }

  function scheduleReconnect(role) {
    if (reconnectAttempts >= MAX_RECONNECT) {
      console.warn('[WS] Max reconnect attempts reached');
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectAttempts++;
      console.log(`[WS] Reconnecting... attempt ${reconnectAttempts}`);
      connect(role);
    }, RECONNECT_DELAY);
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    console.warn('[WS] Not connected, cannot send');
    return false;
  }

  function on(eventType, handler) {
    handlers[eventType] = handler;
  }

  function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    if (ws) ws.close();
  }

  return { connect, send, on, isConnected, disconnect };
})();
