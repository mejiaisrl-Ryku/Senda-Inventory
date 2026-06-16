import React, { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api";

interface ToastStatus {
  connected: boolean;
  locationId?: string;
  expiresAt?: string;
}

interface Props {
  onStatusChange?: (connected: boolean) => void;
}

export function ToastConnectButton({ onStatusChange }: Props) {
  const [status, setStatus]   = useState<ToastStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const pollRef               = useRef<ReturnType<typeof setInterval> | null>(null);
  const popupRef              = useRef<Window | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get<ToastStatus>("/api/toast/status");
      setStatus(data);
      setError(null);
      onStatusChange?.(data.connected);
      return data.connected;
    } catch {
      setError("Could not check Toast status. Try again.");
      return false;
    }
  }, [onStatusChange]);

  // Initial status check on mount.
  useEffect(() => {
    setLoading(true);
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  // Poll every 3 s while a popup is open, stop when connected or popup closes.
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const popupClosed = !popupRef.current || popupRef.current.closed;
      const connected   = await fetchStatus();
      if (connected || popupClosed) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setLoading(false);
      }
    }, 3000);
  }, [fetchStatus]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<{ authUrl: string }>("/api/toast/connect");
      // Prefer popup; fall back to same-tab redirect if popup is blocked.
      const popup = window.open(data.authUrl, "toast_oauth", "width=600,height=700");
      if (popup) {
        popupRef.current = popup;
        startPolling();
      } else {
        window.location.href = data.authUrl;
      }
    } catch {
      setError("Failed to start Toast connection. Try again.");
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await api.post("/api/toast/disconnect");
      const next = { connected: false };
      setStatus(next);
      onStatusChange?.(false);
    } catch {
      setError("Failed to disconnect Toast. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 text-[#555] text-sm">
        <span className="w-4 h-4 rounded-full border-2 border-[#333] border-t-[#3dbf8a] animate-spin" />
        Checking Toast status…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {status?.connected ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[#3dbf8a] text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-[#3dbf8a]" />
            Connected to Toast
            {status.locationId && (
              <span className="text-[#555] font-normal">· {status.locationId}</span>
            )}
          </div>
          <button
            onClick={handleDisconnect}
            disabled={loading}
            className="text-xs text-[#555] hover:text-white underline disabled:opacity-40 transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm font-medium hover:border-[#3dbf8a] hover:text-[#3dbf8a] disabled:opacity-40 transition-all"
        >
          {loading ? (
            <span className="w-4 h-4 rounded-full border-2 border-[#333] border-t-[#3dbf8a] animate-spin" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          )}
          Connect Toast POS
        </button>
      )}

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <span>⚠</span> {error}
          <button onClick={() => { setError(null); fetchStatus(); }} className="underline ml-1">
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
