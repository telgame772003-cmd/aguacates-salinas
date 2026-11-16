# Reglas de Arquitectura y Gobernanza — Aguacates Salinas

## 1. Candado Estricto: Prohibido Tocar Ruta Pro
- Esta aplicación consume el visor comercial licenciado **Ruta Pro Nav Embed 3D** (`https://ruta-pro-companion.web.app/nav-embed.html`) como cliente B2B independiente (`rp_live_salinas_2026_9f4a8c2e`).
- **PROHIBIDO BAJO CUALQUIER CIRCUNSTANCIA** modificar, copiar o desplegar archivos dentro de `C:\Users\tello\Mis proyectos\Ruta Pro` (incluyendo `nav-embed.html`, `nav-embed.js`, `app.html`, `driver-nav-map-3d.js`, `db.js`, `android/` o `ios/`).
- Tampoco se debe copiar el motor 3D de MapLibre dentro de este repositorio; el visor se consume exclusivamente por `<iframe>` y protocolo `postMessage`.

## 2. Cómo Personalizar la UI/UX del Navegador 3D para Aguacates Salinas
Toda personalización visual y operativa de Aguacates Salinas se realiza **únicamente en este repositorio**, dentro de `public/js/driver.js`, editando `SALINAS_NAV3D_UI_CONFIG` (y/o las propiedades por parada en `stops[]`). Esto garantiza que los cambios de Aguacates Salinas solo los vea Aguacates Salinas y jamás afecten a Ruta Pro ni a otros clientes B2B:

- **Colores e identidad (`uiConfig.branding`):**
  - `badgeText`: texto de la insignia superior (ej. `"Ruta Salinas 3D"`).
  - `showBrandBadge`: `true` / `false`.
  - `accentColor`, `accentDarkColor`, `routeLineColor`, `puckColor`: colores hex/rgb exclusivos del cliente.
- **Textos y botones (`uiConfig.labels`):**
  - `primaryAction`: botón principal inferior (ej. `"✅ Entregar / Cobrar"`).
  - `arrivalAction`: botón de la tarjeta de llegada (ej. `"✅ Cobrar Aquí"`).
  - `arrivalTitle`, `arrivalSubtitle`, `closeBtn`, `defaultPinEmoji` (ej. `"🥑"`), `speedUnit` (`"km/h"`).
- **Velocímetro en puntero y controles (`uiConfig.cockpit`):**
  - `showSpeedOnPuck`: `true` / `false` (muestra la velocidad `km/h` en tiempo real pegada horizontalmente debajo de la flecha 3D del chofer).
  - `showBottomSpeedometer`, `showPrimaryActionBtn`, `showVoiceBtn`, `showThemeBtn`, `showCameraModeBtn`, `arrivalRadiusMeters`.
- **Personalización por tipo de parada (`stops[]`):**
  - Cada objeto dentro de `stops` acepta `pinEmoji`, `actionLabel`, `arrivalActionLabel` y `arrivalTitle` (por ejemplo, `"✅ Entregar / Cobrar"` cuando navega a un pedido asignado vs `"➕ Vender / Cobrar"` cuando navega a una tienda/cliente).
- **Actualización en caliente (`RP_NAV_CONFIGURE`):**
  - Para cambiar `uiConfig` o `theme` (`"day"` | `"night"`) mientras el mapa 3D ya está abierto, enviar `frame.contentWindow.postMessage({ type: "RP_NAV_CONFIGURE", uiConfig, theme }, RP_NAV_EMBED_ORIGIN)`.

## 3. Despliegue Seguro de Cambios en Aguacates Salinas
1. Al editar JS/CSS en `public/`, incrementar el query string `?v=...` en `public/chofer.html` y `public/js/driver.js` para evitar caché de módulos ES en móviles.
2. Sincronizar plataformas nativas: `npm run sync:android` y `npm run sync:ios`.
3. Desplegar web en Firebase Hosting de Salinas: `firebase deploy --only "hosting"`.
4. Si se requiere regenerar el APK local en Windows: `npm run build:apk` (usa `--max-workers=1`).
