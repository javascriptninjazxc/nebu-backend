import { Module } from '@nestjs/common'
import { SequelizeModule } from '@nestjs/sequelize'

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      useFactory: () => {
        const uri = process.env.DATABASE_URL

        if (!uri) {
          throw new Error('DATABASE_URL is required')
        }

        return {
          dialect: 'postgres' as const,
          uri,
          autoLoadModels: true,
          synchronize: false,
          logging: false,
          retryAttempts: 1,
          dialectOptions:
            process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {},
          pool: { max: 10, min: 0 },
        }
      },
    }),
  ],
})
export class DatabaseModule {}
