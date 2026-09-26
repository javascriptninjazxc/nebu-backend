import { Injectable } from '@nestjs/common'

/** Public rules only. Monetary state belongs in a transactional database. */
@Injectable()
export class JackpotsService {
  getConfiguration() {
    return {
      enabled: true,
      currency: 'DEMO',
      eligibleGame: 'caches',
      baseRtpBasisPoints: 9600,
      jackpotRtpBasisPoints: 200,
      pools: [
        {
          id: 'mini',
          name: 'Mini Jackpot',
          contributionBasisPoints: 100,
          schedule: { period: 'hour', timezone: 'Europe/Moscow', minute: 0 },
        },
        {
          id: 'mega',
          name: 'Mega Jackpot',
          contributionBasisPoints: 100,
          schedule: {
            period: 'day',
            timezone: 'Europe/Moscow',
            hour: 0,
            minute: 0,
          },
        },
      ],
    } as const
  }
}
