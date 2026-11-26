import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { CreateContactLeadDto } from './create-contact-lead.dto';

// Mismas opciones que el pipe global de main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const validate = (
  body: Record<string, unknown>,
): Promise<CreateContactLeadDto> =>
  pipe.transform(body, {
    type: 'body',
    metatype: CreateContactLeadDto,
  }) as Promise<CreateContactLeadDto>;

const messagesOf = async (body: Record<string, unknown>): Promise<string[]> => {
  try {
    await validate(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message;
  }
  throw new Error('se esperaba un 400');
};

const valid = {
  nombre: '  Ana Gómez ',
  correo: ' Ana.Gomez@Example.COM ',
  celular: '300 123 4567',
  ciudad: 'Medellín',
  tipoIdentificacion: null,
  identificacion: null,
  aceptaTratamientoDatos: true,
  origen: 'home-newsletter',
};

describe('CreateContactLeadDto', () => {
  it('acepta un envío válido y normaliza nombre, correo y celular', async () => {
    const dto = await validate(valid);

    expect(dto).toMatchObject({
      nombre: 'Ana Gómez',
      correo: 'ana.gomez@example.com',
      celular: '3001234567',
      tipoIdentificacion: null,
      identificacion: null,
    });
  });

  it.each(['+573001234567', '573001234567', '+57 300-123-4567'])(
    'quita el indicativo del celular %s',
    async (celular) => {
      const dto = await validate({ ...valid, celular });
      expect(dto.celular).toBe('3001234567');
    },
  );

  it.each(['6041234567', '300123456', '30012345678', '+13001234567'])(
    'rechaza el celular %s',
    async (celular) => {
      const messages = await messagesOf({ ...valid, celular });
      expect(messages.join()).toContain('celular');
    },
  );

  it('acepta que no lleguen los campos de identificación', async () => {
    const { tipoIdentificacion, identificacion, ...body } = valid;
    void tipoIdentificacion;
    void identificacion;
    await expect(validate(body)).resolves.toBeDefined();
  });

  it('trata los textos vacíos de identificación como no enviados', async () => {
    const dto = await validate({
      ...valid,
      tipoIdentificacion: '',
      identificacion: '  ',
    });
    expect(dto.tipoIdentificacion).toBeNull();
    expect(dto.identificacion).toBeNull();
  });

  it('acepta un NIT con DV y quita los puntos', async () => {
    const dto = await validate({
      ...valid,
      tipoIdentificacion: 'NIT',
      identificacion: '900.123.456-7',
    });
    expect(dto.identificacion).toBe('900123456-7');
  });

  it('acepta una CC de solo dígitos', async () => {
    const dto = await validate({
      ...valid,
      tipoIdentificacion: 'CC',
      identificacion: '1020304050',
    });
    expect(dto.identificacion).toBe('1020304050');
  });

  it('rechaza el guion del DV en una CC', async () => {
    const messages = await messagesOf({
      ...valid,
      tipoIdentificacion: 'CC',
      identificacion: '1020304050-1',
    });
    expect(messages).toContain(
      'identificacion solo admite el guion del DV cuando es NIT',
    );
  });

  it.each(['1234', '1234567890123456', '12ab567'])(
    'rechaza la identificación %s',
    async (identificacion) => {
      const messages = await messagesOf({
        ...valid,
        tipoIdentificacion: 'CC',
        identificacion,
      });
      expect(messages.join()).toContain('identificacion');
    },
  );

  it('rechaza la identificación sin su tipo', async () => {
    const messages = await messagesOf({
      ...valid,
      identificacion: '1020304050',
    });
    expect(messages.join()).toContain('tipoIdentificacion');
  });

  it('rechaza el tipo sin la identificación', async () => {
    const messages = await messagesOf({ ...valid, tipoIdentificacion: 'CC' });
    expect(messages.join()).toContain('identificacion es obligatoria');
  });

  it('rechaza un tipo de identificación desconocido', async () => {
    const messages = await messagesOf({
      ...valid,
      tipoIdentificacion: 'CE',
      identificacion: '1020304050',
    });
    expect(messages.join()).toContain('tipoIdentificacion');
  });

  it.each([false, 'true', undefined, null])(
    'rechaza aceptaTratamientoDatos = %p',
    async (aceptaTratamientoDatos) => {
      const messages = await messagesOf({ ...valid, aceptaTratamientoDatos });
      expect(messages).toContain('aceptaTratamientoDatos debe ser true');
    },
  );

  it('rechaza un correo inválido o demasiado largo', async () => {
    expect(
      (await messagesOf({ ...valid, correo: 'no-es-correo' })).join(),
    ).toContain('correo');
    const largo = `${'a'.repeat(250)}@x.co`;
    expect((await messagesOf({ ...valid, correo: largo })).join()).toContain(
      'correo',
    );
  });

  it('rechaza nombre y ciudad fuera de rango', async () => {
    const messages = await messagesOf({
      ...valid,
      nombre: ' A ',
      ciudad: 'x'.repeat(81),
    });
    expect(messages.join()).toContain('nombre');
    expect(messages.join()).toContain('ciudad');
  });

  it('rechaza campos que no están en el contrato', async () => {
    const messages = await messagesOf({ ...valid, admin: true });
    expect(messages.join()).toContain('admin');
  });
});
