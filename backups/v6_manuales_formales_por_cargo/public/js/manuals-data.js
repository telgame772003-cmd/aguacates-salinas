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
        heading: "Supervisión de unidades en tiempo real y auditoría de visitas",
        bodyHtml:
          "Ingrese a la pestaña <strong>🗺️ Ruta, GPS y Cortes</strong> para visualizar el mapa operativo de la ciudad (dispone del botón <strong>⛶ Pantalla Completa</strong> para monitoreo continuo):<br>" +
          "• <strong>🚗 Unidades y trayectoria:</strong> Muestra la ubicación actual de cada unidad, las cajas disponibles a bordo y el <strong>trazo en mapa</strong> del recorrido realizado durante la jornada.<br>" +
          "• <strong>Indicadores de estatus por punto de venta:</strong><br>" +
          "&nbsp;&nbsp;🟢 <strong>Verde:</strong> Cliente con compra registrada hoy (indica cajas e importe).<br>" +
          "&nbsp;&nbsp;🟡 <strong>Amarillo:</strong> Punto visitado sin venta (registra mediante GPS la distancia en metros desde el establecimiento para validar presencialmente la visita).<br>" +
          "&nbsp;&nbsp;⚪ <strong>Gris:</strong> Establecimientos pendientes de visita en la fecha actual.",
        example:
          "Si un ejecutivo de ventas reporta que el cliente aún contaba con inventario, el indicador aparecerá en color amarillo detallando la hora y la distancia GPS exacta al momento del registro."
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
      }
    ],
    whatsappText:
      `👑 *MANUAL OPERATIVO: DIRECCIÓN GENERAL — COMERCIALIZADORA SALINAS*\n\n` +
      `1️⃣ *Supervisión en tiempo real:* En el Panel Administrativo -> pestaña *🗺️ Ruta, GPS y Cortes* (*⛶ Pantalla Completa*):\n` +
      `   • Visualización de unidades en movimiento, inventario a bordo y recorrido diario.\n` +
      `   • Estatus de puntos de venta: 🟢 Con compra hoy | 🟡 Visitado sin venta (validado con distancia GPS) | ⚪ Pendiente.\n\n` +
      `2️⃣ *Alertas de pedidos nuevos:* Active *🔔 Sonido* en la barra superior. Cada pedido entrante emite alerta sonora y muestra un *🔴 Indicador Rojo* en el mapa para asignación directa a la unidad más cercana.\n\n` +
      `3️⃣ *Control de precios:* En *🏷️ Precios y Difusión* se establece el Precio Público y el *Mínimo Ruta ($)* autorizado para proteger el margen comercial.\n\n` +
      `4️⃣ *Conciliación de cortes:* En *Pre-Corte Automático* se cruzan automáticamente los registros de Almacén contra las Ventas en Ruta (inventario a devolver y efectivo exacto a liquidar).\n\n` +
      `5️⃣ *Seguridad y respaldos:* Gestión de personal y PINs en *🚗 Choferes y PIN*, y descarga de base de datos en *💾 Respaldar*.`
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
        icon: "🏪",
        heading: "Alta de establecimientos en el directorio del mapa",
        bodyHtml:
          "Además de los registros realizados por los vendedores en campo, Administración puede dar de alta clientes en el mapa:<br>" +
          "1. En <strong>🗺️ Ruta, GPS y Cortes</strong> presione <strong>➕ Punto / Tienda</strong>.<br>" +
          "2. Seleccione el giro comercial (Tienda, Carnicería, Restaurante o Frutería), indique el nombre del negocio y pegue el enlace de Google Maps o pulse <strong>👆 Elegir en Mapa</strong>.<br>" +
          "3. Presione <strong>💾 Guardar Negocio en el Mapa</strong>.",
        example:
          "Todos los establecimientos dados de alta quedan integrados en el monitoreo diario de cobertura comercial."
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
      `4️⃣ *Registro de puntos de venta:* En *🗺️ Ruta, GPS y Cortes* utilice *➕ Punto / Tienda* para incorporar ubicaciones mediante enlace de Google Maps o selección directa en mapa.\n\n` +
      `5️⃣ *Liquidación vespertina:* Una vez capturada la devolución física por el Área de Almacén, verifique en *Pre-Corte Automático* el cuadre al 100% de cajas y reciba el monto exacto indicado en *💵 Efectivo a Entregar*.`
  },

  almacen: {
    id: "almacen",
    shortTab: "📦 Área de Almacén",
    badge: "NIVEL 3 • CONTROL DE INVENTARIO, SALIDAS Y DEVOLUCIONES",
    title: "Manual Operativo — Área de Almacén",
    people: "Encargado(a) de Almacén y Control de Piso",
    summary:
      "Procedimiento estandarizado para el control diario de existencias en piso, salidas de cámara fría, despacho de unidades por vuelta y recepción de devoluciones sin cálculos manuales.",
    accessNote:
      "Al ingresar al Panel (/admin.html) se muestra directamente la pestaña de trabajo correspondiente: 📋 Control de Almacén.",
    steps: [
      {
        num: "1",
        icon: "🌅",
        heading: "Paso 1 (Apertura de bodega): Registro de inventario inicial y cámara fría",
        bodyHtml:
          "1. Verifique en la parte superior que esté seleccionada la <strong>Fecha actual</strong>.<br>" +
          "2. Presione el botón <strong>↺ Cargar Cierre Anterior</strong> para importar automáticamente las existencias finales del día previo en piso (o capture manualmente las cantidades en <strong>M, P, E y S</strong>).<br>" +
          "3. <strong>Salidas de cámara fría / entradas del día:</strong> Cuando se retire mercancía del refrigerador hacia el piso de venta, capture las cajas correspondientes en los campos <strong>+ M, + P, + E, + S</strong>.<br>" +
          "4. Presione el botón <strong>Guardar Inventario Base</strong>.<br>" +
          "<em>(Nota: Si en el transcurso del día se retiran cajas adicionales de cámara fría, incremente la cantidad en dichos campos y pulse nuevamente Guardar).</em>",
        example:
          "Si iniciaron con 10 cajas de Primera en piso y se retiraron 20 cajas adicionales de cámara fría, el sistema calculará automáticamente una disponibilidad total de 30 cajas en piso."
      },
      {
        num: "2",
        icon: "🚚",
        heading: "Paso 2 (Despacho de unidades): Registro de cada salida a ruta",
        bodyHtml:
          "Cada vez que una unidad cargue mercancía para salir a ruta:<br>" +
          "1. Ubique la sección <strong>2. Registrar Salida de Carro (Nueva Vuelta)</strong>.<br>" +
          "2. En <strong>Chofer / Vendedor</strong> seleccione al operador correspondiente.<br>" +
          "3. En <strong>Maduración que lleva</strong> seleccione el estado de la fruta despachada (<em>Maduro, Sazón, Quebrado, Verde, Maduro y Sazón, etc.</em>).<br>" +
          "4. Capture el número de cajas cargadas por calibre: <strong>M (Media), P (Primera), E (Extra) y S (Super)</strong>.<br>" +
          "5. Presione <strong>+ Dar Salida de Carro</strong>.<br>" +
          "<em>Si el mismo operador realiza una segunda o tercera vuelta durante la jornada, registre una nueva salida siguiendo exactamente los mismos pasos.</em>",
        example:
          "Al confirmar la salida, queda registrada automáticamente la hora exacta del despacho y se actualiza tanto la existencia en piso como el inventario disponible en el teléfono del vendedor."
      },
      {
        num: "3",
        icon: "↩️",
        heading: "Paso 3 (Regreso de ruta): Recepción y captura de devoluciones",
        bodyHtml:
          "Cuando el operador regrese a bodega con mercancía no vendida:<br>" +
          "1. Diríjase a la sección <strong>3. Bitácora de Vueltas y Devoluciones</strong>.<br>" +
          "2. Localice el registro de la vuelta correspondiente y presione el botón <strong>Editar / Devolución</strong>.<br>" +
          "3. En el apartado <strong>DEVOLUCIÓN QUE REGRESA SIN VENDER</strong> capture las cajas recibidas físicamente en buen estado para cada calibre (<strong>M, P, E y S</strong>).<br>" +
          "4. Presione <strong>Guardar Cambios</strong>.",
        example:
          "El sistema calcula de manera automática el neto vendido de esa vuelta y reincorpora las cajas devueltas a la existencia actual en piso."
      },
      {
        num: "4",
        icon: "✅",
        heading: "Verificación de cierre físico de almacén",
        bodyHtml:
          "En la parte superior de la pantalla se muestra permanentemente el indicador principal <strong>TOTAL EN PISO</strong> junto con el desglose por calibre:<br>" +
          "• Dichas cifras representan las cajas físicas que deben encontrarse en el área de piso en todo momento.<br>" +
          "• Al concluir la jornada, verifique que el conteo físico coincida con los indicadores del sistema. En caso de requerir respaldo impreso, presione <strong>🖨️ Imprimir Corte</strong>.",
        example:
          "Nomenclatura oficial de calibres: M = Media | P = Primera | E = Extra | S = Super."
      }
    ],
    whatsappText:
      `📦 *MANUAL OPERATIVO: ÁREA DE ALMACÉN — COMERCIALIZADORA SALINAS*\n\n` +
      `Operación diaria en el módulo *📋 Control de Almacén* en 3 pasos:\n\n` +
      `1️⃣ *APERTURA DE BODEGA (Inventario Inicial):*\n` +
      `• Presione *↺ Cargar Cierre Anterior* para importar la existencia final del día previo.\n` +
      `• Capture en los campos *+M, +P, +E, +S* las cajas retiradas de cámara fría hacia el piso.\n` +
      `• Pulse *Guardar Inventario Base*.\n\n` +
      `2️⃣ *DESPACHO DE UNIDADES (Salida a Ruta):*\n` +
      `• En *2. Registrar Salida de Carro*, seleccione *Chofer / Vendedor* y la *Maduración* despachada.\n` +
      `• Indique las cajas cargadas por calibre (*M, P, E y S*) y presione *+ Dar Salida de Carro*.\n` +
      `*(Repita este registro por cada vuelta adicional durante el día).* \n\n` +
      `3️⃣ *RECEPCIÓN DE DEVOLUCIONES (Regreso de Ruta):*\n` +
      `• En la bitácora inferior localice la vuelta correspondiente y pulse *Editar / Devolución*.\n` +
      `• Capture las cajas recibidas físicamente en *Devolución (M, P, E, S)* y presione *Guardar Cambios*.\n\n` +
      `✅ El recuadro superior *TOTAL EN PISO* calcula automáticamente la existencia exacta que debe permanecer físicamente en bodega.`
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
        heading: "Inicio de recorrido: Activación de ubicación GPS",
        bodyHtml:
          "Al iniciar su ruta, presione en la barra superior el botón <strong>⚪ Activar GPS</strong> hasta visualizar el estado <strong>🟢 GPS Activo</strong>.<br>" +
          "• Mantenga la aplicación abierta durante sus traslados (el sistema conserva activa la pantalla automáticamente).<br>" +
          "• Esto permite a Administración visualizar su ubicación en tiempo real y asignarle los pedidos más cercanos a su zona para evitar traslados innecesarios.",
        example:
          "Al concluir la jornada laboral en bodega, presione nuevamente el botón para finalizar la transmisión de ubicación."
      },
      {
        num: "2",
        icon: "🚗",
        heading: "Sección 1 — 'Mi Ruta': Inventario a bordo y entregas asignadas",
        bodyHtml:
          "• <strong>Indicador superior de carga:</strong> Muestra el total de cajas despachadas por Almacén y la disponibilidad actual en su unidad por calibre (<strong>M, P, E y S</strong>).<br>" +
          "• <strong>Pedidos Asignados por Oficina:</strong> Cada orden asignada muestra domicilio, detalle de cajas y maduración solicitada:<br>" +
          "&nbsp;&nbsp;1. Pulse <strong>📍 Abrir Mapa</strong> para iniciar la navegación o <strong>📞 Llamar</strong> para contactar al cliente.<br>" +
          "&nbsp;&nbsp;2. Presione <strong>🚗 Voy en Camino</strong> al dirigirse al establecimiento.<br>" +
          "&nbsp;&nbsp;3. Al efectuar la entrega, pulse <strong>✅ Entregar y Cobrar</strong> para registrar la forma de pago recibida.",
        example:
          "Al confirmar la entrega, el sistema descuenta automáticamente las cajas del inventario de su unidad y las integra a su corte diario."
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
      `1️⃣ *Inicio de ruta:* Presione en la parte superior *⚪ Activar GPS* (*🟢 GPS Activo*) para habilitar el monitoreo y la asignación de entregas cercanas.\n\n` +
      `2️⃣ *🚗 Mi Ruta:* Consulte su inventario disponible a bordo y gestione los pedidos asignados por Administración (*📍 Abrir Mapa* -> *🚗 Voy en Camino* -> *✅ Entregar y Cobrar*).\n\n` +
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
