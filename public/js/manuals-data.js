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
        icon: "🎯",
        heading: "Prospección DENUE, 18 Zonas KML Reactivas y Paquetes Automáticos",
        bodyHtml:
          "En <strong>🎯 Prospección Aguacatera y Cuadrantes KML</strong> dispone de más de 1,100 negocios filtrados en Saltillo, Ramos Arizpe y Arteaga:<br>" +
          "• <strong>📐 Zonas y Colonias Reactivas:</strong> Active <strong>📐 Cuadrantes / KML</strong> (alternando entre <strong>🗺️ 18 Zonas Región</strong> o <strong>🏘️ 35 Colonias Clave</strong>) y toque cualquier zona coloreada en el mapa → <strong>➕ Sumar a Ruta ▾</strong> para elegir ahí mismo al chofer. Si elige un chofer que ya tiene paradas, el sistema <strong>adiciona</strong> la nueva zona encima y reordena todo el recorrido con OSRM.<br>" +
          "• <strong>📦 Paquetes Auto (25–30) y Excel:</strong> Genere rutas agrupadas por perfil (<em>Anaquel, Cocina, Ejecutiva</em>) o descargue prospectos filtrados en <strong>📊 Exportar Excel (.xlsx)</strong>.<br>" +
          "• <strong>🔒 Mapa fijo en celular:</strong> En pantallas móviles el mapa inicia bloqueado para deslizar la página sin hacer zoom accidental; toque <strong>🔒 Mapa fijo</strong> si desea moverlo.",
        example:
          "Puede tocar la Zona República y asignarla a un chofer, y enseguida tocar Parque Centro y elegir '+ Adicionar' al mismo chofer para fusionar ambas zonas en una sola ruta optimizada."
      },
      {
        num: "6",
        icon: "🔐",
        heading: "Equipo, Rol Mixto Chofer↔Admin, Horario GPS y Respaldos",
        bodyHtml:
          "• En <strong>🚗 Equipo y PINs</strong> gestione vendedores, PINs de 4 dígitos, la casilla <strong>🛡️ Rol Admin</strong> (permite a socios/encargados cambiar entre App Chofer y Panel Admin desde su menú <strong>⋮</strong>) y la hora de <strong>Apagar GPS auto</strong> al finalizar el turno.<br>" +
          "• En <strong>❄️ Termos y Lotes QR</strong> y <strong>🔐 Dirección / Finanzas</strong> controle marbetes QR por tarima, costos de compra, gastos y utilidad neta, y use <strong>💾 Respaldar</strong> para copia íntegra.",
        example:
          "Al configurar 'Apagar GPS auto' a las 08:00 PM, las unidades reportan ubicación continua durante el turno sin botón de pausa manual y se desconectan automáticamente al concluir la jornada."
      }
    ],
    whatsappText:
      `👑 *MANUAL OPERATIVO: DIRECCIÓN GENERAL — COMERCIALIZADORA SALINAS*\n\n` +
      `1️⃣ *Supervisión en tiempo real:* El panel abre directo en *🗺️ Ruta, GPS y Cortes* (*⛶ Completa* y *🔒 Mapa fijo* en móvil para scroll libre):\n` +
      `   • Active *🛣️ Rutas (N)* para comparar ruta planeada vs. recorrido GPS real.\n` +
      `   • Estatus 30d: 🟢 Compró hoy | 🟡 Visitado | ⚪ Pendiente | ⭐ Frecuente.\n\n` +
      `2️⃣ *Prospección y Zonas KML Reactivas:* En *🎯 Prospección Aguacatera* active *📐 Cuadrantes / KML* (*18 Zonas* o *35 Colonias*), toque una zona -> *➕ Sumar a Ruta ▾* y elija al chofer (permite *+ Adicionar* varias zonas al mismo chofer reordenando con OSRM) o use *📦 Paquetes Auto*.\n\n` +
      `3️⃣ *Alertas y Control de Precios:* Active *🔔 Sonido* para pedidos nuevos; en *🏷️ Precios y Difusión* ajuste Precio Público, *Mínimo Ruta ($)* y precio por kg.\n\n` +
      `4️⃣ *Conciliación de Cortes:* En *Pre-Corte Automático* cruce salidas/mezclas de Almacén contra Ventas en Ruta.\n\n` +
      `5️⃣ *Equipo, Rol Chofer↔Admin y GPS por Turno:* En *🚗 Equipo y PINs* active *🛡️ Rol Admin* para socios en ruta y ajuste la hora de *Apagar GPS auto*.\n\n` +
      `6️⃣ *Termos QR, Finanzas y Respaldos:* Gestione lotes en *❄️ Termos QR*, utilidad neta en *🔐 Dirección / Finanzas* y copias en *💾 Respaldar*.`
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
        heading: "Zonas KML Reactivas, Paquetes Auto y Constructor de Rutas",
        bodyHtml:
          "En <strong>🗺️ Ruta, GPS y Cortes</strong> puede armar rutas por zona o punto por punto:<br>" +
          "1. <strong>Por Zona / Colonia KML:</strong> Active <strong>📐 Cuadrantes / KML</strong>, toque cualquier zona coloreada en el mapa → <strong>➕ Sumar a Ruta ▾</strong> y seleccione al chofer (si ya tiene ruta, el botón <strong>+ Adicionar</strong> le suma la nueva zona encima y reordena todo el recorrido).<br>" +
          "2. <strong>Por Paquetes Auto (25–30 paradas):</strong> En <strong>📦 Paquetes Auto</strong> elija perfil de giro y chofer, y pulse <strong>🧭 Pasar a Ruta</strong>.<br>" +
          "3. <strong>Manual / Alta rápida:</strong> En <strong>🧭 Constructor Inteligente de Rutas</strong> busque tiendas/pedidos, cree negocios nuevos con <strong>+ Nuevo</strong>, pulse <strong>⚡ Calcular Mejor Ruta (OSRM)</strong> y <strong>📤 Enviar Ruta al Chofer</strong> (o <strong>🔁 Pasar pendientes</strong> para transferir paradas a otra unidad).",
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
      `4️⃣ *Zonas KML, Paquetes Auto y Constructor de Rutas:* Active *📐 Cuadrantes / KML* y toque una zona -> *➕ Sumar a Ruta ▾* para asignarla o *+ Adicionar* otra zona a un chofer, o arme desde *🧭 Constructor Inteligente de Rutas* y pulse *📤 Enviar Ruta al Chofer*.\n\n` +
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
        heading: "Carga a unidades de reparto y Mezcla por Maduración",
        bodyHtml:
          "Al cargar mercancía a las camionetas:<br>" +
          "1. Desde <code>/almacen.html</code> escanee el QR de la tarima, elija <strong>🚛 Cargar a Chofer</strong>, seleccione vendedor y cantidad de cajas.<br>" +
          "2. En <code>/admin.html</code> → <strong>📋 Control de Almacén</strong>, la tarjeta <strong>1. Registrar Salida de Carro</strong> aparece al inicio: si la unidad lleva una sola madurez use el modo rápido; si lleva combinación variada (ej. Sazón, Quebrado y Maduro en distintos calibres), pulse <strong>🎨 Detallar mezcla por tamaño</strong> para capturar la matriz 4×4 y sumar el total en automático.",
        example:
          "Cada carga queda descontada en tiempo real y muestra el desglose exacto de madurez tanto en bitácora como en la app del chofer."
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
        heading: "App Salinas Reparto: GPS Automático de Turno y Menú (⋮)",
        bodyHtml:
          "La aplicación móvil (Android APK o iPhone TestFlight) mantiene su ubicación activa durante su horario laboral aun con la pantalla bloqueada:<br>" +
          "• <strong>🟢 GPS automático en turno:</strong> Al iniciar sesión dentro de su jornada laboral, el indicador <strong>🟢 GPS</strong> se enciende automáticamente (sin riesgo de apagarlo por accidente en ruta) y se apaga solo al terminar el horario de turno (<strong>🌙 Fin turno</strong>) o al cerrar sesión.<br>" +
          "• <strong>Menú superior ⋮ :</strong> En la esquina superior derecha encontrará <strong>📖 Guía Rápida</strong>, <strong>🚪 Cerrar sesión</strong> (con confirmación para evitar toques accidentales) y, si cuenta con permiso administrativo autorizado, <strong>🛡️ Cambiar a Admin</strong> (regresando desde Admin con <strong>🚗 Chofer</strong>).<br>" +
          "• <strong>Permisos recomendados (una sola vez):</strong> Acepte ubicación en <strong>«Permitir todo el tiempo»</strong> y desactive ahorro de batería. Al permanecer ~1 min cerca de una tienda registrada, la visita se marca sola por geocerca.",
        example:
          "Al terminar su día y liquidar su corte en bodega, abra el menú ⋮ y seleccione 🚪 Cerrar sesión (o deje que el horario automático pase a 🌙 Fin turno)."
      },
      {
        num: "2",
        icon: "🧭",
        heading: "Sección 1 — 'Mi Ruta': Vista Previa 2D, Ruta del Día y Navegación 3D",
        bodyHtml:
          "• <strong>Indicador superior de carga:</strong> Muestra las cajas y mezcla despachadas por Almacén y su disponibilidad actual por calibre (<strong>M, P, E y S</strong>).<br>" +
          "• <strong>🗺️ Mi Ruta del Día:</strong> Aquí recibe en vivo las zonas/rutas enviadas por Administración, puede ver el trazo completo antes de arrancar con <strong>🗺️ Mapa</strong>, o armar la suya con <strong>🗺️ Armar Ruta</strong>.<br>" +
          "&nbsp;&nbsp;• Reordene paradas con <strong>⋮⋮</strong> o <strong>▲ / ▼</strong>; marque <strong>✓</strong> al visitar, quite con <strong>✕</strong> o limpie con <strong>🗑️</strong>.<br>" +
          "&nbsp;&nbsp;• Pulse <strong>🧭 Iniciar Ruta 3D</strong> para abrir la cabina de navegación giro a giro con alertas de llegada y acceso directo a venta.<br>" +
          "• <strong>Pedidos Asignados por Oficina:</strong> Use <strong>📍 Abrir Mapa</strong>, <strong>🚗 Voy en Camino</strong> y <strong>✅ Entregar y Cobrar</strong>.",
        example:
          "Si Admin adiciona otra zona o parada de último minuto mientras navega en 3D, su ruta se actualiza en vivo sin cerrar el mapa."
      },
      {
        num: "3",
        icon: "🏪",
        heading: "Sección 2 — 'Clientes': Alta rápida y Visitas con Nota",
        bodyHtml:
          "Utilice la pestaña <strong>🏪 Clientes</strong> para gestionar puntos de compra directamente en el sistema:<br>" +
          "• <strong>Alta de establecimiento nuevo:</strong> Frente al negocio, presione <strong>📍 Guardar Nuevo Negocio Aquí (GPS)</strong> (o véndale directo en <strong>➕ Vender</strong> y el sistema guardará el punto nuevo automáticamente).<br>" +
          "• <strong>Cliente existente con compra:</strong> Localícelo y pulse <strong>➕ Venderle</strong> para cargar sus datos.<br>" +
          "• <strong>Visita realizada sin venta:</strong> Presione <strong>📍 Pasé (Sin venta)</strong>, elija el motivo y agregue una <strong>nota opcional</strong> (ej. horario en que recibe o encargado) para dejar constancia GPS.",
        example:
          "El registro de visita sin venta actualiza de inmediato el indicador amarillo del negocio en el mapa administrativo."
      },
      {
        num: "4",
        icon: "➕",
        heading: "Sección 3 — 'Vender': Ventas por Caja o Kg y Nota WhatsApp",
        bodyHtml:
          "Para documentar toda venta directa en ruta, ingrese a <strong>➕ Vender</strong>:<br>" +
          "1. Capture o seleccione el establecimiento (si es prospecto nuevo, puede guardar su giro y GPS ahí mismo).<br>" +
          "2. Indique la cantidad por calibre (<strong>S, E, P o M</strong>, por caja o modalidad en kg cuando aplique) respetando el precio mínimo autorizado.<br>" +
          "3. Seleccione el método de cobro: <strong>💵 Efectivo</strong>, <strong>🏦 Transferencia</strong> o <strong>📝 Crédito / Deja Anticipo</strong> (con teléfono de 10 dígitos).<br>" +
          "4. Presione <strong>✅ Registrar Venta</strong> y envíe el comprobante foliado con <strong>📲 Mandar Nota por WhatsApp al Cliente</strong>.",
        example:
          "Aun cuando el cliente solicite nota física impresa, toda operación debe registrarse en la aplicación para cuadrar inventario y efectivo."
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
      `1️⃣ *GPS automático de turno y Menú (⋮):*\n` +
      `• Al iniciar sesión, *🟢 GPS* arranca solo durante su horario laboral (acepte ubicación *"Permitir todo el tiempo"* y sin ahorro de batería) y pasa solo a *🌙 Fin turno* al terminar el horario.\n` +
      `• En el menú superior *⋮* tiene *📖 Guía Rápida*, *🚪 Cerrar sesión* (con confirmación) y, si aplica a su perfil, *🛡️ Cambiar a Admin*.\n` +
      `• Al permanecer ~1 min cerca de una tienda registrada, la visita se marca sola por geocerca.\n\n` +
      `2️⃣ *🗺️ Mi Ruta del Día y Navegación 3D:*\n` +
      `• Revise su trazo con *🗺️ Mapa*, ármela con *🗺️ Armar Ruta* o inicie directo con *🧭 Iniciar Ruta 3D*.\n` +
      `• Reordene con *⋮⋮* (o *▲ / ▼*), marque *✓*, quite con *✕* o vacíe con *🗑️*.\n\n` +
      `3️⃣ *🏪 Clientes:*\n` +
      `• *Negocio nuevo:* Regístrelo con *📍 Guardar Nuevo Negocio Aquí (GPS)* (o directo al venderle por primera vez).\n` +
      `• *Visita sin venta:* Pulse *📍 Pasé (Sin venta)* con motivo y nota opcional.\n\n` +
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
