import { IsIn, IsUUID } from 'class-validator'

export class SpinDto {
  @IsIn(['welcome', 'weekly'])
  mode!: 'welcome' | 'weekly'
}

export class ClaimDto {
  @IsUUID('4')
  id!: string
}
