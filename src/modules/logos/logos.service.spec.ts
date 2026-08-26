import { LogosService } from './logos.service';

describe('LogosService.slug', () => {
  it('normaliza acentos, símbolos y forma jurídica en la key del objeto', () => {
    expect(LogosService.slug('CORONA')).toBe('corona');
    expect(LogosService.slug('3M COLOMBIA S.A.')).toBe('3m-colombia-s-a');
    expect(LogosService.slug('NESTLÉ DE COLOMBIA')).toBe('nestle-de-colombia');
    expect(LogosService.slug("NATURE'S HEART")).toBe('nature-s-heart');
  });

  it('no deja guiones sueltos en los extremos', () => {
    expect(LogosService.slug('  ALFA LTDA.  ')).toBe('alfa-ltda');
    expect(LogosService.slug('***')).toBe('');
  });
});
