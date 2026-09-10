import { ApiProperty } from '@nestjs/swagger';

/**
 * Ids de los favoritos del usuario + total.
 *
 * `ids` puede venir recortada a `FAVORITE_IDS_LIMIT`; `total` es siempre el
 * conteo real, así que el contador del header no depende de `ids.length`.
 */
export class FavoriteIdsResponseDto {
  @ApiProperty({
    type: [Number],
    example: [10, 42, 7],
    description:
      'Ids de producto, del favorito más reciente al más antiguo. Solo ' +
      'productos activos.',
  })
  ids!: number[];

  @ApiProperty({
    example: 3,
    description:
      'Total real de favoritos activos, aunque `ids` se haya recortado',
  })
  total!: number;
}

/**
 * Estado del favorito tras un alta o una baja.
 *
 * Las dos operaciones son idempotentes y devuelven el estado FINAL, no lo que
 * cambió: la UI hace toggle optimista y con esto reconcilia sin tener que
 * adivinar si su petición fue la que aplicó el cambio.
 */
export class FavoriteStateResponseDto {
  @ApiProperty({ example: 10 })
  productId!: number;

  @ApiProperty({ example: true })
  favorito!: boolean;
}
