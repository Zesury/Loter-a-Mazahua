# Feature: Publicación en Vercel + página de proyecto e instructivo

## Objetivo

Publicar la web Lotería Mazahua en Vercel con el nombre de proyecto `loteriamazahua`
(`https://loteriamazahua.vercel.app`) y agregar una página informativa con
"Sobre el proyecto" e "Instructivo", con los mismos estilos del juego.

## Problema

La web vive solo en local (carpeta `04-NETLIFY`) y no está en un repositorio ni
publicada. No existe material de ayuda para quien juega por primera vez.

## Alcance

- Crear `proyecto.html` con secciones "Sobre el proyecto" e "Instructivo".
- Reutilizar `styles.css` y la paleta "madera y mantel"; agregar estilos de documento.
- Enlazar la página nueva desde el menú principal de `index.html`.
- Agregar `vercel.json` para despliegue estático (clean URLs y caché de medios).
- Inicializar repositorio git, commit y push a
  `git@github.com:Zesury/Loter-a-Mazahua.git`.
- Desplegar con Vercel CLI con nombre de proyecto `loteriamazahua`.

## Fuera de alcance

- Comprar un dominio propio (`loteriamazahua.com`) ni configurar DNS.
- Cambiar lógica de juego, audio o Supabase.
- Modificar `netlify.toml` (se conserva como respaldo de Netlify).

## Tareas

- [x] T1. Crear `odd/tasks/vercel-loteriamazahua.md` con objetivo y alcance.
- [x] T2. Crear `proyecto.html` (Sobre el proyecto + Instructivo) con estilos compartidos.
- [x] T3. Agregar estilos de documento a `styles.css` y enlazar la página en `index.html`.
- [x] T4. Agregar `vercel.json` y `.gitignore`.
- [x] T5. `git init`, commit inicial y push al repositorio de GitHub.
- [x] T6. Instalar Vercel CLI, iniciar sesión y desplegar a producción como `loteriamazahua`.
- [x] T7. Verificar la URL publicada (inicio y página de instructivo).

## Evidencia

- Producción: https://loteriamazahua.vercel.app (READY, público).
- Verificado 200 en `/`, `/proyecto`, `/styles.css`, `/imagenes/1.webp`,
  `/audio_mazahua/001.ogg`, `/tableros/01.png`.
- Commit local: `d8e8113 feat: add project and instructions page, prepare Vercel deploy`.
- Despliegue anónimo temporal (`agile-valley-h6g5mu5.tmp.now`) quedó en 403 por
  mitigación de Vercel; se descartó a favor de la cuenta real.

## Criterios de aceptación

- `https://loteriamazahua.vercel.app` carga el menú del juego y los medios (audio, imágenes, tableros).
- `/proyecto` carga la página nueva y respeta la estética del juego.
- El enlace del menú abre la página nueva y el botón de volver regresa al juego.

## Verificación

- Navegación local: abrir `index.html` y `proyecto.html` sin errores de consola.
- Revisión de archivos referenciados (rutas absolutas `/...`).
- `vercel --prod` sin errores y URL final comprobada.

## Estado

Publicado en Vercel y respaldado en GitHub. Repositorio conectado al proyecto de
Vercel para despliegue automático en cada push a `main`.

