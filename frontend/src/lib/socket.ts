import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/useAuthStore';

const URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let socket: Socket | null = null;

export const connectSocket = (token: string) => {
  if (socket) {
    socket.disconnect();
  }
  
  socket = io(URL, {
    auth: { token }, // JWT auth object
    transports: ['websocket'],
    reconnection: true,
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connect_error:', err.message);
    if (err.message.includes('Authentication') || err.message.includes('jwt')) {
      useAuthStore.getState().logout();
    }
  });

  return socket;
};

export const getSocket = () => {
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
