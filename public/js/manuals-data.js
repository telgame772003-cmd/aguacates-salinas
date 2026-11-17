// Documentación Interna: Manuales Operativos por Puesto y Área
// Se renderizan únicamente dentro de las vistas autenticadas (Administración / Ruta)

export const STAFF_MANUALS = {
  duenos: {
    id: "duenos",
    shortTab: "👑 Dirección General",
    badge: "NIVEL 1 • DIRECCIÓN Y SUPERVISIÓN GENERAL",
    title: "Manual Operativo — Dirección General",
    people: "Dirección General y Socios",
    summary:
      "Acceso integral a la operación comercial: supervisión en tiempo real de unidades en ruta, auditoría de visitas a clientes, control de políticas de precios y mínimos autorizados, conciliación de cortes y generación de respaldos.",
    accessNote:
      "Ingreso al Panel Central (/admin.html) mediante Clave Administrativa, y acceso a Modo Chofer (/chofer.html) mediante usuario y PIN de 4 dígitos al realizar labores de ruta.",
    steps: [
      {
        num: "1",
        icon: "🗺️",
        heading: "Monitor en Vivo, historial 30d y vista Plan vs. Recorrido Real",
        bodyHtml:
          "Al entrar al panel se abre directo la pestaña prioritaria <strong>🗺️ Ruta, GPS y Cortes</strong> (con botón <strong>⛶ Completa</strong> y buscador rápido de negocios):<br>" +
          "• <strong>🚗 Carros en vivo y rutas (OSRM):</strong> Los chips muestran únicamente las unidades conectadas (los desconectados quedan en <strong>👥 Offline (X)</strong>). Active <strong>🛣️ Rutas (N)</strong> para comparar la ruta planeada (punteada) vs. el recorrido GPS real <em>highlighted</em> ajustado a calles.<br>" +
          "• <strong>Indicadores de estatus e historial (30 días):</strong><br>" +
          "&nbsp;&nbsp;🟢 <strong>Verde:</strong> Compró hoy. &nbsp;|&nbsp; 🟡 <strong>Amarillo:</strong> Visitado hoy sin venta (manual o por geocerca GPS). &nbsp;|&nbsp; ⚪ <strong>Gris:</strong> Sin visita hoy.<br>" +
          "&nbsp;&nbsp;Al pasar el cursor o tocar un pin verá su <strong>última compra</strong> (fecha, cajas, monto), <strong>última visita</strong> y total de 30 días. Los compradores frecuentes (3+ compras/mes) lucen <strong>aro dorado ⭐</strong>.<br>" +
          "• <strong>Filtros de abandono y frecuencia:</strong> Use <strong>⏳ +3d s/visita</strong>, <strong>🚨 +7d s/compra</strong> y <strong>🔥 Frecuentes</strong> en la barra del mapa.",
        example:
          "Active 🛣️ Rutas y toque el ícono de cualquier carro para ver su estela ajustada a calles sobre su ruta planeada."
      },
      {
        num: "2",
        icon: "🚨",
        heading: "Alertas de pedidos en línea y asignación inmediata",
        bodyHtml:
          "En la barra superior derecha, pulse el botón <strong>🔔 Sonido</strong> para habilitar las notificaciones auditivas en el equipo.<br>" +
          "• Al recibirse un pedido nuevo en línea, el sistema emite una alerta sonora, despliega una <strong>barra superior de aviso</strong> y activa un <strong>🔴 Indicador Rojo de Pedido Nuevo</strong> en el mapa.<br>" +
          "• Al seleccionar dicho indicador directamente sobre el mapa, se muestra el detalle del pedido y permite asignarlo de inmediato a la unidad más cercana.",
        example:
          "Al activarse una alerta en cierta zona, puede identificar visualmente qué unidad cercana cuenta con la maduración solicitada y asignarle la entrega desde el mismo mapa."
      },
      {
        num: "3",
        icon: "🏷️",
        heading: "Política de precios de lista y precio mínimo en ruta",
        bodyHtml:
          "En la pestaña <strong>🏷️ Precios y Difusión</strong> se configuran dos valores para cada calibre (<strong>Super, Extra, Primera y Media</strong>):<br>" +
          "• <strong>Precio por Caja ($):</strong> Tarifa pública vigente en la tienda en línea y precio sugerido de venta.<br>" +
          "• <strong>Mínimo Ruta ($):</strong> Límite inferior autorizado. La aplicación móvil impide registrar ventas por debajo de este importe.",
        example:
          "Si el calibre Primera tiene un precio de lista de $320 y un mínimo autorizado de $280, el vendedor podrá otorgar precio preferencial dentro de ese rango sin exceder el límite establecido."
      },
      {
        num: "4",
        icon: "💰",
        heading: "Auditoría automática de cortes de inventario y efectivo",
        bodyHtml:
          "En la sección inferior de <strong>🗺️ Ruta, GPS y Cortes</strong> se presenta el <strong>Pre-Corte Automático por Chofer</strong>:<br>" +
          "• El sistema concilia automáticamente las salidas y devoluciones registradas en el <strong>Área de Almacén</strong> frente a las ventas capturadas en ruta.<br>" +
          "• Indica con exactitud las cajas físicas que deben reingresar a bodega y el monto exacto de <strong>Efectivo por entregar</strong>, separando pagos por Transferencia y operaciones a Crédito.",
        example:
          "Si una unidad registró salida de 30 cajas y documentó la venta de 22 cajas en ruta, el corte exigirá automáticamente la devolución física de 8 cajas en almacén."
      },
      {
        num: "5",
        icon: "🔐",
        heading: "Gestión de personal de ventas, accesos y respaldos",
        bodyHtml:
          "• En <strong>🚗 Choferes y PIN</strong> es posible dar de alta nuevos ejecutivos de ventas, actualizar números telefónicos, renovar códigos PIN de 4 dígitos y compartir el enlace de acceso mediante <strong>📲 Mandar App</strong>.<br>" +
          "• El botón superior <strong>💾 Respaldar</strong> permite descargar en cualquier momento una copia íntegra de la base de datos operativa.",
        example:
          "Se recomienda generar y almacenar un respaldo semanal al cierre del día sábado como medida de control institucional."
      },
      {
        num: "6",
        icon: "❄️",
        heading: "Control de Termos QR, Cuartos Fríos y Perfil Superadmin",
        bodyHtml:
          "• En la pestaña <strong>❄️ Termos y Lotes QR</strong> cree cada termo entrante (ej. <code>T01</code>) e imprima los <strong>marbetes QR por tarima</strong> para colocarlos en mica plástica.<br>" +
          "• Vigile el semáforo de antigüedad en <strong>Cuarto 1 a Cuarto 4</strong> (🟢 0–3 días, 🟡 4–6 días, 🔴 7+ días) y la merma acumulada al seleccionar tarimas de <em>Proceso</em>.<br>" +
          "• En la pestaña protegida <strong>🔐 Superadmin</strong> (con clave maestra independiente) capture los <strong>precios de compra por termo</strong> y <strong>gastos operativos</strong> para consultar en tiempo real el <strong>Balance Neto y Margen %</strong>.",
        example:
          "Solo quien cuente con la clave Superadmin puede visualizar costos de compra de fruta, gastos y utilidad neta."
      }
    ],
    whatsappText:
      `👑 *MANUAL OPERATIVO: DIRECCIÓN GENERAL — COMERCIALIZADORA SALINAS*\n\n` +
      `1️⃣ *Supervisión en tiempo real:* El panel abre directo en *🗺️ Ruta, GPS y Cortes* (*⛶ Completa*):\n` +
      `   • Active *🛣️ Rutas (N)* para comparar ruta planeada vs. recorrido GPS real ajustado a calles.\n` +
      `   • Estatus e historial 30d: 🟢 Compró hoy | 🟡 Visitado | ⚪ Pendiente | ⭐ Aro dorado (3+ compras/mes).\n` +
      `   • Filtros rápidos: *⏳ +3d s/visita*, *🚨 +7d s/compra* y *🔥 Frecuentes*.\n\n` +
      `2️⃣ *Alertas de pedidos nuevos:* Active *🔔 Sonido* en la barra superior. Cada pedido entrante emite alerta sonora y muestra un *🔴 Indicador Rojo* en el mapa para asignación directa a la unidad más cercana.\n\n` +
      `3️⃣ *Control de precios:* En *🏷️ Precios y Difusión* se establece el Precio Público y el *Mínimo Ruta ($)* autorizado para proteger el margen comercial.\n\n` +
      `4️⃣ *Conciliación de cortes:* En *Pre-Corte Automático* se cruzan automáticamente los registros de Almacén contra las Ventas en Ruta (inventario a devolver y efectivo exacto a liquidar).\n\n` +
      `5️⃣ *Termos QR y Superadmin:* En *❄️ Termos y Lotes QR* genere los QRs por tarima; en *🔐 Superadmin* controle precios de compra, gastos y utilidad neta.\n\n` +
      `6️⃣ *Seguridad y respaldos:* Gestión de personal y PINs en *🚗 Equipo y PINs*, y descarga de base de datos en *💾 Respaldar*.`
  },

  oficina: {
    id: "oficina",
    shortTab: "💼 Administración y Oficina",
    badge: "NIVEL 2 • COORDINACIÓN ADMINISTRATIVA Y DESPACHO",
    title: "Manual Operativo — Administración y Oficina",
    people: "Coordinación Administrativa y Personal de Oficina",
    summary:
      "Procedimiento diario para la difusión matutina de precios, recepción y asignación de pedidos en línea, registro de puntos de venta en el mapa y liquidación ágil de cortes vespertinos.",
    accessNote:
      "Ingreso al Panel de Administración (/admin.html) con Clave Administrativa. En caso de realizar actividades comerciales en campo, se ingresa adicionalmente a Modo Chofer (/chofer.html) con su PIN asignado.",
    steps: [
      {
        num: "1",
        icon: "📣",
        heading: "Apertura del día: Actualización y difusión masiva de precios",
        bodyHtml:
          "Para enviar la lista de precios diaria a toda la cartera de clientes de forma ágil:<br>" +
          "1. Ingrese a la pestaña <strong>🏷️ Precios y Difusión</strong>.<br>" +
          "2. Verifique o actualice los precios y disponibilidad por calibre y pulse <strong>Guardar y Actualizar Precios en Vivo</strong>.<br>" +
          "3. Presione el botón <strong>📋 Copiar Mensaje de Hoy</strong>.<br>" +
          "4. Pegue y envíe el mensaje en las <strong>Listas de Difusión de WhatsApp Business</strong> para notificar simultáneamente a los clientes junto con el enlace de pedidos en línea.",
        example:
          "Los clientes interesados ingresarán su pedido directamente en el portal, registrándose de forma ordenada en el panel administrativo."
      },
      {
        num: "2",
        icon: "🔔",
        heading: "Monitoreo de alertas y recepción de pedidos nuevos",
        bodyHtml:
          "Al iniciar labores en el equipo de oficina, active el botón <strong>🔔 Sonido</strong> ubicado en la parte superior derecha.<br>" +
          "• Cada nuevo pedido generará una alerta auditiva, mostrará la <strong>barra superior de notificación</strong> y colocará un <strong>🔴 Indicador Rojo de Pedido Nuevo</strong> en el mapa.<br>" +
          "• Cuando un cliente nuevo capture únicamente su domicilio escrito sin coordenadas GPS, pulse <strong>📍 Ubicar en Mapa</strong> dentro de su pedido y seleccione el punto en el mapa para dejar registrada su ubicación permanentemente.",
        example:
          "Una vez ubicado el establecimiento por primera vez, todos sus pedidos posteriores aparecerán automáticamente geolocalizados en el mapa."
      },
      {
        num: "3",
        icon: "🚗",
        heading: "Asignación eficiente de pedidos a unidades en ruta",
        bodyHtml:
          "Para despachar cada pedido evitando traslados innecesarios:<br>" +
          "1. En <strong>🗺️ Ruta, GPS y Cortes</strong> identifique qué unidad se encuentra próxima al punto de entrega y verifique que cuente con el calibre y maduración requeridos.<br>" +
          "2. Seleccione al ejecutivo de ventas directamente en la ventana emergente del mapa (o desde la pestaña <strong>📦 Pedidos en Línea</strong>).<br>" +
          "3. El pedido se sincroniza de inmediato en la aplicación móvil del vendedor; opcionalmente puede pulsar <strong>Enviar a Chofer</strong> para remitir los detalles por WhatsApp.",
        example:
          "Esto permite asignar cada entrega a la unidad que realmente dispone del producto solicitado en su inventario a bordo."
      },
      {
        num: "4",
        icon: "🧭",
        heading: "Constructor Inteligente de Rutas (Admin → Chofer) y alta de tiendas",
        bodyHtml:
          "En <strong>🗺️ Ruta, GPS y Cortes</strong> puede armar y enviar rutas en vivo al celular del chofer:<br>" +
          "1. En <strong>🧭 Constructor Inteligente de Rutas</strong> elija al <strong>Chofer</strong>.<br>" +
          "2. Sume paradas buscando por nombre/dirección, tocando un pin del mapa → <strong>➕ Sumar a Ruta</strong>, o pulsando <strong>📦 Cargar Pedidos del Chofer</strong>.<br>" +
          "3. Si la tienda aún no existe en la base de datos, toque <strong>+ Nuevo</strong> ahí mismo (o <strong>+ Punto</strong> arriba del mapa), capture giro, nombre y ubicación (link de Maps o <strong>👆 Elegir en Mapa</strong>) y al guardar se suma directo a la ruta.<br>" +
          "4. Pulse <strong>⚡ Calcular Mejor Ruta (OSRM)</strong> para optimizar el orden (con regreso a Base opcional) y luego <strong>📤 Enviar Ruta al Chofer</strong>. Para agregados urgentes use <strong>⚡ Sumar Último Minuto</strong>; para vaciarla use <strong>🗑️ Limpiar</strong>.",
        example:
          "Al enviar la ruta, aparece al instante en el teléfono del chofer (e incluso actualiza su navegador 3D si ya lo lleva abierto)."
      },
      {
        num: "5",
        icon: "🧾",
        heading: "Cierre del día: Liquidación y recepción de corte por unidad",
        bodyHtml:
          "Al regreso de cada unidad al término de su ruta:<br>" +
          "1. El <strong>Área de Almacén</strong> verifica físicamente y registra las cajas devueltas a bodega.<br>" +
          "2. Administración consulta en <strong>🗺️ Ruta, GPS y Cortes</strong> la tarjeta de <strong>Pre-Corte Automático</strong> correspondiente:<br>" +
          "&nbsp;&nbsp;• El indicador <strong>✓ ¡Cajas cuadran al 100%!</strong> confirma que no existen diferencias de inventario.<br>" +
          "&nbsp;&nbsp;• Si muestra <strong>⚠️ Faltan X cajas por comprobar</strong>, existe una venta pendiente de captura o producto pendiente de devolución.<br>" +
          "&nbsp;&nbsp;• El recuadro inferior indica el importe exacto de <strong>💵 Efectivo a Entregar</strong>, desglosando por separado cobros en <strong>🏦 Transferencia</strong> y saldos en <strong>📝 Crédito</strong>.",
        example:
          "Con este procedimiento se eliminan errores aritméticos y extravío de notas durante la liquidación diaria."
      }
    ],
    whatsappText:
      `💼 *MANUAL OPERATIVO: ADMINISTRACIÓN Y OFICINA — COMERCIALIZADORA SALINAS*\n\n` +
      `1️⃣ *Difusión matutina de precios:* En *🏷️ Precios y Difusión*, actualice tarifas, pulse *📋 Copiar Mensaje de Hoy* y envíelo mediante las Listas de Difusión de WhatsApp Business.\n\n` +
      `2️⃣ *Recepción de pedidos:* Active *🔔 Sonido* al abrir el panel. Cada pedido nuevo emite alerta sonora, muestra aviso superior y coloca un *🔴 Indicador de Pedido Nuevo* en el mapa.\n\n` +
      `3️⃣ *Asignación de entregas:* Seleccione el pedido en el mapa, verifique qué unidad cercana cuenta con el calibre y maduración requeridos, y asígnelo para sincronizarlo en el teléfono del vendedor.\n\n` +
      `4️⃣ *Constructor de Rutas y Alta de Tiendas:* En *🧭 Constructor Inteligente de Rutas* elija chofer, sume tiendas/pedidos (o cree una tienda nueva con *+ Nuevo*), pulse *⚡ Calcular Mejor Ruta (OSRM)* y *📤 Enviar Ruta al Chofer*.\n\n` +
      `5️⃣ *Liquidación vespertina:* Una vez capturada la devolución física por el Área de Almacén, verifique en *Pre-Corte Automático* el cuadre al 100% de cajas y reciba el monto exacto indicado en *💵 Efectivo a Entregar*.`
  },

  almacen: {
    id: "almacen",
    shortTab: "📦 Área de Almacén",
    badge: "NIVEL 3 • CUARTOS FRÍOS QR, PROCESO Y DESPACHO",
    title: "Manual Operativo — Área de Almacén",
    people: "Encargado(a) de Almacén y Cuartos Fríos",
    summary:
      "Procedimiento para el control de tarimas con QR desde celular/tablet (/almacen.html), ubicación en Cuartos 1–4, conversión de Proceso a cajas clasificadas (Limpio/Semilimpio), despacho a choferes y devoluciones.",
    accessNote:
      "Ingreso exclusivo para Almacén en https://aguacates-salinas.web.app/almacen.html con su usuario y PIN personal de bodega (sin visibilidad de cortes de dinero ni precios de compra).",
    steps: [
      {
        num: "1",
        icon: "📷",
        heading: "Recepción de termo y escaneo QR en Cuartos Fríos (/almacen.html)",
        bodyHtml:
          "1. Al llegar un termo nuevo, coloque cada marbete QR impreso en su tarima dentro de su mica plástica.<br>" +
          "2. En <code>/almacen.html</code> presione <strong>📷 Abrir Cámara</strong> y apunte al código QR de la tarima (o elíjala del listado).<br>" +
          "3. En la pestaña <strong>📥 Ubicar / Recibir</strong> seleccione el cuarto frío (<strong>Cuarto 1 a 4</strong> o <strong>Área Selección</strong>), confirme las cajas de <strong>10 kg</strong>, tipo, calidad (<strong>Limpio, Semilimpio o Proceso</strong>) y maduración (<strong>Verde, Pintón o Maduro</strong>), y pulse <strong>✅ Guardar Ubicación</strong>.",
        example:
          "En 15 minutos quedan ubicadas las 25 tarimas del termo con su fecha de entrada para respetar primeras entradas, primeras salidas (FIFO)."
      },
      {
        num: "2",
        icon: "🔄",
        heading: "Conversión de tarimas de «Proceso» a cajas clasificadas",
        bodyHtml:
          "Cuando se seleccione y reempaque una tarima de <strong>Proceso</strong> por tamaño y maduración:<br>" +
          "1. Escanee el QR de la tarima de Proceso y toque <strong>🔄 Convertir Proceso</strong>.<br>" +
          "2. Capture cuántas cajas de 10 kg salieron de cada calibre (<strong>Súper, Extra, Primera, Mediano, Comercial</strong>) más las cajas de <strong>Merma</strong>.<br>" +
          "3. Verifique que la barra indique <strong>Cuadra exacto ✅</strong>, elija si la fruta quedó <strong>Limpio</strong> o <strong>Semilimpio</strong>, su maduración y cuarto destino, y pulse <strong>🔄 Confirmar Conversión</strong>.",
        example:
          "De 104 cajas en una tarima de Proceso pueden salir 25 Primera, 45 Extra, 20 Mediano y 14 de Merma (104/104). El sistema cierra la tarima de Proceso y crea los sub-lotes listos para vender conservando la fecha original del termo."
      },
      {
        num: "3",
        icon: "🚛",
        heading: "Carga matutina a unidades de reparto",
        bodyHtml:
          "Al cargar mercancía a las camionetas:<br>" +
          "1. Escanee el QR de la tarima o sub-lote del cual se toman las cajas.<br>" +
          "2. Seleccione la pestaña <strong>🚛 Cargar a Chofer</strong>, elija al vendedor/unidad, capture la cantidad de cajas de 10 kg y confirme.<br>" +
          "3. Si también utilizan el registro diario de piso en <code>/admin.html</code> (<strong>📋 Control de Almacén</strong>), capture ahí la salida de vuelta y las devoluciones al regreso.",
        example:
          "Cada carga queda descontada en tiempo real de la cámara fría y ligada al vendedor que se la llevó."
      },
      {
        num: "4",
        icon: "❄️",
        heading: "Control de Cuartos Fríos y Merma adicional",
        bodyHtml:
          "En la pestaña inferior <strong>❄️ Cuartos Fríos</strong> puede filtrar por <strong>Cuarto 1–4</strong> o <strong>⏳ Solo Proceso</strong>:<br>" +
          "• El semáforo muestra la antigüedad de cada tarima (🟢 0–3 días, 🟡 4–6 días, 🔴 7+ días).<br>" +
          "• Si cambia una tarima de cuarto, avanza su maduración o se descarta fruta dañada, toque la tarima y use <strong>⚠️ Cuarto / Merma</strong> para mantener el inventario al 100%.",
        example:
          "Nomenclatura: S = Súper | E = Extra | P = Primera | M = Mediano | C = Comercial | PRO = Proceso."
      }
    ],
    whatsappText:
      `📦 *MANUAL OPERATIVO: ÁREA DE ALMACÉN — COMERCIALIZADORA SALINAS*\n\n` +
      `👉 *Acceso celular/tablet:* https://aguacates-salinas.web.app/almacen.html *(con tu PIN de Almacén)*\n\n` +
      `1️⃣ *RECIBIR TARIMAS (Cuartos Fríos):*\n` +
      `• Presione *📷 Abrir Cámara* y escanee el marbete QR de la tarima.\n` +
      `• Elija *Cuarto 1–4*, cajas (10 kg), calidad (*Limpio / Semilimpio / Proceso*) y madurez (*Verde / Pintón / Maduro*).\n\n` +
      `2️⃣ *CONVERTIR PROCESO (Desdoble de Lote):*\n` +
      `• Escanee la tarima de Proceso -> *🔄 Convertir Proceso*.\n` +
      `• Capture cuántas cajas salieron de *Súper, Extra, Primera, Mediano, Comercial* + *Merma*.\n` +
      `• Elija *Limpio / Semilimpio*, madurez y cuarto destino -> *Confirmar Conversión*.\n\n` +
      `3️⃣ *CARGAR A CHOFERES:*\n` +
      `• Escanee el lote -> *🚛 Cargar a Chofer* -> elija vendedor y cajas.\n\n` +
      `4️⃣ *REVISAR CUARTOS:* En *❄️ Cuartos Fríos* revise existencias y semáforo de días (🟢 0-3d | 🟡 4-6d | 🔴 7+d).`
  },

  ventas: {
    id: "ventas",
    shortTab: "🚗 Ventas y Reparto",
    badge: "NIVEL 4 • OPERACIÓN EN RUTA, PROSPECCIÓN Y COBRANZA",
    title: "Manual Operativo — Ventas y Reparto en Ruta",
    people: "Ejecutivos de Ventas y Operadores de Reparto",
    summary:
      "Guía de uso de la aplicación móvil de ruta (/chofer.html) para consulta de carga a bordo, atención de pedidos asignados, geolocalización de clientes, registro de ventas y pre-corte diario.",
    accessNote:
      "Ingrese desde su teléfono móvil a aguacates-salinas.web.app/chofer.html, seleccione su usuario, capture su PIN personal de 4 dígitos y mantenga activa la opción 'Mantener sesión iniciada'.",
    steps: [
      {
        num: "1",
        icon: "🛰️",
        heading: "App Nativa Salinas Reparto: GPS en segundo plano y Geocercas",
        bodyHtml:
          "La aplicación nativa (Android APK o iPhone TestFlight) mantiene su ubicación activa incluso con la pantalla apagada o usando otra app:<br>" +
          "• Al entrar con su usuario y PIN, el botón <strong>🟢 GPS</strong> se activa automáticamente. En la barra superior también tiene <strong>🧭 3D</strong>, <strong>❓ Guía</strong> y <strong>Salir</strong>.<br>" +
          "• <strong>Permisos recomendados (una sola vez):</strong> Acepte ubicación en <strong>«Permitir todo el tiempo»</strong> y desactive el ahorro de batería para <em>Salinas Reparto</em>.<br>" +
          "• <strong>Visitas automáticas por geocerca:</strong> Al permanecer ~1 minuto dentro de 55 metros de una tienda registrada (sin venta), el sistema registra la visita automáticamente sin que tenga que capturar nada.",
        example:
          "Al concluir la jornada laboral en bodega, toque el botón GPS para pausar el rastreo o toque Salir."
      },
      {
        num: "2",
        icon: "🧭",
        heading: "Sección 1 — 'Mi Ruta': Inventario, Mi Ruta del Día y Navegación 3D",
        bodyHtml:
          "• <strong>Indicador superior de carga:</strong> Muestra las cajas despachadas por Almacén y su disponibilidad actual por calibre (<strong>M, P, E y S</strong>).<br>" +
          "• <strong>🗺️ Mi Ruta del Día:</strong> Aquí recibe en vivo la ruta armada por Administración, o puede armar/editar la suya con <strong>🗺️ Armar / Editar</strong>.<br>" +
          "&nbsp;&nbsp;• Para reordenar paradas, mantenga presionado el ícono <strong>⋮⋮</strong> (~0.3 s hasta sentir vibración) o use <strong>▲ / ▼</strong>; toque <strong>✓</strong> para marcar lista, <strong>✕</strong> para quitar una parada o <strong>🗑️ Limpiar</strong> para vaciar la lista (con confirmación).<br>" +
          "&nbsp;&nbsp;• Pulse <strong>🧭 Iniciar Ruta 3D</strong> para abrir la cabina de navegación giro a giro con alertas de llegada y botón rápido de venta.<br>" +
          "• <strong>Pedidos Asignados por Oficina:</strong> Use <strong>📍 Abrir Mapa</strong>, <strong>🚗 Voy en Camino</strong> y <strong>✅ Entregar y Cobrar</strong>.",
        example:
          "Si Admin agrega una parada de último minuto mientras navega en 3D, la ruta se actualiza en vivo sin cerrar su mapa."
      },
      {
        num: "3",
        icon: "🏪",
        heading: "Sección 2 — 'Clientes': Registro de nuevos negocios y constancia de visita",
        bodyHtml:
          "Utilice la pestaña <strong>🏪 Clientes</strong> para gestionar los puntos de compra directamente en el sistema (sin enviar ubicaciones sueltas por mensajería):<br>" +
          "• <strong>Alta de establecimiento nuevo:</strong> Ubicado frente al negocio, presione <strong>📍 Guardar Nuevo Negocio Aquí (GPS)</strong>, seleccione el giro comercial, indique el nombre del establecimiento y guarde el registro.<br>" +
          "• <strong>Cliente existente con compra:</strong> Localícelo en el listado y pulse <strong>➕ Venderle</strong> para autocompletar sus datos en el formulario de venta.<br>" +
          "• <strong>Visita realizada sin venta:</strong> Si acudió al establecimiento pero no requirió producto o se encontraba cerrado, presione <strong>📍 Pasé (Sin venta)</strong> y seleccione el motivo para dejar constancia geolocalizada de su visita.",
        example:
          "El registro de visita sin venta actualiza de inmediato el indicador del cliente en el mapa de supervisión administrativa."
      },
      {
        num: "4",
        icon: "➕",
        heading: "Sección 3 — 'Vender': Captura de ventas en ruta y comprobante digital",
        bodyHtml:
          "Para documentar toda venta directa en ruta, ingrese a <strong>➕ Vender</strong>:<br>" +
          "1. Capture el nombre del cliente o establecimiento.<br>" +
          "2. Indique la cantidad de cajas entregadas por calibre (<strong>S, E, P o M</strong>). En caso de otorgar precio especial, ajústelo respetando el límite mínimo autorizado por el sistema.<br>" +
          "3. Seleccione el método de cobro:<br>" +
          "&nbsp;&nbsp;• <strong>💵 Efectivo</strong> o <strong>🏦 Transferencia</strong>.<br>" +
          "&nbsp;&nbsp;• <strong>📝 Crédito / Deja Anticipo:</strong> Es obligatorio capturar el teléfono de 10 dígitos del cliente; si entrega un pago parcial en efectivo, regístrelo en el campo <em>Anticipo</em> para calcular automáticamente el saldo pendiente.<br>" +
          "4. Presione <strong>✅ Registrar Venta</strong> y utilice el botón <strong>📲 Mandar Nota por WhatsApp al Cliente</strong> para enviar el comprobante foliado.",
        example:
          "Aun cuando el cliente solicite adicionalmente una nota física impresa, toda operación debe registrarse en la aplicación para mantener cuadrado su inventario y efectivo."
      },
      {
        num: "5",
        icon: "💰",
        heading: "Sección 4 — 'Mi Corte': Conciliación previa al regreso a bodega",
        bodyHtml:
          "Consulte la pestaña <strong>💰 Mi Corte</strong> antes de concluir su ruta:<br>" +
          "• Muestra con exactitud <strong>las cajas físicas que debe reingresar al Área de Almacén</strong>.<br>" +
          "• Calcula el importe exacto de <strong>Efectivo que debe liquidar en Administración</strong>, separando los cobros recibidos por transferencia y los saldos otorgados a crédito.<br>" +
          "• Incluye la relación completa de notas emitidas en el día para consulta o reenvío de comprobantes.",
        example:
          "Verificar que su existencia física en la unidad y su efectivo coincidan con 'Mi Corte' agiliza su cierre diario en menos de un minuto."
      }
    ],
    whatsappText:
      `🚗 *MANUAL OPERATIVO: VENTAS Y REPARTO EN RUTA — COMERCIALIZADORA SALINAS*\n\n` +
      `👉 *Acceso móvil:* https://aguacates-salinas.web.app/chofer.html\n` +
      `*(Seleccione su usuario e ingrese su PIN personal de 4 dígitos)*\n\n` +
      `1️⃣ *App Nativa y GPS en segundo plano:*\n` +
      `• Al iniciar sesión, *🟢 GPS* se activa solo (acepte ubicación *"Permitir todo el tiempo"* y sin ahorro de batería).\n` +
      `• Al permanecer ~1 min cerca de una tienda registrada, la visita se marca en automático por geocerca.\n\n` +
      `2️⃣ *🗺️ Mi Ruta del Día y Navegación 3D:*\n` +
      `• Reciba la ruta de Oficina o ármela con *🗺️ Armar / Editar*.\n` +
      `• Reordene manteniendo presionado *⋮⋮* (o *▲ / ▼*), marque *✓*, quite con *✕* o vacíe con *🗑️ Limpiar*.\n` +
      `• Toque *🧭 Iniciar Ruta 3D* para navegar giro a giro con aviso de llegada.\n\n` +
      `3️⃣ *🏪 Clientes:*\n` +
      `• *Establecimiento nuevo:* Regístrelo frente al local pulsando *📍 Guardar Nuevo Negocio Aquí (GPS)*.\n` +
      `• *Visita sin venta:* Seleccione *📍 Pasé (Sin venta)* para dejar constancia GPS de su visita.\n\n` +
      `4️⃣ *➕ Vender:* Capture toda venta realizada en ruta (*Efectivo, Transferencia o Crédito con Anticipo*) y envíe el comprobante foliado con *📲 Mandar Nota por WhatsApp*.\n\n` +
      `5️⃣ *💰 Mi Corte:* Verifique automáticamente las cajas exactas a devolver en Almacén y el efectivo exacto a liquidar en Administración.`
  },

  clientes: {
    id: "clientes",
    shortTab: "🛒 Guía para Clientes",
    badge: "PÚBLICO • INFORMACIÓN VISIBLE EN TIENDA EN LÍNEA",
    title: "Guía Pública de Pedidos para Clientes",
    people: "Clientes Comerciales (Tiendas, Carnicerías, Restaurantes y Fruterías)",
    summary:
      "Texto informativo 100% público visible en aguacates-salinas.web.app para orientar a los compradores sobre cómo realizar sus pedidos en línea (sin incluir información operativa interna).",
    accessNote:
      "Visible públicamente en https://aguacates-salinas.web.app — Disponible para compartir por WhatsApp con clientes que soliciten orientación.",
    steps: [
      {
        num: "1",
        icon: "🥑",
        heading: "Paso 1: Selección de cajas por calibre",
        bodyHtml:
          "Ingrese al portal de pedidos y presione el botón <strong>(+)</strong> en los calibres requeridos (<strong>Super, Extra, Primera o Media</strong>), visualizando al instante los precios vigentes del día.",
        example: ""
      },
      {
        num: "2",
        icon: "📍",
        heading: "Paso 2: Datos de entrega, madurez y ubicación GPS",
        bodyHtml:
          "Indique el nombre de su establecimiento, teléfono de contacto, punto de madurez requerido (<strong>Maduro listo para hoy, Sazón, Quebrado o Verde</strong>) y opcionalmente pulse <strong>📍 Adjuntar mi ubicación GPS</strong> para agilizar la entrega.",
        example: ""
      },
      {
        num: "3",
        icon: "🚚",
        heading: "Paso 3: Confirmación y pago contra entrega",
        bodyHtml:
          "Presione <strong>Confirmar Pedido en Línea</strong> para generar su folio de atención. Podrá consultar el estatus de despacho en tiempo real desde <strong>Mis Pedidos</strong> y realizar su pago al recibir la mercancía (<strong>Efectivo o Transferencia</strong>).",
        example: ""
      }
    ],
    whatsappText:
      `🥑 *GUÍA PARA REALIZAR SU PEDIDO EN LÍNEA — COMERCIALIZADORA SALINAS*\n\n` +
      `Solicite su pedido en menos de un minuto desde nuestro portal oficial:\n` +
      `👉 https://aguacates-salinas.web.app\n\n` +
      `1️⃣ *Seleccione sus cajas:* Pulse *(+)* en los calibres que requiera (*Super, Extra, Primera o Media*) con precios actualizados al día.\n` +
      `2️⃣ *Indique madurez y domicilio:* Elija el punto de madurez (*Maduro para hoy, Sazón, Quebrado o Verde*) y, si se encuentra en su negocio, pulse *📍 Adjuntar mi ubicación GPS* (sus datos quedarán guardados para futuras compras).\n` +
      `3️⃣ *Confirme y pague al recibir:* Presione *Confirmar Pedido en Línea* y liquide al recibir su mercancía mediante *Efectivo o Transferencia*.\n\n` +
      `_“La lealtad es escasa en estos tiempos y nosotros la valoramos. Gracias por tu lealtad.”_`
  }
};
