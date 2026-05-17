import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";

export interface StockUpdateEvent {
  productId: string;
  newQuantity: number;
  change: number;
  reason: string;
  timestamp: string;
}

/**
 * Subscribes to `stock:updated` events and delivers them to `onUpdate`.
 * Multiple rapid events are batched: the callback receives the latest event
 * per productId at most once every `debounceMs` milliseconds.
 */
export function useStockSocket(
  onUpdate: (events: Map<string, StockUpdateEvent>) => void,
  debounceMs = 2000
) {
  const { socket } = useSocket();
  // Accumulate the latest event per productId between flushes.
  const buffer = useRef<Map<string, StockUpdateEvent>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always call the latest version of the callback without re-subscribing.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!socket) return;

    function handleUpdate(event: StockUpdateEvent) {
      buffer.current.set(event.productId, event);

      if (timer.current) return; // already scheduled — just accumulate

      timer.current = setTimeout(() => {
        const batch = new Map(buffer.current);
        buffer.current.clear();
        timer.current = null;
        if (batch.size > 0) onUpdateRef.current(batch);
      }, debounceMs);
    }

    socket.on("stock:updated", handleUpdate);

    return () => {
      socket.off("stock:updated", handleUpdate);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [socket, debounceMs]);
}
