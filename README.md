# Flujo de Seguimiento GeekFORCE (Stage 1 y Stage 2)

Este proyecto automatiza el seguimiento de estudiantes en las etapas 1 y 2 del proceso de Career Support de GeekFORCE, utilizando Notion como base de datos y enviando mensajes personalizados a Slack a través de un webhook (por ejemplo, usando Zapier).

## ¿Qué hace este proyecto?

- Consulta la base de datos de estudiantes en Notion.
- Clasifica a los estudiantes según su progreso y tiempo en cada etapa.
- Genera mensajes personalizados para Slack según reglas de negocio.
- Envía los mensajes a través de un webhook.
- Actualiza campos y etiquetas en Notion para mantener el seguimiento.
- Se ejecuta automáticamente cada jueves a las 10:00 (hora de España) mediante GitHub Actions.

## Estructura de archivos

- `v3.js`: Script principal con toda la lógica de consulta, clasificación, generación de mensajes y actualización de Notion.
- `notion-students.js`, `zappier.js`: Scripts auxiliares o versiones previas (pueden contener utilidades o lógica relacionada).
- `.github/workflows/ejecutar_index.yml`: Flujo de GitHub Actions para la ejecución automática semanal.
- `package.json` y `package-lock.json`: Definición de dependencias y scripts de npm.

## Requisitos

- Node.js 20+
- Una base de datos de Notion con los campos requeridos.
- Un webhook configurado (por ejemplo, Zapier) para enviar mensajes a Slack.
- Variables de entorno:
  - `NOTION_TOKEN`: Token de integración de Notion.
  - `NOTION_DATABASE_ID`: ID de la base de datos de Notion.
  - `ZAPIER_WEBHOOK_URL`: URL del webhook para enviar los mensajes.

## Instalación y configuración

1. Clona este repositorio:
   ```bash
   git clone <URL-del-repo>
   cd <nombre-del-repo>
   ```
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Crea un archivo `.env` en la raíz del proyecto con el siguiente contenido:
   ```env
   NOTION_TOKEN=tu_token_de_notion
   NOTION_DATABASE_ID=tu_database_id
   ZAPIER_WEBHOOK_URL=tu_webhook_url
   ```

## Uso local

Puedes ejecutar el script en modo prueba (no realiza cambios en Notion ni envía mensajes reales):

```bash
node v3.js
```

Para ejecución real, ajusta el parámetro en la función `main(false)` dentro de `v3.js`.

## Automatización con GitHub Actions

El flujo `.github/workflows/ejecutar_index.yml` ejecuta el script automáticamente todos los jueves a las 10:00 (hora de España). Asegúrate de configurar los secretos del repositorio (`NOTION_TOKEN`, `NOTION_DATABASE_ID`, `ZAPIER_WEBHOOK_URL`) en la sección de _Settings > Secrets_ de GitHub.

## Personalización

- Puedes modificar los mensajes y reglas de negocio en el archivo `v3.js`.
- Si necesitas agregar nuevos coaches o enlaces de Calendly, edítalos en el objeto `calendly` dentro del script.

## Licencia

MIT

---

¿Dudas o sugerencias? Abre un issue o contacta con el equipo de desarrollo.
