const fetch = require("node-fetch");

// Configuración
const config = {
  token: process.env.NOTION_TOKEN,
  notion_version: "2022-06-28",
  database_id: process.env.NOTION_DATABASE_ID,
};

// Función para extraer datos de Notion
function extractNotionDataValue(data, label) {
  let field = data.properties[label];
  if (!field) return undefined;
  const fieldType = field.type;
  field = field[fieldType];
  switch (fieldType) {
    case "title":
    case "rich_text":
      return field[0]?.plain_text.trim();
    case "phone_number":
    case "email":
      return field?.trim();
    case "date":
      return field?.start.trim();
    case "multi_select":
      return field?.map((item) => item.name.trim()) ?? [];
    case "status":
    case "select":
      return field?.name.trim();
    case "formula":
      return field?.string?.trim() || field?.number;
    default:
      return undefined;
  }
}

const getStudentsData = async () => {
  const myHeaders = new fetch.Headers();
  myHeaders.append("Notion-Version", config.notion_version);
  myHeaders.append("Authorization", `Bearer ${config.token}`);
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    filter: {
      and: [
        { property: "GeekFORCE Stage", status: { equals: "Stage 1" } },
        { property: "Placement status", status: { equals: "To be placed" } },
        { property: "Educational Status", select: { equals: "Graduated" } },
        {
          property: "Cohort end date",
          rollup: { date: { on_or_after: "2025-04-12" } },
        },
      ],
    },
  });

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
  };

  const response = await fetch(
    `https://api.notion.com/v1/databases/${config.database_id}/query/`,
    requestOptions
  );
  const data = await response.json();

  const students = data.results
    .map((student) => {
      const daysNumber = extractNotionDataValue(student, "Days in Stage 1");
      const name = extractNotionDataValue(student, "Student");
      const slackId = extractNotionDataValue(student, "Slack ID");
      const coach = student.properties["GeekFORCE Coach"]?.select?.name;

      return {
        id: student.id,
        name,
        slackId,
        daysInStage1: daysNumber,
        coach,
        withinRange: daysNumber >= 15 && daysNumber < 30,
      };
    })
    .filter((student) => student.withinRange);

  // Enlaces Calendly por coach
  const coachLinks = {
    "Yoaní Palmás": "https://calendly.com/yoanipalmas/30min",
    "Melissa Zwanck": "https://calendly.com/melissazwanck/mentoring",
    "Cristina Crespo": "https://calendly.com/ccrespo-4geeksacademy/30min",
  };

  // Generar mensajes individuales para cada estudiante
  const messages = [];
  const timestamp = new Date().toISOString();

  students.forEach((student) => {
    if (!student.coach || !student.slackId) return;

    const calendlyLink =
      coachLinks[student.coach] || "https://calendly.com/4geeksacademy";
    const message =
      `<@${student.slackId}>\n\n` +
      `He notado que aún no has comenzado el proceso de Career Support.\n\n` +
      `Por favor, reserva tu <${calendlyLink} |🗓️ *primera sesión individual*> de la Etapa 1 en el calendario de tu coach.\n\n` +
      `También te dejo el enlace a la <https://www.notion.so/4geeksacademy/GeekFORCE-Student-Page-260b99bb21ab4555a46740473fe416e0 |📋 *guía GeekFORCE Student Page*> para que te prepares antes de la sesión.\n\n` +
      `Quedo atenta 😊`;

    messages.push({
      message,
      slackId: student.slackId,
      coachIdentifier: student.coach,
      timestamp,
    });
  });

  return messages;
};

// Ejecutar la función
const main = async () => {
  try {
    const messages = await getStudentsData();
    console.log(JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
};

main();
