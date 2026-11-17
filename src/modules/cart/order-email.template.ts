import type { OrderResponseDto } from './dto/cart.dto';

/**
 * Colores del sistema de diseño del catálogo (jdh-catalogo-ui, globals.css):
 * monocromo JDH, nunca negro puro.
 */
const C = {
  ink: '#1d1d1b', // Negro JDH
  inkSoft: '#343430',
  muted: '#919189',
  line: '#d9d9d9',
  subtle: '#f2f2f2',
  white: '#ffffff',
  success: '#15803d',
};

/** Tipografía de marca con respaldo seguro para clientes de correo. */
const FONT = "'Centrale Sans', 'Montserrat', 'Segoe UI', Arial, sans-serif";

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const DATE = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
});

const SNAPSHOT = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

/**
 * Consolidado del pedido para el buzón interno (y copia al empleado). HTML de
 * correo: tablas e estilos en línea, sin CSS externo ni imágenes remotas.
 * Muestra subtotal, impuestos y total SIN desglosar el IVA por tarifa.
 * Todo texto variable pasa por `escapeHtml`.
 */
export function renderOrderEmail(order: OrderResponseDto): {
  subject: string;
  html: string;
} {
  const subject = `Pedido ${order.numero} · ${order.solicitante.nombre}`;
  const unidades = order.lineas.reduce((sum, line) => sum + line.cantidad, 0);

  const rows = order.lineas
    .map(
      (line, index) => `
        <tr style="background:${index % 2 ? C.subtle : C.white};">
          <td style="padding:10px 12px;font-size:12px;color:${C.muted};white-space:nowrap;">${escapeHtml(line.sku)}</td>
          <td style="padding:10px 12px;font-size:14px;color:${C.ink};">${escapeHtml(line.nombre)}</td>
          <td align="right" style="padding:10px 12px;font-size:14px;color:${C.ink};">${line.cantidad}</td>
          <td align="right" style="padding:10px 12px;font-size:14px;color:${C.inkSoft};white-space:nowrap;">${COP.format(line.precioUnitario)}</td>
          <td align="right" style="padding:10px 12px;font-size:14px;color:${C.ink};white-space:nowrap;">${COP.format(line.totalLinea)}</td>
        </tr>`,
    )
    .join('');

  const totalRow = (label: string, value: number, strong = false) => `
        <tr>
          <td style="padding:6px 0;font-size:${strong ? 16 : 14}px;color:${strong ? C.ink : C.inkSoft};${strong ? 'font-weight:700;' : ''}">${label}</td>
          <td align="right" style="padding:6px 0;font-size:${strong ? 18 : 14}px;color:${C.ink};${strong ? 'font-weight:700;' : ''}white-space:nowrap;">${COP.format(value)}</td>
        </tr>`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.subtle};font-family:${FONT};color:${C.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.subtle};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:${C.white};border:1px solid ${C.line};border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:${C.ink};padding:24px 28px;">
          <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">Juan D. Hoyos · Catálogo</div>
          <div style="font-size:24px;font-weight:700;color:${C.white};margin-top:6px;">Pedido de empleado ${escapeHtml(order.numero)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;padding-bottom:12px;">
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${C.muted};">Solicitante</div>
                <div style="font-size:16px;font-weight:700;margin-top:4px;">${escapeHtml(order.solicitante.nombre)}</div>
                <div style="font-size:14px;color:${C.inkSoft};margin-top:2px;"><a href="mailto:${escapeHtml(order.solicitante.email)}" style="color:${C.inkSoft};">${escapeHtml(order.solicitante.email)}</a></div>
              </td>
              <td align="right" style="vertical-align:top;padding-bottom:12px;">
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${C.muted};">Fecha</div>
                <div style="font-size:14px;margin-top:4px;">${escapeHtml(DATE.format(new Date(order.fecha)))}</div>
                <div style="font-size:12px;color:${C.muted};margin-top:2px;">${order.lineas.length} productos · ${unidades} unidades</div>
              </td>
            </tr>
          </table>
          ${
            order.nota
              ? `<div style="background:${C.subtle};border-left:3px solid ${C.ink};padding:12px 14px;font-size:14px;color:${C.inkSoft};margin:4px 0 16px;"><strong style="color:${C.ink};">Nota:</strong> ${escapeHtml(order.nota)}</div>`
              : ''
          }
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:8px;border-collapse:separate;overflow:hidden;">
            <tr style="background:${C.ink};">
              <th align="left" style="padding:10px 12px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${C.white};font-weight:500;">SKU</th>
              <th align="left" style="padding:10px 12px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${C.white};font-weight:500;">Producto</th>
              <th align="right" style="padding:10px 12px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${C.white};font-weight:500;">Cant.</th>
              <th align="right" style="padding:10px 12px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${C.white};font-weight:500;">Precio unit.</th>
              <th align="right" style="padding:10px 12px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${C.white};font-weight:500;">Total</th>
            </tr>${rows}
          </table>
          <div style="font-size:12px;color:${C.muted};margin-top:8px;">Precios unitarios y totales por producto antes de impuestos.</div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="45%"></td>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line};">
                  ${totalRow('Subtotal', order.subtotal)}
                  ${totalRow('Impuestos', order.impuestos)}
                  <tr><td colspan="2" style="border-top:2px solid ${C.ink};font-size:0;line-height:0;padding-top:4px;">&nbsp;</td></tr>
                  ${totalRow('Total', order.total, true)}
                </table>
                ${
                  order.ivaPorConfirmar
                    ? `<div style="font-size:12px;color:${C.inkSoft};margin-top:8px;">Incluye productos con IVA por confirmar: su IVA no está sumado en impuestos.</div>`
                    : ''
                }
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background:${C.subtle};padding:16px 28px;font-size:12px;color:${C.muted};border-top:1px solid ${C.line};">
          Lista de precios de empleados JDH · costos del ${escapeHtml(SNAPSHOT.format(new Date(`${order.fechaFoto}T00:00:00Z`)))}.<br>
          Pedido interno sin pago en línea: la entrega se gestiona en la oficina.
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, html };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
