import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: true, namespace: 'notifications' })
export class NotificationsGateway {
  @WebSocketServer()
  server: Server;

  emitNotification(notification: unknown) {
    this.server?.emit('notification', notification);
  }
}
