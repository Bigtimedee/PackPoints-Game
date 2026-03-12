import { useEffect, useRef, useState, useCallback } from "react";
import { logger } from "@/lib/logger";

type MessageHandler = (message: any) => void;

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

interface UseWebSocketOptions {
  onMessage?: MessageHandler;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  autoReconnect?: boolean;
}

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, MessageHandler>>(new Map());
  const optionsRef = useRef(options);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  optionsRef.current = options;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) return;

    setStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setStatus("connected");
      setReconnectAttempts(0);
      clearReconnectTimer();
      optionsRef.current.onOpen?.();
      logger.debug("[WS] Connected");
    };

    ws.onclose = () => {
      setIsConnected(false);
      optionsRef.current.onClose?.();

      if (shouldReconnectRef.current && (optionsRef.current.autoReconnect !== false)) {
        setReconnectAttempts(prev => {
          const attempts = prev + 1;
          if (attempts >= MAX_RECONNECT_ATTEMPTS) {
            logger.debug("[WS] Max reconnect attempts reached, giving up");
            setStatus("disconnected");
            return prev;
          }
          const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, prev), MAX_RECONNECT_DELAY);
          logger.debug(`[WS] Reconnecting in ${delay}ms (attempt ${attempts})`);
          setStatus("reconnecting");
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, delay);
          return attempts;
        });
      } else {
        setStatus("disconnected");
      }
    };

    ws.onerror = (error) => {
      optionsRef.current.onError?.(error);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        optionsRef.current.onMessage?.(message);

        const handler = handlersRef.current.get(message.type);
        if (handler) {
          handler(message.payload !== undefined ? message.payload : message);
        }
      } catch (error) {
        logger.error("WebSocket message parse error:", error);
      }
    };
  }, [clearReconnectTimer]);

  const connectWithReconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    setReconnectAttempts(0);
    connect();
  }, [connect]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearReconnectTimer();
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
    setStatus("disconnected");
    setReconnectAttempts(0);
  }, [clearReconnectTimer]);

  const send = useCallback((type: string, payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const on = useCallback((type: string, handler: MessageHandler) => {
    handlersRef.current.set(type, handler);
    return () => {
      handlersRef.current.delete(type);
    };
  }, []);

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      disconnect();
    };
  }, [disconnect, clearReconnectTimer]);

  return { isConnected, status, reconnectAttempts, connect: connectWithReconnect, connectOnce: connect, disconnect, send, on };
}
