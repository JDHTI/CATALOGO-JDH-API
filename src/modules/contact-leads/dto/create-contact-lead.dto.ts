import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

import {
  CONTACT_LEAD_ID_TYPES,
  type ContactLeadIdType,
} from '../contact-leads.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `''` y espacios cuentan como "no envió el dato". */
const trimOrNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Deja el celular en 10 dígitos: quita espacios, guiones, puntos y
 * paréntesis, y el indicativo `+57` / `57` si viene.
 */
export function normalizeCelular(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/[\s\-.()]/g, '').replace(/^\+/, '');
  return /^57\d{10}$/.test(digits) ? digits.slice(2) : digits;
}

/** Dígitos de la identificación; tolera puntos y espacios (900.123.456-7). */
const normalizeIdentificacion = ({ value }: { value: unknown }): unknown => {
  const trimmed = trimOrNull({ value });
  return typeof trimmed === 'string' ? trimmed.replace(/[\s.]/g, '') : trimmed;
};

/** Hay identificación si llega el tipo o el número: entonces van los dos. */
const hasIdentificacion = (dto: CreateContactLeadDto): boolean =>
  dto.tipoIdentificacion != null || dto.identificacion != null;

export class CreateContactLeadDto {
  @ApiProperty({ minLength: 2, maxLength: 120, example: 'Ana Gómez' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @ApiProperty({
    maxLength: 254,
    example: 'ana@example.com',
    description: 'Se guarda en minúsculas',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(254)
  @IsEmail()
  correo!: string;

  @ApiProperty({
    example: '+57 300 123 4567',
    description:
      'Celular colombiano: 10 dígitos que empiezan por 3. Acepta `+57` o ' +
      '`57` delante; se guarda sin indicativo.',
  })
  @Transform(({ value }: { value: unknown }) => normalizeCelular(value))
  @IsString()
  @Matches(/^3\d{9}$/, {
    message:
      'celular debe ser un celular colombiano de 10 dígitos que empiece por 3',
  })
  celular!: string;

  @ApiProperty({ minLength: 2, maxLength: 80, example: 'Medellín' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  ciudad!: string;

  @ApiPropertyOptional({
    enum: CONTACT_LEAD_ID_TYPES,
    nullable: true,
    description: 'Obligatorio si llega `identificacion`',
  })
  @Transform(trimOrNull)
  @ValidateIf(hasIdentificacion)
  @IsIn(CONTACT_LEAD_ID_TYPES, {
    message:
      'tipoIdentificacion debe ser NIT o CC, y es obligatorio cuando llega identificacion',
  })
  tipoIdentificacion?: ContactLeadIdType | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '900123456-7',
    description:
      'Entre 5 y 15 dígitos. Un NIT puede traer el dígito de verificación ' +
      'tras un guion. Obligatorio si llega `tipoIdentificacion`.',
  })
  @Transform(normalizeIdentificacion)
  @ValidateIf(hasIdentificacion)
  @IsString({
    message: 'identificacion es obligatoria cuando llega tipoIdentificacion',
  })
  @Matches(/^\d{5,15}(-\d)?$/, {
    message:
      'identificacion debe tener entre 5 y 15 dígitos (un NIT puede terminar en -DV)',
  })
  @ValidateBy({
    name: 'dvSoloEnNit',
    validator: {
      validate: (value: unknown, args): boolean =>
        typeof value !== 'string' ||
        !value.includes('-') ||
        (args?.object as CreateContactLeadDto).tipoIdentificacion === 'NIT',
      defaultMessage: () =>
        'identificacion solo admite el guion del DV cuando es NIT',
    },
  })
  identificacion?: string | null;

  @ApiProperty({
    enum: [true],
    description:
      'Autorización de tratamiento de datos personales (Ley 1581). Debe ser `true`.',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'aceptaTratamientoDatos debe ser true',
  })
  aceptaTratamientoDatos!: true;

  @ApiProperty({
    maxLength: 40,
    example: 'home-newsletter',
    description: 'Formulario de origen',
  })
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, {
    message: 'origen debe ser un identificador corto (a-z, 0-9 y guion)',
  })
  origen!: string;
}

/**
 * Sin id a propósito: un upsert devolvería el id viejo y dejaría ver que el
 * correo ya estaba registrado.
 */
export class ContactLeadCreatedDto {
  @ApiProperty({ enum: [true], example: true })
  ok!: true;
}
