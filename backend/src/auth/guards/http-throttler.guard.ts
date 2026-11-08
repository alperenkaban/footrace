import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket veya RPC çağrılarını yanlışlıkla kısıtlamamak için bypass et
    if (context.getType() !== 'http') {
      return true;
    }
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Proxy arkasındaki IP'yi doğru tespit et, sahte spoofed başlıklara karşı req.ips/req.ip kullan
    if (Array.isArray(req.ips) && req.ips.length > 0) {
      return req.ips[0];
    }
    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '127.0.0.1';
  }
}

