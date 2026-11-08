import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Comprehensive readiness probe.
   * Checks backend process, PostgreSQL and Redis.
   * Returns HTTP 200 when all up, HTTP 503 when degraded or down.
   */
  @SkipThrottle()
  @Get()
  async checkHealth(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.checkAll();
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    } else {
      res.status(HttpStatus.OK);
    }
    return result;
  }

  /**
   * Readiness alias for Kubernetes / container orchestration.
   */
  @SkipThrottle()
  @Get('ready')
  async checkReadiness(@Res({ passthrough: true }) res: Response) {
    return this.checkHealth(res);
  }

  /**
   * Lightweight liveness probe.
   * Verifies the HTTP process is running and responding to requests.
   */
  @SkipThrottle()
  @Get('live')
  checkLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
