import type {
  ContactLeadData,
  ContactLeadsRepository,
} from './contact-leads.repository';
import { ContactLeadsService } from './contact-leads.service';
import type { CreateContactLeadDto } from './dto/create-contact-lead.dto';

describe('ContactLeadsService', () => {
  const dto: CreateContactLeadDto = {
    nombre: 'Ana Gómez',
    correo: 'ana@example.com',
    celular: '3001234567',
    ciudad: 'Medellín',
    tipoIdentificacion: 'NIT',
    identificacion: '900123456-7',
    aceptaTratamientoDatos: true,
    origen: 'home-newsletter',
  };

  const build = (): {
    service: ContactLeadsService;
    upsertByCorreo: jest.Mock<Promise<{ id: number }>, [ContactLeadData]>;
  } => {
    const upsertByCorreo = jest
      .fn<Promise<{ id: number }>, [ContactLeadData]>()
      .mockResolvedValue({ id: 7 });
    const repository = {
      upsertByCorreo,
    } as unknown as ContactLeadsRepository;
    return { service: new ContactLeadsService(repository), upsertByCorreo };
  };

  it('guarda el contacto con la evidencia de la autorización y no devuelve el id', async () => {
    const { service, upsertByCorreo } = build();
    const before = Date.now();

    await expect(
      service.upsert(dto, { ip: '190.1.2.3', userAgent: 'Mozilla/5.0' }),
    ).resolves.toEqual({ ok: true });

    const data = upsertByCorreo.mock.calls[0][0];
    expect(data).toMatchObject({
      nombre: 'Ana Gómez',
      correo: 'ana@example.com',
      celular: '3001234567',
      ciudad: 'Medellín',
      tipoIdentificacion: 'NIT',
      identificacion: '900123456-7',
      origen: 'home-newsletter',
      ip: '190.1.2.3',
      userAgent: 'Mozilla/5.0',
    });
    expect(new Date(data.aceptaTratamientoAt).getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });

  it('guarda null en identificación, ip y user agent ausentes', async () => {
    const { service, upsertByCorreo } = build();

    await service.upsert(
      { ...dto, tipoIdentificacion: undefined, identificacion: undefined },
      {},
    );

    expect(upsertByCorreo.mock.calls[0][0]).toMatchObject({
      tipoIdentificacion: null,
      identificacion: null,
      ip: null,
      userAgent: null,
    });
  });

  it('recorta un user agent más largo que la columna', async () => {
    const { service, upsertByCorreo } = build();

    await service.upsert(dto, { userAgent: 'x'.repeat(2000) });

    expect(upsertByCorreo.mock.calls[0][0].userAgent).toHaveLength(512);
  });
});
