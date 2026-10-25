// Small reconnecting WebSocket client used by both host and controller.
export function createSocket({ onOpen, onMessage, onStatus } = {}) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let ws = null;
  let closed = false;
  let retry = 0;
  let queue = [];

  function open() {
    ws = new WebSocket(url);
    onStatus?.('connecting');
    ws.onopen = () => {
      retry = 0;
      onStatus?.('open');
      onOpen?.();
      for (const m of queue) ws.send(m);
      queue = [];
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage?.(msg);
    };
    ws.onclose = () => {
      onStatus?.('closed');
      if (closed) return;
      setTimeout(open, Math.min(4000, 300 * 2 ** retry++));
    };
    ws.onerror = () => ws.close();
  }

  open();

  return {
    send(msg, { queueIfClosed = true } = {}) {
      const s = JSON.stringify(msg);
      if (ws && ws.readyState === 1) ws.send(s);
      else if (queueIfClosed) queue.push(s);
    },
    get ready() {
      return ws && ws.readyState === 1;
    },
    get buffered() {
      return ws ? ws.bufferedAmount : 0;
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
