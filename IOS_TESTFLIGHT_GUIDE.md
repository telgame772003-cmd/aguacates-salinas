# Guía de Publicación iOS (TestFlight / Unlisted App) — Salinas Reparto

## 1. Identidad Aislada (Cero impacto en Ruta Pro)
- **Nombre de la App:** `Salinas Reparto`
- **Bundle Identifier:** `com.salinas.reparto` (100% independiente de `com.rutapro.companion`)
- **Carpeta del Proyecto Xcode:** `ios/App/App.xcodeproj`
- **Gestor de Paquetes:** Swift Package Manager nativo (`CapApp-SPM`), sin dependencia de CocoaPods.

## 2. Pasos en tu Mac / Xcode para Subir a TestFlight
1. Clona o copia el repositorio `Aguacates Salinas` en tu Mac y ejecuta en la raíz:
   ```bash
   npm install
   npm run sync:ios
   ```
2. En [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list), registra el App ID **`com.salinas.reparto`** (con capacidad *Background Modes* estándar).
3. En [App Store Connect](https://appstoreconnect.apple.com/apps), crea una **Nueva App** seleccionando el Bundle ID `com.salinas.reparto` y nombre **Salinas Reparto**.
4. Abre `ios/App/App.xcodeproj` en Xcode:
   - En **Signing & Capabilities**, selecciona tu **Team** de Apple Developer.
   - Verifica que en **Background Modes** aparezca marcada la casilla **Location updates** (ya preconfigurada en `Info.plist`).
5. En la barra superior de Xcode elige **Any iOS Device (arm64)** → menú **Product → Archive** → **Distribute App → TestFlight & App Store**.
6. Al incluir `ITSAppUsesNonExemptEncryption = false` en `Info.plist`, la compilación quedará **Lista para Probar** automáticamente en TestFlight sin cuestionarios manuales de cifrado.

## 3. Notas Recomendadas para Revisión de Apple (App Review Information)
Si deseas distribuirla a choferes externos en TestFlight o solicitar **Unlisted App Distribution** ante Apple, pega este texto en *Notes for Review*:

> **Español:**
> Salinas Reparto es la herramienta operativa para los operadores de reparto comercial de Comercializadora Salinas. Permite a cada chofer consultar su inventario de cajas a bordo, navegar con cámara 3D Turn-by-Turn y guía de voz hacia los pedidos y negocios asignados, registrar entregas/ventas en ruta y compartir la ubicación de la unidad en tiempo real con el Despacho durante su turno activo (incluso con la pantalla bloqueada mientras descarga mercancía). El chofer puede pausar el GPS en cualquier momento desde el botón superior "GPS" o al cerrar sesión.
> Usuario de prueba: [Nombre de Chofer Demo] | PIN: [XXXX]

> **English:**
> Salinas Reparto is the commercial fleet delivery app for Comercializadora Salinas drivers. It provides 3D Turn-by-Turn voice navigation to assigned orders and merchant locations, live truck box inventory & delivery settlement, and continuous vehicle location sharing with Dispatch during an active delivery shift (including while the screen is locked during unloading). Drivers can pause GPS sharing at any time via the top "GPS" toggle or by logging out.
> Demo Driver: [Demo Driver Name] | PIN: [XXXX]
