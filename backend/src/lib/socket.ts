import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyToken } from "./jwt";

let io: Server;

interface AuthenticatedSocket extends Socket {
  restaurantId: string;
}

export function initSocket(httpServer: HttpServer, allowedOrigins: string[]): Server {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    transports: ["websocket", "polling"],
  });

  // Verify JWT on every connection — sockets that can't authenticate are rejected.
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const payload = verifyToken(token);
      (socket as AuthenticatedSocket).restaurantId = payload.restaurantId ?? "";
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const { restaurantId } = socket as AuthenticatedSocket;
    socket.join(`restaurant:${restaurantId}`);

    socket.on("disconnect", () => {});
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.io not initialized — call initSocket() first");
  return io;
}
