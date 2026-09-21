# houseaimage — de demo a producto

Documento de trabajo. Marcar cada tarea con `[x]` cuando esté hecha. Seguir el orden: no saltar a cobrar hasta que el loop genere un vídeo real.

**Producto:** un agente sube fotos de un inmueble y obtiene un vídeo de tour listo para el anuncio.

**Hoy:** una página Next.js que sube fotos a disco local y llama a un cliente Higgsfield de ejemplo. Sin usuarios, pagos ni historial.

---

## Ahora — el loop tiene que funcionar

- [ ] 1. Sustituir `src/lib/higgsfield.ts` por la API real (auth `Key id:secret`, endpoint image-to-video). Confirmar con una generación de verdad.
- [ ] 2. Cambiar `src/lib/storage.ts` a storage público persistente (Vercel Blob). Higgsfield no alcanza `localhost` ni el disco de Vercel.
- [ ] 3. Cuando el job termina, copiar el MP4 a nuestro storage. El enlace de Higgsfield caduca.
- [ ] 4. Límites en upload: solo imagen, tamaño máximo, número máximo de fotos.
- [ ] 5. Deploy con dominio y env vars. Generar un vídeo E2E con fotos de un piso real.

## Después — poder cobrarlo

- [ ] 6. Cerrar `/api/upload` y `/api/generate`. Hoy cualquiera gasta la GPU.
- [ ] 7. Cuentas de usuario (auth).
- [ ] 8. Guardar cada generación en base de datos (usuario, fotos, job, url del vídeo).
- [ ] 9. Historial + botón de descarga. Recargar la página no puede perder el vídeo.
- [ ] 10. Pagos por pack o créditos (Stripe). Cada vídeo cuesta GPU.
- [ ] 11. Marca y copy: quitar "Create Next App", explicar para quién es y cuánto cuesta.
- [ ] 12. ToS y privacidad (fotos de viviendas).

## Luego — que se sienta producto, no tool

- [ ] 13. Presets de estancia (salón, cocina, fachada, recorrido) en vez de prompt vacío.
- [ ] 14. Elegir 16:9 (portal) o 9:16 (Stories) en la UI. Hoy 9:16 va hardcodeado.
- [ ] 15. Aviso cuando termina (email). El poll del browser muere si cierras la pestaña.
- [ ] 16. Un vídeo de prueba gratis, con tope.

---

## Fuera de alcance hasta que alguien pague un vídeo

Equipos, white-label, app móvil, Idealista API, virtual staging, 3D.

Atajo válido: con las tareas 1–5 hechas, se puede vender a mano (WhatsApp → MP4 → cobro) sin auth ni Stripe.

## Dónde está el código

| Qué | Dónde |
|---|---|
| UI | `src/app/page.tsx` |
| Dropzone | `src/components/PhotoDropzone.tsx` |
| Upload → job → poll | `src/lib/useVideoGeneration.ts` |
| Higgsfield | `src/lib/higgsfield.ts` |
| Fotos | `src/lib/storage.ts` |
| APIs | `src/app/api/upload`, `src/app/api/generate` |
