import { IsString, MaxLength, MinLength } from 'class-validator'

export class EditProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  displayName!: string

  @IsString()
  @MaxLength(120000)
  avatar!: string
}

export class PasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword!: string
}
