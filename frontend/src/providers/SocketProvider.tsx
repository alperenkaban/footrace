'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/useAuthStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://footrace-6lnc.onrender.com';

interface SocketContextType {
  socket: Socket | null;
  socketState: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'AUTH_ERROR';
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  socketState: 'DISCONNECTED',
});

export const useSocket = () => useContext(SocketContext);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, isAuthenticated } = useAuthStore();
  const [socketState, setSocketState] = useState<SocketContextType['socketState']>('DISCONNECTED');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      if (socketRef.current) {
        console.log('[SOCKET] Disconnecting - not authenticated');
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketState('DISCONNECTED');
      }
      return;
    }

    // Already connected with the same token? Skip.
    if (socketRef.current?.connected) {
      console.log('[SOCKET] Already connected, skipping reconnect');
      return;
    }

    // Disconnect old socket if exists
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    console.log('[SOCKET] Connecting to', API_URL);
    const newSocket = io(API_URL, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('[SOCKET] Connected! ID:', newSocket.id);
      setSocketState('CONNECTED');
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[SOCKET] Disconnected. Reason:', reason);
      setSocketState('DISCONNECTED');
    });

    newSocket.on('connect_error', (err) => {
      console.error('[SOCKET] Connection error:', err.message);
      if (err.message.includes('Authentication') || err.message.includes('jwt')) {
        setSocketState('AUTH_ERROR');
        useAuthStore.getState().logout();
      } else {
        setSocketState('DISCONNECTED');
      }
    });

    socketRef.current = newSocket;
    setSocketState('CONNECTING');

    return () => {
      // Only disconnect when provider unmounts (app closes), NOT on re-renders
      console.log('[SOCKET] Provider cleanup');
    };
  }, [isAuthenticated, accessToken]);

  // Disconnect on full unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        console.log('[SOCKET] Full unmount, disconnecting');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, socketState }}>
      {children}
    </SocketContext.Provider>
  );
}
