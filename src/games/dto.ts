import { IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import { CommandDto, RoundDto } from '../dice/dto.js'

export class ForestStartDto extends CommandDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID('4')
  bonusGrantId?: string

  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID('4')
  bonusWalletId?: string

  @IsString()
  @MaxLength(8)
  @Matches(/^[1-9][0-9]*00$/)
  stakeMinor!: string
}

export class ChestStartDto extends ForestStartDto {}

export class CacheStartDto extends ForestStartDto {
  @IsInt()
  @Min(0)
  @Max(5)
  cardIndex!: number
}

export class CacheRevealDto extends RoundDto {
  @IsInt()
  @Min(0)
  @Max(5)
  cardIndex!: number
}

export class ForestSpinDto extends RoundDto {
  @IsInt()
  @Min(0)
  @Max(2)
  target!: number
}

export class DrawDto extends CommandDto {
  @IsUUID('4')
  drawId!: string

  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number
}

export class DrawRevealDto extends DrawDto {
  @IsInt()
  @Min(0)
  @Max(2)
  cardIndex!: number
}

export class JackpotSyncDto extends CommandDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID('4')
  drawId?: string
}
