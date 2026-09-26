# **Manual Maestro de Arquitectura y Operación Logística (ERP)**

# **1\. Arquitectura del Sistema y Flujo Transaccional**

El sistema ERP opera bajo una arquitectura de Cliente Rico (Frontend) acoplado a una API RESTful (Backend) mediante un modelo MVC extendido con un enfoque de Fat Model (Modelo Gordo). El objetivo central es separar estrictamente el enrutamiento HTTP de las reglas de negocio y del acceso a la base de datos, comunicando ambas capas exclusivamente mediante un contrato JSON estandarizado ({tipo, mensajes, data}).

## **1.1. Capas del Frontend (Cliente \- AngularJS)**

El cliente gestiona el estado y la validación en tiempo real antes de tocar la red, ahorrando ancho de banda y mejorando la UX.

* Template (\*.html): Interfaz de usuario (UI), renderizado condicional y captura de eventos.  
* Controller (\*.controller.js): Lógica de la vista, manejo de loaders (spinners) y estado de la interfaz.  
* Collection (collection.\*.js): Gestor de listas en memoria que transforma JSON plano en Modelos enriquecidos.  
* Resource (resource.\*.js): Mensajero de red que encapsula \$http y gestiona las promesas.  
* Model (\*.js): Instancias con comportamiento local y reglas visuales (ej. calcularTotal()).

## **1.2. Capas del Backend (Servidor \- PHP)**

El servidor procesa la lógica pesada y garantiza la integridad de los datos.

* Router (index.php): Micro-framework (Slim). Intercepta la petición HTTP y despacha al controlador. No sabe de reglas de negocio.  
* Controller (\*Controller.php): Orquesta la operación, instanciando clases y devolviendo el JSON estandarizado. No ejecuta SQL.  
* Validator (\*Validator.php): Filtro de seguridad (ej. validación de stock, fechas). No persiste nada.  
* Modelo de Dominio (\*.php): Núcleo del negocio. Afecta el Kardex y calcula montos. No escribe SQL directamente.  
* Entity / ORM (\*Entity.php): Data Access Layer. Única capa autorizada a ejecutar operaciones preparadas en MySQL, previniendo inyecciones SQL.

## **1.3. Ciclo de Vida de Guardado (End-to-End)**

1. Ida: El usuario hace clic en guardar en el Template. El Controller (JS) enciende el spinner y delega a la Collection, que valida y empaqueta los datos. El Resource envía el POST (JSON).  
2. Procesamiento: El Router recibe el payload y lo pasa al Controller (PHP). El Validator aplica reglas estrictas (si falla, retorna error y corta el flujo). Si aprueba, el Modelo ejecuta la matemática del Kardex y la Entity guarda en la Base de Datos.  
3. Vuelta: El Controller (PHP) retorna 200 OK SUCCESS. El Resource resuelve la promesa, la Collection instancia el nuevo objeto en memoria, y el Controller (JS) apaga el spinner, actualizando la vista para que el Template muestre la notificación de confirmación verde.  
   

### **1.4. Tipología de Ítems y su Comportamiento en el Kardex**

El sistema clasifica el inventario en tres grandes familias. Esta distinción es obligatoria porque define por qué módulos pueden transitar y cómo impactan la rentabilidad del negocio:

* **Insumos (Materia Prima):**  
  * **Definición:** Bienes físicos que sufren transformación. Son la base del *Food Cost*.  
  * **Comportamiento en Kardex:** Ingresan masivamente a través del módulo de **Compras**. Disminuyen a través de **Producción** (al preparar recetas base) o **Ventas** (por explosión de materiales al vender un plato).  
  * **Ejemplo:** Carne, arroz, verduras.  
* **Consumibles (Materiales Operativos y Empaques):**  
  * **Definición:** Bienes físicos que se agotan con el uso, pero no se comen ni se transforman químicamente. Impactan el costo operativo, no el costo de la receta teórica.  
  * **Comportamiento en Kardex:** Ingresan por **Compras**. Generalmente, se retiran del Kardex mediante el módulo de **Almacenes (Salida de Stock / Mermas)** justificándolos como gasto de operación, o se amarran como adicionales en las ventas de *delivery*.  
  * **Ejemplo:** Cajas de hamburguesa, servilletas, guantes, lejía.  
* **Productos (Bienes Finales / Terminados):**  
  * **Definición:** Ítems listos para ser entregados al cliente final. Tienen un precio de venta al público.  
  * **Comportamiento en Kardex:**  
    * *De fabricación interna:* Ingresan al Kardex exclusivamente a través del módulo de **Producción (Salida de Producción)** y salen a través de **Ventas**.  
    * *De reventa:* Ingresan al Kardex directamente por **Compras** (ej. bebidas embotelladas) y salen por **Ventas**.  
  * **Ejemplo:** Hamburguesa Royal (fabricación interna), Gaseosa 500ml (reventa).


# **2\. Módulo de Compras (Aprovisionamiento y Costos)**

El Módulo de Compras es el motor de abastecimiento y control financiero. Garantiza que cada gasto esté justificado documentalmente, que el Kardex se actualice con precisión y que el Food Cost se calcule sobre precios reales de mercado. Se rige por la estricta separación de bienes físicos (afectan inventario) y bienes intangibles (solo afectan finanzas).

## **2.1. Cadena de Documentos Físicos (El Kardex)**

* Solicitud de Compra: Documento interno de requerimiento sin precios pactados. Informa formalmente a logística qué insumos necesita un área y para cuándo.  
* Orden de Compra: Documento externo y comercial que confirma al proveedor la cantidad y el precio pactado. Proyecta el gasto y permite consolidar requerimientos de varias sucursales para mayor poder de negociación (gestión visible en la Distribución de Órdenes de Compra, una pantalla inmutable de auditoría).  
* Guía de Compra (Opcional): Documento de recepción física. Su registro suma inmediatamente el stock en el Kardex para que la cocina opere, separando el flujo físico del contable.  
* Compra (Obligatoria): Documento maestro (factura/boleta). Recalcula el precio promedio unitario, afecta las cuentas por pagar y deduce impuestos. Bloquea su guardado si carece de Proveedor o Serie/Número. Posee una dualidad de fechas (Fecha de compra vs. Fecha de tributación).  
* Nota de Crédito: Corrección contable estrictamente vinculada a una Compra original. Disminuye la deuda y, dependiendo del caso, ajusta el inventario por devoluciones, manteniendo exacto el Food Cost.

## **2.2. Gestión de Intangibles y Financiamiento**

* Compras Rápidas: Contingencias de caja chica. Exige descripción y precio, pero omite el Kardex. Genera una salida de caja inmediata.  
* Órdenes y Compras de Servicio: Flujo para bienes intangibles (mantenimiento, fumigación). La Orden estima el gasto y la Compra de Servicio registra la boleta oficial para obtener crédito fiscal, sin alterar el inventario de alimentos.  
* Compras por Pagar: Panel financiero (Accounts Payable) para facturas al crédito. Gestiona cuotas, intereses, amortizaciones y genera layouts bancarios (ej. BBVA NetCash) para pagos masivos.  
* Plantillas y Borradores: Herramientas de agilidad. Los borradores pausan el registro de facturas largas sin afectar la base de datos, y las plantillas autocompletan pedidos recurrentes.

# **3\. Módulo de Producción (Transformación y Trazabilidad)**

Funciona bajo una lógica MRP (Planificación de Requerimientos de Materiales). Ninguna preparación inicia sin justificar un requerimiento matemático contra el inventario.

## **3.1. Planificación (Workflow de 7 etapas)**

1. Requerimientos: Sugerencia matemática de demanda ((Ventas Proyectadas) \- (Stock Actual)).  
2. Órdenes de Producción: Mandato oficial de trabajo con explosión de materiales y valorización en tiempo real.  
3. Solicitudes de Compra: Freno de seguridad automático si se detecta déficit de insumos para la orden.  
4. Reparto Interno: Traslados desde el almacén principal al área de cocina.  
5. Producción: Ejecución y cocción.  
6. Salida de Producción: Liberación del producto terminado.  
7. Abastecimiento: Ingreso al almacén de venta.

## **3.2. Asientos de Transformación (El Motor del Kardex)**

La producción en el sistema opera como un asiento de doble vía, donde el valor financiero se hereda o prorratea, manteniendo el balance total del inventario:

* Preparar Recetas (Transformación Química): Ejecuta la explosión de materiales. Descuenta insumos crudos y da de alta productos cocinados (ej. salsas, masas), asignándoles la suma del costo de sus ingredientes y un Número de Lote para trazabilidad.  
* Porcionar Recetas (Transformación Física): Pasa un producto terminado a granel (Kilos/Litros) a formatos de venta (Unidades empacadas), prorrateando el costo financiero total entre las nuevas porciones.  
* Porcionar Insumos (Desposte): Toma una pieza entera (ej. Pollo entero) y la divide en cortes (Pechuga, Alitas). Distribuye matemáticamente el costo de la pieza entre los cortes resultantes. Posee un control de Merma, que absorbe financieramente el desperdicio operativo (huesos, grasa) para que los cortes útiles reflejen su costo real encarecido.

## **3.3. Trazabilidad y Prevención**

* Dashboard de Lotes: Monitorea la "salud" de los productos preparados, listando Lotes Activos, Por Vencer (Alerta) y Vencidos (Críticos).  
* Prevención de Duplicidad: El sistema restringe el descuento manual de insumos en cocina. Si una receta está configurada como "Stock en Almacén", se descuenta al usar el módulo Preparar. Si es "Preparación en Venta", se descuenta automáticamente por detrás al facturar en la caja (POS).

# **4\. Módulo de Almacenes (Distribución, Control y Conciliación)**

Núcleo transaccional de la logística física, encargado de blindar el sistema contra pérdidas y mermas ocultas.

## **4.1. Ejecución Logística y Traslados**

* Requerimiento de Stock: Pedido interno manual o generado de forma predictiva mediante el análisis de movimientos (consumo histórico x días a abastecer) o Just-In-Time (por pedidos delivery confirmados).  
* Orden de Movimiento: Aprobación e instrucción de preparación (picking/packing) en el origen.  
* Movimiento entre Almacenes: Ejecución del traslado. Descuenta stock del origen, suma al destino y arrastra el Costo UM Base, garantizando que el Food Cost viaje con la mercadería.  
* GRE (Guía de Remisión Electrónica): Emisión obligatoria del XML a SUNAT para el traslado físico por vía pública, controlando modalidades de transporte (Privado vs. Tercerizado) con validaciones inmutables (Placa, Licencia, Ubigeo).

## **4.2. Control, Conciliación y Ajustes**

* Arqueo de Inventario: Auditoría preventiva de rutina (diaria/por turno) enfocada en ítems críticos o de alto valor. Solo evalúa cantidades mayores a cero.  
* Cuadre de Stock: Conciliación correctiva masiva o segmentada. Puede ser estándar, "ciego" (oculta el stock teórico para forzar el conteo real) o mediante carga masiva (Excel). Calcula automáticamente el impacto monetario de la Sobrevalorización y la Pérdida.  
* Salidas y Reservas: Módulo para asentar bajas físicas por merma, consumo de personal o roturas (afectando cuentas de gasto), y para reservar virtualmente mercadería (Stock Físico vs. Stock Disponible) previniendo que se consuma por error.  
* Sincronización de Stock: Módulo de mantenimiento que recalcula el Kardex de forma retrospectiva cuando ocurren eventos asíncronos (ej. registrar una compra días después de haberse consumido el stock), reprocesando los costos promedio y eliminando saldos negativos históricos.

## **5\. Mapa de Flujos, Transiciones y Canjes**

El sistema no opera como módulos aislados, sino como un ecosistema donde los documentos se transforman (canjean) siguiendo rutas estrictas basadas en la naturaleza del ítem (Insumo, Consumible o Producto). A continuación, se detallan los caminos lógicos extraídos del diagrama de flujo arquitectónico.

### **5.1. El Nodo Central: Requerimiento de Stock**

El **Requerimiento de stock** actúa como el gran distribuidor logístico. Al generarse un requerimiento (ej. un local necesita mercadería), el sistema evalúa la disponibilidad y el tipo de ítem para desviar el flujo por tres caminos posibles:

* **Hacia Solicitud de Compra (Desvío Externo):** Si el ítem (Insumo o Consumible) no tiene stock en ningún almacén de la empresa, el flujo se envía a Compras para adquirirlo de un proveedor externo.  
* **Hacia Orden de Movimiento (Desvío Interno):** Si el ítem (Insumo, Consumible o Producto) tiene stock en el almacén central, el flujo se convierte en una orden para trasladarlo físicamente a la sucursal que lo pide.  
* **Hacia Proceso / Orden de Producción (Desvío de Transformación):** Si el ítem es un Producto de fabricación interna (ej. salsa base) que no está en stock, el flujo exige a la cocina central que lo fabrique.

### **5.2. Ruta de Aprovisionamiento (Bienes Físicos)**

Este es el camino lineal para adquirir bienes que afectarán la rentabilidad. Solo transitan por aquí Insumos, Consumibles y Productos de reventa.

* **Secuencia de Canje:** Solicitud de compra ➔ Orden de compra ➔ Guía de compra ➔ Compra ➔ Nota de crédito de compra.  
* **Impacto Escalonado:**  
  * La *Orden de compra* proyecta la salida de dinero.  
  * La *Guía de compra* suma las unidades físicas al Kardex.  
  * La *Compra* recalcula el Costo Promedio Unitario y asienta la cuenta por pagar.

### **5.3. Ruta Financiera Intangible (Servicios)**

Ruta aislada diseñada para gastos operativos que no se almacenan (ej. mantenimiento).

* **Secuencia de Canje:** Orden de servicio ➔ Compra de servicio.  
* **Regla de Negocio:** Ningún documento de este flujo toca el Kardex ni se cruza con las guías de recepción físicas. Afectan directamente las cuentas por pagar y el estado de resultados.

### **5.4. Ruta de Producción y Abastecimiento de Cocina**

Flujo complejo que interconecta la necesidad de fabricar con la logística de movimiento y compras. Aquí los Insumos se transforman en Productos.

* **Interacciones de la Orden de Producción:**  
  * ➔ **Hacia Solicitud de compra:** Si al explotar la receta faltan insumos crudos, la orden de producción exige comprar antes de cocinar.  
  * ➔ **Hacia Orden de movimiento:** Si los insumos existen pero están en otro almacén, dispara un traslado interno.  
* **Ejecución:** Una vez asegurados los insumos a través de los movimientos internos, se ejecuta la transformación, descontando la materia prima y dando de alta el Producto terminado en el Kardex.

### **5.5. Ruta de Logística Interna y Salidas**

Flujo para la redistribución y baja de mercadería sin fines de venta.

* **Secuencia de Traslado:** Orden de movimiento ➔ Movimiento interno.  
* **Documentación y Baja:** Movimiento interno ➔ Guía interna ➔ Salida.  
* **Regla de Negocio:** La *Guía interna* se utiliza para justificar traslados por vía pública (GRE). La *Salida* se usa como destino final para retirar Consumibles (uso operativo) o dar de baja Insumos/Productos mermados, sin generar ingresos económicos.

Si mi objetivo exclusivo es programar, estabilizar y escalar el bot E2E (Playwright), el documento resuelve la lógica de negocio, pero deja vacíos críticos sobre **la manipulación del DOM, la gestión de estado de las pruebas y la arquitectura de la interfaz**. Al leer el manual, me surgirían las siguientes dudas técnicas operativas:

* **Sincronización del DOM (El manejo de Spinners):** El documento indica que durante el guardado, el Controller enciende un *spinner* y la interfaz se bloquea hasta recibir el 200 OK SUCCESS.  
  * *La duda del Bot:* ¿Cómo está implementado ese *spinner* en el HTML? ¿Es un elemento global (ej. \<div id="loading"\>) que el bot pueda esperar explícitamente (page.waitForSelector('\#loading', { state: 'hidden' })), o el bot tendrá que interceptar directamente el tráfico de red de la API RESTful para saber cuándo terminó la transacción?  
* **Gestión del Estado de Prueba (El problema del Kardex residual):** El manual estipula que los procesos de Producción y Almacenes descuentan el stock físico.  
  * *La duda del Bot:* Si la suite de pruebas E2E corre 50 veces al día en el entorno de integración, el inventario del bot quedará en negativo rápidamente. ¿Existe un *endpoint* oculto en la API (Backend) para inyectar un *seed* de datos y resetear el Kardex antes de cada ejecución, o el bot está obligado a ejecutar un "Cuadre de Stock Masivo" mediante Excel para devolver el almacén a cero tras cada prueba?  
* **Captura de *Hard-Stops* (Aserciones de Pruebas Negativas):** La arquitectura indica que si el Validator de PHP falla, el sistema retorna un JSON con {tipo: 'error', mensajes: \[...\]} y el Template muestra una notificación roja. Además, el sistema "bloquea su guardado si carece de Proveedor".  
  * *La duda del Bot:* Para programar pruebas negativas exitosas, ¿cómo se materializa ese bloqueo en AngularJS? ¿El botón de guardar recibe el atributo disabled, o simplemente se lanza un *toast* (ej. SweetAlert2) en pantalla? El bot necesita los selectores CSS exactos de los contenedores de error para verificar que el sistema efectivamente detuvo la mala operación.  
* **Virtualización de Grillas vs. Renderizado Estándar:** El documento menciona el manejo de plantillas con cientos de registros (Importaciones Masivas) y tableros como "Distribución de Órdenes de Compra" y explosión de materiales.  
  * *La duda del Bot:* ¿Las tablas en el Frontend (Template HTML) renderizan todos los nodos en el DOM a la vez, o utilizan virtualización (como *HandsOnTable*, que destruye las filas que no están visibles en la pantalla)? Si la grilla es virtual, el bot no podrá usar selectores convencionales (tr:nth-child(50)) y obligará a inyectar datos directamente en el \$scope de la *Collection* en memoria.  
* **Interacciones con Terceros (Mocking de SUNAT):** Se detalla que la GRE (Guía de Remisión Electrónica) exige la emisión obligatoria de un XML a la autoridad tributaria (SUNAT).  
  * *La duda del Bot:* Si el bot automatiza la creación de una Guía de Remisión, ¿la prueba disparará un XML real a los servidores de SUNAT? ¿Debe el bot interceptar la petición RESTful de salida y simular (mockear) la respuesta de SUNAT para evitar enviar basura a la base de datos gubernamental durante la integración continua?

