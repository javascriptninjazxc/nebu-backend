import { IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'

export class CommandDto {
  @IsUUID('4') requestId!: string
}

export class StartDto extends CommandDto {
  @ValidateIf((_o, v) => v !== undefined) @IsUUID('4') bonusGrantId?: string
  @ValidateIf((_o, v) => v !== undefined) @IsUUID('4') bonusWalletId?: string
  @IsString() @MaxLength(8) @Matches(/^[1-9][0-9]*00$/) stakeMinor!: string
  @IsInt() @Min(1) @Max(10) mines!: number
}

export class RoundDto extends CommandDto {
  @IsUUID('4') roundId!: string
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number
}

export class RevealDto extends RoundDto {
  @IsInt() @Min(0) @Max(24) cellIndex!: number
}

export class SyncDto extends CommandDto {
  @ValidateIf((_o, value) => value !== undefined) @IsUUID('4') roundId?: string
}

export class StatusDto extends CommandDto {
  @IsUUID('4') operationId!: string
}
