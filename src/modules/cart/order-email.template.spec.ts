import type { OrderResponseDto } from './dto/cart.dto';
import { renderOrderEmail } from './order-email.template';

const ORDER: OrderResponseDto = {
  id: 'o1',
  numero: 'PED-000007',
  fecha: '2026-11-17T20:15:00.000Z',
  solicitante: { nombre: 'Ana <b>Pérez</b>', email: 'ana@jdh.com.co' },
  nota: 'Entregar en "bodega" & recepción',
  lineas: [
    {
      productId: 1,
      sku: '1000',
      nombre: 'Partes <script>',
      cantidad: 3,
      precioUnitario: 49863,
      totalLinea: 149589,
    },
  ],
  subtotal: 149589,
  impuestos: 28422,
  total: 178011,
  ivaPorConfirmar: false,
  fechaFoto: '2026-11-17',
  correo: 'pendiente',
};

describe('renderOrderEmail', () => {
  it('trae número, solicitante, subtotal, impuestos y total en COP', () => {
    const { subject, html } = renderOrderEmail(ORDER);

    expect(subject).toBe('Pedido PED-000007 · Ana <b>Pérez</b>');
    expect(html).toContain('PED-000007');
    expect(html).toContain('ana@jdh.com.co');
    expect(html).toMatch(/Subtotal[\s\S]*149\.589/);
    expect(html).toMatch(/Impuestos[\s\S]*28\.422/);
    expect(html).toMatch(/Total[\s\S]*178\.011/);
  });

  it('no desglosa el IVA por tarifa', () => {
    const { html } = renderOrderEmail(ORDER);

    expect(html).not.toMatch(/IVA 19|IVA 5|Sin IVA/);
  });

  it('escapa todo texto variable', () => {
    const { html } = renderOrderEmail(ORDER);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Pérez</b>');
    expect(html).toContain('Partes &lt;script&gt;');
    expect(html).toContain('&quot;bodega&quot; &amp; recepción');
  });

  it('avisa del IVA por confirmar solo cuando aplica', () => {
    expect(renderOrderEmail(ORDER).html).not.toContain('IVA por confirmar');
    expect(
      renderOrderEmail({ ...ORDER, ivaPorConfirmar: true }).html,
    ).toContain('IVA por confirmar');
  });
});
