'use client';

import { useEffect, useRef, useCallback } from 'react';
import { getAccessToken } from '../lib/auth';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';

type MessageHandler = (msg: { type: string; payload: unknown; timestamp: number }) => void;

export function useWebSocket(onMessage: MessageHandler, symbols?: string[]) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token) return;

    ws.current = new WebSocket(`${WS_URL}?token=${token}`);

    ws.current.onopen = () => {
      if (symbols?.length) {
        ws.current?.send(JSON.stringify({ type: 'SUBSCRIBE', symbols }));
      }
    };

    ws.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        onMessage(msg);
      } catch { /* ignore malformed */ }
    };

    ws.current.onclose = () => {
      reconnectTimeout.current = setTimeout(connect, 3_000);
    };

    ws.current.onerror = () => {
      ws.current?.close();
    };
  }, [onMessage, symbols]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      ws.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send };
}
