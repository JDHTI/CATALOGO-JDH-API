-- Contactos del formulario público de la home (un registro por correo).
-- Ver docs/contact-leads.md.
-- CreateTable
CREATE TABLE "contact_leads" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "correo" VARCHAR(254) NOT NULL,
    "celular" VARCHAR(10) NOT NULL,
    "ciudad" VARCHAR(80) NOT NULL,
    "tipo_identificacion" VARCHAR(3),
    "identificacion" VARCHAR(17),
    "origen" VARCHAR(40) NOT NULL,
    "acepta_tratamiento_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_leads_correo_key" ON "contact_leads"("correo");
